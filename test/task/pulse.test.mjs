// 状态行只有一种状态，不带计时。
// 等待模型响应（还没回一个字）/ 思考中 / 执行中（在写回答）/ 调工具和壳的步骤直接写在干什么；
// 超过 20 秒没动静：「还需要更长时间」「等待模型响应」每 30 秒换一次。等重试的那行在的时候只有它。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { quietLabel } from '../../app/task/timing.mjs'
import { QUIET_MS } from '../../app/dsh/pulse.mjs'
import { createRunner } from '../../app/task/run.mjs'

const working = (runId = 'p1') => reduceTask(createTask(), { type: 'send', text: '把发票汇成表', runId }).state
const feed = (state, event) => reduceTask(state, { taskId: 'p1', ...event }).state
const row = (state) => toTaskView(state).blocks.find((one) => one.kind === 'working') || null
const label = (state) => row(state)?.text || ''

test('一行一种状态：等待模型响应 → 思考中 → 读《…》中 → 执行中；计时是这一轮的总时长', () => {
  let s = working()
  assert.equal(label(s), '等待模型响应')
  s = feed(s, { type: 'step', step: 'copy', at: 1_000 })
  assert.equal(label(s), '准备文件中')
  // 请求发出去了，还没回一个字：上一步不留
  s = feed(s, { type: 'pulse', phase: 'wait', quietSince: 0 })
  assert.equal(label(s), '等待模型响应')
  s = feed(s, { type: 'pulse', phase: 'think', quietSince: 0 })
  assert.equal(label(s), '思考中')
  // 调工具：直接写在干什么
  s = feed(s, { type: 'pulse', phase: 'tool', quietSince: 0 })
  s = feed(s, { type: 'progress', text: 'read 发票照片1.jpg', at: 9_000 })
  assert.equal(label(s), '查看图片中')
  s = feed(s, { type: 'pulse', phase: 'tool', quietSince: 0 })
  // 调了个认不出的工具：执行中
  const unknown = feed(feed(working(), { type: 'pulse', phase: 'tool', quietSince: 0 }), { type: 'progress', text: 'bash -c x', at: 1 })
  assert.equal(label(unknown), '执行中')
  // 工具跑完又等回话：等待模型响应
  s = feed(s, { type: 'pulse', phase: 'wait', quietSince: 0 })
  assert.equal(label(s), '等待模型响应')
  s = feed(s, { type: 'pulse', phase: 'write', quietSince: 0 })
  assert.equal(label(s), '执行中')
  // 状态行不带计时
  assert.equal('since' in row(s), false)
  // 别的轮的、不在干活的：不收
  assert.equal(reduceTask(s, { type: 'pulse', taskId: '别的', phase: 'think', quietSince: 0 }).state, s)
  const done = reduceTask(s, { type: 'end', taskId: 'p1', status: 'done' }).state
  assert.equal(reduceTask(done, { type: 'pulse', taskId: 'p1', phase: 'think', quietSince: 0 }).state, done)
  assert.equal(row(done), null)
  const again = reduceTask(done, { type: 'send', text: '再加一列', runId: 'p2' }).state
  assert.equal(again.pulse, '')
  assert.equal(again.quietSince, 0)
})

test('超过 20 秒没动静：「还需要更长时间」「等待模型响应」每 30 秒换一次', () => {
  let s = feed(working(), { type: 'pulse', phase: 'think', quietSince: 0 })
  s = feed(s, { type: 'pulse', phase: 'think', quietSince: 1_000_000 })
  const one = row(s)
  assert.equal(one.text, '还需要更长时间')
  // quiet 是开始静下来的那一刻：最后一次动静 + 20 秒
  assert.equal(one.quiet, 1_000_000 + QUIET_MS)
  const at = one.quiet
  assert.equal(quietLabel(at, at), '还需要更长时间')
  assert.equal(quietLabel(at, at + 29_000), '还需要更长时间')
  assert.equal(quietLabel(at, at + 30_000), '等待模型响应')
  assert.equal(quietLabel(at, at + 59_000), '等待模型响应')
  assert.equal(quietLabel(at, at + 60_000), '还需要更长时间')
  // 调工具时静下来也一样，不留在读什么
  let t = feed(working(), { type: 'pulse', phase: 'tool', quietSince: 0 })
  t = feed(t, { type: 'progress', text: 'read 市场.pdf', at: 9_000 })
  t = feed(t, { type: 'pulse', phase: 'tool', quietSince: 5_000 })
  assert.equal(label(t), '还需要更长时间')
  // 又动起来了：回到那一种状态
  s = feed(s, { type: 'pulse', phase: 'write', quietSince: 0 })
  assert.equal(label(s), '执行中')
  assert.equal(row(s).quiet, 0)
})

