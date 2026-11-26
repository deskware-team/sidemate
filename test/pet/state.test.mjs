import assert from 'node:assert/strict'
import test from 'node:test'
import { clearHeld, createState, heldTask, reduce } from '../../app/pet/state.mjs'

const at = 1

test('待命是第一态', () => {
  const state = createState()
  assert.equal(state.mode, 'idle')
  assert.equal(state.message, '')
})

test('第一个进度是干活中，那一行记着', () => {
  const step = reduce(createState(), { type: 'progress', taskId: 't1', at, text: '在看材料 2/5' })
  assert.equal(step.state.mode, 'work')
  assert.equal(step.state.taskId, 't1')
  assert.equal(step.state.message, '在看材料 2/5')
  assert.equal(step.notify, false)
})

test('产出和用量都还是干活中', () => {
  const working = reduce(createState(), { type: 'progress', taskId: 't1', at, text: '在写' }).state
  for (const type of ['artifact', 'usage']) {
    const step = reduce(working, { type, taskId: 't1', at })
    assert.equal(step.state.mode, 'work')
    assert.equal(step.state.message, '在写')
  }
})

test('做完了：笑眼，一直保持到点开小岛', () => {
  const done = reduce(createState(), { type: 'end', taskId: 't1', at, status: 'done' })
  assert.equal(done.state.mode, 'done')
  assert.equal(done.hold, true)
  // 通知正文跟小岛悬停那行同一句（状态码 St705）
  assert.equal(done.state.notice, '做完了！')
  const cancelled = reduce(done.state, { type: 'end', taskId: 't1', at, status: 'cancelled' })
  assert.equal(cancelled.state.mode, 'idle')
  assert.equal(cancelled.hold, false)
})

test('没干成是平线，不是等你说话', () => {
  const step = reduce(createState(), { type: 'error', taskId: 't1', at, message: '余额不够' })
  assert.equal(step.state.mode, 'fail')
  assert.equal(step.state.message, '余额不够')
  assert.equal(step.notify, true)
  const ended = reduce(createState(), { type: 'end', taskId: 't1', at, status: 'error', message: '没写成' })
  assert.equal(ended.state.mode, 'fail')
  assert.equal(ended.state.message, '没写成')
  const fallback = reduce(createState(), { type: 'end', taskId: 't1', at, status: 'error' })
  // 什么都没带：状态码 St706
  assert.equal(fallback.state.message, '出错了！')
})

test('它问你一句：要你看一眼', () => {
  const step = reduce(createState(), { type: 'ask', taskId: 't1', at, message: '第三节要不要再短一点？' })
  assert.equal(step.state.mode, 'look')
  assert.equal(step.state.message, '第三节要不要再短一点？')
  assert.equal(step.hold, true)
  // 通知照旧是那句「等你一句话」，冒的那一行里是它问的那句
  const withNotice = reduce(createState(), { type: 'ask', taskId: 't1', at, message: '要不要再短一点？', notice: '等你一句话' })
  assert.equal(withNotice.state.notice, '等你一句话')
  assert.equal(withNotice.state.message, '要不要再短一点？')
})

test('有任务在等确认：小岛说「等你确认」', () => {
  const step = reduce(createState(), { type: 'confirm', taskId: 't1', at, message: '等你确认' })
  assert.equal(step.state.mode, 'confirm')
  assert.equal(step.state.message, '等你确认')
  assert.equal(step.hold, true)
  // 点小岛交给任务窗的是那一轮的 taskId
  assert.deepEqual(heldTask(step.state), { taskId: 't1' })
  // 用户点了以后回到干活中
  const back = reduce(step.state, { type: 'progress', taskId: 't1', at, text: '' })
  assert.equal(back.state.mode, 'work')
})

test('开任务窗：做完了、要你看一眼、没干成都收回去，干活中不动', () => {
  const fail = reduce(createState(), { type: 'error', taskId: 't1', at, message: '看一眼' }).state
  assert.equal(clearHeld(fail).mode, 'idle')
  const done = reduce(createState(), { type: 'end', taskId: 't1', at, status: 'done' }).state
  assert.equal(clearHeld(done).mode, 'idle')
  const look = reduce(createState(), { type: 'ask', taskId: 't1', at, message: '要不要？' }).state
  assert.equal(clearHeld(look).mode, 'idle')
  const working = reduce(createState(), { type: 'progress', taskId: 't1', at, text: '在写' }).state
  assert.equal(clearHeld(working), working)
})

test('换个任务号也算开工了', () => {
  const step = reduce(createState(), { type: 'tick', taskId: 't9', at })
  assert.equal(step.state.mode, 'work')
})

test('阶段：干活中记着，出了干活就清掉', () => {
  const working = reduce(createState(), { type: 'progress', taskId: 't1', at, text: '在写' }).state
  // 干活中还没记下阶段：先当「在读」
  assert.equal(working.phase, 'read')
  const write = reduce(working, { type: 'phase', taskId: 't1', at, phase: 'write' })
  assert.equal(write.state.phase, 'write')
  // 阶段只换阶段：不换状态、不弹通知
  assert.equal(write.state.mode, 'work')
  assert.equal(write.notify, false)
  const think = reduce(write.state, { type: 'phase', taskId: 't1', at, phase: 'think' })
  assert.equal(think.state.phase, 'think')
  // 同一个阶段再来一遍：不换状态
  const same = reduce(think.state, { type: 'phase', taskId: 't1', at, phase: 'think' })
  assert.equal(same.state, think.state)
  // 做完了：阶段清掉
  const done = reduce(think.state, { type: 'end', taskId: 't1', at, status: 'done' })
  assert.equal(done.state.phase, '')
})

test('几个任务同时跑：以最近一条阶段为准', () => {
  const one = reduce(createState(), { type: 'progress', taskId: 't1', at, text: '' }).state
  const two = reduce(one, { type: 'phase', taskId: 't2', at, phase: 'write' })
  assert.equal(two.state.phase, 'write')
  assert.equal(two.state.mode, 'work')
})

test('点小岛交给任务窗的：停在做完了 / 要你看一眼 / 没干成时是那一轮的 taskId，别的时候不带', () => {
  const done = reduce(createState(), { type: 'end', taskId: 'a', at, status: 'done' }).state
  assert.deepEqual(heldTask(done), { taskId: 'a' })
  const look = reduce(createState(), { type: 'ask', taskId: 'b', at, message: '要不要？' }).state
  assert.deepEqual(heldTask(look), { taskId: 'b' })
  const fail = reduce(createState(), { type: 'error', taskId: 'c', at, message: '坏了' }).state
  assert.deepEqual(heldTask(fail), { taskId: 'c' })
  assert.equal(heldTask(reduce(createState(), { type: 'progress', taskId: 'd', at, text: '' }).state), undefined)
  assert.equal(heldTask(createState()), undefined)
  assert.equal(heldTask(clearHeld(done)), undefined)
})
