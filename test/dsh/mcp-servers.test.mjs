// 外部工具服务走 ACP 原生做法：建会话时随 mcpServers 参数交给 dsh，
// 不再生成补丁，钥匙也不进环境变量。
// 这里用真 dsh（rc.3）+ 本机假模型服务 + 本机假 http 外部工具服务验：
// 假模型收到的工具表里有那个服务的工具，假服务收到的请求带着钥匙头，
// dsh 家的配置文件里没有这把钥匙。

import assert from 'node:assert/strict'
import { existsSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const MCP_KEY = 'sidemate-mcp-key-001'
const layout = payloadLayout()
const roots = []
const servers = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
  copyFileSync(process.execPath, layout.node)
  chmodSync(layout.node, 0o755)
}

// 假的 http 外部工具服务：回 initialize 和 tools/list 那两次
function fakeMcp({ tools }) {
  const hits = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      hits.push({ method: req.method, url: req.url, headers: req.headers, body: raw })
      // 服务端往客户端推的那条流：这里不开，405 是允许的
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let msg = {}
      try {
        msg = JSON.parse(raw)
      } catch {
        msg = {}
      }
      const reply = (body) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (msg.method === 'initialize') {
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'fake-mcp', version: '1.0.0' },
          },
        })
        return
      }
      if (msg.method === 'tools/list') {
        reply({ jsonrpc: '2.0', id: msg.id, result: { tools } })
        return
      }
      if (msg.id === undefined) {
        res.writeHead(202)
        res.end()
        return
      }
      reply({ jsonrpc: '2.0', id: msg.id, result: {} })
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const entry = {
        hits,
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise((done) => server.close(() => done())),
      }
      servers.push(entry)
      resolve(entry)
    })
  })
}

// 一个目录里哪些文件写着这把钥匙
function filesWithKey(dir) {
  const out = []
  const walk = (full) => {
    for (const name of readdirSync(full)) {
      const path = join(full, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      try {
        if (readFileSync(path, 'utf8').includes(MCP_KEY)) out.push(path)
      } catch {
        // 不是文字文件：读不了就不算
      }
    }
  }
  if (!existsSync(dir)) return out
  walk(dir)
  return out
}

after(async () => {
  for (const one of servers) await one.close()
  // Windows 上刚收掉的 dsh 可能还占着临时目录里的文件：多试几次，还删不掉就留给系统清，不算测试失败
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {
      // 删不掉的临时目录不影响结果
    }
  }
})