test('90 秒那句「还在等它回话」没有了：后台不再报，状态行上也不冒', () => {
  const s = feed(working(), { type: 'progress', hint: true, text: '还在等它回话；不想等可以点停下。' })
  assert.equal(label(s), '等待模型响应')
  assert.equal(JSON.stringify(toTaskView(s)).includes('还在等它回话'), false)
})

test('等重试的时候：只有等待那一行；模型出声了等待那行才收，回到一种状态', () => {
  let s = feed(working(), { type: 'pulse', phase: 'wait', quietSince: 0 })
  s = feed(s, { type: 'wait', vendor: '智谱', text: '模型忙，60 秒后自动重试（第 1 次，最多 10 次）', until: 1, retry: 1, max: 10 })
  // 等的时候静下来了：还是只有等待那一行
  s = feed(s, { type: 'pulse', phase: 'wait', quietSince: 5_000 })
  let blocks = toTaskView(s).blocks
  assert.equal(blocks.some((one) => one.kind === 'working'), false)
  assert.equal(blocks.filter((one) => one.kind === 'wait').length, 1)
  // 重试起来了、模型开始想：等待那行收掉，只剩「思考中」
  s = feed(s, { type: 'pulse', phase: 'think', quietSince: 0 })
  blocks = toTaskView(s).blocks
  assert.equal(blocks.some((one) => one.kind === 'wait'), false)
  assert.equal(label(s), '思考中')
})

test('壳那头：dsh 报的状态原样进那一行，不进日志', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-pulse-'))
  const ws = join(root, '工作区')
  mkdirSync(ws, { recursive: true })
  const logs = []
  let onEvent = null
  let finish = null
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'x/y', effort: null }, vendor: '测试', free: false }),
    extensions: ['.md'],
    log: (event, data) => logs.push([event, data]),
    prepareTask: () => ({ kind: 'files', workspace: ws, copied: [], skipped: [], snapshot: [] }),
    runTask: (options) => {
      onEvent = options.onEvent
      return { sessionId: 's1', cancel() {}, done: new Promise((done) => { finish = () => done({ type: 'end', taskId: options.taskId, status: 'done' }) }) }
    },
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: join(root, '产出', input.name), name: input.name, locked: false }),
    clearWorkspace: () => {},
    snapshotWorkspace: () => [],
  })
  runner.act({ type: 'send', text: '说一句' })
  for (let i = 0; i < 400 && !onEvent; i += 1) await new Promise((done) => setTimeout(done, 5))
  assert.ok(onEvent, 'runTask 应当起了')
  const now = () => runner.view().blocks.find((one) => one.kind === 'working')
  onEvent({ type: 'pulse', phase: 'think', quietSince: 0 })
  assert.equal(now().text, '思考中')
  onEvent({ type: 'pulse', phase: 'think', quietSince: 42 })
  assert.equal(now().text, '还需要更长时间')
  assert.equal(now().quiet, 42 + QUIET_MS)
  assert.equal(logs.some(([event]) => event === 'pulse'), false)
  finish()
  for (let i = 0; i < 400 && runner.view().phase === 'working'; i += 1) await new Promise((done) => setTimeout(done, 5))
  assert.equal(runner.view().phase, 'done')
})
