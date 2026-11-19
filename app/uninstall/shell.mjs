// 卸载前的那一问：一个小窗，「确定卸载桌伴吗？」加一个勾选「同时删除全部配置和记录」。
// 从「应用」里点卸载时，卸载器（build/installer.nsh 的 customUnInit）跑 sidemate.exe --uninstall-confirm，
// 等这个窗口关掉，照退出码走：0 不卸（关窗、点取消）、1 卸载留数据、2 卸载并删掉 %LOCALAPPDATA%\sidemate。
// 这个模式下桌伴别的东西一样都不起（小岛、任务窗、dsh），也不碰桌伴的 Electron 目录。
import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { t } from '../copy/copy.mjs'
import { iconPath } from '../assets/icon.mjs'

const dir = dirname(fileURLToPath(import.meta.url))

export const UNINSTALL_FLAG = '--uninstall-confirm'
export const EXIT = Object.freeze({ cancel: 0, keep: 1, wipe: 2 })

export function wantsUninstallConfirm(argv) {
  return Array.isArray(argv) && argv.includes(UNINSTALL_FLAG)
}

// 页面回的那一下换成退出码：点了卸载才算卸，勾了才删数据
export function exitCodeOf(answer) {
  if (!answer || answer.ok !== true) return EXIT.cancel
  return answer.wipe === true ? EXIT.wipe : EXIT.keep
}

export function runUninstallConfirm() {
  let code = EXIT.cancel
  let win = null
  ipcMain.handle('uninstall:answer', (_event, answer) => {
    code = exitCodeOf(answer)
    if (win && !win.isDestroyed()) win.close()
  })
  app.on('window-all-closed', () => app.exit(code))
  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: 420,
      height: 196,
      useContentSize: true,
      center: true,
      frame: false,
      show: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#f5f1e8',
      title: t('uninstall.title'),
      icon: iconPath,
      webPreferences: {
        preload: join(dir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.loadFile(join(dir, 'page.html'))
  })
}
