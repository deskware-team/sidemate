// 点卡片上的「收下」：换成新的空任务，对话流是空的，不留「上一个任务收好了」那一行。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'

const at = Date.UTC(2026, 10, 2, 12, 0, 0)
const usage = { at, inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 }
const OUT = 'C:/Users/slow/桌伴/任务/1106-汇成本周周报'

function withCard() {
  let s = reduceTask(createTask(), { type: 'send', text: '汇成本周周报', runId: 'a1' }).state
  s = reduceTask(s, { type: 'output', taskId: 'a1', name: '本周周报.docx', to: `${OUT}/本周周报.docx`, pages: 3 }).state
  s = reduceTask(s, { type: 'usage', taskId: 'a1', ...usage }).state
  s = reduceTask(s, { type: 'end', taskId: 'a1', status: 'done' }).state
  return s
}

function chatOnly() {
  let s = reduceTask(createTask(), { type: 'send', text: '讲个笑话', runId: 'b1' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'b1', text: '好。' }).state
  s = reduceTask(s, { type: 'end', taskId: 'b1', status: 'done' }).state
  return s
}

test('点收下：有产出也好、只聊天也好，新任务的对话流都是空的', () => {
  for (const before of [withCard(), chatOnly()]) {
    const step = reduceTask(before, { type: 'accept' })
    assert.equal(step.settle, true)
    assert.equal(step.pet, 'idle')
    assert.equal(step.state.phase, 'empty')
    assert.deepEqual(step.state.flow, [])
    assert.deepEqual(step.state.cards, [])
    const view = toTaskView(step.state)
    assert.deepEqual(view.flow, [])
    // 空的新任务：对话区不放提示（占位字已经说了），输入框占位字还是那一句
    assert.equal(view.flowHint, undefined)
    assert.equal(view.input.hint, '拖动文件到聊天框，或随便说点什么')
  }
})

test('点收下：还在干活的窗不动', () => {
  const s = reduceTask(createTask(), { type: 'send', text: '写', runId: 'c1' }).state
  const step = reduceTask(s, { type: 'accept' })
  assert.equal(step.settle, false)
  assert.equal(step.state, s)
})

test('点收下和点新任务一样：都是空的新任务', () => {
  const accepted = reduceTask(withCard(), { type: 'accept' }).state
  const fresh = reduceTask(withCard(), { type: 'new' }).state
  assert.deepEqual(accepted.flow, fresh.flow)
  assert.deepEqual(accepted.flow, [])
  assert.equal(accepted.phase, fresh.phase)
})
