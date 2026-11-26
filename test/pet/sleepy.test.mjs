// 犯困的纯计算：10 分钟到、活动重置、非待命不困、鼠标在跟前不算没动静。

import assert from 'node:assert/strict'
import test from 'node:test'
import { sleepyOf } from '../../app/pet/sleepy.mjs'
import { SLEEPY } from '../../app/pet/eyes.mjs'

const minute = 60 * 1000

test('10 分钟没动静才困，差一秒都不困', () => {
  const lastActive = 0
  assert.equal(sleepyOf({ mode: 'idle', lastActive, now: 10 * minute - 1000 }).sleepy, false)
  assert.equal(sleepyOf({ mode: 'idle', lastActive, now: 10 * minute }).sleepy, true)
  assert.equal(SLEEPY.idleMs, 10 * minute)
})

test('有动静就重新计时：活动一重置，又不困了', () => {
  // 差点就困了
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now: 10 * minute - 500 }).sleepy, false)
  // 第 9 分钟来了下动静：到第 10 分钟还不困，得到第 19 分钟才困
  const touched = 9 * minute
  assert.equal(sleepyOf({ mode: 'idle', lastActive: touched, now: 10 * minute }).sleepy, false)
  assert.equal(sleepyOf({ mode: 'idle', lastActive: touched, now: 19 * minute - 1 }).sleepy, false)
  assert.equal(sleepyOf({ mode: 'idle', lastActive: touched, now: 19 * minute }).sleepy, true)
})

test('非待命不困：干活、做完了、要你看一眼、没干成都不困', () => {
  const now = 30 * minute
  for (const mode of ['work', 'look', 'done', 'fail']) {
    assert.equal(sleepyOf({ mode, lastActive: 0, now }).sleepy, false, `${mode} 不困`)
  }
})

test('鼠标正停在小岛上或在 120px 内，不算没动静', () => {
  const now = 30 * minute
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now, hover: true }).sleepy, false)
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now, near: true }).sleepy, false)
})

test('没给时刻就当早困了（宁可睁开也别睡死）', () => {
  assert.equal(sleepyOf({ mode: 'idle' }).sleepy, true)
  assert.equal(sleepyOf({ mode: 'work' }).sleepy, false)
})

test('level：醒着 / 犯困 / 睡着三档，跟 sleepy 对得上', () => {
  assert.equal(SLEEPY.asleepMs, 10 * minute + SLEEPY.dozeMs)
  const lv = (over) => sleepyOf({ mode: 'idle', lastActive: 0, now: over }).level
  assert.equal(lv(5 * minute), 'awake')
  assert.equal(lv(10 * minute - 1), 'awake')
  assert.equal(lv(10 * minute), 'drowsy')
  assert.equal(lv(SLEEPY.asleepMs - 1), 'drowsy')
  assert.equal(lv(SLEEPY.asleepMs), 'asleep')
  assert.equal(lv(30 * minute), 'asleep')
  assert.equal(sleepyOf({ mode: 'idle' }).level, 'asleep') // 没给时刻：早就没动静了
  // 鼠标在跟前不算没动静，档位也回醒着
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now: 30 * minute, near: true }).level, 'awake')
  assert.equal(sleepyOf({ mode: 'work', lastActive: 0, now: 30 * minute }).level, 'awake')
  // 老的 sleepy 布尔保留：10 分钟一道坎
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now: 10 * minute }).sleepy, true)
  assert.equal(sleepyOf({ mode: 'idle', lastActive: 0, now: 10 * minute - 1 }).sleepy, false)
})
