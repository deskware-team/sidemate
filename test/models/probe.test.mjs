import assert from 'node:assert/strict'
import test from 'node:test'
import { classify, probeDeepseek, probeEndpoint } from '../../app/models/probe.mjs'

const KEY = 'kt-side-probe-sample'

// 收下每个返回值，最后一并查有没有漏出钥匙
const seen = []

function respond(status, body = '', headers = {}) {
  return { status, body, headers }
}

function throwNet() {
  return { throw: true }
}

// 按顺序吐预设返回的假 fetch，同时记下每次请求的 url 和 headers
function fake(responses) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const index = calls.length
    calls.push({ url, headers: options.headers ?? {}, options })
    const next = responses[index]
    if (!next) throw new Error(`no scripted response left ${KEY}`)
    if (next.throw) throw new Error(`cannot connect ${KEY}`)
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => next.headers?.[String(name).toLowerCase()] ?? null },
      async text() { return next.body },
    }
  }
  return { fetchImpl, calls }
}

const OPENAI_LIST = JSON.stringify({
  data: [
    { id: 'side-chat', display_name: '聊天款', context_window: 128000, max_tokens: 8192 },
    { id: 'side-mini', name: '迷你款', context_length: 32000, max_output_tokens: 4096 },
    { id: 'side-bare' },
  ],
})

// 模型接口的回包：OpenAI 格式有 choices，Anthropic 格式有 content
const OPENAI_REPLY = JSON.stringify({
  id: 'side-1',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
})
const ANTHROPIC_REPLY = JSON.stringify({
  id: 'side-1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
})

test('openai probe lists models then chats, filling name, contextWindow, maxTokens', async () => {
  const f = fake([respond(200, OPENAI_LIST), respond(200, OPENAI_REPLY)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1/',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, {
    ok: true,
    listed: true,
    models: [
      { id: 'side-chat', name: '聊天款', contextWindow: 128000, maxTokens: 8192 },
      { id: 'side-mini', name: '迷你款', contextWindow: 32000, maxTokens: 4096 },
      { id: 'side-bare', name: null, contextWindow: null, maxTokens: null },
    ],
    message: '测试成功',
  })
  const [list, chat] = f.calls
  assert.equal(list.url, 'https://api.side.example/v1/models')
  assert.equal(list.options.method, 'GET')
  assert.equal(list.options.redirect, 'manual')
  assert.ok(list.options.signal instanceof AbortSignal)
  assert.equal(list.headers.authorization, `Bearer ${KEY}`)
  assert.equal('content-type' in list.headers, false)
  assert.equal(chat.url, 'https://api.side.example/v1/chat/completions')
  assert.equal(chat.options.redirect, 'manual')
  assert.ok(chat.options.signal instanceof AbortSignal)
  assert.equal(chat.headers.authorization, `Bearer ${KEY}`)
  assert.equal(chat.headers['content-type'], 'application/json')
  const body = JSON.parse(chat.options.body)
  assert.equal(body.model, 'side-chat')
  assert.equal(body.max_tokens, 5)
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }])
})

test('anthropic baseUrl with and without /v1 both build the same urls', async () => {
  const list = JSON.stringify({ data: [{ id: 'claude-side', display_name: '副驾款' }] })
  for (const baseUrl of ['https://api.side.example', 'https://api.side.example/v1', 'https://api.side.example/v1/']) {
    const f = fake([respond(200, list), respond(200, ANTHROPIC_REPLY)])
    const result = await probeEndpoint({
      protocol: 'anthropic',
      baseUrl,
      key: KEY,
      model: 'claude-side',
      fetchImpl: f.fetchImpl,
    })
    seen.push(result)
    assert.deepEqual(result, {
      ok: true,
      listed: true,
      models: [{ id: 'claude-side', name: '副驾款', contextWindow: null, maxTokens: null }],
      message: '测试成功',
    })
    assert.equal(f.calls[0].url, 'https://api.side.example/v1/models?limit=1000')
    assert.equal(f.calls[0].headers['x-api-key'], KEY)
    assert.equal(f.calls[0].headers['anthropic-version'], '2023-06-01')
    assert.equal(f.calls[1].url, 'https://api.side.example/v1/messages')
    assert.equal(f.calls[1].headers['x-api-key'], KEY)
    assert.equal(f.calls[1].headers['anthropic-version'], '2023-06-01')
    assert.equal(f.calls[1].headers['content-type'], 'application/json')
    assert.equal(JSON.parse(f.calls[1].options.body).model, 'claude-side')
  }
})

