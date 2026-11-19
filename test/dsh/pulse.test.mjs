// 状态行上「模型在不在动」：等回话 → 在想 → 在写回答 / 调工具；静了 20 秒以上报最后一次动静的时刻。
// 只在换了说法、静下来、又动起来时报，最多一拍一次；想的、写的字一个都不报出去。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'
import { QUIET_MS, createPulse } from '../../app/dsh/pulse.mjs'

const roots = []
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}
after(() => { for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } } })

// 假时钟 + 手动走拍：每一声都记下来
function fake() {
  const clock = { t: 0 }
  const told = []
  const pulse = createPulse({ emit: (event) => told.push(event), now: () => clock.t, tickMs: 1_000 })
  const at = (t, fn) => { clock.t = t; fn?.() }
  return { clock, told, pulse, at }
}

const chunk = (kind, text) => ({ sessionUpdate: kind, content: { type: 'text', text } })

test('一串 ACP 动静：等回话 → 在想 → 在写回答 → 调工具 → 又等回话', () => {
  const { told, pulse, at } = fake()
  // 请求还没发：别的动静不算
  at(0, () => pulse.update({ sessionUpdate: 'available_commands_update' }))
  assert.deepEqual(told, [])
  at(0, () => pulse.prompt())
  assert.deepEqual(told, [{ type: 'pulse', phase: 'wait', quietSince: 0 }])
  // 半秒后开始想：不到一拍先压着，下一拍补报
  at(500, () => pulse.update(chunk('agent_thought_chunk', '不该出去的想法')))
  assert.equal(told.length, 1)
  at(1_000, () => pulse.tick())
  assert.deepEqual(told[1], { type: 'pulse', phase: 'think', quietSince: 0 })
  // 还在想、用量来了：说法没变，不报
  at(1_200, () => pulse.update(chunk('agent_thought_chunk', '还在想')))
  at(1_300, () => pulse.update({ sessionUpdate: 'usage_update', used: 10 }))
  at(2_000, () => pulse.tick())
  assert.equal(told.length, 2)
  // 开始写回答
  at(2_500, () => pulse.update(chunk('agent_message_chunk', '先看看')))
  assert.deepEqual(told[2], { type: 'pulse', phase: 'write', quietSince: 0 })
  // 两个工具同时跑：一个跑完还在调工具，都跑完才又等回话
  at(3_600, () => pulse.update({ sessionUpdate: 'tool_call', toolCallId: 'a', status: 'pending', title: 'read' }))
  at(3_700, () => pulse.update({ sessionUpdate: 'tool_call', toolCallId: 'b', status: 'in_progress', title: 'read' }))
  assert.deepEqual(told[3], { type: 'pulse', phase: 'tool', quietSince: 0 })
  at(4_800, () => pulse.update({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' }))
  at(5_000, () => pulse.tick())
  assert.equal(told.length, 4)
  at(5_100, () => pulse.update({ sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'failed' }))
  assert.deepEqual(told[4], { type: 'pulse', phase: 'wait', quietSince: 0 })
  // 报出去的只有说法和时刻，没有一个字
  assert.equal(JSON.stringify(told).includes('想法'), false)
  for (const one of told) assert.deepEqual(Object.keys(one).sort(), ['phase', 'quietSince', 'type'])
})

test('静了 20 秒以上：报最后一次动静的时刻；又动起来就收回', () => {
  const { told, pulse, at } = fake()
  at(0, () => pulse.prompt())
  at(1_000, () => pulse.update(chunk('agent_thought_chunk', 'x')))
  at(2_000, () => pulse.tick())
  assert.deepEqual(told.at(-1), { type: 'pulse', phase: 'think', quietSince: 0 })
  // 正好 20 秒还不算
  at(1_000 + QUIET_MS, () => pulse.tick())
  assert.equal(told.length, 2)
  at(1_000 + QUIET_MS + 1_000, () => pulse.tick())
  assert.deepEqual(told.at(-1), { type: 'pulse', phase: 'think', quietSince: 1_000 })
  // 接着静：秒数页面自己数，这边不再报
  at(40_000, () => pulse.tick())
  at(50_000, () => pulse.tick())
  assert.equal(told.length, 3)
  // 又来了一句：没动静那句收回
  at(55_000, () => pulse.update(chunk('agent_message_chunk', '好')))
  assert.deepEqual(told.at(-1), { type: 'pulse', phase: 'write', quietSince: 0 })
  // 收场以后：再有动静、再走拍都不报
  pulse.stop()
  at(90_000, () => pulse.tick())
  at(91_000, () => pulse.update(chunk('agent_thought_chunk', 'y')))
  assert.equal(told.length, 4)
})

test('同一拍里来回换：最多一秒报一次，下一拍报最后那个说法', () => {
  const { told, pulse, at } = fake()
  at(0, () => pulse.prompt())
  at(100, () => pulse.update(chunk('agent_thought_chunk', 'a')))
  at(200, () => pulse.update(chunk('agent_message_chunk', 'b')))
  at(300, () => pulse.update({ sessionUpdate: 'tool_call', toolCallId: 't', status: 'pending' }))
  assert.equal(told.length, 1)
  at(1_000, () => pulse.tick())
  assert.deepEqual(told.map((one) => one.phase), ['wait', 'tool'])
})

// 一个只说 ACP 的假对端：想两句、静一会儿、写一句，再收场
const PEER = `
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const update = (u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'p1', update: u } })
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'p1' } })
    else if (msg.method === 'session/prompt') {
      await wait(150)
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '秘密的想法' } })
      await wait(150)
      update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '写' } })
      await wait(700)
      update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: '好了' } })
      await wait(150)
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

test('真跑一轮（假对端）：状态行的说法一路报出来，想的字不出去', { timeout: 60_000 }, async () => {
  const root = scratch('sidemate-pulse-peer-')
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER)
  const events = []
  const handle = runTask({
    taskId: 'pulse-peer',
    workspace: scratch('sidemate-ws-'),
    lowRoot: scratch('sidemate-low-'),
    payloadRoot: root,
    node: process.execPath,
    apiKey: 'sidemate-test-key',
    prompt: '写一句',
    usageWaitMs: 0,
    quietMs: 300,
    pulseTickMs: 50,
    onEvent: (event) => events.push(event),
  })
  const end = await handle.done
  assert.equal(end.status, 'done', JSON.stringify(events))
  const pulses = events.filter((one) => one.type === 'pulse')
  const phases = pulses.map((one) => one.phase).filter((one, i, all) => one !== all[i - 1])
  assert.deepEqual(phases, ['wait', 'think', 'write'], JSON.stringify(pulses))
  // 写到一半静了 700 毫秒：报过一回「静了」，又动起来时收回
  const quietAt = pulses.findIndex((one) => one.quietSince > 0)
  assert.ok(quietAt > 0, JSON.stringify(pulses))
  assert.equal(pulses[quietAt].phase, 'write')
  assert.ok(pulses.slice(quietAt + 1).some((one) => one.quietSince === 0), JSON.stringify(pulses))
  // 每一声都带着这一轮的编号；收场以后不再报
  assert.ok(pulses.every((one) => one.taskId === 'pulse-peer'))
  const endAt = events.findIndex((one) => one.type === 'end')
  assert.ok(events.slice(endAt).every((one) => one.type !== 'pulse'))
  // 想的字：事件里没有，日志里只有字数
  assert.equal(JSON.stringify(events).includes('秘密的想法'), false)
  const log = readFileSync(handle.logPath, 'utf8')
  assert.equal(log.includes('秘密的想法'), false)
  assert.match(log, /thought 5/)
})
