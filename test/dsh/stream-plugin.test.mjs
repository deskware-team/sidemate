// 逐字流的两件东西：dsh 小插件（把 agent/assistant-stream 的每个文字增量一行一行写给桌伴）
// 和桌伴这边的接法（一行一行读，读到哪儿记到哪儿；攒成整段前缀、节流着发 reply）。

import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { STREAM_FILE_ENV, createLiveReplies, createStreamWatcher, streamPatchYaml, streamPluginSource } from '../../app/dsh/stream-plugin.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('插件源码：听 agent/assistant-stream，把文字增量和结算各写成一行 JSON', () => {
  const source = streamPluginSource()
  assert.match(source, /ctx\.on\('agent\/assistant-stream'/)
  assert.match(source, /chunk\.type !== 'text-delta'/)
  assert.match(source, /kind: 'delta'/)
  assert.match(source, /kind: 'end'/)
  // 只有结算成 assistant/message 的那次才算成（要重试的那种不算）
  assert.match(source, /eventType === 'assistant\/message'/)
  // 会话号从 agent 上拿：一个进程上跑好几个会话，每行都带会话号
  assert.match(source, /agent\?\.session\?\.id/)
  // 写进哪个文件从环境变量拿，源码里不写死路径
  assert.match(source, new RegExp(STREAM_FILE_ENV))
  // 不许出现钥匙
  assert.equal(/api[_-]?key/i.test(source), false)
})

test('补丁：插一行自己的插件，不动 acp 那一行', () => {
  const text = streamPatchYaml('C:/tmp/patches/stream-plugin.mjs')
  assert.match(text, /- insert:/)
  assert.match(text, /- id: sidemate-stream/)
  assert.match(text, /name: "C:\/tmp\/patches\/stream-plugin\.mjs"/)
  assert.equal(/disabled: true/.test(text), false)
})

test('读流式文件：一行一个事件，读到哪儿记到哪儿', async () => {
  const dir = scratch('sidemate-stream-')
  const path = join(dir, 'stream.log')
  const seen = []
  const watcher = createStreamWatcher({ path, onEvent: (info) => seen.push(info), intervalMs: 10 })
  try {
    appendFileSync(path, `${JSON.stringify({ sessionId: 's1', attemptId: 'a1', kind: 'delta', text: '你' })}\n`, 'utf8')
    appendFileSync(path, `${JSON.stringify({ sessionId: 's1', attemptId: 'a1', kind: 'end', committed: true })}\n`, 'utf8')
    await sleep(120)
    assert.deepEqual(seen, [
      { kind: 'delta', sessionId: 's1', attemptId: 'a1', text: '你' },
      { kind: 'end', sessionId: 's1', attemptId: 'a1', committed: true },
    ])
  } finally {
    watcher.stop()
  }
})

test('读流式文件：不是 JSON 的、不认识的行都跳过，不把一轮带崩', async () => {
  const dir = scratch('sidemate-stream-')
  const path = join(dir, 'stream.log')
  const seen = []
  const watcher = createStreamWatcher({ path, onEvent: (info) => seen.push(info), intervalMs: 10 })
  try {
    appendFileSync(path, '不是 JSON\n', 'utf8')
    appendFileSync(path, `${JSON.stringify({ sessionId: 's1', attemptId: 'a1', kind: 'delta', text: '好' })}\n`, 'utf8')
    appendFileSync(path, `${JSON.stringify({ kind: 'noise' })}\n`, 'utf8')
    await sleep(120)
    assert.deepEqual(seen, [{ kind: 'delta', sessionId: 's1', attemptId: 'a1', text: '好' }])
  } finally {
    watcher.stop()
  }
})

test('增量攒成整段前缀：发出去的前缀一次比一次长，不重复', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 20 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '你' })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '好' })
  await sleep(80)
  live.frame({ kind: 'delta', attemptId: 'a1', text: '呀' })
  await sleep(80)
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['你', '你好', '你好呀'])
  assert.ok(replies.every((one) => one.type === 'reply'))
})

test('节流：隔得近的增量攒成一个前缀，不一个字一发', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 60 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '一' })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '二' })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '三' })
  await sleep(30)
  assert.deepEqual(replies.map((one) => one.text), ['一'])
  await sleep(80)
  assert.deepEqual(replies.map((one) => one.text), ['一', '一二三'])
  live.stop()
})

test('结算的整段以它为准：流式缺了尾巴，结算来了补上', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 10 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '你' })
  await sleep(40)
  live.settle('你好')
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['你', '你好'])
})

test('结算的超了车（文件还没读到）：流式不抢，整段到收住时才发', () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text })
  live.settle('你好')
  live.frame({ kind: 'delta', attemptId: 'a1', text: '你' })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '好' })
  live.frame({ kind: 'end', attemptId: 'a1', committed: true })
  live.cut('你好')
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['你好'])
})

test('这一步收住：流式发过就不再补同一句（同一段不重复）', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 10 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '话A' })
  await sleep(40)
  live.cut('话A')
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['话A'])
})

test('这一步收住：没流过的那段这时整段补发（过程话也是独立气泡）', () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text })
  live.settle('话B')
  live.cut('话B')
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['话B'])
})

test('这一步收住：打码后空白的段不发', () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text })
  live.settle('  \n\t')
  live.cut('  \n\t')
  live.stop()
  assert.deepEqual(replies, [])
})

test('收住以后才读到的字（文件比话慢）不另开新段', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 10 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '话A' })
  await sleep(40)
  live.cut('话A')
  live.frame({ kind: 'delta', attemptId: 'a1', text: '话' }) // 同一段的字这时才从文件里读出来
  live.frame({ kind: 'delta', attemptId: 'a1', text: 'A' })
  live.stop()
  assert.deepEqual(replies.map((one) => one.text), ['话A'])
})

test('没成的那次（要重试）：半截丢掉，下一次从头攒，不接在半截后面', async () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, waitMs: 10 })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '半' })
  live.frame({ kind: 'end', attemptId: 'a1', committed: false })
  live.frame({ kind: 'delta', attemptId: 'a2', text: '成' })
  await sleep(40)
  live.stop()
  // 没成那次的半截已经冒出去了，收回是下一张卡的事；这里只保证重试的字不接在半截后面
  assert.deepEqual(replies.map((one) => one.text), ['半', '成'])
})

test('新闻那一轮不转发', () => {
  const replies = []
  const live = createLiveReplies({ emit: (event) => replies.push(event), redact: (text) => text, news: true })
  live.frame({ kind: 'delta', attemptId: 'a1', text: '闲' })
  live.settle('闲话')
  live.cut('闲话')
  live.stop()
  assert.deepEqual(replies, [])
})