describe('外部工具服务走 mcpServers', { concurrency: 1 }, () => {
  test('带上服务表：模型那边有这个服务的工具，服务那边收到带钥匙的请求，配置文件里没有钥匙', { timeout: 180_000 }, async () => {
    ensureNode()
    const mcp = await fakeMcp({ tools: [{ name: 'echo', description: '回一句', inputSchema: { type: 'object', properties: {} } }] })
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'text', text: '好了' }) })
    const lowRoot = scratch('sidemate-mcpsrv-low-')
    try {
      const events = []
      const handle = runTask({
        taskId: 'mcp-servers',
        apiKey: KEY,
        baseUrl: fake.url,
        prompt: '说一声好了',
        workspace: scratch('sidemate-mcpsrv-ws-'),
        lowRoot,
        mcpServers: [{ type: 'http', name: 'fake', url: mcp.url, headers: [{ name: 'Authorization', value: MCP_KEY }] }],
        onEvent: (event) => events.push(event),
      })
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(events.map((event) => event.type)))
      // 假模型收到的工具表里有这个服务的工具
      assert.ok(fake.calls.length >= 1, '模型没收到请求')
      const tools = (fake.calls[0].tools || []).map((one) => one?.name ?? one?.function?.name)
      assert.equal(tools.includes('mcp__fake__echo'), true, JSON.stringify(tools))
      // 假服务收到的请求带着钥匙头
      const posts = mcp.hits.filter((one) => one.method === 'POST')
      assert.ok(posts.length >= 1, '外部工具服务没收到请求')
      assert.equal(posts.every((one) => one.headers.authorization === MCP_KEY), true, JSON.stringify(posts.map((one) => one.headers.authorization)))
      // dsh 家的配置文件里没有这把钥匙
      const patch = join(lowRoot, 'dsh', 'cordis.patch.yml')
      if (existsSync(patch)) assert.equal(readFileSync(patch, 'utf8').includes(MCP_KEY), false, '配置文件里不该有钥匙')
      assert.deepEqual(filesWithKey(lowRoot), [], 'dsh 家的文件里不该有钥匙')
    } finally {
      await fake.close()
    }
  })

  test('本机程序型：dsh 起这个程序，模型那边有它的工具，钥匙只进这个程序的环境变量', { timeout: 180_000 }, async () => {
    ensureNode()
    const dir = scratch('sidemate-mcpsrv-stdio-')
    const script = join(dir, 'fake-mcp.mjs')
    // 假的本机程序型服务：钥匙对了工具叫 with_key，没收到钥匙叫 no_key
    writeFileSync(script, [
      "import readline from 'node:readline'",
      "const rl = readline.createInterface({ input: process.stdin })",
      "const say = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')",
      "rl.on('line', (line) => {",
      "  let msg = {}",
      "  try { msg = JSON.parse(line) } catch { return }",
      "  if (msg.method === 'initialize') say({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } } })",
      `  else if (msg.method === 'tools/list') say({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: process.env.LOCAL_MCP_KEY === '${MCP_KEY}' ? 'with_key' : 'no_key', description: 'd', inputSchema: { type: 'object', properties: {} } }] } })`,
      "  else if (msg.id !== undefined) say({ jsonrpc: '2.0', id: msg.id, result: {} })",
      "})",
      '',
    ].join('\n'), 'utf8')
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'text', text: '好了' }) })
    const lowRoot = scratch('sidemate-mcpsrv-low-')
    try {
      const events = []
      const handle = runTask({
        taskId: 'mcp-stdio',
        apiKey: KEY,
        baseUrl: fake.url,
        prompt: '说一声好了',
        workspace: scratch('sidemate-mcpsrv-ws-'),
        lowRoot,
        mcpServers: [{ name: 'local', command: process.execPath, args: [script], env: [{ name: 'LOCAL_MCP_KEY', value: MCP_KEY }] }],
        onEvent: (event) => events.push(event),
      })
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(events.map((event) => event.type)))
      assert.equal(events.some((event) => event.type === 'mcp-config-failed'), false, '本机程序型的配置 dsh 应该认')
      assert.ok(fake.calls.length >= 1, '模型没收到请求')
      const tools = (fake.calls[0].tools || []).map((one) => one?.name ?? one?.function?.name)
      assert.equal(tools.includes('mcp__local__with_key'), true, JSON.stringify(tools))
      assert.deepEqual(filesWithKey(lowRoot), [], 'dsh 家的文件里不该有钥匙')
    } finally {
      await fake.close()
    }
  })

  test('配置不对：不带它也能跑，任务窗里说一句', { timeout: 180_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'text', text: '好了' }) })
    const lowRoot = scratch('sidemate-mcpsrv-bad-')
    try {
      const events = []
      const handle = runTask({
        taskId: 'mcp-bad',
        apiKey: KEY,
        baseUrl: fake.url,
        prompt: '说一声好了',
        workspace: scratch('sidemate-mcpsrv-ws-'),
        lowRoot,
        // 地址不是 http 网址：dsh 不认这份配置
        mcpServers: [{ type: 'http', name: 'fake', url: '这不是网址', headers: [{ name: 'Authorization', value: MCP_KEY }] }],
        onEvent: (event) => events.push(event),
      })
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(events.map((event) => event.type)))
      assert.equal(events.some((event) => event.type === 'mcp-config-failed'), true, JSON.stringify(events.map((event) => event.type)))
      // 没带上的那一轮，模型那边照旧收到请求
      assert.ok(fake.calls.length >= 1, '模型没收到请求')
      const tools = (fake.calls[0].tools || []).map((one) => one?.name ?? one?.function?.name)
      assert.equal(tools.some((name) => String(name).startsWith('mcp__')), false, JSON.stringify(tools))
    } finally {
      await fake.close()
    }
  })
})
