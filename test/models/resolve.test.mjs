import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { noDeepseekYaml } from '../../app/dsh/models.mjs'
import { addCustom, defaults, saveCatalog } from '../../app/models/catalog.mjs'
import { createConsent } from '../../app/models/consent.mjs'
import { envName, KEY_BROKEN_MESSAGE } from '../../app/models/keys.mjs'
import { resolveModel } from '../../app/models/resolve.mjs'

// 假钥匙：不带 sk- 开头。
const DEEPSEEK_KEY = 'test-key-deepseek'
const ZHIPU_KEY = 'test-key-zhipu'

// 假 keyring：只记在内存里，够用就行。
function fakeKeyring(keys = {}) {
  const map = new Map(Object.entries(keys))
  return {
    read(id) {
      return map.has(id) ? map.get(id) : null
    },
    has(id) {
      return map.has(id)
    },
    env(ids) {
      const out = {}
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!map.has(id)) continue
        out[envName(id)] = map.get(id)
      }
      return out
    },
  }
}

// 临时目录 + 三个文件的路径。
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-resolve-'))
  return {
    dir,
    files: {
      catalog: join(dir, 'models.json'),
      consent: join(dir, 'consent.json'),
    },
  }
}

// 写清单：可带一条自定义条目。
function writeCatalog(file, { custom = false } = {}) {
  const base = defaults()
  const catalog = custom
    ? addCustom(base, { preset: 'zhipu', models: [{ id: 'glm-4-flash', name: 'GLM-4-Flash', efforts: ['low', 'high'] }] }).catalog
    : base
  saveCatalog(file, catalog)
  return catalog
}

// 同意当前这一版说明。
function agree(file, version) {
  const consent = createConsent({ file, ...(version ? { version } : {}) })
  consent.agree({ terms: true, crossBorder: true })
  return consent
}

