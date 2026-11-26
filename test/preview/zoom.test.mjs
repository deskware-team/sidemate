// 预览窗的缩放和分页：档位、适应宽度的比例、分批要页的规则、缩放时滚动位置怎么算。
// 这些都是纯函数（app/preview/model.mjs），页面和主进程都用同一份。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampPercent,
  cssSize,
  fitPercent,
  FIT_PADDING,
  FIT_PADDING_SHEET,
  MAX_PAGES,
  needsHighDpi,
  pageBatches,
  pageRange,
  scrollTopAfterZoom,
  zoomStep,
  ZOOM_STEPS,
} from '../../app/preview/model.mjs'

test('缩放档位就是那几档', () => {
  assert.deepEqual(ZOOM_STEPS, [50, 75, 100, 125, 150, 200])
})

test('适应宽度：页宽撑满画布减去左右 16 内边距', () => {
  // 画布 632、页宽 600 → (632-32)/600 = 100%
  assert.equal(fitPercent(600, 632), 100)
  // 画布 632、页宽 1200 → 50%
  assert.equal(fitPercent(1200, 632), 50)
  // 画布太窄或页宽不知道 → 用 100%
  assert.equal(fitPercent(0, 632), 100)
  assert.equal(fitPercent(600, 20), 100)
  // 夹在 10%–400% 之间
  assert.equal(clampPercent(3), 10)
  assert.equal(clampPercent(900), 400)
  assert.equal(clampPercent('不是数'), 100)
})

test('适应宽度：图片和 Excel 不放大（最多 100%），分页文档可以超过 100%', () => {
  // 画布 632、页宽 300 → (632-32)/300 = 200%
  assert.equal(fitPercent(300, 632), 200)
  assert.equal(fitPercent(300, 632, { max: 100 }), 100)
  // 上限夹在中间
  assert.equal(fitPercent(600, 632, { max: 100 }), 100)
})

test('适应宽度减掉的内边距：画布左右 16，Excel 的图外面还套 12 的白边', () => {
  assert.equal(FIT_PADDING, 32)
  assert.equal(FIT_PADDING_SHEET, 56)
  // Excel：画布 583、图宽 527 → (583-56)/527 = 100%
  assert.equal(fitPercent(527, 583, { padding: FIT_PADDING_SHEET }), 100)
})

test('缩放一档：放大往上一档、缩小往下一档，到头就没有了', () => {
  assert.equal(zoomStep(100, 1), 125)
  assert.equal(zoomStep(100, -1), 75)
  assert.equal(zoomStep(50, -1), null)
  assert.equal(zoomStep(200, 1), null)
  // 适应宽度算出来的比例不是整档：往旁边找最近的一档
  assert.equal(zoomStep(87, 1), 100)
  assert.equal(zoomStep(87, -1), 75)
})

test('分批要页：先要第 1 页，往后 2–20 一批、21–30 一批，最多 30 页', () => {
  assert.deepEqual(pageBatches(3), [[1], [2, 3]])
  assert.deepEqual(pageBatches(7), [[1], [2, 3, 4, 5, 6, 7]])
  assert.deepEqual(pageBatches(30), [[1], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]])
  // 一批最多 19 张（加上第一页不超过插件 20 张的上限）
  assert.equal(Math.max(...pageBatches(200).map((one) => one.length)), 19)
  // 页数再多也只到 30 页
  const many = pageBatches(200)
  assert.deepEqual(many[0], [1])
  assert.deepEqual(many[many.length - 1], [21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
  assert.equal(many.flat().length, MAX_PAGES)
  // 不知道有几页
  assert.deepEqual(pageBatches(0), [])
})

test('100% = 真实大小：CSS 像素 = 图像素 × 96 / dpi', () => {
  // A4 在 200 dpi 下是 1654×2339 → 真实大小约 794×1123 CSS 像素
  assert.deepEqual(cssSize(1654, 2339, 200), { width: 794, height: 1123 })
  // dpi 不知道就按像素本身
  assert.deepEqual(cssSize(800, 600, 0), { width: 800, height: 600 })
})

test('屏幕上需要的 dpi 超过 200 才按 300 dpi 重渲', () => {
  // 100% + 屏幕倍率 1 → 96 dpi，不够重渲
  assert.equal(needsHighDpi(100, 1), false)
  assert.equal(needsHighDpi(200, 1), false)
  // 屏幕倍率 2、125% → 240 dpi，要重渲
  assert.equal(needsHighDpi(125, 2), true)
  assert.equal(needsHighDpi(100, 2), false)
  assert.equal(needsHighDpi(100), false)
})

test('所有看法都能放大到 200%（档位就是那几档）', () => {
  assert.deepEqual(ZOOM_STEPS, [50, 75, 100, 125, 150, 200])
})

test('页号的一段', () => {
  assert.deepEqual(pageRange(3, 6), [3, 4, 5, 6])
  assert.deepEqual(pageRange(4, 3), [])
})

test('缩放时画布中间那一点不动：滚动位置按内容高度的比例挪', () => {
  // 内容 1000 高、视口 400、滚到 300（中间在 500）
  // 放大后内容 2000 高 → 中间那一点在 1000 → 滚动位置 1000-200 = 800
  assert.equal(scrollTopAfterZoom(300, 1000, 2000, 400), 800)
  // 缩小：内容 500 高 → 中间那一点在 250 → 滚动位置 250-200 = 50
  assert.equal(scrollTopAfterZoom(300, 1000, 500, 400), 50)
  // 顶上了就还是顶上
  assert.equal(scrollTopAfterZoom(0, 1000, 2000, 400), 0)
  // 底下了就贴着底
  assert.equal(scrollTopAfterZoom(600, 1000, 500, 400), 100)
  // 横向用同一个算法，但不贴边：一直按中间那一点算
  // 内容 800 宽、视口 600、滚到 0（中间那一点在 300）→ 放大后内容 1600 → 300*2-300 = 300
  assert.equal(scrollTopAfterZoom(0, 800, 1600, 600, { keepEdge: false }), 300)
  assert.equal(scrollTopAfterZoom(100, 800, 1600, 600, { keepEdge: false }), 500)
})
