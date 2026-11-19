// 「加一个自定义模型」弹窗的纯逻辑：临时目录 + 假加密 + 假 probe，照 test/settings/models.test.mjs 那一套。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { addCustom, loadCatalog, saveCatalog, updateEntry } from '../../app/models/catalog.mjs'
import { modelFiles } from '../../app/models/files.mjs'
import { createKeyring } from '../../app/models/keys.mjs'
import {
  NO_MODEL_TEXT,
  applyPreset,
  blankForm,
  canSave,
  contextLabel,
  customForm,
  dialogPayload,
  editModel,
  formToEntry,
  missingFields,
  missingText,
  testAndSave,
} from '../../app/settings/custom.mjs'

// 假钥匙不以 sk- 开头
const KEY_A = 'demo-key-alpha-value'
const KEY_B = 'demo-key-beta-value'

// 假加密：异或一下，够测试用
function xor() {
  return {
    available: () => true,
    encrypt(text) {
      const buf = Buffer.from(text, 'utf8')
      for (let i = 0; i < buf.length; i++) buf[i] ^= 0x5a
      return buf
    },
    decrypt(buf) {
      const copy = Buffer.from(buf)
      for (let i = 0; i < copy.length; i++) copy[i] ^= 0x5a
      return copy.toString('utf8')
    },
  }
}

// 假 probe：记下收到的入参，按脚本回话
function fakeProbe(script) {
  const seen = []
  const probe = async (input) => {
    seen.push(input)
    return typeof script === 'function' ? script(input) : script
  }
  return { probe, seen }
}

const OK_PROBE = { ok: true, listed: true, models: [], message: '通了' }

