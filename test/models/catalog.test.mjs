import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  EFFORTS,
  EFFORT_LABELS,
  PRESETS,
  addCustom,
  addKilo,
  defaults,
  entryDetail,
  limitOf,
  loadCatalog,
  normalizeModel,
  removeEntry,
  saveCatalog,
  setDefault,
  stripSecrets,
  updateEntry,
  usable,
  validateEntry,
} from '../../app/models/catalog.mjs'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'sidemate-models-'))
}

// 一条能通过校验的自定义条目，按需覆盖字段。
function customEntry(overrides = {}) {
  return {
    id: 'x',
    kind: 'custom',
    name: '自定',
    protocol: 'openai',
    baseUrl: 'https://a.example/v1',
    models: [{ id: 'm1' }],
    ...overrides,
  }
}

test('档位、标签和预设按定好的值导出', () => {
  assert.deepEqual(EFFORTS, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(EFFORT_LABELS, {
    off: '关',
    minimal: '最低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '很高',
    max: '最高',
  })
  assert.deepEqual(Object.keys(PRESETS), ['zhipu'])
  assert.equal(PRESETS.kimi, undefined)
  assert.equal(PRESETS.zhipu.protocol, 'openai')
  assert.equal(PRESETS.zhipu.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal(PRESETS.zhipu.concurrency, 1)
  assert.deepEqual(PRESETS.zhipu.models, [
    { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200000, singleConcurrent: true },
  ])
})

test('初始清单是 Kilo 和 DeepSeek 两条', () => {
  const catalog = defaults()
  assert.equal(catalog.version, 1)
  assert.deepEqual(catalog.default, { entry: 'deepseek', model: 'deepseek-flash', effort: null })
  const [kilo, deepseek] = catalog.entries
  assert.equal(kilo.id, 'kilo')
  // kind 这一档是「这条线路不用密钥」的意思
  assert.equal(kilo.kind, 'free')
  assert.equal(kilo.name, 'Kilo 模型')
  assert.equal(kilo.protocol, 'openai')
  assert.equal(kilo.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
  assert.equal(kilo.keyless, undefined)
  assert.equal(kilo.concurrency, 1)
  assert.deepEqual(kilo.models, [
    {
      id: 'kilo-auto/free',
      name: 'Kilo 模型',
      contextWindow: 256000,
      maxTokens: 32000,
      efforts: [],
      effortValues: {},
      vision: false,
      thinkingFormat: null,
      singleConcurrent: true,
      auto: {},
    },
  ])
  assert.equal(deepseek.id, 'deepseek')
  assert.equal(deepseek.kind, 'deepseek')
  assert.equal(deepseek.protocol, 'anthropic')
  assert.equal(deepseek.baseUrl, 'https://api.deepseek.com/anthropic')
  assert.equal(deepseek.models[0].id, 'deepseek-flash')
  assert.equal(deepseek.models[0].vision, true)
  assert.deepEqual(validateEntry(kilo), [])
  assert.deepEqual(validateEntry(deepseek), [])
})

test('内置 DeepSeek 带四档思考，没有 medium', () => {
  const [, deepseek] = defaults().entries
  assert.deepEqual(deepseek.models[0].efforts, ['off', 'low', 'high', 'max'])
  assert.equal(deepseek.models[0].efforts.includes('medium'), false)
})

test('normalizeModel 补默认值并把档位排成固定顺序', () => {
  assert.deepEqual(normalizeModel({ id: 'm1' }), {
    id: 'm1',
    name: 'm1',
    contextWindow: null,
    maxTokens: null,
    efforts: [],
    effortValues: {},
    vision: false,
    thinkingFormat: null,
    singleConcurrent: false,
    auto: {},
  })
  assert.deepEqual(
    normalizeModel({
      id: 'm2',
      name: ' M2 ',
      efforts: ['high', 'turbo', 'off', 'high'],
      contextWindow: 0,
      vision: 1,
      auto: { contextWindow: true },
    }),
    {
      id: 'm2',
      name: ' M2 ',
      contextWindow: null,
      maxTokens: null,
      efforts: ['off', 'high'],
      effortValues: {},
      vision: false,
      thinkingFormat: null,
      singleConcurrent: false,
      auto: { contextWindow: true },
    },
  )
})

test('协议只能是两种，地址要 https', () => {
  // 协议不对用户改不了什么：只说「配置错误」，哪条没过在 entryDetail 里（进日志）
  assert.deepEqual(validateEntry(customEntry({ protocol: 'google' })), ['配置错误'])
  assert.equal(entryDetail(customEntry({ protocol: 'google' })), 'bad protocol: google')
  assert.ok(validateEntry(customEntry({ baseUrl: 'http://a.example/v1' })).includes('网址格式错误'))
  assert.ok(validateEntry(customEntry({ baseUrl: 'ftp://a.example/v1' })).includes('网址格式错误'))
  assert.ok(validateEntry(customEntry({ baseUrl: 'http://localhost.evil.com/v1' })).includes('网址格式错误'))
  assert.deepEqual(validateEntry(customEntry({ baseUrl: 'http://localhost:11434/v1' })), [])
  assert.deepEqual(validateEntry(customEntry({ baseUrl: 'http://127.0.0.1:8080' })), [])
})

test('名称去空格后要 1 到 20 个字', () => {
  assert.ok(validateEntry(customEntry({ name: '   ' })).includes('名称不合规'))
  assert.ok(validateEntry(customEntry({ name: 'x'.repeat(21) })).includes('名称不合规'))
  assert.deepEqual(validateEntry(customEntry({ name: '  二十个字以内的名字  ' })), [])
})

test('自定义至少一个模型，id 不为空也不重复', () => {
  assert.ok(validateEntry(customEntry({ models: [] })).includes('至少添加一个模型'))
  assert.ok(validateEntry(customEntry({ models: [{ id: 'm1' }, { id: 'm1' }] })).includes('模型 id 重复'))
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: '  ' }] })), ['配置错误'])
  assert.equal(entryDetail(customEntry({ models: [{ id: '  ' }] })), 'model without id')
})

