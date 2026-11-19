// 小岛大小那档（app/pet/theme.mjs 的 applyFont / layout.mjs 的 layoutFor）：
// 小 0.85 / 标准 1 / 大 1.25，整套尺寸（窗口、眼睛、冒的那行字、红点）按比例变，
// 换算沿用字号那一套。纯计算，不碰 Electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { BASE, layoutFor } from '../../app/pet/layout.mjs'
import { applyFont, bubbleBoxWidth, theme } from '../../app/pet/theme.mjs'

test('标准档就是设计稿那套：112×30、表情区 56', () => {
  const box = layoutFor(BASE.font)
  assert.equal(box.island, 112)
  assert.equal(box.height, 30)
  assert.equal(box.eyeZone, 56)
  assert.equal(box.eyeGap, 20)
  assert.equal(box.eyeRadius, 5.3)
  assert.equal(box.scale, 1)
})

test('大那档 1.25：整套按比例放大（112→140、30→38、眼睛、红点都跟着）', () => {
  const box = layoutFor(BASE.font * 1.25)
  assert.equal(box.scale, 1.25)
  assert.equal(box.island, 140)
  assert.equal(box.height, 38) // 37.5 四舍五入
  assert.equal(box.eyeZone, 70)
  assert.equal(box.eyeGap, 25)
  assert.ok(Math.abs(box.eyeRadius - 5.3 * 1.25) < 0.01)
  assert.ok(Math.abs(box.dotSize - 6 * 1.25) < 0.01)
  assert.equal(box.bubbleHardMax, 575)
  // applyFont 把 theme 里那套一起换过来；冒的那行最窄就是小岛那么宽
  applyFont(BASE.font * 1.25)
  assert.equal(theme.island, 140)
  assert.equal(theme.height, 38)
  assert.equal(theme.bubbleMin, 140)
  assert.equal(bubbleBoxWidth(0), 140)
  // 眼睛往左挪的量是 SVG 用户单位，不跟着变
  assert.equal(theme.eyeShift, 28)
})

test('小那档 0.85：整套按比例缩小（112→95、30→25）', () => {
  applyFont(BASE.font * 0.85)
  assert.equal(theme.island, 95)
  assert.equal(theme.height, 25) // 25.5 浮点在中间偏下，四舍五入到 25
  assert.equal(theme.eyeZone, 48)
  assert.equal(bubbleBoxWidth(0), 95)
})

test('换回标准：还是 112×30，不留上一档的残余', () => {
  applyFont(BASE.font * 1.25)
  applyFont(BASE.font)
  assert.equal(theme.island, 112)
  assert.equal(theme.height, 30)
  assert.equal(theme.eyeZone, 56)
  assert.equal(theme.font, BASE.font)
})
