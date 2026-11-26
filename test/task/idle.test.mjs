// 任务窗空闲时还在跑的东西：页面上那个每秒走一次的表该开该停。
// - 只在真有东西要倒数的时候才开；页面藏起来（任务窗收着）也停
// - 字没变就别重写（改了要重排重画）
// 纯判断在 app/task/tick.mjs（node --test 直接测）；页面那几行照源码断言。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { needsTick, stillCounting } from '../../app/task/tick.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')
const tick = readFileSync(join(here, '../../app/task/tick.mjs'), 'utf8')
const shell = readFileSync(join(here, '../../app/task/shell.mjs'), 'utf8')

test('秒数过了点就不倒了', () => {
  assert.equal(stillCounting(0, 1000), false)
  assert.equal(stillCounting(500, 1000), false)
  assert.equal(stillCounting(1500, 1000), true)
})

test('没有要倒数的东西就不走秒表', () => {
  assert.equal(needsTick({}, 1000), false)
  assert.equal(needsTick({ untils: [0, 500] }, 1000), false)
  assert.equal(needsTick({ untils: [1500] }, 1000), true)
  // 干活中那两句：静默时刻有值就一直走着
  assert.equal(needsTick({ quietAt: 10 }, 1000), true)
})

test('秒表：按需开停，不是挂上去就一直走', () => {
  // 表挂在 start 里、stop 收掉；没有「一上来就 setInterval」的写法
  assert.match(tick, /timer = setInterval\(tick, 1000\)/)
  assert.match(tick, /const stop = \(\) =>/)
  assert.equal(/^setInterval\(tick, 1000\)/m.test(tick), false)
  // 页面藏起来（任务窗收着）就停
  assert.match(tick, /if \(hidden\(\)\) \{\s*stop\(\)\s*return\s*\}/)
  assert.match(tick, /if \(needsTick\(targets\(\)\)\) start\(\)/)
})

test('页面：视图来了就对一次表，页面藏起来也停', () => {
  assert.match(page, /const tick = createTick\(\{ flow: els\.flow, hidden: \(\) => document\.visibilityState === 'hidden' \}\)/)
  assert.match(page, /tick\.sync\(\)/)
  assert.match(page, /document\.addEventListener\('visibilitychange', \(\) => tick\.sync\(\)\)/)
  // 页面里没有自己挂的 setInterval 了
  assert.equal(/setInterval/.test(page), false)
})

test('主进程：任务窗自己有焦点的时候少抢层级（多半已经在最前面，白抢白搭合成）', () => {
  assert.match(shell, /const KEEP_ABOVE_FOCUS_MS = 2000/)
  assert.match(shell, /win\.isFocused\(\) \? KEEP_ABOVE_FOCUS_MS : KEEP_ABOVE_MS/)
  // 失焦了（用户去别的程序了）照旧抢快些
  assert.match(shell, /win\.on\('blur', \(\) => startKeepAbove\(\)\)/)
})