test('a 404 list still passes when a model was given, with listed=false', async () => {
  const f = fake([respond(404), respond(200, OPENAI_REPLY)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, { ok: true, listed: false, models: [], message: '测试成功' })
  assert.equal(JSON.parse(f.calls[1].options.body).model, 'side-chat')
})

test('405, unparseable and empty lists also count as listed=false', async () => {
  for (const list of [respond(405), respond(200, '<html>不是 json</html>'), respond(200, '{"data":[]}')]) {
    const f = fake([list, respond(200, OPENAI_REPLY)])
    const result = await probeEndpoint({
      protocol: 'openai',
      baseUrl: 'https://api.side.example/v1',
      key: KEY,
      model: 'side-chat',
      fetchImpl: f.fetchImpl,
    })
    seen.push(result)
    assert.deepEqual(result, { ok: true, listed: false, models: [], message: '测试成功' })
    assert.equal(f.calls.length, 2)
  }
})

test('a 404 list with no model asks for manual add and sends nothing else', async () => {
  const f = fake([respond(404)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, {
    ok: true,
    listed: false,
    models: [],
    kind: 'nomodels',
    code: 'Si108',
    message: '模型列表获取失败 · Si108 错误',
  })
  assert.equal(f.calls.length, 1)
})

test('a 401 list is a bad key and stops right there', async () => {
  const f = fake([respond(401, `{"error":"bad key ${KEY}"}`)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, {
    ok: false,
    kind: 'key',
    code: 'Si401',
    raw: '{"error":"bad key ***"}',
    message: '密钥无效 · Si401 错误，{"error":"bad key ***"}',
  })
  assert.equal(f.calls.length, 1)
})

test('a 402 chat：照 HTTP 码报，厂商原话原样摆出来', async () => {
  const f = fake([respond(200, OPENAI_LIST), respond(402, '{"error":{"message":"no balance"}}')])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, { ok: false, kind: 'other', code: 'Si402', raw: '{"error":{"message":"no balance"}}', message: '测试失败 · Si402 错误，{"error":{"message":"no balance"}}' })
})

test('a 429 是忙：只看状态码，回包里写什么都不改', async () => {
  const short = fake([respond(200, OPENAI_LIST), respond(429, '余额不足，请充值后再试')])
  const quota = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: short.fetchImpl,
  })
  seen.push(quota)
  assert.deepEqual(quota, { ok: false, kind: 'busy', code: 'Si429', raw: '余额不足，请充值后再试', message: '服务繁忙 · Si429 错误，余额不足，请充值后再试' })

  const plain = fake([respond(200, OPENAI_LIST), respond(429, 'rate limited, retry later')])
  const busy = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: plain.fetchImpl,
  })
  seen.push(busy)
  assert.deepEqual(busy, {
    ok: false,
    kind: 'busy',
    code: 'Si429',
    raw: 'rate limited, retry later',
    message: '服务繁忙 · Si429 错误，rate limited, retry later',
  })
})

test('a 404 chat means wrong address or model name', async () => {
  const f = fake([respond(200, OPENAI_LIST), respond(404, '{"error":{"message":"model not found"}}')])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, {
    ok: false,
    kind: 'address',
    code: 'Si404',
    raw: '{"error":{"message":"model not found"}}',
    message: '地址或模型名错误 · Si404 错误，{"error":{"message":"model not found"}}',
  })
})

test('那边回了 HTTP 码，码就是它回的那个（400、403、500）', async () => {
  const bad = fake([respond(200, OPENAI_LIST), respond(400, '{"error":{"message":"bad request"}}')])
  const one = await probeEndpoint({ protocol: 'openai', baseUrl: 'https://api.side.example/v1', key: KEY, fetchImpl: bad.fetchImpl })
  seen.push(one)
  assert.deepEqual(one, {
    ok: false,
    kind: 'address',
    code: 'Si400',
    raw: '{"error":{"message":"bad request"}}',
    message: '地址或模型名错误 · Si400 错误，{"error":{"message":"bad request"}}',
  })
  const forbidden = fake([respond(200, OPENAI_LIST), respond(403, 'no access')])
  const two = await probeEndpoint({ protocol: 'openai', baseUrl: 'https://api.side.example/v1', key: KEY, fetchImpl: forbidden.fetchImpl })
  seen.push(two)
  assert.equal(two.kind, 'key')
  assert.equal(two.code, 'Si403')
  assert.match(two.message, /^密钥无效 · Si403 错误/)
  const broken = fake([respond(200, OPENAI_LIST), respond(500, 'oops')])
  const three = await probeEndpoint({ protocol: 'openai', baseUrl: 'https://api.side.example/v1', key: KEY, fetchImpl: broken.fetchImpl })
  seen.push(three)
  assert.equal(three.kind, 'busy')
  assert.equal(three.code, 'Si500')
  assert.match(three.message, /^服务繁忙 · Si500 错误/)
})

