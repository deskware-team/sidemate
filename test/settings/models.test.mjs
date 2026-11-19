// 「模型」页的行数据和三个动作：临时目录 + 假加密，照 test/models/keys.test.mjs 那一套。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { addCustom, defaults, loadCatalog, saveCatalog, setDefault, updateEntry } from '../../app/models/catalog.mjs'
import { createConsent } from '../../app/models/consent.mjs'
import { modelFiles } from '../../app/models/files.mjs'
import { createKeyring } from '../../app/models/keys.mjs'
import {
  BROKEN_DEFAULT_TEXT,
  addKiloEntry,
  chooseDefault,
  guideAction,
  modelRows,
  removeCustom,
  removeKey,
  removeKilo,
  rowsWarning,
  setConcurrency,
} from '../../app/settings/models.mjs'

// 假钥匙不以 sk- 开头
const KEY_DEEPSEEK = 'demo-key-deepseek-value'
const KEY_CUSTOM = 'demo-key-custom-value'

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

// 两条自定义条目的输入：一条两个模型的 Anthropic 格式，一条预设智谱
const CUSTOM_TWO = {
  name: '测试接口',
  protocol: 'anthropic',
  baseUrl: 'https://api.example.test/v1',
  models: [{ id: 'one' }, { id: 'two' }],
}
const CUSTOM_ZHIPU = { preset: 'zhipu' }

