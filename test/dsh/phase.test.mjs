// 阶段（在读、在写、在想）：dsh 按工具名算出来发给壳，同一个阶段连着来只发一次。
// 这里用一个只说 ACP 的假对端，事件顺序自己排：想 → 读 → 读 → 写。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'
import { phaseOfTool, phaseOfUpdate, createPhaseEmitter } from '../../app/dsh/phase.mjs'

const KEY = 'sidemate-test-key'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 假对端：按 peer.json 里的 steps 回话。steps 里 'think' 是模型在想，其余是工具名。
const PEER_SCRIPT = `
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const cfg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'peer.json'), 'utf8'))
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const update = (u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: u } })
const tool = (title) => update({ sessionUpdate: 'tool_call', toolCallId: 't-' + title, title, kind: 'other', status: 'in_progress', rawInput: {} })
const think = () => update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '想' } })
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
      for (const step of cfg.steps) {
        if (step === 'think') think()
        else tool(step)
      }
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

function fakePeer(steps) {
  const root = scratch('sidemate-peer-')
  mkdirSync(join(root, 'node'), { recursive: true })
  const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(process.execPath, node)
  chmodSync(node, 0o755)
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
  writeFileSync(join(root, 'peer.json'), JSON.stringify({ steps }))
  return root
}

async function runPeer(steps, taskId) {
  const events = []
  const handle = runTask({
    taskId,
    workspace: scratch('sidemate-ws-'),
    lowRoot: scratch('sidemate-low-'),
    payloadRoot: fakePeer(steps),
    apiKey: KEY,
    prompt: '说',
    // 报错也要重试（没说原因就失败算服务出错）：测试里等不起，只试一次
    retryPolicy: { initialDelayMs: 10, maxDelayMs: 20, maxRetries: 1 },
    onEvent: (event) => events.push(event),
  })
  const end = await handle.done
  return { end, events, phases: events.filter((one) => one.type === 'phase').map((one) => one.phase) }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('工具名 → 阶段：读类算 read，其余算 write', () => {
  for (const name of ['read', 'glob', 'grep', 'ls', 'web_search', 'web_fetch', 'office_render', 'skill', 'mcp__acme__search']) {
    assert.equal(phaseOfTool(name), 'read', name)
  }
  for (const name of ['write', 'edit', 'str_replace_editor', 'office_convert', 'office_recalculate', 'present', 'bash', 'pwsh', 'ask']) {
    assert.equal(phaseOfTool(name), 'write', name)
  }
})

test('这一条更新对应哪个阶段：模型在想是 think，动了工具的照工具名算', () => {
  assert.equal(phaseOfUpdate({ sessionUpdate: 'agent_thought_chunk' }), 'think')
  assert.equal(phaseOfUpdate({ sessionUpdate: 'tool_call', title: 'read' }), 'read')
  assert.equal(phaseOfUpdate({ sessionUpdate: 'tool_call', title: 'write' }), 'write')
  assert.equal(phaseOfUpdate({ sessionUpdate: 'agent_message_chunk' }), '')
})

test('阶段发出去：变了才发，连着同一个阶段不发第二遍', () => {
  const events = []
  const emitPhase = createPhaseEmitter((event) => events.push(event))
  emitPhase('read')
  emitPhase('read')
  emitPhase('write')
  emitPhase('think')
  assert.deepEqual(events.map((one) => one.phase), ['read', 'write', 'think'])
  assert.deepEqual(events[0], { type: 'phase', phase: 'read' })
})

test('先读后写：发两次阶段；连着读只发一次', { timeout: 60_000 }, async () => {
  const { end, phases } = await runPeer(['read', 'read', 'write'], 'phase-readwrite')
  assert.equal(end.status, 'done', JSON.stringify(phases))
  assert.deepEqual(phases, ['read', 'write'])
})

test('模型在想：先发一次 think', { timeout: 60_000 }, async () => {
  const { end, phases } = await runPeer(['think', 'think', 'read'], 'phase-think')
  assert.equal(end.status, 'done', JSON.stringify(phases))
  assert.deepEqual(phases, ['think', 'read'])
})
