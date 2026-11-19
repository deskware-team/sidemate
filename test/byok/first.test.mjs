// 首次运行第二步「先选一个模型」的纯逻辑：临时目录 + 假加密 + 假 probe，照 test/settings 那一套。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { loadCatalog, removeEntry, saveCatalog } from '../../app/models/catalog.mjs'
import { modelFiles } from '../../app/models/files.mjs'
import { createKeyring } from '../../app/models/keys.mjs'
import { probeDeepseek } from '../../app/models/probe.mjs'
import { testAndSave } from '../../app/settings/custom.mjs'
import {
  applyDefault,
  canSubmit,
  deepseekChoice,
  firstStep,
  kiloChoice,
  saveKilo,
  guideView,
  needFirstRun,
  saveDeepseek,
  saveZhipu,
  zhipuChoice,
  zhipuForm,
} from '../../app/byok/first.mjs'

// 假钥匙不以 sk- 开头
const DEEPSEEK_KEY = 'demo-key-deepseek-value'
const ZHIPU_KEY = 'demo-key-zhipu-value'

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

// 搭一个临时桌伴根：清单和钥匙都落在里面
function stage() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-byok-first-'))
  const files = modelFiles(root)
  return {
    files,
    keyring: createKeyring({ root, crypto: xor() }),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

function defaultOf(files) {
  return loadCatalog(files.catalog).default
}

test('the wizard step follows the resolved model and the played intro', () => {
  // 模型能用、开场没放过：直接补开场
  assert.equal(firstStep({ ready: true, introPlayed: false }), 'intro')
  // 还没有能用的模型：从「关于桌伴」看起
  assert.equal(firstStep({ ready: false, introPlayed: false }), 'about')
  // 要不要走首次运行：两样都齐了才不用
  assert.equal(needFirstRun({ ready: true, introPlayed: true }), false)
  assert.equal(needFirstRun({ ready: true, introPlayed: false }), true)
  assert.equal(needFirstRun({ ready: false, introPlayed: true }), true)
})

test('a submit button needs a key and must not be busy', () => {
  assert.equal(canSubmit('', false), false)
  assert.equal(canSubmit('  ', false), false)
  assert.equal(canSubmit(null, false), false)
  assert.equal(canSubmit(ZHIPU_KEY, false), true)
  assert.equal(canSubmit(ZHIPU_KEY, true), false)
  assert.equal(canSubmit(`  ${DEEPSEEK_KEY}  `, true), false)
})

test('the fixed defaults point at the builtin entries', () => {
  assert.deepEqual(deepseekChoice(), { entry: 'deepseek', model: 'deepseek-flash', effort: null })
  assert.deepEqual(kiloChoice(), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
})

test('the zhipu form carries the preset and the key', () => {
  const form = zhipuForm(`  ${ZHIPU_KEY}  `)
  assert.equal(form.preset, 'zhipu')
  assert.equal(form.name, 'GLM')
  assert.equal(form.protocol, 'openai')
  assert.equal(form.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal(form.key, ZHIPU_KEY)
  assert.equal(form.model.id, 'glm-4.7-flash')
})

test('the zhipu default goes to the newly added last row', () => {
  const rows = [
    { id: 'kilo', kind: 'kilo' },
    { id: 'deepseek', kind: 'deepseek' },
    { id: 'c-zhipu', kind: 'custom' },
  ]
  assert.deepEqual(zhipuChoice(rows), { entry: 'c-zhipu', model: 'glm-4.7-flash', effort: null })
  assert.deepEqual(zhipuChoice([]), { entry: '', model: 'glm-4.7-flash', effort: null })
  assert.deepEqual(zhipuChoice(null), { entry: '', model: 'glm-4.7-flash', effort: null })
})

test('applyDefault writes the catalog only for a legal choice', () => {
  const one = stage()
  try {
    // setDefault 只看条目和模型在不在清单里：内置两条都在，写得进去
    const back = applyDefault(one.files, kiloChoice())
    assert.equal(back.ok, true)
    assert.deepEqual(defaultOf(one.files), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
    const missing = applyDefault(one.files, { entry: 'no-such', model: 'x', effort: null })
    assert.equal(missing.ok, false)
    // 批注把「没有这个条目」删了，只剩一句存不上
    assert.equal(missing.message, '保存失败')
    const badModel = applyDefault(one.files, { entry: 'deepseek', model: 'no-such-model', effort: null })
    assert.equal(badModel.ok, false)
    assert.equal(badModel.message, '配置错误')
    // 写坏的那次不动盘上的文件
    assert.deepEqual(defaultOf(one.files), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  } finally {
    one.done()
  }
})

// 假 probe：按真签名接对象，并记下收到的入参（形状不对要当场看出来）
function fakeProbe(back) {
  const seen = []
  const probe = async (args) => {
    seen.push(args)
    return typeof back === 'function' ? back(args) : back
  }
  return { probe, seen }
}

test('saveDeepseek stores the key and the default only after the probe passes', async () => {
  const one = stage()
  try {
    const refusedProbe = fakeProbe({ ok: false, message: '密钥无效' })
    const refused = await saveDeepseek({ files: one.files, keyring: one.keyring, key: DEEPSEEK_KEY, probe: refusedProbe.probe })
    assert.equal(refused.ok, false)
    assert.equal(refused.message, '密钥无效')
    // 传给 probe 的必须是对象，key 在里面：传字符串的话 probe 里拿不到钥匙
    assert.equal(typeof refusedProbe.seen[0], 'object')
    assert.equal(refusedProbe.seen[0].key, DEEPSEEK_KEY)
    assert.equal(one.keyring.has('deepseek'), false)
    assert.equal(one.keyring.read('deepseek'), null)
    assert.equal(defaultOf(one.files).entry, 'deepseek') // 初始清单本来就是 deepseek，看模型没被换
    const thrown = await saveDeepseek({ files: one.files, keyring: one.keyring, key: DEEPSEEK_KEY, probe: async () => { throw new Error('offline') } })
    assert.equal(thrown.ok, false)
    assert.equal(thrown.message, '测试失败')
    const wiredProbe = fakeProbe({ ok: true, message: '通了。' })
    const wired = await saveDeepseek({ files: one.files, keyring: one.keyring, key: `  ${DEEPSEEK_KEY}  `, probe: wiredProbe.probe })
    assert.equal(wired.ok, true)
    assert.equal(wired.message, '通了。')
    assert.equal(wiredProbe.seen[0].key, `  ${DEEPSEEK_KEY}  `)
    assert.equal(one.keyring.read('deepseek'), DEEPSEEK_KEY)
    assert.deepEqual(defaultOf(one.files), { entry: 'deepseek', model: 'deepseek-flash', effort: null })
  } finally {
    one.done()
  }
})

test('saveDeepseek really sends the key to DeepSeek with the real probe', async () => {
  const one = stage()
  // 假服务：记下每个请求的 url 和头，不联网
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, headers: options.headers ?? {} })
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() { return '{"data":[]}' },
    }
  }
  try {
    // 包一层把假 fetch 塞进去，别碰真网络
    const back = await saveDeepseek({
      files: one.files,
      keyring: one.keyring,
      key: 'sk-x',
      probe: (args) => probeDeepseek({ ...args, fetchImpl }),
    })
    assert.equal(back.ok, true)
    assert.equal(one.keyring.read('deepseek'), 'sk-x')
    assert.ok(calls.length > 0, '至少发出去一个请求')
    for (const call of calls) {
      assert.match(String(call.url), /^https:\/\/api\.deepseek\.com\//)
      // DeepSeek 走的是它的 Anthropic 路线，钥匙放在 x-api-key 头里（跟 Authorization: Bearer 一个意思）
      assert.equal(call.headers['x-api-key'], 'sk-x')
      assert.equal(call.headers['anthropic-version'], '2023-06-01')
    }
  } finally {
    one.done()
  }
})

test('saveDeepseek with an empty key sends nothing and answers Si101', async () => {
  const one = stage()
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, headers: options.headers ?? {} })
    return { ok: true, status: 200, headers: { get: () => null }, async text() { return '{}' } }
  }
  try {
    const back = await saveDeepseek({
      files: one.files,
      keyring: one.keyring,
      key: '   ',
      probe: (args) => probeDeepseek({ ...args, fetchImpl }),
    })
    assert.equal(back.ok, false)
    assert.equal(back.message, '密钥未填写 · Si101 错误')
    assert.equal(calls.length, 0, '空密钥一个请求都不发')
    assert.equal(one.keyring.has('deepseek'), false)
  } finally {
    one.done()
  }
})

