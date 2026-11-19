// 字号「特大」和小岛「大」两档：整窗测试的主进程入口，做法照 test/task/gap-main.mjs。
// electron 直接跑这个文件（不跑 app/）：先把两档写进隔离 home 的 ~/桌伴/设置.json，
// 起整个桌伴，关掉首次运行那扇窗，点小岛打开任务窗，量四件事：
// ① 任务窗 zoomFactor = 1.3、窗宽 629（484×1.3）——正文字号 14 CSS 像素放大成 14×1.3；
// ② 小岛窗口 140×38（112×30 × 1.25）；
// ③ 小岛底边到面板顶边看得见的缝还是 8±1（DIP，余量跟着档位换算）；
// ④ 任务窗里 Ctrl+0 / Ctrl+减号 真的换档（1 → 0.9），档位写回 设置.json。
// 再截一张整屏的图（小岛 + 展开的任务窗，存 SIDEMATE_SHOTS），写完结果自己 app.quit()。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），
// 具名导入会在链接时就报错；这个文件会被 node --test 当测试扫到，纯 node 下不能炸。
import electron from 'electron'
const { app, BrowserWindow, desktopCapturer, screen } = electron
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const resultFile = process.env.SIDEMATE_ZOOM_RESULT
const shotsDir = process.env.SIDEMATE_SHOTS || ''
const state = { uncaught: [], benign: [] }

// Electron 在 Windows 上截屏（desktopCapturer）时偶尔自己抛一个
// 「Render frame was disposed before the request completed」：这是它内部的毛病，不是桌伴的错
// （main 的 gap 测试也碰得到同一个，同一台机器上时好时坏）。这类单独记一笔，不算未捕获异常。
const BENIGN = ['Render frame was disposed before the request completed']
const note = (message) => {
  if (BENIGN.some((one) => message.includes(one))) state.benign.push(message)
  else state.uncaught.push(message)
}

process.on('uncaughtException', (error) => state.uncaught.push(`${error?.name}: ${error?.message}`))
process.on('unhandledRejection', (reason) => {
  console.error('STACK:', reason?.stack)
  note(`unhandledRejection: ${reason?.message || String(reason)}`)
})

// 页面里某个元素的矩形（CSS px，原点在窗的内容区左上；乘上 zoomFactor 才是 DIP）
const rectOf = async (win, selector) => JSON.parse(await win.webContents.executeJavaScript(
  `JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`,
))
const fontSizeOf = async (win, selector) => win.webContents.executeJavaScript(
  `getComputedStyle(document.querySelector('${selector}')).fontSize`,
)

// 键盘走一遍 Ctrl 换档：keyDown + keyUp，跟真人按是同一条路
const press = (win, key, code) => {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, code, modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, code, modifiers: ['control'] })
}

async function measure(task, pet, zoom) {
  const petBox = pet.getContentBounds()
  const taskBox = task.getContentBounds()
  const strip = await rectOf(pet, '#strip')
  const panel = await rectOf(task, '#panel')
  // 页面矩形是 CSS px：任务窗的字放大了，DIP 偏移要乘 zoomFactor；小岛不跟字号走，乘 1
  const stripBottom = petBox.y + strip.bottom
  const panelTop = taskBox.y + panel.top * zoom
  return {
    petBox, taskBox,
    stripBottom, panelTop,
    gap: Math.round((panelTop - stripBottom) * 10) / 10,
  }
}

