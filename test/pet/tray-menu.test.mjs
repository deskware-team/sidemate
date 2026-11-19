// 托盘右键菜单的模板（app/pet/menu.mjs 的 trayMenuTemplate）：只有「设置」「退出」。
// 托盘图标留着；没有「显示桌伴」，也不挂新闻订阅。纯模板，不碰 Electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { trayMenuTemplate } from '../../app/pet/menu.mjs'

const labels = (items) => items.map((one) => one.label)

test('托盘菜单：设置 · 退出', () => {
  assert.deepEqual(labels(trayMenuTemplate({})), ['设置', '退出'])
  // 传了别的也不加
  assert.deepEqual(labels(trayMenuTemplate({ news: { label: '新闻订阅', submenu: [] }, onShow: () => {} })), ['设置', '退出'])
})

test('每一项都带着自己那一下：设置点一下就开设置窗', () => {
  const done = []
  const items = trayMenuTemplate({
    onSettings: () => done.push('设置'),
    onQuit: () => done.push('退出'),
  })
  for (const item of items) item.click()
  assert.deepEqual(done, ['设置', '退出'])
})
