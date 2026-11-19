// 右键编辑菜单的模板规则：
// 可编辑框 / 密码框 / 只选了字 / http(s) 链接 / 什么都没有。

import assert from 'node:assert/strict'
import test from 'node:test'

import { editMenuTemplate, httpLink } from '../../app/main/edit-menu.mjs'

function labels(items) {
  return items.filter((item) => item.type !== 'separator').map((item) => item.label)
}

test('可编辑的框：撤销 重做 剪切 复制 粘贴 全选，全部可用', () => {
  const items = editMenuTemplate({
    isEditable: true,
    editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
  })
  assert.deepEqual(labels(items), ['撤销', '重做', '剪切', '复制', '粘贴', '全选'])
  assert.equal(items.filter((item) => item.type === 'separator').length, 2)
  for (const item of items) {
    if (item.type !== 'separator') assert.equal(item.enabled, true, item.label)
  }
  assert.equal(items.find((item) => item.label === '撤销').role, 'undo')
  assert.equal(items.find((item) => item.label === '重做').role, 'redo')
  assert.equal(items.find((item) => item.label === '剪切').role, 'cut')
  assert.equal(items.find((item) => item.label === '复制').role, 'copy')
  assert.equal(items.find((item) => item.label === '粘贴').role, 'paste')
  assert.equal(items.find((item) => item.label === '全选').role, 'selectAll')
})

test('可编辑的框：editFlags 说不能做的就灰掉', () => {
  const items = editMenuTemplate({
    isEditable: true,
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
  })
  const map = Object.fromEntries(items.filter((item) => item.type !== 'separator').map((item) => [item.label, item.enabled]))
  assert.equal(map['撤销'], false)
  assert.equal(map['重做'], false)
  assert.equal(map['剪切'], false)
  assert.equal(map['复制'], false)
  assert.equal(map['粘贴'], true)
  assert.equal(map['全选'], true)
})

test('密码框：没有剪切和复制，只留粘贴和全选（新写法 formControlType）', () => {
  const items = editMenuTemplate({
    isEditable: true,
    formControlType: 'input-password',
    editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
  })
  assert.deepEqual(labels(items), ['粘贴', '全选'])
})

test('普通输入框（formControlType 是 input-text）：不算密码框', () => {
  const items = editMenuTemplate({
    isEditable: true,
    formControlType: 'input-text',
    editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
  })
  assert.deepEqual(labels(items), ['撤销', '重做', '剪切', '复制', '粘贴', '全选'])
})

test('没给标志就当作不能做', () => {
  const items = editMenuTemplate({ isEditable: true })
  for (const item of items) {
    if (item.type !== 'separator') assert.equal(item.enabled, false, item.label)
  }
})

test('只选了字（不可编辑）：只有复制', () => {
  const items = editMenuTemplate({ isEditable: false, selectionText: '选中的字' })
  assert.deepEqual(labels(items), ['复制'])
  assert.equal(items[0].role, 'copy')
})

test('http 链接：有复制链接，复制的是链接本身', () => {
  const copied = []
  const items = editMenuTemplate({ isEditable: false, linkURL: 'https://example.com/a?b=1' }, { copyText: (text) => copied.push(text) })
  assert.deepEqual(labels(items), ['复制链接'])
  items[0].click()
  assert.deepEqual(copied, ['https://example.com/a?b=1'])
})

test('http 链接和选中的字都有：复制 + 复制链接', () => {
  const items = editMenuTemplate({ isEditable: false, selectionText: 'abc', linkURL: 'http://example.com/' })
  assert.deepEqual(labels(items), ['复制', '复制链接'])
})

test('javascript: 和 file: 链接不显示复制链接', () => {
  for (const url of ['javascript:alert(1)', 'file:///c:/x.txt', 'mailto:a@b.c']) {
    const items = editMenuTemplate({ isEditable: false, linkURL: url })
    assert.deepEqual(labels(items), [], url)
  }
  assert.equal(httpLink('javascript:alert(1)'), '')
  assert.equal(httpLink('file:///c:/x.txt'), '')
})

test('什么都没有：空数组，不弹菜单', () => {
  assert.deepEqual(editMenuTemplate({ isEditable: false }), [])
  assert.deepEqual(editMenuTemplate({}), [])
  assert.deepEqual(editMenuTemplate(), [])
})
