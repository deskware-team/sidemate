// 任务窗跟着小岛重摆（改小岛大小、拖走小岛）+ Esc 收起任务窗：整窗测试的主进程入口，
// 做法照 test/task/gap-main.mjs。
// electron 直接跑这个文件（不跑 app/）：起整个桌伴（隔离的 USERPROFILE 和 userData），
// 关掉首次运行那扇窗，用页面事件点小岛打开任务窗，等垂下来的动画走完，
// 量「小条底边到面板顶边」的缝和两者的横向中心；
// 再把小岛大小改成「大」那档（小岛变宽、变高，位置跟着走），量一遍：
// 缝还得是 0，任务窗得跟着小岛重新摆（x 要变，中心还得对着小岛）；
// 最后往任务窗里发一个 Esc，任务窗要收起来。
// 量出来的数写到 SIDEMATE_TASKWIN_RESULT 指的文件，自己 app.quit()。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），
// 具名导入会在链接时就报错；这个文件会被 node --test 当测试扫到，纯 node 下不能炸。
import electron from 'electron'
const { app, BrowserWindow, screen } = electron
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const resultFile = process.env.SIDEMATE_TASKWIN_RESULT
const state = { uncaught: [] }

process.on('uncaughtException', (error) => state.uncaught.push(`${error?.name}: ${error?.message}`))
process.on('unhandledRejection', (reason) => state.uncaught.push(`unhandledRejection: ${reason?.message || String(reason)}`))

// 页面里某个元素的矩形（CSS px，原点在窗的内容区左上）
const rectOf = async (win, selector) => JSON.parse(await win.webContents.executeJavaScript(
  `JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`,
))

// 小岛那扇窗、任务窗那扇窗
async function findWindow(part, visibleOnly = false) {
  for (let i = 0; i < 100; i += 1) {
    const win = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed()
      && one.webContents.getURL().includes(part)
      && !one.webContents.isLoading()
      && (!visibleOnly || one.isVisible()))
    if (win) return win
    await sleep(200)
  }
  return null
}

// 量一次：小条底边到面板顶边的缝（看得见的，DIP）、两者的横向中心差，
// 以及按规则该在哪儿（小岛锚点的中心减去半个窗宽，出工作区就贴边）
async function measure(pet, task) {
  const petBox = pet.getContentBounds()
  const taskBox = task.getContentBounds()
  const strip = await rectOf(pet, '#strip')
  const panel = await rectOf(task, '#panel')
  // 看得见的小条底边：小条画到哪儿算哪儿，但窗子只露这么高（Windows 会给透明窗垫高）
  const stripBottom = petBox.y + Math.min(strip.bottom, petBox.height)
  const panelTop = taskBox.y + panel.top
  // 小岛锚点：窗口的位置和大小（看得见的那截高按小条算）
  const anchorX = petBox.x + petBox.width / 2
  const area = screen.getDisplayNearestPoint({ x: anchorX, y: petBox.y }).workArea
  const expectedX = Math.round(Math.max(area.x, Math.min(Math.round(anchorX - taskBox.width / 2), area.x + area.width - taskBox.width)))
  const stripCenterX = petBox.x + strip.left + strip.width / 2
  const taskCenterX = taskBox.x + taskBox.width / 2
  return {
    gap: Math.round((panelTop - stripBottom) * 10) / 10,
    // 任务窗中心对着小条中心：横向差多少 DIP
    centerDiff: Math.round((taskCenterX - stripCenterX) * 10) / 10,
    // 任务窗该在哪儿（规则算出来的位置）跟实际差多少
    placeDiff: Math.round((taskBox.x - expectedX) * 10) / 10,
    expectedX,
    stripCenterX: Math.round(stripCenterX * 10) / 10,
    taskCenterX: Math.round(taskCenterX * 10) / 10,
    petBox,
    taskBox,
  }
}

// 拖一下小岛：把指针钉在测试钩子里（小岛跟的是系统指针，别的猫在跑试用时不好动真指针），
// 钉住后按下、挪一段、抬手，小岛落到新地方，任务窗要跟着重摆
async function dragIsland(pet, hookFile) {
  const box = pet.getContentBounds()
  const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  await setFakeCursor(hookFile, from)
  await pet.webContents.executeJavaScript('window.pet.dragStart(); true')
  await sleep(200)
  // 往右挪 200 像素：小岛跟过去
  await setFakeCursor(hookFile, { x: from.x + 200, y: from.y })
  await sleep(400)
  await pet.webContents.executeJavaScript('window.pet.dragEnd(); true')
  await sleep(1500)
}