test('saveDeepseek keeps the chosen default when the user had picked another entry', async () => {
  const one = stage()
  try {
    // 先把默认换成 Kilo（清单里本来就有这条），再存 DeepSeek：默认要回到 deepseek
    assert.equal(applyDefault(one.files, kiloChoice()).ok, true)
    assert.equal(defaultOf(one.files).entry, 'kilo')
    const back = await saveDeepseek({ files: one.files, keyring: one.keyring, key: DEEPSEEK_KEY, probe: async ({ key }) => ({ ok: true, message: '通了。' }) })
    assert.equal(back.ok, true)
    assert.deepEqual(defaultOf(one.files), { entry: 'deepseek', model: 'deepseek-flash', effort: null })
  } finally {
    one.done()
  }
})

test('saveZhipu goes through testAndSave and defaults to the new glm-4.7-flash', async () => {
  const one = stage()
  try {
    const okProbe = async ({ key }) => ({ ok: true, listed: true, models: [], message: '通了' })
    const back = await saveZhipu({ files: one.files, keyring: one.keyring, key: ZHIPU_KEY, test: testAndSave, probe: okProbe })
    assert.equal(back.ok, true)
    assert.equal(one.keyring.read('c-zhipu'), ZHIPU_KEY)
    const entry = loadCatalog(one.files.catalog).entries.find((item) => item.id === 'c-zhipu')
    assert.equal(entry.kind, 'custom')
    assert.deepEqual(defaultOf(one.files), { entry: 'c-zhipu', model: 'glm-4.7-flash', effort: null })
    // 再来一遍：条目往后排，默认跟到新的那条
    const again = await saveZhipu({ files: one.files, keyring: one.keyring, key: ZHIPU_KEY, test: testAndSave, probe: okProbe })
    assert.equal(again.ok, true)
    assert.deepEqual(defaultOf(one.files), { entry: 'c-zhipu-2', model: 'glm-4.7-flash', effort: null })
  } finally {
    one.done()
  }
})