// 搭一个临时桌伴根：清单和钥匙都落在里面
function stage(options = {}) {
  const { custom = null } = options
  const root = mkdtempSync(join(tmpdir(), 'sidemate-settings-custom-'))
  const files = modelFiles(root)
  const keyring = createKeyring({ root, crypto: xor() })
  let catalog = loadCatalog(files.catalog)
  let customId = null
  if (custom) {
    const added = addCustom(catalog, custom)
    assert.equal(added.ok, true)
    catalog = added.catalog
    customId = added.id
  }
  saveCatalog(files.catalog, catalog)
  return {
    files,
    keyring,
    customId,
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

// 一份能过校验的表单：预设智谱，模型是 GLM-4.7-Flash
function zhipuForm(extra = {}) {
  const form = applyPreset(blankForm(), 'zhipu')
  form.key = KEY_A
  return { ...form, ...extra }
}

// 一份自己填的表单：标准三项都齐了
function ownForm(extra = {}) {
  const form = {
    ...blankForm(),
    name: '我家的',
    protocol: 'openai',
    baseUrl: 'https://api.example.test/v1',
    key: KEY_A,
    model: { ...blankForm().model, id: 'my-model', contextWindow: 128000, maxTokens: 4096 },
  }
  return { ...form, ...extra }
}

test('空表单：标准三项都没填', () => {
  const form = blankForm()
  assert.deepEqual(form.model, {
    id: '',
    name: '',
    contextWindow: null,
    maxTokens: null,
    efforts: [],
    effortValues: {},
    vision: false,
    thinkingFormat: null,
  })
  assert.deepEqual(missingFields(form), ['id', 'contextWindow', 'maxTokens'])
  assert.equal(missingText(form), '请填写模型 ID')
})

test('applyPreset 填名称、格式、地址和模型，自己填只清标记不动字段', () => {
  const form = applyPreset(blankForm(), 'zhipu')
  assert.equal(form.name, 'GLM')
  assert.equal(form.protocol, 'openai')
  assert.equal(form.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal(form.preset, 'zhipu')
  assert.equal(form.model.id, 'glm-4.7-flash')
  assert.equal(form.model.contextWindow, 200000)
  const edited = applyPreset({ ...form, name: '我家的智谱' }, null)
  assert.equal(edited.preset, null)
  assert.equal(edited.name, '我家的智谱')
  assert.equal(edited.baseUrl, form.baseUrl)
  assert.equal(edited.model.id, form.model.id)
})

test('标准三项必填：缺哪一项说哪一句', () => {
  const noId = ownForm({ model: { ...ownForm().model, id: '' } })
  assert.deepEqual(missingFields(noId), ['id'])
  assert.equal(missingText(noId), '请填写模型 ID')
  const noContext = ownForm({ model: { ...ownForm().model, contextWindow: null } })
  assert.equal(missingText(noContext), '请填写上下文窗口')
  const noMax = ownForm({ model: { ...ownForm().model, maxTokens: null } })
  assert.equal(missingText(noMax), '请填写最大输出')
  // 预设带来的表单不用用户填那几项
  assert.deepEqual(missingFields(zhipuForm()), [])
})

test('canSave：标准三项齐了、不在忙，才能点「测试并保存」', () => {
  assert.equal(canSave({ form: ownForm(), busy: false }), true)
  assert.equal(canSave({ form: ownForm(), busy: true }), false)
  assert.equal(canSave({ form: ownForm({ model: { ...ownForm().model, id: '' } }), busy: false }), false)
  assert.equal(canSave({}), false)
  // 智谱预设的表单也能存
  assert.equal(canSave({ form: zhipuForm(), busy: false }), true)
})

test('contextLabel：128000 显示成「上下文 128000」，没数显示按默认', () => {
  assert.equal(contextLabel(128000), '上下文 128000')
  assert.equal(contextLabel(1000), '上下文 1000')
  assert.equal(contextLabel(500), '上下文 500')
  assert.equal(contextLabel(null), '按默认')
  assert.equal(contextLabel(0), '按默认')
})

test('editModel 把改过的值合回模型', () => {
  const model = { id: 'm1', name: '模型一', contextWindow: 128000, maxTokens: 4096, efforts: [], vision: false }
  const edited = editModel(model, { name: '模型一', contextWindow: 64000, maxTokens: 4096, efforts: ['low', 'high'], vision: true })
  assert.equal(edited.name, '模型一')
  assert.equal(edited.contextWindow, 64000)
  assert.deepEqual(edited.efforts, ['low', 'high'])
  assert.equal(edited.vision, true)
  const renamed = editModel(model, { id: 'new-id' })
  assert.equal(renamed.id, 'new-id')
})

test('formToEntry 带上模型和高级项', () => {
  const entry = formToEntry(ownForm({
    model: {
      ...ownForm().model,
      efforts: ['high'],
      effortValues: { high: 'xhigh' },
      vision: true,
      thinkingFormat: 'deepseek',
    },
  }))
  assert.equal(entry.models.length, 1)
  assert.equal(entry.models[0].id, 'my-model')
  assert.equal(entry.models[0].contextWindow, 128000)
  assert.equal(entry.models[0].maxTokens, 4096)
  assert.deepEqual(entry.models[0].efforts, ['high'])
  assert.equal(entry.models[0].effortValues.high, 'xhigh')
  assert.equal(entry.models[0].vision, true)
  assert.equal(entry.models[0].thinkingFormat, 'deepseek')
})

test('customForm：新建给空表单，改已有的填好字段、钥匙空着', () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    const blank = customForm(loadCatalog(s.files.catalog), null)
    assert.equal(blank.ok, true)
    assert.deepEqual(blank.form, blankForm())
    const back = customForm(loadCatalog(s.files.catalog), s.customId)
    assert.equal(back.ok, true)
    assert.equal(back.form.id, s.customId)
    assert.equal(back.form.name, 'GLM')
    assert.equal(back.form.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
    assert.equal(back.form.key, '')
    assert.equal(back.form.model.id, 'glm-4.7-flash')
    assert.equal(customForm(loadCatalog(s.files.catalog), 'nope').ok, false)
  } finally {
    s.done()
  }
})

test('dialogPayload：表单、思考档位、思考参数格式一包给齐，都是能过 IPC 的普通值', () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    const back = dialogPayload(loadCatalog(s.files.catalog), s.customId)
    assert.equal(back.ok, true)
    assert.equal(back.form.id, s.customId)
    // 服务商预设的下拉去掉了
    assert.equal(back.presets, undefined)
    assert.deepEqual(back.efforts.map((one) => one.id), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    assert.ok(back.thinkingFormats.includes('deepseek'))
    assert.ok(back.thinkingFormats.includes('qwen'))
    JSON.stringify(back)
  } finally {
    s.done()
  }
})

test('测试失败不存：清单和钥匙都不动', async () => {
  const s = stage()
  try {
    const { probe, seen } = fakeProbe({ ok: false, kind: 'key', message: '密钥无效' })
    const back = await testAndSave(s.files, s.keyring, zhipuForm(), { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, '密钥无效')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].model, 'glm-4.7-flash')
    assert.equal(loadCatalog(s.files.catalog).entries.length, 2)
    assert.deepEqual(s.keyring.list(), [])
  } finally {
    s.done()
  }
})

