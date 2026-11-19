// 任务窗的摆位（app/task/window.mjs 的 placeTaskWindow）：看得见的面板顶边要紧贴
// 小岛底边（缝 GAP = 0）——顶上不留透明余量（SHADOW_TOP = 0），不然那圈余量会
// 压住小岛下半截、挡住小岛的点击；0.3 那道 20 的缝就是把余量算进去了；
// 窗底（连底下的阴影余量）不出工作区；左右跟着小岛居中、出不去工作区；
// 想要多高都得夹进上下限。纯计算，不碰 Electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { GAP, SHADOW_BOTTOM, SHADOW_TOP, WIN_W, placeTaskWindow, winHeight } from '../../app/task/window.mjs'
import { MIN_H, clampHeight, maxHeightFor } from '../../app/task/height.mjs'

const island = { x: 600, y: 40, width: 112, height: 30 }
const workArea = { x: 0, y: 0, width: 2560, height: 1397 }

const place = (panel, box = island, area = workArea) => placeTaskWindow({
  island: box, workArea: area, panel,
  maxPanel: maxHeightFor(area.height), clamp: clampHeight,
})

test('窗 y = 小岛底边：看得见的面板顶边紧贴小条底边，缝是 0', () => {
  const { bounds } = place(520)
  // 卡上要的那条：窗 y 加上窗顶那圈透明余量，正好是小岛底边（缝 0）
  assert.equal(bounds.y + SHADOW_TOP, island.y + island.height + GAP)
  // 窗顶不再压进小岛底下：顶上那圈余量是 0，缝也是 0
  assert.equal(bounds.y - (island.y + island.height), GAP - SHADOW_TOP)
  assert.equal(GAP, 0, '缝不是 0')
  assert.equal(SHADOW_TOP, 0, '窗顶还留着透明余量（会压住小岛、挡住小岛的点击）')
})

test('窗比面板只多出下面那圈余量，窗底不出工作区', () => {
  const { bounds, panelHeight } = place(520)
  assert.equal(bounds.height, winHeight(panelHeight))
  // 顶上不留余量：窗高就是面板高 + 底下那圈
  assert.equal(bounds.height, panelHeight + SHADOW_BOTTOM)
  // 想要特别高：夹到工作区装得下的极限，窗底（连底下的阴影余量）也不出工作区
  const tall = place(99_999)
  assert.equal(tall.panelHeight, Math.min(maxHeightFor(workArea.height), workArea.y + workArea.height - tall.bounds.y - SHADOW_TOP - SHADOW_BOTTOM))
  assert.ok(tall.bounds.y + tall.bounds.height <= workArea.y + workArea.height)
  assert.equal(tall.bounds.height, winHeight(tall.panelHeight))
})

test('左右跟小岛居中；小岛靠边时窗也不出工作区', () => {
  const { bounds } = place(520)
  assert.equal(bounds.x + bounds.width / 2, Math.round(island.x + island.width / 2))
  assert.equal(bounds.width, WIN_W)
  // 小岛贴着工作区左边：窗左不出工作区
  const left = place(520, { x: workArea.x, y: workArea.y, width: 40, height: 30 })
  assert.equal(left.bounds.x, workArea.x)
  // 小岛贴着右边：窗右不出工作区
  const right = place(520, { x: workArea.x + workArea.width - 40, y: workArea.y, width: 40, height: 30 })
  assert.equal(right.bounds.x + right.bounds.width, workArea.x + workArea.width)
})

test('高度夹进上下限：低不下 360，屏幕太小也至少 360', () => {
  assert.equal(place(100).panelHeight, MIN_H)
  // 工作区只装得下 300：宁可超出一点也不缩成一牙（跟 height.mjs 同一条规矩）
  const tiny = place(520, island, { x: 0, y: 0, width: 2560, height: 400 })
  assert.equal(tiny.panelHeight, MIN_H)
})

test('小岛在副屏上：拿那块屏的工作区算，缝还是 0', () => {
  const second = { x: 2560, y: 100, width: 1440, height: 800 }
  const { bounds } = place(520, { x: 3000, y: 100, width: 112, height: 36 }, second)
  assert.equal(bounds.y + SHADOW_TOP, 100 + 36 + GAP)
  assert.ok(bounds.x >= second.x && bounds.x + bounds.width <= second.x + second.width)
})
