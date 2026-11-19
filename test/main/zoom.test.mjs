// 显示偏好的纯计算（app/main/zoom.mjs）：档位表、不在档位里当标准、Ctrl 加减到头不再变、
// 窗口尺寸跟着档位放大但被工作区卡住。不碰 Electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { FONT_STEPS, ISLAND_STEPS, normalizeStep, stepScale, zoomWindowSize } from '../../app/main/zoom.mjs'

test('档位表：字号四档、小岛三档，标准都是 1', () => {
  assert.deepEqual(FONT_STEPS, [0.9, 1, 1.15, 1.3])
  assert.deepEqual(ISLAND_STEPS, [0.85, 1, 1.25])
})

test('不在档位里的值当标准', () => {
  assert.equal(normalizeStep(1.3, FONT_STEPS), 1.3)
  assert.equal(normalizeStep(1, FONT_STEPS), 1)
  assert.equal(normalizeStep(1.5, FONT_STEPS), 1, '两档之间的值不当数')
  assert.equal(normalizeStep(0, FONT_STEPS), 1)
  assert.equal(normalizeStep(-1, ISLAND_STEPS), 1)
  assert.equal(normalizeStep('大', ISLAND_STEPS), 1)
  assert.equal(normalizeStep(undefined, ISLAND_STEPS), 1)
  assert.equal(normalizeStep(Number.NaN, ISLAND_STEPS), 1)
})

test('Ctrl 加减在档位里走一步，到头不再变', () => {
  // 从标准往大：1 → 1.15 → 1.3
  assert.equal(stepScale(1, FONT_STEPS, 1), 1.15)
  assert.equal(stepScale(1.15, FONT_STEPS, 1), 1.3)
  assert.equal(stepScale(1.3, FONT_STEPS, 1), 1.3, '特大再加还是特大')
  // 从标准往小：1 → 0.9
  assert.equal(stepScale(1, FONT_STEPS, -1), 0.9)
  assert.equal(stepScale(0.9, FONT_STEPS, -1), 0.9, '小再减还是小')
  // 小岛：大再加大还是大
  assert.equal(stepScale(1, ISLAND_STEPS, 1), 1.25)
  assert.equal(stepScale(1.25, ISLAND_STEPS, 1), 1.25)
  assert.equal(stepScale(1, ISLAND_STEPS, -1), 0.85)
  assert.equal(stepScale(0.85, ISLAND_STEPS, -1), 0.85)
  // 存的值本来就不在档位里：先当标准再走
  assert.equal(stepScale(1.07, FONT_STEPS, 1), 1.15)
})

test('窗口尺寸跟着档位放大；超过工作区就被卡住', () => {
  // 设置窗 720×560：标准就是 720×560，特大 936×728，小 648×504
  assert.deepEqual(zoomWindowSize({ width: 720, height: 560, scale: 1 }), { width: 720, height: 560 })
  assert.deepEqual(zoomWindowSize({ width: 720, height: 560, scale: 1.3 }), { width: 936, height: 728 })
  assert.deepEqual(zoomWindowSize({ width: 720, height: 560, scale: 0.9 }), { width: 648, height: 504 })
  // 工作区装不下：贴工作区（哪边超压哪边），里面出滚动条
  assert.deepEqual(
    zoomWindowSize({ width: 720, height: 560, scale: 1.3, workArea: { x: 0, y: 0, width: 800, height: 600 } }),
    { width: 800, height: 600 },
  )
  assert.deepEqual(
    zoomWindowSize({ width: 720, height: 560, scale: 1, workArea: { x: 0, y: 0, width: 700, height: 900 } }),
    { width: 700, height: 560 },
  )
  // 工作区比放大后的还大：不压
  assert.deepEqual(
    zoomWindowSize({ width: 720, height: 560, scale: 1.3, workArea: { x: 0, y: 0, width: 2000, height: 1200 } }),
    { width: 936, height: 728 },
  )
  // 没给工作区（拿不到屏）：只放大不压（410×1.15 = 471.5，浮点算出来在中间偏下，四舍五入到 471）
  assert.deepEqual(zoomWindowSize({ width: 560, height: 410, scale: 1.15 }), { width: 644, height: 471 })
})
