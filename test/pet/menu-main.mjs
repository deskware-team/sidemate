// 小岛右键菜单整窗测试的主进程入口：electron 直接跑这个文件（不跑 app/）。
// 起来先把 Menu.prototype.popup 换成只记菜单项、不真弹（真弹会等真人点，测试就卡住了），
// 托盘的 setContextMenu 也记一份，再挂 process.on('uncaughtException') 记异常；
// 然后照常起整个桌伴（app/main/main.mjs，userData 和 USERPROFILE 都在临时目录里隔离）。
// 等小岛窗口加载完，从小岛页面发一次右键、一次左键，把记录写到 SIDEMATE_MENU_RESULT
// 指的文件，自己 app.quit()（不等人来收）。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），
// 具名导入会在链接时就报错；这个文件会被 node --test 当测试扫到，纯 node 下不能炸。
import electron from 'electron'
const { app, BrowserWindow, Menu, Tray } = electron
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const resultFile = process.env.SIDEMATE_MENU_RESULT
const state = { popups: [], tray: [], uncaught: [] }

// 只记 label 和类型，子菜单递归记一层层下来
const pick = (items) => (items || []).map((item) => {
  const one = { label: item.label || '', type: item.type || 'normal' }
  if (item.submenu) one.submenu = pick(item.submenu.items)
  return one
})

async function main() {
  const originalPopup = Menu.prototype.popup
  Menu.prototype.popup = function () {
    state.popups.push(pick(this.items))
  }
  const originalSetTrayMenu = Tray.prototype.setContextMenu
  Tray.prototype.setContextMenu = function (menu) {
    try { state.tray.push(pick(menu.items)) } catch { /* 记不下来就拉倒 */ }
    return originalSetTrayMenu.call(this, menu)
  }
  process.on('uncaughtException', (error) => { state.uncaught.push(`${error?.name}: ${error?.message}`) })
  process.on('unhandledRejection', (reason) => { state.uncaught.push(`unhandledRejection: ${reason?.message || String(reason)}`) })

  const finish = () => {
    try { writeFileSync(resultFile, `${JSON.stringify(state)}\n`) } catch { /* 写不进就算了 */ }
    app.quit()
  }

  // 起整个桌伴。装的钩子都在 import 之前，右键菜单走到 popup 那一步已经被换成只记不弹
  await import(new URL('../../app/main/main.mjs', import.meta.url).href)

  // 等小岛窗口加载完（最多约 20 秒）
  let pet = null
  for (let i = 0; i < 100 && !pet; i++) {
    await sleep(200)
    pet = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed() && one.webContents.getURL().includes('pet.html') && !one.webContents.isLoading())
  }
  if (!pet) {
    state.uncaught.push('没等到小岛窗口')
    return finish()
  }

  // 在小岛页面正中发右键再发左键：和真人按一下是同一条路
  const [width, height] = pet.getContentSize()
  const at = { x: Math.floor(width / 2), y: Math.floor(height / 2) }
  const tap = (button) => {
    pet.webContents.sendInputEvent({ type: 'mouseDown', ...at, button, clickCount: 1 })
    pet.webContents.sendInputEvent({ type: 'mouseUp', ...at, button, clickCount: 1 })
  }
  tap('right')
  await sleep(1500)
  tap('left')
  await sleep(1500)
  finish()
}

// 只在 Electron 里起窗；纯 node（node --test 把本文件当测试扫）下什么都不做，退出码 0
if (process.versions.electron) {
  // userData 要在 ready 之前换到隔离目录
  if (process.env.SIDEMATE_MENU_USER_DATA) {
    app.setPath('userData', process.env.SIDEMATE_MENU_USER_DATA)
    mkdirSync(process.env.SIDEMATE_MENU_USER_DATA, { recursive: true })
  }
  app.whenReady().then(() => main().catch((error) => { console.error(error); app.exit(1) }))
}
