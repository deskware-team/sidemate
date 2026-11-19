// 小岛右键菜单的模板（不碰 Electron，好单测）。
// 新闻订阅 › · 新任务 · 最近 › · 设置 · 置顶 ·（分隔）· 退出
// 「新闻订阅」排最前，模板由壳现算传进来。
//
// 「置顶」是勾选项：勾上小岛一直压在别的窗口上面，不勾就跟普通窗口一样会被盖住。

import { t } from '../copy/copy.mjs'

// 托盘右键菜单的模板（不碰 Electron，好单测）：设置 · 退出
export function trayMenuTemplate(options = {}) {
  const {
    onSettings = () => {},
    onQuit = () => {},
  } = options
  return [{ label: t('menu.settings'), click: onSettings }, { label: t('menu.quit'), click: onQuit }]
}

export function petMenuTemplate(options = {}) {
  const {
    recent = null,
    news = null,
    onTop = true,
    onToggleOnTop = () => {},
    onNewTask = () => {},
    onSettings = () => {},
    onQuit = () => {},
  } = options
  const items = []
  if (news) items.push(news)
  items.push({ label: t('menu.newTask'), click: onNewTask })
  if (recent) items.push(recent)
  items.push(
    { label: t('menu.settings'), click: onSettings },
    { type: 'checkbox', label: t('menu.onTop'), checked: !!onTop, click: (item) => onToggleOnTop(item && typeof item.checked === 'boolean' ? item.checked : !onTop) },
    { type: 'separator' },
    { label: t('menu.quit'), click: onQuit },
  )
  return items
}