test('存不上：写盘失败是那一句、那一个码（Si907）', async () => {
  const s = stage()
  try {
    const blocker = join(tmpdir(), `sidemate-custom-block-${process.pid}`)
    writeFileSync(blocker, 'x')
    const { probe } = fakeProbe(OK_PROBE)
    const back = await testAndSave({ ...s.files, catalog: join(blocker, '模型.json') }, s.keyring, zhipuForm(), { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, '保存失败 · Si907 错误')
  } finally {
    s.done()
  }
})

test('成功存清单和钥匙：条目、模型、钥匙都对上', async () => {
  const s = stage()
  try {
    const { probe } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring, zhipuForm(), { probe })
    assert.equal(back.ok, true)
    const onDisk = loadCatalog(s.files.catalog)
    const entry = onDisk.entries.find((item) => item.id === 'c-zhipu')
    assert.equal(entry.name, 'GLM')
    assert.equal(entry.protocol, 'openai')
    assert.deepEqual(entry.models.map((model) => model.id), ['glm-4.7-flash'])
    assert.equal(s.keyring.has('c-zhipu'), true)
    assert.equal(s.keyring.read('c-zhipu'), KEY_A)
    const row = back.rows.find((item) => item.id === 'c-zhipu')
    assert.equal(row.note, 'OpenAI 格式，1 个模型')
  } finally {
    s.done()
  }
})

test('标准三项没填齐时不能存，也不去测', async () => {
  const s = stage()
  try {
    const { probe, seen } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring, { ...zhipuForm(), preset: null, model: { ...zhipuForm().model, id: '' } }, { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, NO_MODEL_TEXT)
    assert.equal(seen.length, 0)
    assert.equal(loadCatalog(s.files.catalog).entries.length, 2)
    assert.deepEqual(s.keyring.list(), [])
  } finally {
    s.done()
  }
})

test('改已有的：钥匙框空着用原来的钥匙测，不换钥匙，改动写进清单', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    s.keyring.save(s.customId, KEY_B)
    const before = loadCatalog(s.files.catalog)
    const entry = before.entries.find((item) => item.id === s.customId)
    const form = customForm(before, s.customId).form
    const { probe, seen } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring,
      { ...form, name: '智谱备用', model: { ...form.model, maxTokens: 8192 } },
      { probe })
    assert.equal(back.ok, true)
    assert.equal(seen[0].key, KEY_B)
    assert.equal(s.keyring.read(s.customId), KEY_B)
    const onDisk = loadCatalog(s.files.catalog)
    const saved = onDisk.entries.find((item) => item.id === s.customId)
    assert.equal(saved.name, '智谱备用')
    assert.equal(saved.models[0].maxTokens, 8192)
    assert.equal(saved.baseUrl, entry.baseUrl)
    assert.equal(onDisk.entries.length, before.entries.length)
  } finally {
    s.done()
  }
})

test('改已有的：填了新钥匙才换，测试用新钥匙', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    s.keyring.save(s.customId, KEY_B)
    const form = customForm(loadCatalog(s.files.catalog), s.customId).form
    const { probe, seen } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring, { ...form, key: KEY_A }, { probe })
    assert.equal(back.ok, true)
    assert.equal(seen[0].key, KEY_A)
    assert.equal(s.keyring.read(s.customId), KEY_A)
  } finally {
    s.done()
  }
})

test('改已有的：没有已存钥匙又没填，先回话不测不存', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    const { probe, seen } = fakeProbe(OK_PROBE)
    const form = customForm(loadCatalog(s.files.catalog), s.customId).form
    const back = await testAndSave(s.files, s.keyring, form, { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, '密钥未填写')
    assert.equal(seen.length, 0)
  } finally {
    s.done()
  }
})

test('addCustom 的校验错误回给「测一下」旁边，不写盘', async () => {
  const s = stage()
  try {
    const { probe } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring,
      { ...ownForm(), name: '' }, { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, '名称不合规')
    assert.equal(loadCatalog(s.files.catalog).entries.length, 2)
  } finally {
    s.done()
  }
})

test('返回值里没有钥匙原文', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    s.keyring.save(s.customId, KEY_B)
    const form = customForm(loadCatalog(s.files.catalog), s.customId).form
    const { probe } = fakeProbe(OK_PROBE)
    const edited = await testAndSave(s.files, s.keyring, { ...form, key: KEY_A }, { probe })
    const fresh = await testAndSave(s.files, s.keyring, zhipuForm({ name: '再来一家' }), { probe })
    for (const back of [edited, fresh]) {
      const text = JSON.stringify(back)
      assert.equal(text.includes(KEY_A), false)
      assert.equal(text.includes(KEY_B), false)
    }
  } finally {
    s.done()
  }
})

