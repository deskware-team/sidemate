// 回话：干活过程中模型说的每一段话都是一个气泡、都留着（学 Grok Bot）：
// 每开始用一次工具，前面那段就收住发出去；收场时最后那段也发。逐字流出来时发前缀，
// 收住时用结算整段校准。过程话也进对话历史。
// 这里用一个只说 ACP 的假对端，事件序列自己排：话 → 工具 → 话。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'

const KEY = 'sidemate-test-key'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 假对端：按 peer.json 里的 mode 回话。事件顺序就是这里写下的顺序。
const PEER_SCRIPT = `
const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const cfg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'peer.json'), 'utf8'))
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const say = (text, id) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: { sessionUpdate: 'agent_message_chunk', messageId: id || 'm1', content: { type: 'text', text } } } })
const tool = () => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'web_search', kind: 'other', status: 'in_progress', rawInput: { query: 'q' } } } })
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'peer-1' } })
    else if (msg.method === 'session/prompt') {
      if (cfg.mode === 'plain') {
        say('话A')
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      } else if (cfg.mode === 'two') {
        say('话A', 'm1')
        say('话B', 'm2')
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      } else if (cfg.mode === 'tool2') {
        say('话A')
        tool()
        say('话B', 'm2')
        tool()
        say('话C', 'm3')
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      } else if (cfg.mode === 'tool') {
        say('话A')
        tool()
        say('话B', 'm2')
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      } else if (cfg.mode === 'stream') {
        // 逐字流：照真插件的样子，把每个字一行一行写进桌伴给的那个文件（路径在环境变量里）
        const file = process.env.DSH_SIDEMATE_STREAM_FILE || ''
        const line = (item) => { try { appendFileSync(file, JSON.stringify(item) + '\\n', 'utf8') } catch { /* 写不动就当没这行 */ } }
        line({ sessionId: 'peer-1', attemptId: 'a1', kind: 'delta', text: '你' })
        line({ sessionId: 'peer-1', attemptId: 'a1', kind: 'delta', text: '好' })
        // 等桌伴把文件读走（读器隔一会儿读一回），再结算整段
        setTimeout(() => {
          line({ sessionId: 'peer-1', attemptId: 'a1', kind: 'end', committed: true })
          say('你好')
          send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
        }, 400)
      } else {
        say('话A')
        tool()
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Internal error: turn failed: 炸了' } })
      }
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

function fakePeer(mode) {
  const root = scratch('sidemate-peer-')
  mkdirSync(join(root, 'node'), { recursive: true })
  const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(process.execPath, node)
  chmodSync(node, 0o755)
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
  writeFileSync(join(root, 'peer.json'), JSON.stringify({ mode }))
  return root
}

async function runPeer(mode, taskId, extra = {}) {
  const events = []
  const handle = runTask({
    taskId,
    workspace: scratch('sidemate-ws-'),
    lowRoot: scratch('sidemate-low-'),
    payloadRoot: fakePeer(mode),
    apiKey: KEY,
    prompt: '说',
    // 报错也要重试（没说原因就失败算服务出错）：测试里等不起，只试一次
    retryPolicy: { initialDelayMs: 10, maxDelayMs: 20, maxRetries: 1 },
    onEvent: (event) => events.push(event),
    ...extra,
  })
  const end = await handle.done
  return { end, events, replies: events.filter((one) => one.type === 'reply').map((one) => one.text) }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('话 → 工具 → 话：两段话各自一个气泡', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('tool', 'reply-tool')
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(replies, ['话A', '话B'])
})

test('三段过程话出三个气泡：中间那段不丢', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('tool2', 'reply-tool2')
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(replies, ['话A', '话B', '话C'])
})

test('没有工具调用：话原样就是回答', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('plain', 'reply-plain')
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(replies, ['话A'])
})

test('两段话、中间没有工具：合起来就是回答', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('two', 'reply-two')
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(replies, ['话A话B'])
})

test('话 → 工具 → 出错：动手前那段照冒，没有别的回答', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('error', 'reply-error')
  assert.equal(end.status, 'error', JSON.stringify(events))
  assert.deepEqual(replies, ['话A'])
  assert.equal(events.some((one) => one.type === 'error'), true)
})

test('回答在收场前发出去：动手前那段在动手时就冒', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('tool', 'reply-order')
  assert.equal(end.status, 'done', JSON.stringify(events))
  // 回话这条排在结束之前：任务窗先收话，再收场
  const atReply = events.findIndex((one) => one.type === 'reply')
  const atEnd = events.findIndex((one) => one.type === 'end')
  assert.ok(atReply >= 0 && atReply < atEnd, JSON.stringify(events.map((one) => one.type)))
  // 动手前那段排在工具调用之前、回答排在结束之前
  const types = events.map((one) => one.type)
  assert.ok(types.indexOf('reply') < types.indexOf('tool-call'), JSON.stringify(types))
  assert.equal(replies.length, 2)
})

test('逐字流：增量发出去的是前缀递增，结算的整段不再重复一遍', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('stream', 'reply-stream')
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(replies, ['你', '你好'])
})

test('新闻那一轮不转发逐字流', { timeout: 60_000 }, async () => {
  const { end, events, replies } = await runPeer('stream', 'reply-streamnews', { title: false })
  assert.equal(end.status, 'done', JSON.stringify(events))
  // 只有收场那句结算的整段，没有流式前缀
  assert.deepEqual(replies, ['你好'])
})
