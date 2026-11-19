// 悬停只算看得见的那一截：真窗口测试的主进程入口（electron 直接跑这个文件，不跑 app/）。
//
// 小岛的底色只画主题那么高（Windows 给透明无边框的窗垫了最小高），窗里下面那一截是透明的。
// 鼠标停在那截透明的地方，不该算「停在小岛上」：不该冒那一行字，
// 细线状态下也不该把小岛叫回来。只有指针在 #strip 上才算（接文件时小岛长开，还是 #strip）。
//
// 这个文件起一个小岛窗（高度故意比小条高，下面留一截透明的），
// 在页面里派发 mouseover / mouseout，看主进程收到几次 pet:hover / pet:leave。
// 结果写进 SIDEMATE_PET_RESULT 指的 json；量完自己 app.quit()。

import electron from 'electron'
const { app, BrowserWindow, ipcMain } = electron
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { theme } from '../../app/pet/theme.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const resultFile = process.env.SIDEMATE_PET_RESULT

// 页面停下来一格的时间：派发完等一下，让 IPC 走到主进程
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

let hovers = 0
let leaves = 0
ipcMain?.on('pet:hover', () => { hovers++ })
ipcMain?.on('pet:leave', () => { leaves++ })
ipcMain?.handle('pet:ready', () => ({
  still: true,
  font: theme.font,
  mode: 'idle',
  message: '',
  scene: 'strip',
  news: false,
  bubble: { text: '', actions: [] },
}))
ipcMain?.on('pet:measure', () => { /* 页面量那一行字：这里用不上 */ })

// 在页面里派发一个鼠标事件
const fire = (script) => `(() => {
  const strip = document.getElementById('strip')
  const body = document.body
  const box = strip.getBoundingClientRect()
  const send = (el, type, options = {}) => el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, ...options,
  }))
  ${script}
  return { stripBottom: box.bottom, inner: window.innerHeight }
})()`

async function main() {
  const win = new BrowserWindow({
    // 窗比小条高：下面那一截是透明的（Windows 垫出来的）
    width: theme.island, height: 72,
    x: 60, y: 60,
    frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: true, backgroundColor: '#00000000',
    webPreferences: {
      preload: join(root, 'app/pet/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  await win.loadFile(join(root, 'app/pet/pet.html'))
  await wait(500)

  const out = {}

  // 1. 鼠标停在小条下面那截透明的地方：不该算停在岛上
  await win.webContents.executeJavaScript(fire(`
    send(body, 'mouseover', { clientX: 10, clientY: box.bottom + 10 })
  `))
  await wait(400)
  out.hoverOnTransparent = hovers
  out.leaveOnTransparent = leaves

  // 2. 鼠标停在小条上：算停在岛上
  await win.webContents.executeJavaScript(fire(`
    send(strip, 'mouseover', { clientX: 10, clientY: 10 })
  `))
  await wait(400)
  out.hoverOnStrip = hovers - out.hoverOnTransparent
  out.leaveOnStrip = leaves - out.leaveOnTransparent

  // 3. 从小条挪到下面那截透明的地方：算离开
  await win.webContents.executeJavaScript(fire(`
    send(strip, 'mouseout', { clientX: 10, clientY: 10, relatedTarget: body })
  `))
  await wait(400)
  out.leaveAfterOut = leaves - out.leaveOnStrip - out.leaveOnTransparent

  // 4. 接文件时小岛往两边长开：停在长开的小条上算停在岛上
  win.setBounds({ ...win.getBounds(), width: theme.island * 2 })
  win.webContents.send('pet:scene', { scene: 'tray' })
  await wait(400)
  const before = hovers
  await win.webContents.executeJavaScript(fire(`
    send(strip, 'mouseover', { clientX: 20, clientY: 10 })
  `))
  await wait(400)
  out.hoverOnTray = hovers - before

  out.total = { hovers, leaves }
  try { writeFileSync(resultFile, `${JSON.stringify(out, null, 2)}\n`) } catch { /* 写不进就算了 */ }
  console.log(JSON.stringify(out))
  app.quit()
}

if (process.versions.electron) {
  app.whenReady().then(() => main().catch((error) => { console.error(error); app.exit(1) }))
}