// 测试钩子：把系统指针钉在某个位置（钉不上就写 null 放开）
async function setFakeCursor(hookFile, point) {
  const payload = point ? { action: 'fake-cursor', x: point.x, y: point.y } : { action: 'fake-cursor', x: null, y: null }
  writeFileSync(hookFile, `${JSON.stringify(payload)}\n`, 'utf8')
  await sleep(500)
}

// 等小岛停稳（宽度不再变，并且是收起的那一条）
async function waitStrip(pet, minWidth = 0, maxWidth = 9999) {
  let lastBox = ''
  let stable = 0
  for (let i = 0; i < 150; i += 1) {
    const box = pet.getContentBounds()
    const key = `${box.x},${box.y},${box.width},${box.height}`
    stable = key === lastBox ? stable + 1 : 0
    lastBox = key
    if (stable >= 3 && box.width >= minWidth && box.width <= maxWidth) return box
    await sleep(200)
  }
  return pet.getContentBounds()
}

// 点一下小岛：用页面事件点（不抢真鼠标，别的猫在跑试用）
async function clickIsland(pet) {
  const box = pet.getContentBounds()
  const x = Math.floor(box.width / 2)
  const y = Math.floor(box.height / 2)
  pet.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  await sleep(80)
  pet.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

async function main() {
  // 隔离的程序数据目录（%LOCALAPPDATA%\sidemate）：写一份「免费通道已同意」，点小岛就开任务窗（不开首次运行那扇窗）
  const root = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || homedir(), 'AppData', 'Local'), 'sidemate')
  mkdirSync(join(root, 'data'), { recursive: true })
  writeFileSync(join(root, 'useragreement.json'), `${JSON.stringify({ version: '1.0', at: Date.now(), terms: true, crossBorder: true })}\n`, 'utf8')
  // 清单默认选免费通道：默认那条要 DeepSeek 的钥匙，没配就只会开首次运行那扇窗
  writeFileSync(join(root, 'model.json'), `${JSON.stringify({ version: 1, default: { entry: 'free', model: 'kilo-auto/free', effort: null }, entries: [] })}\n`, 'utf8')
  // 开场放过：不起首次运行那扇窗、小岛也不出场（出场会把小岛挪到顶边正中，
  // 顶边正中别的猫在跑试用，会把小岛点没了）
  writeFileSync(join(root, 'data', 'settings.json'), `${JSON.stringify({ introPlayed: true })}\n`, 'utf8')
  {
    const { modelFiles } = await import(new URL('../../app/models/files.mjs', import.meta.url).href)
    const { createConsent } = await import(new URL('../../app/models/consent.mjs', import.meta.url).href)
    const { resolveModel } = await import(new URL('../../app/models/resolve.mjs', import.meta.url).href)
    const { openKeyring } = await import(new URL('../../app/models/system-crypto.mjs', import.meta.url).href)
    const files = modelFiles()
    state.debugFiles = files
    state.debugConsent = createConsent({ file: files.consent }).status()
    state.debugResolve = resolveModel({ files, keyring: openKeyring() })
  }

  // 起整个桌伴
  // 测试钩子文件：小岛跟的是系统指针，钉住它才动得了（不用动真鼠标）
  const hookFile = join(process.env.SIDEMATE_TASKWIN_USER_DATA || join(process.env.USERPROFILE || homedir(), '桌伴'), 'pet-hook.json')
  process.env.SIDEMATE_PET_TEST_HOOK = hookFile
  // 小岛放屏幕左上角：顶边正中别的猫在跑试用，点小岛会把我这边的也点了
  const userData = process.env.SIDEMATE_TASKWIN_USER_DATA || join(process.env.USERPROFILE || homedir(), '桌伴')
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'pet-place.json'), `${JSON.stringify({ x: 120, y: 0 })}\n`, 'utf8')
  await import(new URL('../../app/main/main.mjs', import.meta.url).href)

  const pet = await findWindow('pet.html')
  if (!pet) {
    state.uncaught.push('没等到小岛窗口')
    return finish()
  }
  // 首次运行那扇窗关掉：只留小岛。等它加载完再关，关在半截会把渲染进程搞出未捕获异常
  for (let i = 0; i < 40; i += 1) {
    const busy = BrowserWindow.getAllWindows().some((one) => !one.isDestroyed() && one !== pet && one.webContents.isLoading())
    if (!busy) break
    await sleep(200)
  }
  for (const one of BrowserWindow.getAllWindows()) {
    if (one === pet || one.isDestroyed()) continue
    if (!one.webContents.getURL().includes('task.html')) one.close()
  }
  await sleep(500)
  // 等小岛停稳（收着的那一条：宽度 112 左右）
  await waitStrip(pet, 100, 160)
  await sleep(500)

  // 任务窗：模型配好了、放过开场，桌伴自己就把任务窗露出来了；
  // 没有就点小岛开一个（点一下是开，再点一下就关了，别点两下）
  await sleep(1500)
  let task = await findWindow('task.html')
  if (!task || !task.isVisible()) {
    await clickIsland(pet)
    await sleep(1500)
    task = await findWindow('task.html')
  }
  // 等它露脸（垂下来的动画走完）
  for (let i = 0; i < 60 && task && !task.isVisible(); i += 1) await sleep(200)
  state.debugWindows = BrowserWindow.getAllWindows().map((one) => ({
    url: one.webContents.getURL(), visible: one.isVisible(),
  }))
  if (!task || !task.isVisible()) {
    state.uncaught.push('没等到任务窗露脸')
    return finish()
  }
  await sleep(1200)
  // 任务窗失焦就自己收起来；这台机器上别的猫在跑试用，可能把它点没了。
  // 所以每一步都先把它叫回来再动手。
  task = await keepTaskOpen(pet, task)
  state.before = await measure(pet, task)
  state.beforeVisible = task.isVisible()

  // 改小岛大小：大那档（1.25）——小岛变宽变高，位置跟着走，任务窗要重摆
  const display = await import(new URL('../../app/main/display.mjs', import.meta.url).href)
  task = await keepTaskOpen(pet, task)
  display.setIslandScale(1.25)
  // 等小岛落到新尺寸（大那档：140 宽、38 高）
  await waitStrip(pet, 130, 160)
  await sleep(800)
  state.after = await measure(pet, task)
  state.afterVisible = task.isVisible()
  // 任务窗有没有跟着走（位置变了：小岛高了，任务窗要跟着往下）
  state.moved = state.before.taskBox.y !== state.after.taskBox.y || state.before.taskBox.x !== state.after.taskBox.x

  // 拖走小岛：任务窗要跟着重摆（拖完那一下重摆一次）
  // 先把小岛收回成那一条（鼠标停在上面会把它张开，收回来再拖，测的就是拖动这一下）
  await pet.webContents.executeJavaScript('window.pet.leave(); true')
  await waitStrip(pet, 130, 160)
  await sleep(600)
  task = await keepTaskOpen(pet, task)
  const islandBefore = pet.getContentBounds().x
  await dragIsland(pet, hookFile)
  await sleep(800)
  state.dragged = await measure(pet, task)
  state.draggedVisible = task.isVisible()
  state.islandMoved = pet.getContentBounds().x !== islandBefore

  // Esc：任务窗要收起来
  task.focus()
  await sleep(200)
  task.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await sleep(1200)
  state.escHidden = task.isDestroyed() ? true : !task.isVisible()
  finish()
}

// 任务窗开着、也在前台：它失焦就自己收起来，被别处点没了就再点小岛开一个
async function keepTaskOpen(pet, task) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!task || task.isDestroyed()) {
      task = await findWindow('task.html')
      await sleep(500)
      continue
    }
    if (!task.isVisible()) {
      await clickIsland(pet)
      await sleep(1200)
      task = await findWindow('task.html')
      continue
    }
    task.focus()
    await sleep(250)
    if (task.isVisible()) return task
  }
  return task
}

function finish() {
  try { writeFileSync(resultFile, `${JSON.stringify(state, null, 2)}\n`) } catch { /* 写不进就算了 */ }
  app.quit()
}

// 只在 Electron 里起窗；纯 node（node --test 把本文件当测试扫）下什么都不做，退出码 0
if (process.versions.electron) {
  // userData 要在 ready 之前换到隔离目录
  if (process.env.SIDEMATE_TASKWIN_USER_DATA) {
    app.setPath('userData', process.env.SIDEMATE_TASKWIN_USER_DATA)
    mkdirSync(process.env.SIDEMATE_TASKWIN_USER_DATA, { recursive: true })
  }
  app.whenReady().then(() => main().catch((error) => { console.error(error); finish() }))
}