test('档位和窗口上限的类型校验：都说「配置错误」，细节分得清', () => {
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', efforts: ['low', 'high'] }] })), [])
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', efforts: ['extreme'] }] })), ['配置错误'])
  assert.equal(entryDetail(customEntry({ models: [{ id: 'm', efforts: ['extreme'] }] })), 'unknown effort: extreme')
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', contextWindow: 0 }] })), ['配置错误'])
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', contextWindow: 'big' }] })), ['配置错误'])
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', maxTokens: -1 }] })), ['配置错误'])
  assert.match(entryDetail(customEntry({ models: [{ id: 'm', maxTokens: -1 }] })), /^maxTokens is not a positive integer/)
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', contextWindow: 128000, maxTokens: 8192 }] })), [])
})

test('清单里不能放密钥', () => {
  assert.deepEqual(validateEntry(customEntry({ apiKey: 'sk-1' })), ['配置错误'])
  assert.equal(entryDetail(customEntry({ apiKey: 'sk-1' })), 'holds a key field')
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm', accessToken: 't' }] })), ['配置错误'])
  assert.deepEqual(validateEntry(customEntry({ models: [{ id: 'm1' }, { id: 'm2', MY_SECRET: 's' }] })), ['配置错误'])
  // keyless 那个字段没有了：旧清单里还带着的，读进来丢掉，写回去会被拦
  assert.deepEqual(validateEntry(customEntry({ keyless: true })), ['配置错误'])
})