test('上游忙照样存：条目和钥匙都落盘，回一句存好了', async () => {
  const s = stage()
  try {
    const { probe } = fakeProbe({ ok: false, kind: 'busy', message: '那边太忙，过一会儿再测' })
    const back = await testAndSave(s.files, s.keyring, zhipuForm(), { probe })
    assert.equal(back.ok, true)
    assert.equal(back.message, '测试成功，模型返回：那边太忙，过一会儿再测')
    const onDisk = loadCatalog(s.files.catalog)
    const entry = onDisk.entries.find((item) => item.id === 'c-zhipu')
    assert.equal(entry.name, 'GLM')
    assert.equal(s.keyring.has('c-zhipu'), true)
    assert.equal(back.rows.find((item) => item.id === 'c-zhipu').note, 'OpenAI 格式，1 个模型')
  } finally {
    s.done()
  }
})

test('余额不够也存（那边 402 算 other），地址不对、钥匙不对、连不上都不存', async () => {
  const s = stage()
  try {
    const quota = await testAndSave(s.files, s.keyring, zhipuForm(), { probe: fakeProbe({ ok: false, kind: 'other', message: '余额不够，先去充值' }).probe })
    assert.equal(quota.ok, true)
    assert.equal(quota.message, '测试失败，信息已保存')
  } finally {
    s.done()
  }

  for (const kind of ['key', 'address', 'https', 'network']) {
    const one = stage()
    try {
      const { probe } = fakeProbe({ ok: false, kind, message: '没测成' })
      const back = await testAndSave(one.files, one.keyring, zhipuForm(), { probe })
      assert.equal(back.ok, false, `${kind} 不该存`)
      assert.equal(loadCatalog(one.files.catalog).entries.length, 2)
      assert.deepEqual(one.keyring.list(), [])
    } finally {
      one.done()
    }
  }
})

test('给已有的条目加一个模型：钥匙不动，条目那几样不动，模型添在后面', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    s.keyring.save(s.customId, KEY_B)
    const form = customForm(loadCatalog(s.files.catalog), s.customId, { mode: 'add' }).form
    assert.equal(form.mode, 'add')
    assert.equal(form.name, 'GLM')
    assert.equal(form.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
    assert.equal(form.model.id, '')
    const { probe, seen } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring,
      { ...form, model: { ...form.model, id: 'glm-4.6', contextWindow: 200000, maxTokens: 8192 } },
      { probe })
    assert.equal(back.ok, true)
    assert.equal(seen[0].key, KEY_B)
    assert.equal(seen[0].model, 'glm-4.6')
    const entry = loadCatalog(s.files.catalog).entries.find((item) => item.id === s.customId)
    assert.deepEqual(entry.models.map((model) => model.id), ['glm-4.7-flash', 'glm-4.6'])
    assert.equal(entry.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
    assert.equal(s.keyring.read(s.customId), KEY_B)
  } finally {
    s.done()
  }
})

test('加模型时标准三项还是要填，填不齐就不测不存', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    const form = customForm(loadCatalog(s.files.catalog), s.customId, { mode: 'add' }).form
    const { probe, seen } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring, form, { probe })
    assert.equal(back.ok, false)
    assert.equal(back.message, '请填写模型 ID')
    assert.equal(seen.length, 0)
    const entry = loadCatalog(s.files.catalog).entries.find((item) => item.id === s.customId)
    assert.equal(entry.models.length, 1)
  } finally {
    s.done()
  }
})

test('改第二个模型：只换那一个，别的不动', async () => {
  const s = stage({ custom: { preset: 'zhipu' } })
  try {
    s.keyring.save(s.customId, KEY_B)
    const catalog = loadCatalog(s.files.catalog)
    const withTwo = updateEntry(catalog, s.customId, {
      models: [
        ...catalog.entries.find((item) => item.id === s.customId).models,
        { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 8192 },
      ],
    })
    assert.equal(withTwo.ok, true)
    saveCatalog(s.files.catalog, withTwo.catalog)
    const form = customForm(loadCatalog(s.files.catalog), s.customId, { modelIndex: 1 }).form
    assert.equal(form.mode, 'edit')
    assert.equal(form.model.id, 'glm-4.6')
    const { probe } = fakeProbe(OK_PROBE)
    const back = await testAndSave(s.files, s.keyring,
      { ...form, model: { ...form.model, maxTokens: 16384 } }, { probe })
    assert.equal(back.ok, true)
    const entry = loadCatalog(s.files.catalog).entries.find((item) => item.id === s.customId)
    assert.deepEqual(entry.models.map((model) => model.id), ['glm-4.7-flash', 'glm-4.6'])
    assert.equal(entry.models[1].maxTokens, 16384)
    assert.equal(entry.models[0].maxTokens, null)
  } finally {
    s.done()
  }
})
