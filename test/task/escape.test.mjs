// 任务窗里按 Esc：弹层、下拉、菜单开着先关它们；都没开就把任务窗收起来
// （输入框里有字也收，字保留）。纯逻辑，不碰 DOM。

import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeAction } from '../../app/task/escape.mjs'

test('什么都没开着：收任务窗', () => {
  assert.equal(escapeAction({}), 'window')
  assert.equal(escapeAction({ history: false, tag: false, models: false, inputOpen: false }), 'window')
})

test('弹层、下拉、菜单开着：先关它们，别顺手把窗也收了', () => {
  assert.equal(escapeAction({ history: true }), 'history')
  assert.equal(escapeAction({ tag: true }), 'tag')
  assert.equal(escapeAction({ models: true }), 'models')
  // 一起开着时有一个先关：历史下拉最上
  assert.equal(escapeAction({ history: true, tag: true, models: true }), 'history')
  assert.equal(escapeAction({ tag: true, models: true }), 'tag')
})

test('输入胶囊张着、里面没有字：收胶囊，不收窗', () => {
  assert.equal(escapeAction({ inputOpen: true, inputEmpty: true }), 'input')
})

test('输入框里有字：收窗（字保留）', () => {
  assert.equal(escapeAction({ inputOpen: true, inputEmpty: false }), 'window')
})
