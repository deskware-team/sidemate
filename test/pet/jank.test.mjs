// 卡顿上报限流：1 分钟最多 10 条，多的丢掉。纯函数，给时间就按时间算。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createJankLimiter } from '../../app/pet/jank-limit.mjs'

test('限流：一分钟里最多放 10 条', () => {
  const limit = createJankLimiter({ max: 10, windowMs: 60_000 })
  let t = 0
  let allowed = 0
  for (let i = 0; i < 25; i++) {
    t += 1000
    if (limit(t)) allowed += 1
  }
  assert.equal(allowed, 10, `放行了 ${allowed} 条`)
})

test('限流：过了一分钟又放行', () => {
  const limit = createJankLimiter({ max: 2, windowMs: 60_000 })
  assert.equal(limit(1000), true)
  assert.equal(limit(2000), true)
  assert.equal(limit(3000), false, '第三条该丢')
  assert.equal(limit(62_000), true, '过了一分钟该又能发了')
  assert.equal(limit(62_500), true, '窗口里还有位置')
  assert.equal(limit(63_000), false, '又满了')
})

test('限流：不传 now 就用 Date.now', () => {
  const limit = createJankLimiter({ max: 1, windowMs: 60_000 })
  assert.equal(limit(), true)
  assert.equal(limit(), false)
})
