// 任务窗跟着字号档位放大（app/task/window.mjs 的 taskMetrics / placeTaskWindow）：
// 窗宽和阴影余量乘以系数、面板最低高跟着放大，看得见的缝始终是 0，
// 高度仍然被工作区卡住。纯计算，不碰 Electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { GAP, SHADOW_BOTTOM, SHADOW_TOP, WIN_W, taskMetrics, placeTaskWindow, winHeight } from '../../app/task/window.mjs'
import { MIN_H, clampHeight, maxHeightFor } from '../../app/task/height.mjs'

const island = { x: 600, y: 40, width: 140, height: 38 } // 小岛「大」那档：112×30 × 1.25
const workArea = { x: 0, y: 0, width: 2560, height: 1397 }

const place = (panel, scale = 1, box = island, area = workArea, minPanel = MIN_H * scale) => placeTaskWindow({
  island: box, workArea: area, panel,
  maxPanel: maxHeightFor(area.height), clamp: clampHeight,
  scale, minPanel,
})

test('档位换算：窗宽和四周阴影余量都乘以系数，四舍五入', () => {
  assert.deepEqual(taskMetrics(1), { winW: WIN_W, shadowX: 12, shadowTop: 0, shadowBottom: 26 })
  // 特大 1.3：484→629，12→16（15.6），26→34（33.8）；顶上不留余量，一直是 0
  assert.deepEqual(taskMetrics(1.3), { winW: 629, shadowX: 16, shadowTop: 0, shadowBottom: 34 })
  assert.deepEqual(taskMetrics(0.9), { winW: 436, shadowX: 11, shadowTop: 0, shadowBottom: 23 })
})

test('窗高 = 面板高 + 放大后的下面那圈余量', () => {
  assert.equal(winHeight(520, 1.3), Math.round(520) + 0 + 34)
  assert.equal(winHeight(520), 520 + SHADOW_TOP + SHADOW_BOTTOM, '标准档跟原来一样')
})

test('特大那档：看得见的缝还是 0，窗宽 629，面板最低 468', () => {
  const { bounds, panelHeight } = place(520, 1.3)
  // 面板顶边（窗顶 + 放大后的顶部余量）就是小岛底边，缝 0
  assert.equal(bounds.y + taskMetrics(1.3).shadowTop, island.y + island.height + GAP)
  assert.equal(bounds.width, 629)
  assert.equal(bounds.height, winHeight(panelHeight, 1.3))
  // 面板最低高跟着放大：360×1.3 = 468
  assert.equal(place(100, 1.3).panelHeight, Math.round(MIN_H * 1.3))
  // 面板 CSS 宽还是 460：窗宽除回系数 ≈ 面板加两边余量
  assert.ok(Math.abs(bounds.width / 1.3 - WIN_W) < 1)
})

test('放大后的窗底还是不出工作区：想要特别高就被卡住', () => {
  const tall = place(99_999, 1.3)
  const { shadowTop, shadowBottom } = taskMetrics(1.3)
  assert.ok(tall.bounds.y + tall.bounds.height <= workArea.y + workArea.height)
  assert.equal(tall.panelHeight, Math.min(
    maxHeightFor(workArea.height),
    workArea.y + workArea.height - tall.bounds.y - shadowTop - shadowBottom,
  ))
  // 矮屏：装不下那么多就压到装得下，最低那条（468）保底
  const tiny = place(99_999, 1.3, island, { x: 0, y: 0, width: 2560, height: 500 })
  assert.equal(tiny.panelHeight, Math.round(MIN_H * 1.3))
})

test('clampHeight 的下限能换成放大后的：低于它抬回它', () => {
  assert.equal(clampHeight(400, 960, 468), 468)
  assert.equal(clampHeight(520, 960, 468), 520)
  assert.equal(clampHeight(100, 960, 306), 306, // 小那档 360×0.9 = 324；这里直接给 306 也听参数的
  )
  // 不给还是 360
  assert.equal(clampHeight(100, 960), 360)
})

test('宽度仍然跟小岛居中、不出工作区', () => {
  const { bounds } = place(520, 1.3)
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - (island.x + island.width / 2)) < 1)
  const left = place(520, 1.3, { x: workArea.x, y: workArea.y, width: 40, height: 30 })
  assert.equal(left.bounds.x, workArea.x)
  const right = place(520, 1.3, { x: workArea.x + workArea.width - 40, y: workArea.y, width: 40, height: 30 })
  assert.equal(right.bounds.x + right.bounds.width, workArea.x + workArea.width)
})
