// 鼠标靠近·看你的纯计算：120px 内外、左右两边、夹到 ±3、y=−1、取 0.5 精度；
// 轮询变了才发、条件不满足自己停。纯函数，不碰 electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { nearOf, watchNear } from '../../app/pet/near.mjs'
import { NEAR } from '../../app/pet/eyes.mjs'

const island = { x: 100, y: 10, width: 112, height: 30 } // 小岛中心 x=156

test('离得远（120px 以外）：不看，偏移归零', () => {
  assert.deepEqual(nearOf({ x: 100 + 112 + 121, y: 10 }, island), { near: false, dx: 0, dy: 0 })
  assert.deepEqual(nearOf({ x: 100 - 121, y: 10 }, island), { near: false, dx: 0, dy: 0 })
  assert.deepEqual(nearOf({ x: 156, y: 10 + 30 + 121 }, island), { near: false, dx: 0, dy: 0 })
  assert.deepEqual(nearOf(null, island), { near: false, dx: 0, dy: 0 })
  assert.deepEqual(nearOf({ x: 0, y: 0 }, null), { near: false, dx: 0, dy: 0 })
})

test('贴到 120px 边上还算在内', () => {
  assert.equal(nearOf({ x: 100 + 112 + 120, y: 25 }, island).near, true)
  assert.equal(nearOf({ x: 100 - 120, y: 25 }, island).near, true)
  assert.equal(nearOf({ x: 156, y: 10 - 120 }, island).near, true)
})

test('左右两边：挪向鼠标那边，最多夹到 ±3', () => {
  // 右边远处（dx 夹到 +3）
  assert.deepEqual(nearOf({ x: 100 + 112 + 100, y: 25 }, island), { near: true, dx: 3, dy: -1 })
  // 左边远处（dx 夹到 -3）
  assert.deepEqual(nearOf({ x: 0, y: 25 }, island), { near: true, dx: -3, dy: -1 })
  // 中间：不挪，只抬起 1
  assert.deepEqual(nearOf({ x: 156, y: 25 }, island), { near: true, dx: 0, dy: -1 })
})

test('x = 3 × clamp((鼠标x − 中心x) / 60, −1, 1)，取到 0.5 精度', () => {
  // 偏 30px：30/60 = 0.5 → 1.5
  assert.equal(nearOf({ x: 156 + 30, y: 25 }, island).dx, 1.5)
  // 偏 -30px：-1.5
  assert.equal(nearOf({ x: 156 - 30, y: 25 }, island).dx, -1.5)
  // 偏 20px：3 × 20/60 = 1.0，整好一档
  assert.equal(nearOf({ x: 156 + 20, y: 25 }, island).dx, 1)
  // 偏 25px：3 × 25/60 = 1.25 → 取 0.5 精度是 1.5
  assert.equal(nearOf({ x: 156 + 25, y: 25 }, island).dx, 1.5)
  // 偏 55px：3 × 55/60 = 2.75 → 取 0.5 精度是 3.0
  assert.equal(nearOf({ x: 156 + 55, y: 25 }, island).dx, 3)
  // y 固定 -1（抬起 1；toward-1-1.svg 是 +3 / −1）
  assert.equal(nearOf({ x: 156 + 40, y: 100 }, island).dy, NEAR.liftPx)
  assert.equal(NEAR.liftPx, -1)
})

test('轮询：条件不满足不起表，起了一轮里变了才发', async () => {
  const sent = []
  let cursor = { x: 5000, y: 5000 } // 一开始离得远远的
  let on = false
  const watch = watchNear({
    getCursor: () => cursor,
    getBounds: () => island,
    active: () => on,
    send: (plan) => sent.push(plan),
    interval: 5,
  })
  try {
    // 不该看着鼠标：sync 也不起表
    watch.sync()
    assert.deepEqual(sent, [])
    // 该看着了：立刻发一次（在外头也是一条 near:false）
    on = true
    watch.sync()
    assert.deepEqual(sent, [{ near: false, dx: 0, dy: 0 }])
    // 鼠标进了 120px：变了才发，没变就不发
    cursor = { x: 156 + 60, y: 25 }
    await new Promise((done) => setTimeout(done, 20))
    assert.deepEqual(sent, [
      { near: false, dx: 0, dy: 0 },
      { near: true, dx: 3, dy: -1 },
    ])
    // 条件没了：自己停，鼠标再怎么动都不发
    on = false
    cursor = { x: 156, y: 25 }
    await new Promise((done) => setTimeout(done, 20))
    const count = sent.length
    cursor = { x: 0, y: 0 }
    await new Promise((done) => setTimeout(done, 20))
    assert.equal(sent.length, count, '停了就一条也不发')
  } finally {
    watch.stop()
  }
})