test('默认 DeepSeek 有钥匙：能开工，补丁只有路线一段（重试交给 dsh）', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    const result = resolveModel({ choice: null, files, keyring: fakeKeyring({ deepseek: DEEPSEEK_KEY }) })
    assert.equal(result.ok, true)
    assert.equal(result.apiKey, DEEPSEEK_KEY)
    assert.equal(result.vendor, 'DeepSeek')
    assert.equal(result.model.value, JSON.stringify(['deepseek-official', 'deepseek-flash']))
    assert.equal(result.model.effort, null)
    // 路线一段：重试策略不归桌伴管了，dsh 用它自己的默认
    assert.equal(result.patchTexts.length, 1)
    assert.ok(result.patchTexts[0].includes('llm-pi-ai'))
    assert.equal(result.patchTexts.some((one) => one.includes('retryPolicy')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('DeepSeek 没密钥：密钥未填写', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    const result = resolveModel({ choice: null, files, keyring: fakeKeyring() })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'key')
    // 错误码 Si101，停工那句在 app/copy/errors.mjs 的 stops.noKey
    assert.equal(result.code, 'Si101')
    assert.equal(result.stop, 'noKey')
    assert.equal(result.message, 'DeepSeek 密钥未填写')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('选 Kilo 模型但没同意：必须阅读并同意使用须知', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    const result = resolveModel({
      choice: { entry: 'kilo', model: 'kilo-auto/free', effort: null },
      files,
      keyring: fakeKeyring(),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'consent')
    assert.equal(result.message, '必须阅读并同意使用须知')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同意的是以前那一版使用须知：跟没同意一样', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    agree(files.consent, '0.9')
    const result = resolveModel({
      choice: { entry: 'kilo', model: 'kilo-auto/free', effort: null },
      files,
      keyring: fakeKeyring(),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'consent')
    assert.equal(result.message, '必须阅读并同意使用须知')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Kilo 同意了但没 DeepSeek 钥匙：能开工，多挂一段补丁', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    agree(files.consent)
    const result = resolveModel({
      choice: { entry: 'kilo', model: 'kilo-auto/free', effort: null },
      files,
      keyring: fakeKeyring(),
    })
    assert.equal(result.ok, true)
    assert.equal(result.vendor, 'Kilo 模型')
    assert.equal(result.apiKey, '')
    // 路线一段、没有 DeepSeek 钥匙的手写目录一段、只发一个请求的那段
    assert.equal(result.patchTexts.length, 3)
    assert.equal(result.patchTexts[1], noDeepseekYaml())
    assert.ok(result.patchTexts[0].includes('kilo'))
    assert.ok(result.patchTexts[2].includes('tool-subagent'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('自定义条目没钥匙：回话说缺哪一条', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog, { custom: true })
    const result = resolveModel({
      choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: null },
      files,
      keyring: fakeKeyring(),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'key')
    assert.ok(result.message.includes('GLM'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('自定义条目有钥匙：模型值是 JSON 化的 [条目, 模型]', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog, { custom: true })
    const result = resolveModel({
      choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: null },
      files,
      keyring: fakeKeyring({ 'c-zhipu': ZHIPU_KEY }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.model.value, JSON.stringify(['c-zhipu', 'glm-4-flash']))
    assert.equal(result.vendor, 'GLM')
    assert.equal(result.apiKey, '')
    assert.equal(result.env[envName('c-zhipu')], ZHIPU_KEY)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('钥匙只带这一轮用的模型那家：别的自定义条目的钥匙不进 env', () => {
  const { dir, files } = scratch()
  try {
    const base = writeCatalog(files.catalog, { custom: true })
    // 再加一条同预设的：id 是 c-zhipu-2
    const second = addCustom(base, { preset: 'zhipu', models: [{ id: 'glm-4-plus', name: 'GLM-4-Plus' }] })
    assert.equal(second.id, 'c-zhipu-2')
    saveCatalog(files.catalog, second.catalog)
    const keyring = fakeKeyring({ deepseek: DEEPSEEK_KEY, 'c-zhipu': ZHIPU_KEY, 'c-zhipu-2': 'test-key-zhipu-2' })
    const custom = resolveModel({ choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: null }, files, keyring })
    assert.equal(custom.ok, true)
    assert.deepEqual(Object.keys(custom.env), [envName('c-zhipu')])
    // DeepSeek 的钥匙照旧带：联网搜索走 DeepSeek 的搜索接口
    assert.equal(custom.apiKey, DEEPSEEK_KEY)
    // 选 DeepSeek 那一轮：自定义条目的钥匙一把都不带
    const deepseek = resolveModel({ choice: null, files, keyring })
    assert.equal(deepseek.ok, true)
    assert.deepEqual(deepseek.env, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('选的模型不在清单里：模型不可用', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    const result = resolveModel({
      choice: { entry: 'deepseek', model: '没有的模型', effort: null },
      files,
      keyring: fakeKeyring({ deepseek: DEEPSEEK_KEY }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'missing')
    assert.equal(result.message, '模型不可用')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('档位原样带出去', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog, { custom: true })
    const result = resolveModel({
      choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: 'high' },
      files,
      keyring: fakeKeyring({ 'c-zhipu': ZHIPU_KEY }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.model.effort, 'high')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('钥匙解不开：说去设置·模型里重新填一次，不报模型没提供', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog)
    // 钥匙文件在，但解不开（换了系统、换了用户、文件坏了）
    const broken = {
      read: () => null,
      has: (id) => id === 'deepseek',
      env: () => ({}),
    }
    const result = resolveModel({ choice: null, files, keyring: broken })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'key')
    assert.equal(result.message, KEY_BROKEN_MESSAGE)
    assert.equal(result.message.includes('模型没提供'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('自定义条目的钥匙解不开：也是同一句', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog, { custom: true })
    const broken = {
      read: () => null,
      has: (id) => id === 'c-zhipu',
      env: () => ({}),
    }
    const result = resolveModel({
      choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: null },
      files,
      keyring: broken,
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'key')
    assert.equal(result.message, KEY_BROKEN_MESSAGE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('现在能选的模型列出来', () => {
  const { dir, files } = scratch()
  try {
    writeCatalog(files.catalog, { custom: true })
    agree(files.consent)
    const result = resolveModel({
      choice: { entry: 'c-zhipu', model: 'glm-4-flash', effort: null },
      files,
      keyring: fakeKeyring({ 'c-zhipu': ZHIPU_KEY }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.model.value, JSON.stringify(['c-zhipu', 'glm-4-flash']))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