test('saveZhipu shows the reason and changes nothing when the probe fails', async () => {
  const one = stage()
  try {
    const back = await saveZhipu({ files: one.files, keyring: one.keyring, key: ZHIPU_KEY, test: testAndSave, probe: async ({ key }) => ({ ok: false, kind: 'key', message: '密钥无效' }) })
    assert.equal(back.ok, false)
    assert.equal(back.message, '密钥无效')
    assert.equal(one.keyring.has('c-zhipu'), false)
    assert.equal(defaultOf(one.files).entry, 'deepseek')
    const empty = await saveZhipu({ files: one.files, keyring: one.keyring, key: '', test: testAndSave, probe: async ({ key }) => ({ ok: true, message: '通了' }) })
    assert.equal(empty.ok, false)
    assert.equal(empty.message, '密钥未填写')
    assert.equal(existsSync(join(dirname(one.files.catalog), '钥匙')), false)
  } finally {
    one.done()
  }
})

test('the guide view is plain data for the sandboxed page', () => {
  const guide = guideView({
    title: '钥匙怎么拿',
    intro: '大约需要 5 分钟。',
    steps: [
      ['打开官网。', 'https://example.com/'],
      ['复制钥匙。', null],
    ].map(([text, url]) => ({ text, url })),
    outro: '以官方页面为准。',
  })
  assert.deepEqual(guide, {
    title: '钥匙怎么拿',
    intro: '大约需要 5 分钟。',
    steps: [
      { text: '打开官网。', url: 'https://example.com/' },
      { text: '复制钥匙。', url: null },
    ],
    outro: '以官方页面为准。',
  })
  const blank = guideView(null)
  assert.equal(blank.title, '')
  assert.deepEqual(blank.steps, [])
})

