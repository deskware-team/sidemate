// 成品卡右键菜单：四项，顺序和文字一字不差；点了以后发给主进程的动作也对得上。

import assert from 'node:assert/strict'
import test from 'node:test'
import { cardMenuTemplate } from '../../app/task/card-menu.mjs'
import { t } from '../../app/copy/copy.mjs'

const labels = {
  preview: t('output.preview'),
  open: t('output.open'),
  reveal: t('output.reveal'),
  saveAs: t('output.saveAsMenu'),
}

test('右键菜单：预览 / 打开 / 在文件夹里显示 / 另存为…', () => {
  const items = cardMenuTemplate(labels)
  assert.deepEqual(items.map((one) => one.label), ['预览', '打开', '在文件夹里显示', '另存为…'])
})

test('右键菜单：四项点的动作：预览 / 打开 / 在文件夹里显示 / 另存为', () => {
  const items = cardMenuTemplate(labels)
  assert.deepEqual(items.map((one) => one.type), ['preview', 'open', 'reveal', 'save-as'])
})
