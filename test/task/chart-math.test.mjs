// 统计图里的纯计算：刻度、数字格式、百分比、坐标换算。不碰 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import { niceScale, formatNumber, percent, yAt } from '../../app/task/chart-math.mjs'

test('刻度：从 0 开始，分成 4–5 格，顶上是个好看的数', () => {
  const scale = niceScale(2160)
  assert.equal(scale.ticks[0], 0)
  assert.ok(scale.ticks.length >= 4 && scale.ticks.length <= 6, `格数 ${scale.ticks.length}`)
  assert.ok(scale.max >= 2160)
  assert.equal(scale.ticks[scale.ticks.length - 1], scale.max)
  // 每格一样大
  const step = scale.ticks[1] - scale.ticks[0]
  for (let i = 1; i < scale.ticks.length; i += 1) {
    assert.ok(Math.abs((scale.ticks[i] - scale.ticks[i - 1]) - step) < 1e-6)
  }
  // 顶数小的也一样
  const small = niceScale(3)
  assert.equal(small.ticks[0], 0)
  assert.ok(small.max >= 3)
  // 没有数或者全是 0：不炸
  assert.deepEqual(niceScale(0), { max: 1, ticks: [0, 1] })
  assert.deepEqual(niceScale(-5), { max: 1, ticks: [0, 1] })
  assert.deepEqual(niceScale('x'), { max: 1, ticks: [0, 1] })
})

test('数字：千分位，小数最多两位', () => {
  assert.equal(formatNumber(2160), '2,160')
  assert.equal(formatNumber(1980), '1,980')
  assert.equal(formatNumber(999), '999')
  assert.equal(formatNumber(1234567), '1,234,567')
  assert.equal(formatNumber(2.5), '2.5')
  assert.equal(formatNumber(2.50), '2.5')
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber('x'), '')
})

test('百分比：占多少，保留一位小数', () => {
  assert.equal(percent(1, 3), 33.3)
  assert.equal(percent(2, 4), 50)
  assert.equal(percent(0, 10), 0)
  // 总数是 0 或者不对：不炸
  assert.equal(percent(1, 0), 0)
  assert.equal(percent(1, 'x'), 0)
})

test('坐标：0 在底上，最大值在顶上', () => {
  assert.equal(yAt(0, 100, 200, 180), 200)
  assert.equal(yAt(100, 100, 200, 180), 20)
  assert.equal(yAt(50, 100, 200, 180), 110)
  assert.equal(yAt('x', 100, 200, 180), 200)
  assert.equal(yAt(1, 0, 200, 180), 200)
})
