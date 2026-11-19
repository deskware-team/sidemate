import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createKeyring } from '../../app/models/keys.mjs'
import {
  addMcp,
  loadMcp,
  mcpServersFor,
  mcpToolsFor,
  parsePasted,
  probeLocalMcp,
  probeMcp,
  removeMcp,
  resolveCommand,
  updateMcp,
} from '../../app/abilities/mcp.mjs'

const KEY_A = 'demo-mcp-key-alpha'
const KEY_B = 'demo-mcp-key-beta'

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

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-abilities-'))
  const file = join(dir, 'mcp.json')
  const keyring = createKeyring({ root: dir, crypto: xor() })
  return { dir, file, keyring }
}

// ─── 存取和校验 ─────────────────────────────────────────────

test('addMcp 存条目、钥匙进钥匙串不进文件', () => {
  const { dir, file, keyring } = fresh()
  try {
    const added = addMcp(file, {
      name: 'GitHub 工具',
      url: 'https://api.side.example/mcp',
      auth: { kind: 'header', name: 'Authorization' },
      secret: KEY_A,
    }, keyring)
    assert.equal(added.ok, true)
    assert.equal(added.id, 'mcp-github')
    assert.equal(keyring.read('mcp-github'), KEY_A)
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes(KEY_A), false)
    const raw = JSON.parse(text)
    assert.deepEqual(raw.mcp, [
      { id: 'mcp-github', name: 'GitHub 工具', url: 'https://api.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: true, sealed: raw.mcp[0].sealed },
    ])
    // 密文就存在这一条上，不另存文件；往外带的列表里没有它
    assert.equal(typeof raw.mcp[0].sealed, 'string')
    assert.deepEqual(loadMcp(file), [
      { id: 'mcp-github', name: 'GitHub 工具', url: 'https://api.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: true },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('addMcp 不动同一个文件里的其他字段', () => {
  const { dir, file, keyring } = fresh()
  try {
    writeFileSync(file, `${JSON.stringify({ version: 1, skills: { a: true }, mcp: [] })}\n`, 'utf8')
    const added = addMcp(file, { name: '查资料', url: 'https://side.example/mcp', auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(added.ok, true)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    assert.deepEqual(raw.skills, { a: true })
    assert.equal(raw.version, 1)
    assert.equal(raw.mcp.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同名重排：mcp-github、mcp-github-2；文件缺了回空数组', () => {
  const { dir, file, keyring } = fresh()
  try {
    addMcp(file, { name: 'GitHub', url: 'https://a.side.example/mcp', auth: { kind: 'none', name: '' } }, keyring)
    const second = addMcp(file, { name: 'GitHub', url: 'https://b.side.example/mcp', auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(second.id, 'mcp-github-2')
    assert.deepEqual(loadMcp(join(dir, '没有.json')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('校验：http 远端、名字长度、放法、参数名、网址带钥匙', () => {
  const { dir, file, keyring } = fresh()
  try {
    const bad = addMcp(file, { name: '远端', url: 'http://api.side.example/mcp', auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(bad.ok, false)
    assert.deepEqual(bad.errors, ['网址格式错误'])
    // 界面只说那一类，哪条规矩没过写在 detail 里（设置窗记进日志）
    assert.equal(bad.detail, 'url is not https')
    const local = addMcp(file, { name: '本机调试', url: 'http://127.0.0.1:3333/mcp', auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(local.ok, true)
    const longName = addMcp(file, { name: 'x'.repeat(21), url: 'https://a.side.example/mcp', auth: { kind: 'none', name: '' } }, keyring)
    assert.deepEqual(longName.errors, ['名称不合规'])
    const badKind = addMcp(file, { name: '怪放法', url: 'https://a.side.example/mcp', auth: { kind: 'cookie', name: 'x' } }, keyring)
    assert.deepEqual(badKind.errors, ['配置错误'])
    assert.equal(badKind.detail, 'unknown auth kind')
    const badName = addMcp(file, { name: '怪名字', url: 'https://a.side.example/mcp', auth: { kind: 'header', name: '坏 名字' } }, keyring)
    assert.deepEqual(badName.errors, ['名称不合规'])
    const leaked = addMcp(file, { name: '带钥匙', url: 'https://a.side.example/mcp?key=abc', auth: { kind: 'none', name: '' } }, keyring)
    assert.deepEqual(leaked.errors, ['网址参数含密钥'])
    assert.equal(loadMcp(file).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadMcp 把夹带的字段和钥匙洗掉', () => {
  const { dir, file } = fresh()
  try {
    const raw = {
      mcp: [
        { id: 'mcp-x', name: 'X', url: 'https://x.side.example/mcp', auth: { kind: 'none', name: '' }, enabled: true, secret: KEY_A },
        { id: 'no-prefix', name: '坏', url: 'https://y.side.example/mcp', auth: { kind: 'none', name: '' } },
        '不是对象',
      ],
    }
    writeFileSync(file, `${JSON.stringify(raw)}\n`, 'utf8')
    const list = loadMcp(file)
    assert.equal(list.length, 1)
    assert.deepEqual(Object.keys(list[0]).sort(), ['auth', 'enabled', 'id', 'name', 'url'])
    assert.equal(JSON.stringify(list).includes(KEY_A), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateMcp 换钥匙、改放法删钥匙；removeMcp 把钥匙一起删', () => {
  const { dir, file, keyring } = fresh()
  try {
    addMcp(file, { name: 'GitHub', url: 'https://api.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, secret: KEY_A }, keyring)
    const swapped = updateMcp(file, 'mcp-github', { url: 'https://new.side.example/mcp' }, keyring, KEY_B)
    assert.equal(swapped.ok, true)
    assert.equal(keyring.read('mcp-github'), KEY_B)
    assert.equal(loadMcp(file)[0].url, 'https://new.side.example/mcp')
    const toNone = updateMcp(file, 'mcp-github', { auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(toNone.ok, true)
    assert.equal(keyring.has('mcp-github'), false)
    const removed = removeMcp(file, 'mcp-github', keyring)
    assert.equal(removed.ok, true)
    assert.deepEqual(loadMcp(file), [])
    const again = removeMcp(file, 'mcp-github', keyring)
    assert.equal(again.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── 粘贴解析 ───────────────────────────────────────────────

test('粘贴 mcpServers 写法：请求头抽钥匙，条目里不留', () => {
  const out = parsePasted(JSON.stringify({
    mcpServers: {
      github: {
        type: 'http',
        url: 'https://api.side.example/mcp',
        headers: { Authorization: `Bearer ${KEY_A}`, 'X-Org': 'side' },
      },
      gitlab: {
        serverUrl: 'https://gl.side.example/mcp',
        headers: { 'PRIVATE-TOKEN': KEY_B },
      },
    },
  }))
  assert.deepEqual(out.problems, [])
  assert.deepEqual(out.entries, [
    { name: 'github', url: 'https://api.side.example/mcp', auth: { kind: 'header', name: 'Authorization' } },
    { name: 'gitlab', url: 'https://gl.side.example/mcp', auth: { kind: 'header', name: 'PRIVATE-TOKEN' } },
  ])
  assert.deepEqual(out.secrets, { github: `Bearer ${KEY_A}`, gitlab: KEY_B })
  assert.equal(JSON.stringify(out.entries).includes(KEY_A), false)
})

test('粘贴：网址参数里的钥匙抽出来，网址洗干净', () => {
  const out = parsePasted(JSON.stringify({
    mcpServers: {
      search: { url: 'https://s.side.example/mcp?api_key=qq-query-key-9&lang=zh', headers: {} },
    },
  }))
  assert.deepEqual(out.problems, [])
  assert.deepEqual(out.entries, [{ name: 'search', url: 'https://s.side.example/mcp?lang=zh', auth: { kind: 'query', name: 'api_key' } }])
  assert.equal(out.secrets.search, 'qq-query-key-9')
})

test('粘贴单个 { url, headers } 写法：主机名当名字', () => {
  const out = parsePasted(JSON.stringify({ url: 'https://one.side.example/mcp', headers: { 'X-Api-Key': 'xx-api-key-7' } }))
  assert.deepEqual(out.problems, [])
  assert.deepEqual(out.entries, [{ name: 'one.side.example', url: 'https://one.side.example/mcp', auth: { kind: 'header', name: 'X-Api-Key' } }])
  assert.equal(out.secrets['one.side.example'], 'xx-api-key-7')
})

test('粘贴：本机程序（command）收成 stdio 条目：程序找成完整路径，像钥匙的环境变量抽出来', () => {
  const out = parsePasted(JSON.stringify({
    mcpServers: {
      files: {
        command: process.execPath,
        args: ['server.js', '--root', 'C:\\docs'],
        env: { REGION: 'cn', SEARCH_API_KEY: 'ss-local-key-9' },
      },
    },
  }))
  assert.deepEqual(out.problems, [])
  assert.deepEqual(out.entries, [{
    name: 'files',
    transport: 'stdio',
    command: process.execPath,
    args: ['server.js', '--root', 'C:\\docs'],
    env: { REGION: 'cn' },
    auth: { kind: 'env', name: 'SEARCH_API_KEY' },
  }])
  assert.equal(out.secrets.files, 'ss-local-key-9')
})

test('粘贴：本机程序找不到就说找不到，别的坏配置也报得出', () => {
  const missing = parsePasted(JSON.stringify({ mcpServers: { files: { command: 'sidemate-no-such-program-xyz' } } }))
  assert.deepEqual(missing.entries, [])
  assert.deepEqual(missing.problems, [{ name: 'files', message: '找不到这个程序 · Si109 错误', detail: 'command not found: sidemate-no-such-program-xyz' }])
  const typed = parsePasted(JSON.stringify({ mcpServers: { files: { type: 'stdio', url: 'https://a.side.example/mcp' } } }))
  assert.deepEqual(typed.problems, [{ name: 'files', message: '找不到这个程序 · Si109 错误', detail: 'no command' }])
  const noUrl = parsePasted(JSON.stringify({ mcpServers: { broken: { type: 'http' } } }))
  assert.deepEqual(noUrl.problems, [{ name: 'broken', message: '网址未填写', detail: 'no url' }])
  const junk = parsePasted('这不是配置')
  assert.deepEqual(junk.entries, [])
  assert.deepEqual(junk.problems, [{ name: '', message: '配置错误', detail: 'not JSON' }])
})

test('粘贴：请求头和网址参数都带钥匙时只收请求头那把', () => {
  const out = parsePasted(JSON.stringify({
    mcpServers: { both: { url: 'https://b.side.example/mcp?token=tt-2', headers: { Authorization: `Bearer ${KEY_A}` } } },
  }))
  assert.deepEqual(out.entries, [{ name: 'both', url: 'https://b.side.example/mcp', auth: { kind: 'header', name: 'Authorization' } }])
  assert.equal(out.secrets.both, `Bearer ${KEY_A}`)
  assert.deepEqual(out.problems, [{ name: 'both', message: '配置错误', detail: 'key in both header and url query; using the header' }])
})

// ─── 测一下 ─────────────────────────────────────────────────

// 按顺序吐预设返回的假 fetch，同时记下每次请求的 url、headers 和 body
function fakeFetch(responses) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const index = calls.length
    calls.push({ url, headers: { ...(options.headers ?? {}) }, body: options.body })
    const next = responses[index]
    if (!next) throw new Error('no scripted response left')
    if (next.throw) throw new Error('cannot connect')
    if (next.hang) {
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    }
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => (next.headers ?? {})[String(name).toLowerCase()] ?? null },
      async text() { return next.body ?? '' },
    }
  }
  return { fetchImpl, calls }
}

const INIT_JSON = JSON.stringify({
  jsonrpc: '2.0', id: 1,
  result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'side', version: '1' } },
})
const TOOLS_JSON = JSON.stringify({
  jsonrpc: '2.0', id: 2,
  result: { tools: [{ name: 'search', description: '搜资料' }, { name: 'fetch', description: '' }] },
})

test('probe：JSON 回包走通，后续请求带会话号和协议版本', async () => {
  const f = fakeFetch([
    { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }, body: INIT_JSON },
    { status: 202, headers: { 'content-type': 'application/json' }, body: '' },
    { status: 200, headers: { 'content-type': 'application/json' }, body: TOOLS_JSON },
  ])
  const result = await probeMcp({
    url: 'https://api.side.example/mcp',
    auth: { kind: 'header', name: 'Authorization' },
    secret: `Bearer ${KEY_A}`,
    fetchImpl: f.fetchImpl,
  })
  assert.deepEqual(result, { ok: true, tools: [{ name: 'search', description: '搜资料' }, { name: 'fetch', description: '' }], message: '已连接 2 个工具' })
  assert.equal(f.calls[0].headers.Accept, 'application/json, text/event-stream')
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${KEY_A}`)
  assert.equal('Mcp-Session-Id' in f.calls[0].headers, false)
  assert.equal(f.calls[1].headers['Mcp-Session-Id'], 'sess-1')
  assert.equal(f.calls[1].headers['MCP-Protocol-Version'], '2025-06-18')
  assert.equal(f.calls[2].headers['Mcp-Session-Id'], 'sess-1')
  assert.equal(JSON.parse(f.calls[0].body).method, 'initialize')
  assert.equal(JSON.parse(f.calls[1].body).method, 'notifications/initialized')
  assert.equal(JSON.parse(f.calls[2].body).method, 'tools/list')
  assert.equal(JSON.stringify(result).includes(KEY_A), false)
})

test('probe：SSE 回包也解得开', async () => {
  const sse = (obj) => `event: message\ndata: ${JSON.stringify(obj)}\n\n`
  const f = fakeFetch([
    { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-2' }, body: sse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {} } }) },
    { status: 202, headers: { 'content-type': 'text/event-stream' }, body: '' },
    { status: 200, headers: { 'content-type': 'text/event-stream' }, body: `: 保持连接\ndata: 什么都不是\n\n${sse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'only', description: '只有一个' }] } })}` },
  ])
  const result = await probeMcp({ url: 'https://api.side.example/mcp', auth: { kind: 'none', name: '' }, fetchImpl: f.fetchImpl })
  assert.deepEqual(result, { ok: true, tools: [{ name: 'only', description: '只有一个' }], message: '已连接 1 个工具' })
})

test('probe：钥匙放网址参数时拼进发出的网址，不进返回值', async () => {
  const f = fakeFetch([
    { status: 200, headers: { 'content-type': 'application/json' }, body: INIT_JSON },
    { status: 202, headers: {} },
    { status: 200, headers: { 'content-type': 'application/json' }, body: TOOLS_JSON },
  ])
  const result = await probeMcp({
    url: 'https://api.side.example/mcp?lang=zh',
    auth: { kind: 'query', name: 'api_key' },
    secret: 'qq-query-key-9',
    fetchImpl: f.fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(f.calls[0].url, 'https://api.side.example/mcp?lang=zh&api_key=qq-query-key-9')
  assert.equal(JSON.stringify(result).includes('qq-query-key-9'), false)
})

test('probe：401 钥匙不对、404 地址不对、连不上、超时都分得清，只说密钥无效 / 地址无效 / 连接失败，后面跟码', async () => {
  const key = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ status: 401, headers: {}, body: '' }]).fetchImpl })
  assert.deepEqual(key, { ok: false, kind: 'key', code: 'Si401', status: 401, message: '密钥无效 · Si401 错误' })
  const forbidden = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ status: 403, headers: {}, body: '' }]).fetchImpl })
  assert.equal(forbidden.kind, 'key')
  const address = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ status: 404, headers: {}, body: '' }]).fetchImpl })
  assert.deepEqual(address, { ok: false, kind: 'address', code: 'Si404', status: 404, message: '地址无效 · Si404 错误' })
  const net = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ throw: true }]).fetchImpl })
  assert.deepEqual(net, { ok: false, kind: 'network', code: 'Si601', status: 0, message: '连接失败 · Si601 错误' })
  const slow = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ hang: true }]).fetchImpl, timeoutMs: 80 })
  assert.equal(slow.kind, 'network')
  // 那边回了 HTTP 错码又说不清是哪儿：码就是它回的那个
  const odd = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ status: 500, headers: {}, body: '' }]).fetchImpl })
  assert.deepEqual(odd, { ok: false, kind: 'other', code: 'Si500', status: 500, message: '连接失败 · Si500 错误' })
  // 那边回了 200 但回的不是这个工具服务：没有 HTTP 错码，用设置自己的那个码（Si110）
  const notTool = await probeMcp({ url: 'https://api.side.example/mcp', fetchImpl: fakeFetch([{ status: 200, headers: { 'content-type': 'application/json' }, body: '{"hello":"world"}' }]).fetchImpl })
  assert.deepEqual(notTool, { ok: false, kind: 'other', code: 'Si110', status: 0, message: '连接失败 · Si110 错误' })
})

test('probe：报错里不带网址，更不带钥匙和网址参数里的秘密', async () => {
  const net = await probeMcp({
    url: 'https://api.side.example/mcp?api_key=qq-secret-key-1',
    fetchImpl: fakeFetch([{ throw: true }]).fetchImpl,
  })
  assert.equal(net.message.includes('qq-secret-key-1'), false)
  assert.equal(net.message.includes('api_key'), false)
  assert.equal(net.message.includes('https://'), false)
})

// ─── 交给 dsh ───────────────────────────────────────────────

function dshEntries() {
  return [
    { id: 'mcp-github', name: 'GitHub', url: 'https://api.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: true },
    { id: 'mcp-search', name: '查资料', url: 'https://s.side.example/mcp', auth: { kind: 'query', name: 'api_key' }, enabled: true },
    { id: 'mcp-plain', name: '不用钥匙', url: 'https://p.side.example/mcp', auth: { kind: 'none', name: '' }, enabled: true },
    { id: 'mcp-off', name: '停用', url: 'https://o.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: false },
    { id: 'mcp-nokey', name: '没钥匙', url: 'https://n.side.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: true },
    { id: 'mcp-bad', name: '地址不对', url: 'ftp://b.side.example/mcp', auth: { kind: 'none', name: '' }, enabled: true },
  ]
}

test('mcpServersFor：钥匙放请求头的，服务表里带这把钥匙', () => {
  const { dir, file, keyring } = fresh()
  try {
    // 钥匙存在 mcp.json 里对应的那一条上：条目得先在
    writeFileSync(file, `${JSON.stringify({ mcp: dshEntries() }, null, 2)}
`, 'utf8')
    keyring.save('mcp-github', KEY_A)
    const servers = mcpServersFor(dshEntries(), keyring)
    const github = servers.find((one) => one.name === 'github')
    assert.deepEqual(github, {
      type: 'http',
      name: 'github',
      url: 'https://api.side.example/mcp',
      headers: [{ name: 'Authorization', value: KEY_A }],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mcpServersFor：钥匙放网址参数里的，网址里带着这把钥匙', () => {
  const { dir, file, keyring } = fresh()
  try {
    writeFileSync(file, `${JSON.stringify({ mcp: dshEntries() }, null, 2)}
`, 'utf8')
    keyring.save('mcp-search', KEY_B)
    const servers = mcpServersFor(dshEntries(), keyring)
    const search = servers.find((one) => one.name === 'search')
    assert.deepEqual(search, {
      type: 'http',
      name: 'search',
      url: `https://s.side.example/mcp?api_key=${encodeURIComponent(KEY_B)}`,
      headers: [],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mcpServersFor：不用钥匙的照常给，headers 是空的', () => {
  const { dir, keyring } = fresh()
  try {
    const servers = mcpServersFor(dshEntries(), keyring)
    assert.deepEqual(servers.find((one) => one.name === 'plain'), {
      type: 'http',
      name: 'plain',
      url: 'https://p.side.example/mcp',
      headers: [],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mcpToolsFor：服务表和钥匙原文一起给；网址里的普通参数不算钥匙', () => {
  const { dir, file, keyring } = fresh()
  try {
    // 地址里带着 format=json 这种普通参数，钥匙放网址参数里（key=XYZ）
    const entries = [
      { id: 'mcp-json', name: '查资料', url: 'https://x.side.example/mcp?format=json', auth: { kind: 'query', name: 'key' }, enabled: true },
    ]
    writeFileSync(file, `${JSON.stringify({ mcp: entries }, null, 2)}\n`, 'utf8')
    keyring.save('mcp-json', 'XYZ')
    const tools = mcpToolsFor(entries, keyring)
    assert.equal(tools.servers[0].url, 'https://x.side.example/mcp?format=json&key=XYZ', tools.servers[0].url)
    assert.deepEqual(tools.secrets, ['XYZ'], JSON.stringify(tools.secrets))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mcpServersFor：停用的、要钥匙但没存的、校验不过的都不进', () => {
  const { dir, file, keyring } = fresh()
  try {
    writeFileSync(file, `${JSON.stringify({ mcp: dshEntries() }, null, 2)}
`, 'utf8')
    keyring.save('mcp-github', KEY_A)
    const servers = mcpServersFor(dshEntries(), keyring)
    const names = servers.map((one) => one.name)
    assert.equal(names.includes('off'), false, '停用的不进')
    assert.equal(names.includes('nokey'), false, '要钥匙但钥匙串里没有的不进')
    assert.equal(names.includes('bad'), false, '网址不合规的不进')
    assert.deepEqual(mcpServersFor([], keyring), [])
    assert.deepEqual(
      mcpServersFor(dshEntries(), null).map((one) => one.name),
      ['plain'],
      '没有钥匙串时：不用钥匙的那条照给，要钥匙的不给',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─── 本机程序型（stdio） ─────────────────────────────────────

test('resolveCommand：完整路径看在不在；只给名字按 PATH 找（Windows 上按 PATHEXT 补后缀）；带目录的相对路径不认', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-cmd-'))
  try {
    const name = process.platform === 'win32' ? 'faketool.cmd' : 'faketool'
    writeFileSync(join(dir, name), 'echo hi\n', 'utf8')
    const env = { PATH: dir, PATHEXT: '.EXE;.CMD' }
    assert.equal(resolveCommand(process.execPath), process.execPath)
    assert.equal(resolveCommand(join(dir, 'nope.exe')), '')
    assert.equal(resolveCommand('faketool', env), join(dir, name))
    assert.equal(resolveCommand('nothere', env), '')
    assert.equal(resolveCommand('sub\\faketool', env), '')
    assert.equal(resolveCommand('', env), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('addMcp 存本机程序条目：程序、参数、普通环境变量进文件，钥匙进钥匙串；找不到程序不存', () => {
  const { dir, file, keyring } = fresh()
  try {
    const added = addMcp(file, {
      name: '本地搜索',
      transport: 'stdio',
      command: process.execPath,
      args: ['server.js'],
      env: { REGION: 'cn' },
      auth: { kind: 'env', name: 'SEARCH_API_KEY' },
      secret: KEY_B,
    }, keyring)
    assert.equal(added.ok, true, JSON.stringify(added))
    assert.equal(keyring.read(added.id), KEY_B)
    const text = readFileSync(file, 'utf8')
    assert.equal(text.includes(KEY_B), false, '钥匙不进文件')
    assert.deepEqual(loadMcp(file), [{
      id: added.id,
      name: '本地搜索',
      transport: 'stdio',
      command: process.execPath,
      args: ['server.js'],
      env: { REGION: 'cn' },
      auth: { kind: 'env', name: 'SEARCH_API_KEY' },
      enabled: true,
    }])
    const missing = addMcp(file, { name: '不存在', transport: 'stdio', command: 'C:\\no\\such\\program.exe', auth: { kind: 'none', name: '' } }, keyring)
    assert.equal(missing.ok, false)
    assert.deepEqual(missing.errors, ['找不到这个程序 · Si109 错误'])
    assert.equal(loadMcp(file).length, 1, '找不到程序的那条没存')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('mcpToolsFor：本机程序条目交给 dsh 的是 { name, command, args, env }，钥匙放进它自己那个环境变量', () => {
  const { dir, file, keyring } = fresh()
  try {
    const added = addMcp(file, {
      name: 'local',
      transport: 'stdio',
      command: process.execPath,
      args: ['server.js', '--fast'],
      env: { REGION: 'cn' },
      auth: { kind: 'env', name: 'SEARCH_API_KEY' },
      secret: KEY_B,
    }, keyring)
    assert.equal(added.ok, true)
    const tools = mcpToolsFor(loadMcp(file), keyring)
    assert.deepEqual(tools.servers, [{
      name: 'local',
      command: process.execPath,
      args: ['server.js', '--fast'],
      env: [{ name: 'REGION', value: 'cn' }, { name: 'SEARCH_API_KEY', value: KEY_B }],
    }])
    assert.equal('type' in tools.servers[0], false, 'ACP 里本机程序型不带 type')
    assert.deepEqual(tools.secrets, [KEY_B])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('probeLocalMcp：起本机程序走一遍 initialize / tools/list，钥匙进它的环境变量，测完收掉', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-stdio-'))
  try {
    const script = join(dir, 'fake-mcp.mjs')
    writeFileSync(script, [
      "import readline from 'node:readline'",
      "const rl = readline.createInterface({ input: process.stdin })",
      "const say = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')",
      "rl.on('line', (line) => {",
      "  const msg = JSON.parse(line)",
      "  if (msg.method === 'initialize') say({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } })",
      "  if (msg.method === 'tools/list') say({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: process.env.FAKE_KEY === 'kk-1' ? 'with_key' : 'no_key', description: 'd' }] } })",
      "})",
      '',
    ].join('\n'), 'utf8')
    const ok = await probeLocalMcp({ command: process.execPath, args: [script], auth: { kind: 'env', name: 'FAKE_KEY' }, secret: 'kk-1', timeoutMs: 20000 })
    assert.equal(ok.ok, true, JSON.stringify(ok))
    assert.deepEqual(ok.tools.map((one) => one.name), ['with_key'])
    assert.equal(JSON.stringify(ok).includes('kk-1'), false, '钥匙不进返回值')
    const missing = await probeLocalMcp({ command: 'sidemate-no-such-program-xyz' })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'Si109')
    // 起来了但不说 MCP 的程序：马上退出，算连接失败
    const quit = await probeLocalMcp({ command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 20000 })
    assert.equal(quit.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