test('智谱预设补出 GLM-4.7-Flash', () => {
  const before = defaults()
  const result = addCustom(before, { preset: 'zhipu' })
  assert.equal(result.ok, true)
  assert.equal(result.id, 'c-zhipu')
  const entry = result.catalog.entries.find((item) => item.id === 'c-zhipu')
  assert.equal(entry.kind, 'custom')
  assert.equal(entry.name, 'GLM')
  assert.equal(entry.protocol, 'openai')
  assert.equal(entry.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal(entry.concurrency, 1)
  assert.deepEqual(entry.models, [
    {
      id: 'glm-4.7-flash',
      name: 'GLM-4.7-Flash',
      contextWindow: 200000,
      maxTokens: null,
      efforts: [],
      effortValues: {},
      vision: false,
      thinkingFormat: null,
      singleConcurrent: true,
      auto: {},
    },
  ])
  assert.equal(before.entries.length, 2)
  assert.equal(before.entries.some((item) => item.id === 'c-zhipu'), false)
})

test('预设里没有 kimi，传进去当没有预设', () => {
  const result = addCustom(defaults(), {
    preset: 'kimi',
    name: '自定',
    protocol: 'openai',
    baseUrl: 'https://a.example/v1',
    models: [{ id: 'm1', name: 'M1' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.id, 'custom')
  const entry = result.catalog.entries.find((item) => item.id === 'custom')
  assert.equal(entry.name, '自定')
  assert.equal(entry.protocol, 'openai')
  assert.equal(entry.baseUrl, 'https://a.example/v1')
  assert.deepEqual(entry.models.map((model) => model.id), ['m1'])
})

test('id 重复就加 -2、-3，没预设用 custom', () => {
  const one = addCustom(defaults(), { preset: 'zhipu' })
  assert.equal(one.id, 'c-zhipu')
  const two = addCustom(one.catalog, { preset: 'zhipu' })
  assert.equal(two.id, 'c-zhipu-2')
  const three = addCustom(two.catalog, { preset: 'zhipu' })
  assert.equal(three.id, 'c-zhipu-3')
  const plain = addCustom(three.catalog, customEntry({ name: '无预设' }))
  assert.equal(plain.id, 'custom')
  const plainAgain = addCustom(plain.catalog, customEntry({ name: '再来一个' }))
  assert.equal(plainAgain.id, 'custom-2')
})

test('校验不过就不进清单', () => {
  const before = defaults()
  const bad = addCustom(before, { name: '坏的', protocol: 'openai', baseUrl: 'http://x.example/v1', models: [] })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.includes('网址格式错误'))
  assert.ok(bad.errors.includes('至少添加一个模型'))
  assert.equal(bad.detail, 'baseUrl is not https; no models')
  assert.equal(bad.catalog, before)
  assert.equal(before.entries.length, 2)
})

test('updateEntry 改条目，坏补丁原样退回', () => {
  const start = addCustom(defaults(), customEntry({ name: '老名字' }))
  const renamed = updateEntry(start.catalog, 'custom', { name: '新名字', models: [{ id: 'm1' }, { id: 'm2', name: '二' }] })
  assert.equal(renamed.ok, true)
  const entry = renamed.catalog.entries.find((item) => item.id === 'custom')
  assert.equal(entry.name, '新名字')
  assert.deepEqual(entry.models.map((model) => model.id), ['m1', 'm2'])
  assert.equal(entry.models[1].name, '二')
  assert.equal(start.catalog.entries.find((item) => item.id === 'custom').name, '老名字')
  const bad = updateEntry(renamed.catalog, 'custom', { baseUrl: 'http://x.example' })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.includes('网址格式错误'))
  assert.equal(bad.catalog, renamed.catalog)
  const missing = updateEntry(renamed.catalog, 'nope', { name: '没有的' })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.errors, ['配置错误'])
  assert.equal(missing.detail, 'no entry: nope')
})

test('Kilo 删得掉，DeepSeek 删不掉', () => {
  const removedKilo = removeEntry(defaults(), 'kilo')
  assert.equal(removedKilo.ok, true)
  assert.equal(removedKilo.catalog.entries.some((item) => item.id === 'kilo'), false)
  assert.equal(removeEntry(defaults(), 'deepseek').ok, false)
  assert.equal(removeEntry(defaults(), 'nope').ok, false)
})

test('Kilo 删掉以后能加回来，地址和模型照常量写', () => {
  const removed = removeEntry(defaults(), 'kilo')
  const added = addKilo(removed.catalog)
  assert.equal(added.ok, true)
  const entry = added.catalog.entries.find((item) => item.id === 'kilo')
  assert.equal(entry.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
  assert.equal(entry.models[0].id, 'kilo-auto/free')
  assert.equal(entry.models[0].contextWindow, 256000)
  assert.equal(entry.models[0].maxTokens, 32000)
  assert.equal(entry.concurrency, 1)
})

test('读清单不再补回 Kilo：删掉就是删掉了', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'models.json')
    const removed = removeEntry(defaults(), 'kilo')
    saveCatalog(file, removed.catalog)
    const loaded = loadCatalog(file)
    assert.equal(loaded.entries.some((item) => item.id === 'kilo'), false)
    assert.equal(loaded.entries.some((item) => item.id === 'deepseek'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('每把密钥的并发上限：按条目取，0 是不限', () => {
  const base = defaults()
  assert.equal(limitOf(base, 'kilo'), 1)
  assert.equal(limitOf(base, 'deepseek'), 0)
  assert.equal(limitOf(base, 'nope'), 0)
  const custom = addCustom(base, { preset: 'zhipu' })
  assert.equal(limitOf(custom.catalog, 'c-zhipu'), 1)
  const plain = addCustom(custom.catalog, { name: '自定', protocol: 'openai', baseUrl: 'https://a.example/v1', models: [{ id: 'm1' }] })
  assert.equal(limitOf(plain.catalog, plain.id), 0)
  const changed = updateEntry(plain.catalog, plain.id, { concurrency: 3 })
  assert.equal(limitOf(changed.catalog, plain.id), 3)
})

test('盘上已有的密文留着：改并发上限也不丢', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'models.json')
    const added = addCustom(defaults(), { name: '自定', protocol: 'openai', baseUrl: 'https://a.example/v1', models: [{ id: 'm1' }] })
    const sealed = 'c2VhbGVkLWNpcGhlcnRleHQ='
    const withKey = {
      ...added.catalog,
      entries: added.catalog.entries.map((entry) => (entry.id === added.id ? { ...entry, sealed } : entry)),
    }
    saveCatalog(file, withKey)
    // 读回来再改并发上限：盘上那条的密文不能被抹掉
    const loaded = loadCatalog(file)
    const changed = updateEntry(loaded, added.id, { concurrency: 2 })
    assert.equal(changed.ok, true)
    saveCatalog(file, changed.catalog)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const entry = raw.entries.find((one) => one.id === added.id)
    assert.equal(entry.sealed, sealed, '密文还在')
    assert.equal(entry.concurrency, 2, '并发上限也写进去了')
    // 界面拿到的清单里不能带密文
    const forUi = stripSecrets(changed.catalog)
    assert.equal(forUi.entries.find((one) => one.id === added.id).sealed, undefined)
    assert.equal(forUi.entries.find((one) => one.id === added.id).concurrency, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('删掉默认条目后默认回到 DeepSeek', () => {
  const added = addCustom(defaults(), customEntry())
  const picked = setDefault(added.catalog, { entry: 'custom', model: 'm1', effort: null })
  assert.equal(picked.ok, true)
  const removed = removeEntry(picked.catalog, 'custom')
  assert.equal(removed.ok, true)
  assert.equal(removed.catalog.entries.some((item) => item.id === 'custom'), false)
  assert.deepEqual(removed.catalog.default, { entry: 'deepseek', model: 'deepseek-flash', effort: null })
})

test('设默认要条目模型都在，档位要模型支持', () => {
  const base = defaults()
  const toKilo = setDefault(base, { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  assert.equal(toKilo.ok, true)
  assert.deepEqual(toKilo.catalog.default, { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  assert.equal(setDefault(base, { entry: 'nope', model: 'm1', effort: null }).ok, false)
  assert.equal(setDefault(base, { entry: 'deepseek', model: 'nope', effort: null }).ok, false)
  assert.equal(setDefault(base, { entry: 'deepseek', model: 'deepseek-flash', effort: 'low' }).ok, true)
  assert.equal(setDefault(base, { entry: 'deepseek', model: 'deepseek-flash', effort: 'medium' }).ok, false)
  const withEfforts = addCustom(base, customEntry({ models: [{ id: 'm', efforts: ['low', 'high'] }] }))
  const picked = setDefault(withEfforts.catalog, { entry: 'custom', model: 'm', effort: 'high' })
  assert.equal(picked.ok, true)
  assert.deepEqual(picked.catalog.default, { entry: 'custom', model: 'm', effort: 'high' })
})

test('能选哪些：没同意没钥匙、只同意、有钥匙', () => {
  const base = defaults()
  assert.deepEqual(usable(base, { hasKey: () => false, consented: false }), [])
  assert.deepEqual(usable(base, { hasKey: () => false, consented: true }), [
    { entry: 'kilo', model: 'kilo-auto/free', name: 'Kilo 模型', efforts: [] },
  ])
  const zhipu = addCustom(base, { preset: 'zhipu' }).catalog
  assert.deepEqual(usable(zhipu, { hasKey: (id) => id === 'c-zhipu', consented: false }), [
    { entry: 'c-zhipu', model: 'glm-4.7-flash', name: 'GLM-4.7-Flash', efforts: [] },
  ])
  assert.deepEqual(usable(zhipu, { hasKey: (id) => id === 'c-zhipu', consented: true }), [
    { entry: 'kilo', model: 'kilo-auto/free', name: 'Kilo 模型', efforts: [] },
    { entry: 'c-zhipu', model: 'glm-4.7-flash', name: 'GLM-4.7-Flash', efforts: [] },
  ])
  const local = {
    ...zhipu,
    entries: [
      ...zhipu.entries,
      {
        id: 'local',
        kind: 'custom',
        name: '本机',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [normalizeModel({ id: 'llama' })],
      },
    ],
  }
  // 自定义条目都要钥匙：没有钥匙就选不了
  assert.deepEqual(usable(local, { hasKey: () => false, consented: false }), [])
  assert.deepEqual(usable(local, { hasKey: (id) => id === 'local', consented: false }), [
    { entry: 'local', model: 'llama', name: 'llama', efforts: [] },
  ])
})

test('文件缺了或坏了回到初始清单', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'models.json')
    assert.deepEqual(loadCatalog(file), defaults())
    writeFileSync(file, '{oops', 'utf8')
    assert.deepEqual(loadCatalog(file), defaults())
    writeFileSync(file, '[1, 2]', 'utf8')
    assert.deepEqual(loadCatalog(file), defaults())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('读入补上缺的内置条目并补齐模型', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'models.json')
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        default: { entry: 'mine', model: 'm1', effort: null },
        entries: [
          { id: 'mine', kind: 'custom', name: '我的', protocol: 'openai', baseUrl: 'https://a.example/v1', models: [{ id: 'm1', efforts: ['high', 'low', 'weird'] }] },
          { id: 'deepseek', kind: 'deepseek', name: 'DeepSeek', protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', models: [{ id: 'deepseek-flash', name: 'DeepSeek', vision: true }] },
        ],
      }),
      'utf8',
    )
    const catalog = loadCatalog(file)
    assert.deepEqual(catalog.default, { entry: 'mine', model: 'm1', effort: null })
    assert.deepEqual(catalog.entries.map((entry) => entry.id), ['mine', 'deepseek'])
    assert.deepEqual(catalog.entries[0].models, [
      {
        id: 'm1',
        name: 'm1',
        contextWindow: null,
        maxTokens: null,
        efforts: ['low', 'high'],
        effortValues: {},
        vision: false,
        thinkingFormat: null,
        singleConcurrent: false,
        auto: {},
      },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('保存走临时文件，读回来一模一样', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'sub', 'models.json')
    const catalog = addCustom(defaults(), { preset: 'zhipu' }).catalog
    saveCatalog(file, catalog)
    assert.equal(existsSync(`${file}.tmp`), false)
    assert.deepEqual(loadCatalog(file), catalog)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('带着钥匙的清单不写盘', () => {
  const dir = scratch()
  try {
    const file = join(dir, 'models.json')
    saveCatalog(file, defaults())
    const before = readFileSync(file, 'utf8')
    const dirty = defaults()
    dirty.entries.push(customEntry({ id: 'leak', name: '漏的', apiKey: 'sk-1' }))
    assert.throws(() => saveCatalog(file, dirty), /配置错误: holds a key field/)
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(existsSync(`${file}.tmp`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('旧清单里的 keyless 字段读进来就丢，旧的免费通道那条换成 Kilo', () => {
  const dir = scratch()
  try {
    const file = join(dir, '模型.json')
    writeFileSync(file, JSON.stringify({
      version: 1,
      default: { entry: 'free', model: 'kilo-auto/free', effort: null },
      entries: [
        {
          id: 'free',
          kind: 'free',
          name: 'Kilo 模型',
          baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
          keyless: true,
          models: [{ id: 'kilo-auto/free', name: 'Kilo 模型' }],
        },
        {
          id: 'c-old',
          kind: 'custom',
          name: '旧的',
          protocol: 'openai',
          baseUrl: 'https://old.example/v1',
          keyless: false,
          models: [{ id: 'm1' }],
        },
      ],
    }))
    const catalog = loadCatalog(file)
    const kilo = catalog.entries.find((entry) => entry.id === 'kilo')
    assert.ok(kilo, '旧的那条要换成 Kilo')
    assert.equal(kilo.keyless, undefined, 'keyless 字段没有了')
    assert.equal(kilo.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
    const old = catalog.entries.find((entry) => entry.id === 'c-old')
    assert.equal(old.keyless, undefined, '别的条目身上的 keyless 也丢掉')
    assert.equal(catalog.default.entry, 'kilo', '默认那条也跟着换成 Kilo')
    assert.equal(catalog.default.model, 'kilo-auto/free')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