test('the files on disk never hold the key in the clear', async () => {
  const one = stage()
  try {
    await saveDeepseek({ files: one.files, keyring: one.keyring, key: DEEPSEEK_KEY, probe: async ({ key }) => ({ ok: true, message: '通了。' }) })
    await saveZhipu({ files: one.files, keyring: one.keyring, key: ZHIPU_KEY, test: testAndSave, probe: async ({ key }) => ({ ok: true, listed: true, models: [], message: '通了' }) })
    const catalogText = readFileSync(one.files.catalog, 'utf8')
    assert.equal(catalogText.includes(DEEPSEEK_KEY), false)
    assert.equal(catalogText.includes(ZHIPU_KEY), false)
    // 密文就存在 model.json 里那一条上，不另存文件
    const raw = JSON.parse(catalogText)
    const sealed = raw.entries.find((entry) => typeof entry.sealed === 'string' && entry.sealed !== '')
    assert.equal(typeof sealed.sealed, 'string')
    assert.equal(Buffer.from(sealed.sealed, 'base64').includes(Buffer.from(ZHIPU_KEY, 'utf8')), false)
  } finally {
    one.done()
  }
})

test('saveKilo adds the entry back when it was deleted and sets the default', () => {
  const one = stage()
  try {
    // 清单里删掉 Kilo：首次运行再选它，要把条目加回来
    const catalog = loadCatalog(one.files.catalog)
    const removed = removeEntry(catalog, 'kilo')
    assert.equal(removed.ok, true)
    saveCatalog(one.files.catalog, removed.catalog)
    const back = saveKilo(one.files)
    assert.equal(back.ok, true)
    const entry = loadCatalog(one.files.catalog).entries.find((item) => item.id === 'kilo')
    assert.equal(entry.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
    assert.equal(entry.models[0].id, 'kilo-auto/free')
    assert.deepEqual(defaultOf(one.files), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  } finally {
    one.done()
  }
})

test('首次运行四个入口：DeepSeek 在上面，下面三个小框是智谱、自定义、Kilo', () => {
  const html = readFileSync(new URL('../../app/byok/page.html', import.meta.url), 'utf8')
  // DeepSeek 那块在上面
  assert.ok(html.indexOf('id="deepseek-key"') < html.indexOf('id="others"'), 'DeepSeek 要在三个小框上面')
  // 下面三个小框
  for (const id of ['to-zhipu', 'to-custom', 'to-kilo']) {
    assert.ok(html.includes(`id="${id}"`), `缺少入口 ${id}`)
  }
  // 三个小框的次序：智谱、自定义、Kilo
  assert.ok(html.indexOf('id="to-zhipu"') < html.indexOf('id="to-custom"'))
  assert.ok(html.indexOf('id="to-custom"') < html.indexOf('id="to-kilo"'))
})

test('首次运行的 Kilo：同意之后条目加回清单，默认换过去', () => {
  const one = stage()
  try {
    const back = saveKilo(one.files)
    assert.equal(back.ok, true)
    const entry = loadCatalog(one.files.catalog).entries.find((item) => item.id === 'kilo')
    assert.equal(entry.baseUrl, 'https://ai-gateway.kilo.ai/api/v1')
    assert.equal(entry.models[0].id, 'kilo-auto/free')
    assert.equal(entry.models[0].contextWindow, 256000)
    assert.equal(entry.models[0].maxTokens, 32000)
    assert.deepEqual(defaultOf(one.files), { entry: 'kilo', model: 'kilo-auto/free', effort: null })
  } finally {
    one.done()
  }
})
