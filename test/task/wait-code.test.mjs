// 等的时候停工那几种：停在这儿 / 一直没回 / 回的话是坏的，后面都带一个错误码（Si）。
// 厂商的业务错误码（智谱 1302 / 1305）不认了：忙就是 Si429、模型忙那句话。

import assert from 'node:assert/strict'
import test from 'node:test'
import { codeFor, errorCodeLine } from '../../app/task/codes.mjs'
import { createTask, reduceTask } from '../../app/task/state.mjs'
import { toTaskView } from '../../app/task/view.mjs'

function working() {
  return { ...createTask(), runId: 'r1', phase: 'working', round: 1 }
}

function errorItem(reason, extra = {}) {
  const state = working()
  const step = reduceTask(state, { type: 'error', reason, taskId: 'r1', ...extra })
  const item = step.state.flow.find((one) => one.kind === 'error')
  return { step, item }
}

test('三种停工各有一个码', () => {
  assert.equal(codeFor('busy'), 'Si429')
  assert.equal(codeFor('noreply'), 'Si303')
  assert.equal(codeFor('badreply'), 'Si305')
})

test('一直没回：停在这儿，带 Si303', () => {
  const { step, item } = errorItem('noreply')
  assert.ok(item, '没有停工那一行')
  assert.equal(item.code, 'Si303')
  assert.equal(step.state.phase, 'paused')
  assert.equal(item.text, '模型响应超时，已保存执行进度')
  // 画成输入框上方的红色横幅，不在对话流里
  const block = toTaskView(step.state, { root: '' }).banner
  assert.deepEqual([block.level, block.code], ['block', 'Si303'])
})

test('回的话是坏的：带 Si305', () => {
  const { item } = errorItem('badreply', { raw: 'stream ended without finish_reason' })
  assert.equal(item.code, 'Si305')
  assert.equal(item.text, '模型响应无效，已保存执行进度')
  assert.equal(item.raw, 'stream ended without finish_reason')
})

test('一直忙：带 Si429；厂商的业务码不单说', () => {
  const { item } = errorItem('busy', { vendor: '智谱', biz: 1302 })
  assert.equal(item.code, 'Si429')
  assert.equal(item.text, '模型忙，已保存执行进度')
})

test('日志里也有这一行：码 + 细节', () => {
  const line = errorCodeLine({ reason: 'noreply', detail: 'no reply after 60s' })
  assert.equal(line.code, 'Si303')
  assert.equal(line.event, 'error-code')
  assert.match(line.detail, /no reply/)
})
