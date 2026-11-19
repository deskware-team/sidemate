// Kilo 同意弹窗：520×665，不能调大小，一次只开一个。
// 窗口写法照抄 app/settings/shell.mjs（preload、contextIsolation、sandbox）。
// 同意记录写盘走 app/models/consent.mjs，路径从 app/models/files.mjs 拿。
import { BrowserWindow, ipcMain } from 'electron'
import { t } from '../copy/copy.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECKS, SUMMARY, TERMS_VERSION, createConsent, readTerms } from '../models/consent.mjs'
import { modelFiles } from '../models/files.mjs'
import { iconPath } from '../assets/icon.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
let win = null
let promise = null
let settle = null
let bound = false

function windowOptions(parent) {
  const options = {
    width: 520,
    height: 665,
    useContentSize: true,
    center: true,
    // 不要系统标题栏：页面顶上那一条拖窗口，右上角自己画圆形关闭按钮
    frame: false,
    show: false,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    title: t('consent.title'),
    icon: iconPath,
    webPreferences: {
      preload: join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
  // 给了上级窗口就挂在它上面模态
  if (parent && typeof parent.isDestroyed === 'function') {
    options.parent = parent
    options.modal = true
  }
  return options
}

// 只结一次；同意写盘成功给 true，其余一律 false
function finish(value) {
  if (!settle) return
  const resolve = settle
  settle = null
  resolve(value)
}

function consentStore() {
  return createConsent({ file: modelFiles().consent })
}

function bind() {
  if (bound) return
  bound = true
  ipcMain.handle('consent:content', () => ({
    summary: SUMMARY,
    terms: readTerms(),
    checks: CHECKS,
    version: TERMS_VERSION,
  }))
  ipcMain.handle('consent:agree', (_event, payload) => {
    const result = consentStore().agree({
      terms: payload?.terms === true,
      crossBorder: payload?.crossBorder === true,
    })
    if (result.ok) {
      finish(true)
      close()
    }
    return { ok: result.ok === true, message: result.message ?? '' }
  })
  ipcMain.handle('consent:cancel', () => {
    finish(false)
    close()
    return { ok: true }
  })
}

// 关掉窗口，并把当前这次开窗的结果落定
function close() {
  const current = win
  win = null
  promise = null
  if (current && !current.isDestroyed()) current.close()
}

// 打开同意弹窗，用户同意且写盘成功 resolve(true)，取消或关窗 resolve(false)
export function openFreeConsent({ parent } = {}) {
  // 已经开着就把它叫到前面来，返回同一个 Promise
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return promise
  }
  bind()
  promise = new Promise((resolve) => {
    settle = resolve
  })
  const current = new BrowserWindow(windowOptions(parent))
  win = current
  current.once('ready-to-show', () => current.show())
  current.on('closed', () => {
    if (win === current) {
      win = null
      promise = null
    }
    finish(false)
  })
  current.loadFile(join(dir, 'page.html'))
  return promise
}