test('a thrown fetch is a network miss, even when the list call also threw', async () => {
  const both = fake([throwNet(), throwNet()])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: both.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, { ok: false, kind: 'network', code: 'Si601', raw: '', message: '连接失败 · Si601 错误' })
  assert.equal(both.calls.length, 2)

  const chatOnly = fake([respond(200, OPENAI_LIST), throwNet()])
  const again = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: chatOnly.fetchImpl,
  })
  seen.push(again)
  assert.deepEqual(again, { ok: false, kind: 'network', code: 'Si601', raw: '', message: '连接失败 · Si601 错误' })
})

test('no key means no Authorization header anywhere', async () => {
  const f = fake([respond(200, OPENAI_LIST), respond(200, OPENAI_REPLY)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.equal(result.ok, true)
  assert.equal(f.calls.length, 2)
  for (const call of f.calls) {
    assert.equal('authorization' in call.headers, false)
    assert.equal(JSON.stringify(call.headers).toLowerCase().includes(KEY.toLowerCase()), false)
  }
})

test('a models object shape parses into the same list form', async () => {
  const list = JSON.stringify({
    models: {
      'side-a': {},
      'side-b': { display_name: '二号', max_tokens: 1024 },
    },
  })
  const f = fake([respond(200, list), respond(200, OPENAI_REPLY)])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result.models, [
    { id: 'side-a', name: null, contextWindow: null, maxTokens: null },
    { id: 'side-b', name: '二号', contextWindow: null, maxTokens: 1024 },
  ])
  assert.equal(result.listed, true)
  assert.equal(JSON.parse(f.calls[1].options.body).model, 'side-a')
})

test('classify sorts status into kinds', () => {
  assert.equal(classify(401), 'key')
  assert.equal(classify(403), 'key')
  assert.equal(classify(402), 'other')
  assert.equal(classify(429), 'busy')
  assert.equal(classify(503), 'busy')
  assert.equal(classify(400), 'address')
  assert.equal(classify(404), 'address')
  assert.equal(classify(422), 'address')
  assert.equal(classify(418), 'other')
})

test('no return value ever contains the key', () => {
  assert.ok(seen.length > 0)
  for (const result of seen) {
    assert.equal(JSON.stringify(result).includes(KEY), false)
  }
})

test('回包是网页也照 HTTP 码说话：200 就是通了，不猜错因', async () => {
  const f = fake([respond(200, '<html><body>你好</body></html>'), respond(200, '<html><body>你好</body></html>')])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.equal(result.ok, true)
})

test('回包是不相干的 JSON 也算通了：只看 HTTP 码', async () => {
  const f = fake([respond(200, '{"hello":"world"}'), respond(200, '{"hello":"world"}')])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.equal(result.ok, true)
})

test('Anthropic 格式：回包是什么形状都算通了（只看 HTTP 码）', async () => {
  const ok = fake([respond(404), respond(200, ANTHROPIC_REPLY)])
  const good = await probeEndpoint({
    protocol: 'anthropic',
    baseUrl: 'https://api.side.example',
    key: KEY,
    model: 'side-chat',
    fetchImpl: ok.fetchImpl,
  })
  seen.push(good)
  assert.equal(good.ok, true)
  const bad = fake([respond(404), respond(200, OPENAI_REPLY)])
  const wrong = await probeEndpoint({
    protocol: 'anthropic',
    baseUrl: 'https://api.side.example',
    key: KEY,
    model: 'side-chat',
    fetchImpl: bad.fetchImpl,
  })
  seen.push(wrong)
  assert.equal(wrong.ok, true)
})

test('跳到 https 就说要 https，不跟着跳', async () => {
  const f = fake([respond(301, '', { location: 'https://api.side.example/v1/models' })])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'http://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, { ok: false, kind: 'https', code: 'Si105', raw: '', message: '地址无效 · Si105 错误' })
  assert.equal(f.calls.length, 1)
})

test('跳到别的机器上去也不去', async () => {
  const f = fake([respond(404), respond(301, '', { location: 'https://elsewhere.invalid/v1/chat/completions' })])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    model: 'side-chat',
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.deepEqual(result, { ok: false, kind: 'redirect', code: 'Si106', raw: '', message: '地址无效 · Si106 错误' })
  assert.equal(f.calls.length, 2)
})

test('模型列表回的不是 JSON，没填模型名：让用户自己填模型', async () => {
  const f = fake([respond(200, '<html>这是个网页</html>')])
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: 'https://api.side.example/v1',
    key: KEY,
    fetchImpl: f.fetchImpl,
  })
  seen.push(result)
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'nomodels')
  assert.equal(result.code, 'Si108')
  assert.equal(f.calls.length, 1)
})

test('DeepSeek 密钥框空着点「测试并保存」：一个请求都不发，只说密钥没填', async () => {
  for (const key of ['', '   ', undefined]) {
    const f = fake([])
    const result = await probeDeepseek({ key, fetchImpl: f.fetchImpl })
    seen.push(result)
    assert.equal(f.calls.length, 0, '不连 DeepSeek')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'Si101')
    assert.equal(result.message, '密钥未填写 · Si101 错误')
  }
})