// 搭一个临时桌伴根：清单、同意、次数、钥匙都落在里面，view 跟页面用的同一种形状
function stage(options = {}) {
  const { deepseekKey = true, custom = null, customKey = false, agreed = false, defaultEntry = null } = options
  const root = mkdtempSync(join(tmpdir(), 'sidemate-settings-models-'))
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
  if (defaultEntry) {
    const entry = catalog.entries.find((item) => item.id === defaultEntry)
    const picked = setDefault(catalog, { entry: defaultEntry, model: entry.models[0].id, effort: null })
    assert.equal(picked.ok, true)
    catalog = picked.catalog
  }
  const written = catalog
  saveCatalog(files.catalog, written)
  if (deepseekKey) keyring.save('deepseek', KEY_DEEPSEEK)
  if (customId && customKey) keyring.save(customId, KEY_CUSTOM)
  if (agreed) createConsent({ file: files.consent }).agree({ terms: true, crossBorder: true })
  const view = {
    hasKey: (id) => keyring.has(id),
    consent: createConsent({ file: files.consent }).status(),
  }
  return {
    root,
    files,
    keyring,
    view,
    customId,
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

function rowOf(rows, id) {
  return rows.find((row) => row.id === id)
}

test('钥匙解不开：那一行写去设置·模型里重新填一次，圆点不能选', () => {
  const s = stage({ deepseekKey: true, custom: CUSTOM_ZHIPU, customKey: true, agreed: true })
  try {
    const rows = modelRows({
      catalog: loadCatalog(s.files.catalog),
      ...s.view,
      brokenKey: (id) => id === s.customId,
    })
    const custom = rowOf(rows, s.customId)
    assert.equal(custom.note, '密钥无效')
    assert.equal(custom.broken, true)
    assert.equal(custom.canBeDefault, false)
    assert.equal(custom.whyNot, '密钥无效')
    // 没坏的那一行不受影响
    const deepseek = rowOf(rows, 'deepseek')
    assert.equal(deepseek.note, 'sk-xx***xxxx')
    assert.equal(deepseek.canBeDefault, true)
  } finally {
    s.done()
  }
})

test('没同意、没钥匙时三类行的小字，圆点都不能选', () => {
  const s = stage({ deepseekKey: false, custom: CUSTOM_TWO, customKey: false, agreed: false })
  try {
    const rows = modelRows({ catalog: loadCatalog(s.files.catalog), ...s.view })
    const kilo = rowOf(rows, 'kilo')
    assert.equal(kilo.note, '')
    assert.equal(kilo.canBeDefault, false)
    assert.equal(kilo.whyNot, '必须阅读并同意使用须知')
    assert.deepEqual(kilo.buttons, [
      { id: 'guide', label: '使用须知' },
      { id: 'remove', label: '删除' },
    ])
    assert.deepEqual(kilo.tags, [])
    // 并发上限：Kilo 默认 1，能改
    assert.equal(kilo.concurrency, 1)
    assert.equal(kilo.canSetConcurrency, true)
    const deepseek = rowOf(rows, 'deepseek')
    assert.equal(deepseek.note, '未填写密钥')
    assert.equal(deepseek.canBeDefault, false)
    assert.deepEqual(deepseek.buttons, [])
    assert.equal(deepseek.isDefault, true)
    assert.deepEqual(deepseek.tags, ['默认'])
    const custom = rowOf(rows, s.customId)
    assert.equal(custom.kind, 'custom')
    assert.equal(custom.note, 'Anthropic 格式，2 个模型，未填写密钥')
    assert.equal(custom.canBeDefault, false)
    assert.deepEqual(custom.buttons, [
      { id: 'add-model', label: '加模型' },
      { id: 'remove', label: '删除' },
    ])
    assert.deepEqual(custom.tags, ['自定义'])
  } finally {
    s.done()
  }
})

test('同意过、有钥匙时小字换成状态，圆点能选，按钮齐全', () => {
  const s = stage({ deepseekKey: true, custom: CUSTOM_ZHIPU, customKey: true, agreed: true })
  try {
    const rows = modelRows({ catalog: loadCatalog(s.files.catalog), ...s.view })
    const kilo = rowOf(rows, 'kilo')
    // Kilo 那行不写额度小字
    assert.equal(kilo.note, '')
    assert.equal(kilo.canBeDefault, true)
    assert.equal(kilo.whyNot, null)
    const deepseek = rowOf(rows, 'deepseek')
    assert.equal(deepseek.note, 'sk-xx***xxxx')
    assert.equal(deepseek.canBeDefault, true)
    assert.deepEqual(deepseek.buttons, [
      { id: 'change-key', label: '修改密钥' },
      { id: 'remove-key', label: '删除密钥' },
    ])
    const custom = rowOf(rows, s.customId)
    assert.equal(custom.note, 'OpenAI 格式，1 个模型')
    assert.equal(custom.canBeDefault, true)
    assert.deepEqual(custom.buttons, [
      { id: 'add-model', label: '加模型' },
      { id: 'remove', label: '删除' },
    ])
    assert.equal(rowsWarning(rows), null)
  } finally {
    s.done()
  }
})

test('没同意不能把 Kilo 选成默认，写盘不动', () => {
  const s = stage({ agreed: false })
  try {
    const back = chooseDefault(s.files, 'kilo', s.view)
    assert.equal(back.ok, false)
    assert.equal(back.message, '必须阅读并同意使用须知')
    assert.equal(loadCatalog(s.files.catalog).default.entry, 'deepseek')
  } finally {
    s.done()
  }
})

test('没钥匙不能把自定义条目选成默认', () => {
  const s = stage({ custom: CUSTOM_TWO, customKey: false })
  try {
    const back = chooseDefault(s.files, s.customId, s.view)
    assert.equal(back.ok, false)
    assert.equal(back.message, '需填入密钥')
    assert.equal(loadCatalog(s.files.catalog).default.entry, 'deepseek')
  } finally {
    s.done()
  }
})

test('chooseDefault 写盘：模型取该条目第一个，档位留空', () => {
  const s = stage({ agreed: true, custom: CUSTOM_TWO, customKey: true })
  try {
    const back = chooseDefault(s.files, s.customId, s.view)
    assert.equal(back.ok, true)
    assert.deepEqual(loadCatalog(s.files.catalog).default, {
      entry: s.customId,
      model: 'one',
      effort: null,
    })
    assert.equal(rowOf(back.rows, s.customId).isDefault, true)
    assert.equal(rowOf(back.rows, 'deepseek').isDefault, false)
    assert.equal(back.warning, null)
    chooseDefault(s.files, 'kilo', s.view)
    assert.deepEqual(loadCatalog(s.files.catalog).default, {
      entry: 'kilo',
      model: 'kilo-auto/free',
      effort: null,
    })
  } finally {
    s.done()
  }
})

test('chooseDefault 不认识的条目报错不写盘', () => {
  const s = stage()
  try {
    const back = chooseDefault(s.files, 'nope', s.view)
    assert.equal(back.ok, false)
    assert.equal(back.message, '')
    assert.equal(loadCatalog(s.files.catalog).default.entry, 'deepseek')
  } finally {
    s.done()
  }
})

test('removeCustom 把条目和钥匙都删，默认回到 DeepSeek', () => {
  const s = stage({ deepseekKey: false, custom: CUSTOM_TWO, customKey: true, defaultEntry: null })
  try {
    const picked = chooseDefault(s.files, s.customId, s.view)
    assert.equal(picked.ok, true)
    const back = removeCustom(s.files, s.keyring, s.customId, s.view)
    assert.equal(back.ok, true)
    assert.equal(rowOf(back.rows, s.customId), undefined)
    assert.equal(rowOf(back.rows, 'deepseek').isDefault, true)
    assert.equal(back.warning, '默认模型不可用')
    const onDisk = loadCatalog(s.files.catalog)
    assert.equal(onDisk.entries.some((entry) => entry.id === s.customId), false)
    assert.deepEqual(onDisk.default, { entry: 'deepseek', model: 'deepseek-flash', effort: null })
    assert.equal(s.keyring.has(s.customId), false)
  } finally {
    s.done()
  }
})

test('removeCustom 删的不是默认时顶上不提醒', () => {
  const s = stage({ custom: CUSTOM_ZHIPU, customKey: true })
  try {
    const back = removeCustom(s.files, s.keyring, s.customId, s.view)
    assert.equal(back.ok, true)
    assert.equal(back.warning, null)
    assert.equal(rowOf(back.rows, 'deepseek').isDefault, true)
  } finally {
    s.done()
  }
})

test('removeKey 后该行变回还没填钥匙，删的是默认时顶上提醒', () => {
  const s = stage({ deepseekKey: true })
  try {
    const back = removeKey(s.files, s.keyring, 'deepseek', s.view)
    assert.equal(back.ok, true)
    const deepseek = rowOf(back.rows, 'deepseek')
    assert.equal(deepseek.note, '未填写密钥')
    assert.equal(deepseek.canBeDefault, false)
    assert.deepEqual(deepseek.buttons, [])
    assert.equal(deepseek.isDefault, true)
    assert.equal(back.warning, BROKEN_DEFAULT_TEXT)
    assert.equal(s.keyring.has('deepseek'), false)
  } finally {
    s.done()
  }
})

test('removeKey 删的不是默认条目时顶上不提醒', () => {
  const s = stage({ custom: CUSTOM_TWO, customKey: true })
  try {
    const back = removeKey(s.files, s.keyring, s.customId, s.view)
    assert.equal(back.ok, true)
    assert.equal(back.warning, null)
    assert.equal(rowOf(back.rows, s.customId).note, 'Anthropic 格式，2 个模型，未填写密钥')
    assert.equal(s.keyring.has('deepseek'), true)
  } finally {
    s.done()
  }
})

test('guideAction：没同意过先弹同意弹窗', () => {
  const s = stage({ agreed: false })
  try {
    const rows = modelRows({ catalog: loadCatalog(s.files.catalog), ...s.view })
    assert.equal(guideAction(rowOf(rows, 'free')), 'consent')
  } finally {
    s.done()
  }
})

test('guideAction：同意过的是当前这一版，直接看条款全文', () => {
  const s = stage({ agreed: true })
  try {
    const rows = modelRows({ catalog: loadCatalog(s.files.catalog), ...s.view })
    assert.equal(guideAction(rowOf(rows, 'kilo')), 'doc')
  } finally {
    s.done()
  }
})

test('guideAction：同意的是以前那一版条款，还是先弹同意弹窗', () => {
  const s = stage({ agreed: false })
  try {
    // 写一份以前的版本的同意记录，当前这一版还没同意
    createConsent({ file: s.files.consent, version: '0.9' }).agree({
      terms: true,
      crossBorder: true,
    })
    const status = createConsent({ file: s.files.consent }).status()
    assert.equal(status.agreed, false)
    assert.equal(status.stale, true)
    const view = { ...s.view, consent: status }
    const rows = modelRows({ catalog: loadCatalog(s.files.catalog), ...view })
    assert.equal(guideAction(rowOf(rows, 'free')), 'consent')
  } finally {
    s.done()
  }
})

test('rows 里没有钥匙原文', () => {
  const s = stage({ deepseekKey: true, custom: CUSTOM_ZHIPU, customKey: true, agreed: true })
  try {
    for (const back of [
      modelRows({ catalog: loadCatalog(s.files.catalog), ...s.view }),
      chooseDefault(s.files, s.customId, s.view).rows,
      removeKey(s.files, s.keyring, 'c-zhipu', s.view).rows,
    ]) {
      const text = JSON.stringify(back)
      assert.equal(text.includes(KEY_DEEPSEEK), false)
      assert.equal(text.includes(KEY_CUSTOM), false)
    }
  } finally {
    s.done()
  }
})

test('删 Kilo：条目删掉，两个同意一起撤回', () => {
  const s = stage({ agreed: true })
  try {
    const back = removeKilo(s.files, s.view)
    assert.equal(back.ok, true)
    assert.equal(loadCatalog(s.files.catalog).entries.some((row) => row.id === 'kilo'), false)
    const consent = createConsent({ file: s.files.consent }).status()
    assert.equal(consent.agreed, false)
    // 加回来以后要重新同意
    const added = addKiloEntry(s.files, s.view)
    assert.equal(added.ok, true)
    const entry = loadCatalog(s.files.catalog).entries.find((row) => row.id === 'kilo')
    assert.equal(entry.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
    assert.equal(createConsent({ file: s.files.consent }).status().agreed, false)
    const rows = modelRows({
      catalog: loadCatalog(s.files.catalog),
      hasKey: s.view.hasKey,
      consent: createConsent({ file: s.files.consent }).status(),
    })
    assert.equal(rowOf(rows, 'kilo').canBeDefault, false)
  } finally {
    s.done()
  }
})

test('并发上限能改：0 是不限，写进清单', () => {
  const s = stage({ custom: CUSTOM_ZHIPU, customKey: true })
  try {
    const back = setConcurrency(s.files, s.customId, 4, s.view)
    assert.equal(back.ok, true)
    const entry = loadCatalog(s.files.catalog).entries.find((row) => row.id === s.customId)
    assert.equal(entry.concurrency, 4)
    const zero = setConcurrency(s.files, s.customId, 0, s.view)
    assert.equal(zero.ok, true)
    assert.equal(loadCatalog(s.files.catalog).entries.find((row) => row.id === s.customId).concurrency, 0)
  } finally {
    s.done()
  }
})

test('自定义那一行：底下几个模型各有一个名字，另有「加模型」那个按钮', () => {
  const catalog = addCustom(defaults(), { preset: 'zhipu' }).catalog
  const withTwo = updateEntry(catalog, 'c-zhipu', {
    models: [
      ...catalog.entries.find((item) => item.id === 'c-zhipu').models,
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 8192 },
    ],
  })
  const rows = modelRows({ catalog: withTwo.catalog, hasKey: () => true, consent: { agreed: true } })
  const row = rows.find((one) => one.id === 'c-zhipu')
  assert.deepEqual(row.models.map((one) => one.id), ['glm-4.7-flash', 'glm-4.6'])
  assert.deepEqual(row.models.map((one) => one.name), ['GLM-4.7-Flash', 'GLM-4.6'])
  assert.ok(row.buttons.some((one) => one.id === 'add-model'))
  assert.ok(row.buttons.some((one) => one.id === 'remove'))
})

test('并发上限：每个条目都能改，DeepSeek 默认不限', () => {
  const rows = modelRows({ catalog: defaults(), hasKey: () => true, consent: { agreed: true } })
  const deepseek = rowOf(rows, 'deepseek')
  assert.equal(deepseek.concurrency, 0)
  assert.equal(deepseek.canSetConcurrency, true)
  const kilo = rowOf(rows, 'kilo')
  assert.equal(kilo.concurrency, 1)
  // 智谱那把密钥默认 1
  const catalog = addCustom(defaults(), { preset: 'zhipu' }).catalog
  const zhipu = rowOf(modelRows({ catalog, hasKey: () => true, consent: { agreed: true } }), 'c-zhipu')
  assert.equal(zhipu.concurrency, 1)
})
