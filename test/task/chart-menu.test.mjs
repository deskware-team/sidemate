// 图的右键菜单：两项（另存为图片 / 复制图片），默认文件名按图的标题算。

import assert from 'node:assert/strict'
import test from 'node:test'
import { chartFileName, chartMenuTemplate } from '../../app/task/chart-menu.mjs'

test('右键菜单两项，顺序和字照定的', () => {
  const template = chartMenuTemplate({ saveAs: '另存为图片…', copy: '复制图片' })
  assert.deepEqual(template, [
    { label: '另存为图片…', type: 'save-as' },
    { label: '复制图片', type: 'copy' },
  ])
})

test('默认文件名用图的标题', () => {
  assert.equal(chartFileName('三家门店本周客流', '统计图'), '三家门店本周客流.png')
})

test('标题里不能用的字符换成空格', () => {
  assert.equal(chartFileName('三家门店:本周*客流?', '统计图'), '三家门店 本周 客流.png')
  assert.equal(chartFileName('a/b\\c', '统计图'), 'a b c.png')
})

test('没有标题就用兜底的名字', () => {
  assert.equal(chartFileName('', '统计图'), '统计图.png')
  assert.equal(chartFileName('   ', '流程图'), '流程图.png')
  assert.equal(chartFileName(null, undefined), 'image.png')
})

test('结尾的点和空格去掉（Windows 不让）', () => {
  assert.equal(chartFileName('报表. ', '统计图'), '报表.png')
})
