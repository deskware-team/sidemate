// 全局右键编辑菜单：桌伴所有窗口里右键点输入框、点选中的字、右键点链接，
// 都能弹出一份中文的编辑菜单（撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选 / 复制链接）。
//
// 模板部分是纯函数（不引 Electron），好单测；装菜单的部分才碰 Electron。

import { createRequire } from 'node:module'
import { t } from '../copy/copy.mjs'
import { trackMenu } from './menu-state.mjs'

const nodeRequire = createRequire(import.meta.url)

// 在 Electron 主进程里 require('electron') 拿到的是模块本身；
// 在普通 node 里 require('electron') 拿到的是可执行文件路径字符串。
// 所以这里判一下再取，没取到就当作「这里不是 Electron 环境」。
function electronApi() {
  try {
    const mod = nodeRequire('electron')
    if (mod && typeof mod === 'object' && mod.Menu) return mod
  } catch { /* 没装 electron 或不在 Electron 里 */ }
  return null
}

// 只认 http / https，其他协议（javascript:、file: 等）不给「复制链接」
export function httpLink(url) {
  if (!url || typeof url !== 'string') return ''
  const text = url.trim()
  if (!/^https?:\/\//i.test(text)) return ''
  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch { /* 不是合法网址 */ }
  return ''
}

function flag(flags, name) {
  // 没给这个标志就当作不能做（稳妥：宁可灰掉也别给一个做了没反应的动作）
  return flags && flags[name] !== undefined ? !!flags[name] : false
}

// 菜单模板：params 就是 Electron context-menu 事件的 params。
// 规则：
//   可编辑的框 → 撤销 / 重做 ─ 剪切 / 复制 / 粘贴 ─ 全选
//   密码框     → 只留粘贴 / 全选（不显示剪切和复制）
//                Electron 用 formControlType（'input-password'）
//   不可编辑但选了字 → 只有复制
//   右键在 http(s) 链接上 → 追加一项「复制链接」
//   什么都没有 → 空数组（不弹菜单）
export function editMenuTemplate(params = {}, actions = {}) {
  const {
    isEditable = false,
    selectionText = '',
    editFlags = {},
    linkURL = '',
    formControlType = '',
  } = params || {}

  const flags = editFlags || {}
  const password = String(formControlType || '').toLowerCase() === 'input-password'
  const items = []

  if (isEditable) {
    if (password) {
      items.push(
        { label: t('edit.paste'), role: 'paste', enabled: flag(flags, 'canPaste') },
        { label: t('edit.selectAll'), role: 'selectAll', enabled: flag(flags, 'canSelectAll') },
      )
    } else {
      items.push(
        { label: t('edit.undo'), role: 'undo', enabled: flag(flags, 'canUndo') },
        { label: t('edit.redo'), role: 'redo', enabled: flag(flags, 'canRedo') },
        { type: 'separator' },
        { label: t('edit.cut'), role: 'cut', enabled: flag(flags, 'canCut') },
        { label: t('edit.copy'), role: 'copy', enabled: flag(flags, 'canCopy') },
        { label: t('edit.paste'), role: 'paste', enabled: flag(flags, 'canPaste') },
        { type: 'separator' },
        { label: t('edit.selectAll'), role: 'selectAll', enabled: flag(flags, 'canSelectAll') },
      )
    }
  } else if (selectionText) {
    items.push({ label: t('edit.copy'), role: 'copy', enabled: flag(flags, 'canCopy') })
  }

  const link = httpLink(linkURL)
  if (link) {
    items.push({
      label: t('edit.copyLink'),
      click: () => { if (typeof actions.copyText === 'function') actions.copyText(link) },
    })
  }

  return items
}

// 给一个 webContents 装上右键编辑菜单。
export function attachEditMenu(webContents, api = electronApi()) {
  if (!webContents || typeof webContents.on !== 'function') return null
  const handler = (_event, params) => {
    const menu = editMenuTemplate(params, {
      copyText: (text) => { if (api && api.clipboard) api.clipboard.writeText(text) },
    })
    if (!menu.length) return
    if (!api || !api.Menu) return
    const win = api.BrowserWindow && api.BrowserWindow.fromWebContents ? api.BrowserWindow.fromWebContents(webContents) : null
    // 菜单开着的时候任务窗别往最前面提，免得盖住菜单
    const built = trackMenu(api.Menu.buildFromTemplate(menu))
    built.popup(win ? { window: win } : {})
  }
  webContents.on('context-menu', handler)
  return handler
}

let installed = false

// 全局装一次：以后每个新建的窗口（webContents）都有这份右键菜单。
export function installEditMenu(appRef = null) {
  const api = electronApi()
  const theApp = appRef || (api ? api.app : null)
  if (!theApp || typeof theApp.on !== 'function') return false
  if (installed) return false
  installed = true
  theApp.on('web-contents-created', (_event, webContents) => { attachEditMenu(webContents, api) })
  return true
}