async function main() {
  // 起整个桌伴
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

  // 预写过 introPlayed：首次运行那扇窗不会自己弹；万一还开着（byok 的 page.html）关掉，只留小岛
  for (const one of BrowserWindow.getAllWindows()) {
    if (one === pet || one.isDestroyed()) continue
    const url = one.webContents.getURL()
    if (!url.includes('task.html')) one.close()
  }

  // 小岛那档先量：窗口尺寸 = 标准 ×1.25（点了一下它会冒一行变宽，所以趁收着的时候量）
  state.island = { bounds: pet.getContentBounds() }

  // 设置页改小岛大小：开着的窗立刻变（标准 → 大），不用重开桌伴
  {
    const { openSettings } = await import(new URL('../../app/settings/shell.mjs', import.meta.url).href)
    openSettings('display')
    await sleep(1500)
    const settings = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed() && one.webContents.getURL().includes('page=display'))
    if (!settings) {
      state.uncaught.push('没等到设置窗的「显示」那一页')
    } else {
      const pickIsland = async (label) => {
        await settings.webContents.executeJavaScript(
          `[...document.querySelectorAll('#island-seg .seg-btn')].find((n) => n.textContent === ${JSON.stringify(label)}).click()`,
        )
        await sleep(900)
        return pet.getContentBounds()
      }
      const standard = await pickIsland('标准')
      const big = await pickIsland('大')
      state.islandLive = { standard, big }
      settings.close()
      await sleep(500)
    }
  }

  // 在小岛页面正中发左键：和真人按一下是同一条路（最后一下用来收窗）
  const [width, height] = pet.getContentSize()
  const at = { x: Math.floor(width / 2), y: Math.floor(height / 2) }
  const tap = () => {
    pet.webContents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 })
    pet.webContents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 })
  }
  tap()

  // 等任务窗露脸（最多约 20 秒）
  let task = null
  for (let i = 0; i < 100 && !task; i++) {
    await sleep(200)
    task = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed() && one.isVisible() && one.webContents.getURL().includes('task.html') && !one.webContents.isLoading())
  }
  if (!task) {
    state.uncaught.push('点了小岛没等到任务窗露脸')
    return finish()
  }
  // 等垂下来的动画走完（win-drop 260ms，留足余量）
  await sleep(900)

  // ① 字号那档：页面 zoom、窗宽、正文字号
  state.big = { zoom: task.webContents.getZoomFactor() }
  state.big.fontCss = await fontSizeOf(task, 'body')
  state.big.frameCss = (await rectOf(task, '#frame')).width
  state.big.measure = await measure(task, pet, state.big.zoom)

  // 整屏截一张：小岛（大）+ 展开的任务窗（特大）
  if (shotsDir) {
    try {
      const bounds = screen.getPrimaryDisplay().bounds
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: bounds.width, height: bounds.height } })
      const pick = sources.find((one) => one.display_id === String(screen.getPrimaryDisplay().id)) || sources[0]
      if (!pick) throw new Error('desktopCapturer 没给出屏幕')
      mkdirSync(shotsDir, { recursive: true })
      state.shot = join(shotsDir, '特大字号和小岛大.png')
      writeFileSync(state.shot, pick.thumbnail.toPNG())
    } catch (error) {
      state.shotError = error?.message || String(error)
    }
  }

  // ④ 任务窗里的 Ctrl 换档：Ctrl+0 回标准、Ctrl+减号到小
  press(task, '0', 'Digit0')
  await sleep(700)
  state.zero = { zoom: task.webContents.getZoomFactor() }
  state.zero.measure = await measure(task, pet, state.zero.zoom)
  press(task, '-', 'Minus')
  await sleep(700)
  state.small = { zoom: task.webContents.getZoomFactor() }
  state.small.measure = await measure(task, pet, state.small.zoom)
  // 换过档以后，设置.json 里写的还是这几档（先读，再按加号）
  try {
    state.saved = JSON.parse(readFileSync(join(process.env.USERPROFILE, '桌伴', '设置.json'), 'utf8'))
  } catch (error) {
    state.savedError = error?.message || String(error)
  }
  // 再按 Ctrl + 加号：从 0.9 回到 1（Electron 自带那路缩放要是没关掉，这里会是 1.08 之类）
  press(task, '=', 'Equal')
  await sleep(700)
  state.up = { zoom: task.webContents.getZoomFactor() }

  // 再点一下小岛：任务窗收得回去
  tap()
  await sleep(900)
  state.closed = task.isDestroyed() || !task.isVisible()
  finish()
}

function finish() {
  try { writeFileSync(resultFile, `${JSON.stringify(state, null, 2)}\n`) } catch { /* 写不进就算了 */ }
  app.quit()
}

// 只在 Electron 里起窗；纯 node（node --test 把本文件当测试扫）下什么都不做，退出码 0
if (process.versions.electron) {
  // userData 要在 ready 之前换到隔离目录
  if (process.env.SIDEMATE_ZOOM_USER_DATA) {
    app.setPath('userData', process.env.SIDEMATE_ZOOM_USER_DATA)
    mkdirSync(process.env.SIDEMATE_ZOOM_USER_DATA, { recursive: true })
  }
  app.whenReady().then(() => main().catch((error) => { console.error(error); finish() }))
}
