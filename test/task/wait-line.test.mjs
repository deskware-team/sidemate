// 等的时候心里有数：等待行会动、挂死不回停在这儿、坏回复说人话（定稿文案）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { countdownText, waitInfo } from '../../app/task/wait.mjs'
import { t } from '../../app/copy/copy.mjs'

const working = () => reduceTask(createTask(), { type: 'send', text: '干活', runId: 'w1' }).state
const here = fileURLToPath(new URL('.', import.meta.url))
const css = readFileSync(join(here, '../../app/task/task.css'), 'utf8')
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')
// 取第一条正好是这个选择器的规则体
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`)
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

test('等待行排版：左边一段照常折行的字，右边一个「停下」；字不再一截一截各占一列', () => {
  const wait = rule('.wait')
  assert.ok(wait, '没找到 .wait')
  assert.equal(/space-between/.test(wait), false, '.wait 不能再用 space-between 把每一截字撑开')
  assert.match(rule('.wait .wtext'), /flex:\s*1/)
  assert.match(rule('.wait .wtext'), /min-width:\s*0/)
  assert.match(rule('.wait .btns'), /flex:\s*none/)
  // 页面上：头、倒数、尾巴都包在同一个 .wtext 里；没有「已经等了多久」那一截
  const waitEl = page.slice(page.indexOf('function waitEl'), page.indexOf('function userEl'))
  assert.match(waitEl, /className = 'wtext'/)
  assert.match(waitEl, /text\.append\(secs/)
  assert.equal(/wmins|waitedText|已经等了/.test(page), false)
})

test('等待行：模型忙，几秒后自动重试、第几次、最多几次；不说已经等了多久', () => {
  const info = waitInfo(37_000, 5, 10, 1_000_000)
  const state = reduceTask(working(), { type: 'wait', taskId: 'w1', vendor: '智谱', ...info }).state
  const wait = state.flow.find((one) => one.kind === 'wait')
  assert.equal(wait.text, '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(wait.head, '模型忙，')
  assert.equal(wait.tail, '（第 5 次，最多 10 次）')
  assert.equal(wait.until, 1_037_000)
  assert.equal(wait.retry, 5)
  // 等待行上有一个「停下」
  assert.deepEqual(wait.buttons.map((one) => one.action), ['stop'])
  // 页面上拿得到拆开的三段，秒数自己走；没有「已经等了多久」那一截
  const block = toTaskView(state).blocks.find((one) => one.kind === 'wait')
  assert.equal(block.head, '模型忙，')
  assert.equal(block.tail, '（第 5 次，最多 10 次）')
  assert.equal('since' in block, false)
  assert.equal('since' in wait, false)
  // 厂商的业务码不单说：忙就是模型忙
  const busy = waitInfo(37_000, 5, 10, 1_000_000, { code: 1302 })
  assert.equal(busy.text, '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(busy.head, '模型忙，')
})

test('倒数：数着走，数到 0 说「重新连接中」，不留「0 秒后自动重试」', () => {
  const now = 1_000_000
  assert.equal(countdownText(now + 37_000, now), '37 秒后自动重试')
  assert.equal(countdownText(now + 1_000, now), '1 秒后自动重试')
  assert.equal(countdownText(now, now), '重新连接中')
  assert.equal(countdownText(now - 5_000, now), '重新连接中')
  assert.equal(countdownText(0, now), '重新连接中')
})

test('忙：停在这儿，已保存执行进度；给「接着干」和「换模型」', () => {
  const state = reduceTask(working(), { type: 'error', taskId: 'w1', reason: 'busy', vendor: '智谱' }).state
  assert.equal(state.phase, 'paused')
  const line = state.flow[state.flow.length - 1]
  assert.equal(line.kind, 'error')
  assert.equal(line.text, '模型忙，已保存执行进度')
  assert.deepEqual(line.buttons.map((one) => one.action), ['continue', 'models'])
  // 停在这儿以后输入框占位字不变
  assert.equal(toTaskView(state).input.hint, '拖动文件到聊天框，或随便说点什么')
})

test('免费通道、并发满了、平台过载：都是模型忙（Si429）', () => {
  const free = reduceTask(working(), { type: 'error', taskId: 'w1', reason: 'busy', vendor: '免费通道', free: true }).state
  assert.equal(free.flow.at(-1).text, '模型忙，已保存执行进度')
  for (const code of [1302, 1305]) {
    // 厂商的业务码在报错事件里叫 biz（Si 码另算，都是 Si429）
    const one = reduceTask(working(), { type: 'error', taskId: 'w1', reason: 'busy', vendor: '智谱', biz: code }).state
    assert.equal(one.flow.at(-1).text, '模型忙，已保存执行进度')
    assert.equal(one.flow.at(-1).code, 'Si429')
  }
})

test('挂死不回：停在这儿说模型响应超时（Si303），等待那行不留着', () => {
  const withWait = reduceTask(working(), {
    type: 'wait', taskId: 'w1', vendor: '智谱', text: '模型忙，60 秒后自动重试（第 3 次，最多 10 次）', until: 1, retry: 3, max: 10,
  }).state
  const state = reduceTask(withWait, { type: 'error', taskId: 'w1', reason: 'noreply' }).state
  assert.equal(state.phase, 'paused')
  // 等待那行没了：不留「重新连接中」
  assert.equal(state.flow.some((one) => one.kind === 'wait'), false)
  const line = state.flow[state.flow.length - 1]
  assert.equal(line.text, '模型响应超时，已保存执行进度')
  assert.equal(line.code, 'Si303')
  assert.deepEqual(line.buttons.map((one) => one.action), ['continue', 'models'])
})

test('点了停下：定稿的那句', () => {
  const stopped = reduceTask(working(), { type: 'end', taskId: 'w1', status: 'cancelled' }).state
  assert.equal(stopped.flow.at(-1).text, '用户手动停止，已保存执行进度')
  assert.deepEqual(stopped.flow.at(-1).buttons.map((one) => one.action), ['continue', 'retry'])
})

test('坏回复：模型响应无效（Si305），给「重来」和「换个模型」', () => {
  const state = reduceTask(working(), { type: 'error', taskId: 'w1', reason: 'badreply', raw: 'stream ended without finish_reason' }).state
  assert.equal(state.phase, 'error')
  const line = state.flow[state.flow.length - 1]
  assert.equal(line.text, t('stops.invalid'))
  assert.equal(line.text, '模型响应无效，已保存执行进度')
  assert.equal(line.code, 'Si305')
  assert.equal(line.raw, 'stream ended without finish_reason')
  assert.deepEqual(line.buttons.map((one) => one.action), ['retry', 'models'])
})

test('厂商报余额不够（402）：照 Si402 报，给「重来」', () => {
  const state = reduceTask(working(), {
    type: 'error', taskId: 'w1', reason: 'quota', vendor: 'DeepSeek', raw: '402 Payment Required',
  }).state
  const line = state.flow[state.flow.length - 1]
  assert.equal(line.code, 'Si402')
  assert.equal(line.text, '模型请求失败，已保存执行进度')
  assert.deepEqual(line.buttons.map((one) => one.action), ['retry'])
})

test('普通过程话不上屏，只换状态行那一句', () => {
  const plain = reduceTask(working(), { type: 'progress', taskId: 'w1', text: 'search' }).state
  assert.equal(toTaskView(plain).blocks.filter((one) => one.kind === 'note' || one.kind === 'reply').length, 0)
  assert.equal(toTaskView(plain).blocks.find((one) => one.kind === 'working').text, '搜索中')
})
