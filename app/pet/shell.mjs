// 小岛：贴在屏幕顶边的墨色小条，平时只有一双眼睛。
// 拖动不用 app-region：那块会被当成标题栏，页面收不到拖放；这里手动跟鼠标。
// 完整路径在 preload 里用 webUtils.getPathForFile 拿。

import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, screen, shell, systemPreferences } from 'electron'
import { appendFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bubbleOf, elapsedText } from './bubble.mjs'
import { cubicBezier } from './ease.mjs'
import { petMenuTemplate, trayMenuTemplate } from './menu.mjs'
import { applyOnTop, createOnTop, onTopFromPlace } from './on-top.mjs'
import { createRecaller } from './recall.mjs'
import { readPlace, writePlace } from './place-store.mjs'
import { createExpect } from './expect.mjs'
import { watchNear } from './near.mjs'
import { trayIcon } from './tray-icon.mjs'
import { coversDisplay, watchForeground } from './foreground.mjs'
import { INTRO_LINE, introAlive, introTiming } from './intro.mjs'
import { centerX, displayAt, dragBounds, dragGrab, dropScene, expandedBounds, restorePlace, topStrip } from './place.mjs'
import { onCollapse, onExpand, onHover, onStateChange } from './scene.mjs'
import { clearHeld, createState, heldTask, reduce } from './state.mjs'
import { petClick, petDrop } from './click.mjs'
import { pressIsland } from './press.mjs'
import { newsDotOf } from './news.mjs'
import { theme, applyFont, bubbleBoxWidth } from './theme.mjs'
import { BASE, visibleStripHeight } from './layout.mjs'
import { currentDisplay, onDisplay } from '../main/display.mjs'
import { menuOpen, trackMenu } from '../main/menu-state.mjs'
import { appPaths, appRoot, dataPaths, ensureDataDir } from '../paths.mjs'
import { t } from '../copy/copy.mjs'
import { todayString } from '../news/topics.mjs'
import { recentMenuTemplate, recentTasks } from '../task/recent-tasks.mjs'
import { iconPath } from '../assets/icon.mjs'
import { startTestHook } from './test-hook.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const easeOut = cubicBezier(...theme.curveOut)
const easeIn = cubicBezier(...theme.curveIn)

let pet, tray, logFile, rest = null, dragTimer = null, dragging = false, grab = null
let leaveTimer = null, hoverTimer = null
let introBusy = null, introGen = 0, introPhase = 'idle', introTimers = [], state = createState()
let openTask = () => {}, toggleTask = () => 'opened', openSettings = () => {}, recentList = () => []
let scene = 'strip', bubbleWidth = 0, animTimer = null, stopWatch = null, lineHoldUntil = 0
let rendererReady = false
let workSince = 0, workTimer = null
let topper = null
let setTaskTop = () => {}
let raiseTask = () => {}
// 小岛改了大小、或者被拖走了：任务窗跟着重摆到小岛正下方（缝 0）
let relayoutTask = () => {}
let recaller = null
let stopHook = () => {}
let nearWatch = { sync: () => {}, stop: () => {} }
// 接文件·期待：进来先弹一下等 250ms 再张托；拖走取消；这 250ms 里松手直接处理
let expectTray = { enter: () => {}, leave: () => {}, drop: () => {}, stop: () => {} }
// 早报入口：菜单数据和未读在 newsEntry（壳传进来），红点亮不亮这边记
let newsEntry = null, newsPending = false, newsDot = false
let newsOpen = () => {}
let busyOf = () => false
// 叫回小岛时临时置顶着：别让别的置顶窗一激活就把它压回去
let tempTop = false
// 显示偏好里的小岛大小：档位变了整套尺寸重算（订阅在 startPet 里接上）
let stopScaleWatch = () => {}
// 测试钩子钉住的指针位置：拖动靠真鼠标动，自动化测试不动真鼠标
let fakeCursor = null

try { app.setAppUserModelId('cn.deskware.sidemate') } catch { /* Windows 通知才用得到 */ }

function log(event, data = {}) {
  if (!logFile) return
  ensureDataDir()
  try { appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`) } catch { /* 日志失败不能弄丢拖放 */ }
}

function stillMotion() {
  if (process.env.SIDEMATE_PET_STILL === '1') return true
  try { return systemPreferences.getAnimationSettings().prefersReducedMotion === true } catch { return false }
}

// 指针位置：测试钩子钉住的就用它，不然问系统
function cursorPoint() { return fakeCursor || screen.getCursorScreenPoint() }

function send(channel, payload) {
  if (pet && !pet.isDestroyed()) pet.webContents.send(channel, payload)
}

function notify(body) {
  try { if (Notification.isSupported()) new Notification({ title: t('sidemate'), body, icon: iconPath }).show() } catch { /* 没有通知服务 */ } }

// 小岛待的那块屏：只能吸顶，能贴到哪块屏的顶边就贴哪块
function homeDisplay() {
  const point = { x: (rest?.x ?? 0) + theme.island / 2, y: (rest?.y ?? 0) + 4 }
  return displayAt(screen, point)
}

function area() {
  return homeDisplay().workArea
}

// 「打开」开的那份：只认这一轮自己交出去的（做完的事件里带着），不去全盘找最新的
function artifactName() {
  return state.artifact ? basename(state.artifact) : ''
}

function push() {
  const artifact = artifactName()
  send('pet:state', { mode: state.mode, message: state.message, artifact })
  send('pet:bubble', bubbleOf({ ...state, artifact, news: newsDot, elapsed: elapsedText(workSince ? Date.now() - workSince : 0) }))
}

// 有新早报的红点：有没看的早报、且用户手头没在干活才亮；正在干活的先等，
// 活干完（apply 每次都会再走一遍）才亮。亮起来那一下眨两下眼（渲染进程那边放）。
function syncNewsDot() {
  const plan = newsDotOf({ pending: newsPending, busy: busyOf() })
  if (plan.dot === newsDot) return
  newsDot = plan.dot
  send('pet:news', { dot: newsDot, blink: newsDot })
  push() // 停上来冒的那行要跟着换
}

// 「新闻订阅」子菜单：右键菜单弹出来那一刻现算。整个是一项，子菜单里才是主题
function newsMenu() {
  if (!newsEntry) return null
  return {
    label: t('menu.news'),
    submenu: newsEntry.menu({
      today: todayString(new Date()),
      onOpenIssue: (topicId, date) => { log('menu', { item: 'news-issue', topicId, date }); newsOpen({ topicId, date }) },
      onManage: () => { log('menu', { item: 'news-manage' }); openSettings('news') },
    }),
  }
}

// 干活中那行后面的秒数自己走
function syncClock() {
  if (state.mode === 'work') {
    if (!workSince) workSince = Date.now()
    if (workTimer) return
    workTimer = setInterval(() => {
      send('pet:bubble', bubbleOf({ ...state, artifact: artifactName(), elapsed: elapsedText(Date.now() - workSince) }))
    }, 1000)
    return
  }
  workSince = 0
  clearInterval(workTimer)
  workTimer = null
}

// 看你：主进程每 120ms 问一次鼠标位置，算出眼睛该挪多少发 pet:near。
// 只在小岛显示着、scene 是 strip 或 expanded、没在拖、没在出场、不是 still、待命中才轮询；
// 偏移取到 0.5 精度，变了才发。still 每回都问系统有点贵，门上 2 秒问一次就够。
let stillCheckedAt = 0
let stillChecked = false
const stillNow = () => Date.now() - stillCheckedAt > 2000
  ? (stillCheckedAt = Date.now(), stillChecked = stillMotion())
  : stillChecked
const nearActive = () => Boolean(pet && !pet.isDestroyed() && pet.isVisible())
  && !dragging && !introBusy && state.mode === 'idle'
  && (scene === 'strip' || scene === 'expanded') && !stillNow()

function apply(event) {
  const step = reduce(state, event)
  state = step.state
  if (step.notify) notify(state.notice || state.message)
  syncClock()
  push()
  // 有事不自动冒字：状态变了只改眼神，不自己张开
  if (onStateChange().expand) expand()
  // 用户手头的活干完了：等着的新早报这会儿才亮
  syncNewsDot()
  nearWatch.sync()
}

// 用户点开小岛 / 任务窗打开：做完了、要你看一眼、没干成这三种收回去，回待命
function resetHeld() {
  const next = clearHeld(state)
  if (next === state) return false
  state = next
  push()
  syncClock()
  return true
}

function taskOpened(detail) {
  if (detail) openTask(detail)
  else openTask()
  resetHeld()
}

// 窗子跟着样子改大小
function targetBounds() {
  const work = area()
  // 接文件：小岛自己往两边长开，跟冒一行一样宽的长法，高度不变（任务窗开着也不往下挡）
  if (scene === 'tray') return expandedBounds(rest, dropWidth(), work)
  if (scene === 'line') {
    const width = theme.lineWidth
    return { ...topStrip(rest.x + (rest.width - width) / 2, work, width, theme.lineHeight), y: work.y }
  }
  if (scene === 'expanded') return expandedBounds(rest, expandedWidth(), work)
  return topStrip(rest.x, work, rest.width, rest.height)
}

function expandedWidth() {
  // 左边表情区 + 空 + 文字区（跟着字走）+ 右边留白；太长封顶 bubbleHardMax
  return bubbleBoxWidth(bubbleWidth)
}

// 接文件时长开多宽：右边那句「松手交给我」按字数估（汉字一个约一个字号宽，加粗多留一点）
function dropWidth() {
  return bubbleBoxWidth(Math.ceil(t('desk.dropHere').length * theme.font * 1.08))
}

function mix(from, to, amount) {
  const box = {}
  for (const key of ['x', 'y', 'width', 'height']) box[key] = Math.round(from[key] + (to[key] - from[key]) * amount)
  return box
}

function animateTo(to, duration, easing, done) {
  clearInterval(animTimer)
  animTimer = null
  if (!pet || pet.isDestroyed()) return
  if (stillMotion() || !duration) {
    pet.setBounds(to)
    done?.()
    return
  }
  const from = pet.getBounds()
  const started = Date.now()
  animTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - started) / duration)
    pet.setBounds(mix(from, to, easing(t)))
    if (t < 1) return
    clearInterval(animTimer)
    animTimer = null
    pet.setBounds(to)
    done?.()
  }, 8) // Windows 计时器一格 15.6ms：写 16 会隔两格才改一次窗口（眼睛跟着一顿一顿），写 8 每格都改
}

function applyScene(next, options = {}) {
  const changed = scene !== next
  const before = scene
  scene = next
  if (changed) {
    send('pet:scene', { scene: next })
    if (next === 'tray') log('expand', { scene: next })
    else if (before === 'tray') log('collapse', { scene: next })
  }
  const to = targetBounds()
  // 细线变回来的时候再说一遍层级
  if (next === 'strip' && before === 'line') refreshTop()
  if (options.immediate) {
    animateTo(to, 0, easeOut)
    return
  }
  const duration = next === 'expanded' ? theme.expandMs : next === 'strip' ? theme.collapseMs : theme.sceneMs
  animateTo(to, duration, next === 'strip' ? easeIn : easeOut)
}

function expand() {
  if (!onExpand(scene).expand) return
  scene = 'expanded'
  send('pet:scene', { scene })
  if (!bubbleWidth) {
    animateTo(targetBounds(), 0, easeOut)
    return
  }
  animateTo(targetBounds(), theme.expandMs, easeOut)
}

function collapse() {
  if (!onCollapse(scene).collapse) return
  scene = 'strip'
  send('pet:scene', { scene })
  animateTo(targetBounds(), theme.collapseMs, easeIn, () => relayoutTask())
}

function showMenu() {
  log('menu-open')
  const root = appRoot(), all = appPaths().tasks
  const recent = recentMenuTemplate(
    // 删掉、挪走了的文件夹不列
    recentList().filter((dir) => existsSync(dir)).map((dir) => ({ dir, name: basename(dir) })),
    recentTasks(root),
    existsSync(all) ? all : '',
    {
      openFolder: (dir) => { log('menu', { item: 'recent', dir }); taskOpened({ recent: dir }) },
      openTask: (out) => { log('menu', { item: 'recent-task', dir: out }); void shell.openPath(out) },
      openAll: (dir) => { log('menu', { item: 'all-tasks', dir }); void shell.openPath(dir) },
    },
  )
  // 菜单开着的时候任务窗别往最前面提（见 app/main/menu-state.mjs）
  trackMenu(Menu.buildFromTemplate(petMenuTemplate({
    recent,
    news: newsMenu(),
    onTop: topper ? topper.onTop : true,
    onToggleOnTop: (value) => {
      log('menu', { item: t('menu.onTop'), onTop: value })
      setTop(value)
    },
    onNewTask: () => { log('menu', { item: t('menu.newTask') }); taskOpened({ fresh: true }) },
    onSettings: () => { log('menu', { item: t('menu.settings') }); openSettings() },
    onQuit: () => app.quit(),
  }))).popup({ window: pet })
}

// 托盘单击：把小岛叫回最前
function trayClick() {
  const ok = recallIsland('tray-click')
  log('tray', { item: 'click', recalled: ok })
}

// 托盘：图标留着，右键只有「设置」「退出」
function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip(t('sidemate'))
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate({
    onSettings: () => { log('tray', { item: t('menu.settings') }); openSettings() },
    onQuit: () => app.quit(),
  })))
  tray.on('click', trayClick)
}

// 位置记住：下次启动还在那块屏的顶边
// display：那块屏的 id；displayBounds：那份 bounds，id 变了（拔了重插）还找得回来；x：相对那块屏工作区左边的偏移
function placeFile() {
  return join(app.getPath('userData'), 'pet-place.json')
}

function loadPlace() {
  return readPlace(placeFile())
}

function savePlace() {
  const display = homeDisplay(), work = display.workArea
  writePlace(placeFile(), {
    display: display.id,
    displayBounds: { ...display.bounds },
    x: (rest?.x ?? work.x) - work.x,
    onTop: topper ? topper.onTop : true,
  })
}

// 「置顶」的选择：跟位置记在同一个文件里
function saveTop(onTop) {
  const saved = loadPlace() || {}
  writePlace(placeFile(), { ...saved, onTop })
}

// 勾上/不勾：小岛自己改层级，任务窗跟着
function setTop(onTop) {
  if (!topper) return
  topper.set(onTop)
  setTaskTop(onTop)
}

// 再说一遍层级：别的置顶窗一被激活就会把小岛压下去
function refreshTop() {
  if (!topper) return
  // 叫回小岛时临时置顶着：这时别按用户勾的来，否则刚提到前面又被压回去
  if (tempTop) {
    if (pet && !pet.isDestroyed()) applyOnTop(pet, true)
    return
  }
  topper.apply()
}

// 把小岛叫回最前：
// 被别的窗盖住的、收成细线的，都叫得回来；不改用户勾的「置顶」，不抢焦点
function recallIsland(from) {
  if (!pet || pet.isDestroyed()) return false
  if (!recaller) return false
  const result = recaller.recall()
  log('recall', { from, ...result })
  return true
}

function createWindow() {
  const saved = loadPlace()
  topper = createOnTop({
    initial: onTopFromPlace(saved),
    persist: saveTop,
    getWindows: () => (pet && !pet.isDestroyed() ? [pet] : []),
  })
  const middle = process.env.SIDEMATE_PET_AT === 'center'
  // 存过就照存的放（哪块屏、那块屏顶边的哪个 x）；那块屏不在了回主屏顶边正中
  const spot = middle ? null : restorePlace(saved, screen, theme.island)
  const work = middle ? screen.getPrimaryDisplay().workArea : spot.area
  const x = middle
    ? Math.round(work.x + (work.width - theme.island) / 2)
    : spot.x
  const y = middle ? Math.round(work.y + (work.height - theme.height) / 2) : work.y
  rest = { x, y, width: theme.island, height: theme.height }
  pet = new BrowserWindow({
    width: theme.island, height: theme.height, x, y,
    frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, alwaysOnTop: topper.onTop,
    skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  pet.loadFile(join(dir, 'pet.html'))
  // 建窗时只说了要不要置顶，层级在这儿补上
  refreshTop()
  pet.once('ready-to-show', () => { pet.showInactive(); refreshTop() })
  // 别的置顶窗一被激活，小岛就被压下去：窗口自己动的时候再说一遍层级
  pet.on('focus', refreshTop)
  // 露脸：页面里的定时器重新排，看你的轮询也重新开
  pet.on('show', () => { refreshTop(); send('pet:shown', { shown: true }); nearWatch.sync() })
  log('start', { bounds: pet.getBounds(), scene })
}

// 首次运行的小岛出场：
// 小岛放到顶边正中，从顶边上方 30px 滑到贴顶，320ms，出来曲线；
// 滑的时候眼睛往上看，落定眨一下换睁眼；停 0.3 秒冒一行「把文件拖给我试试」；
// 停 6 秒或鼠标离开就收回。只放这一次。
export function playIntro() {
  if (!pet) return Promise.resolve()
  if (introBusy) return introBusy.promise
  const gen = ++introGen
  let resolve
  const promise = new Promise((done) => { resolve = done })
  introBusy = { promise, resolve, gen }
  clearIntroTimers()
  const still = stillMotion()
  const work = area()
  // 首次运行只有这一次：小岛放到顶边正中，不管用户之前把它挪到哪
  rest = { x: centerX(work, theme.island), y: work.y, width: theme.island, height: theme.height }
  scene = 'strip'
  introPhase = 'slide'
  send('pet:scene', { scene })
  const top = targetBounds()
  // 页面还没好就先等一下，别把出场动画丢了
  whenReady(gen, () => {
    // 兜底已经把那一行冒出来的话，就别再滑一次
    if (!introAlive(gen, introGen, introBusy)) return
    if (still) {
      // 关了「显示动画」：直接出现在贴顶、冒一行的那一帧
      pet.setBounds(top)
      introPhase = 'land'
      send('pet:intro', { phase: 'line', text: INTRO_LINE })
      return
    }
    // 从顶边上方 30px 滑到贴顶
    pet.setBounds({ ...top, y: top.y + introTiming.fromOffset })
    send('pet:intro', { phase: 'slide' })
    animateTo(top, introTiming.slideMs, easeOut)
    introTimers.push(setTimeout(() => {
      if (!introAlive(gen, introGen, introBusy)) return
      introPhase = 'land'
      send('pet:intro', { phase: 'land' })
      // 落定后停 0.3 秒再冒那一行
      introTimers.push(setTimeout(() => {
        if (!introAlive(gen, introGen, introBusy)) return
        send('pet:intro', { phase: 'line', text: INTRO_LINE })
      }, introTiming.pauseMs))
    }, introTiming.slideMs))
  })
  // 页面没回话也别把设置页吊着
  introTimers.push(setTimeout(() => showIntroLine(gen), introTiming.slideMs + introTiming.pauseMs + 2000))
  return promise
}

// 冒那一行：小岛张开，字最后 120ms 淡入。promise 到这就 resolve，不等 6 秒
function showIntroLine(gen, tries = 0) {
  if (!introAlive(gen, introGen, introBusy)) return
  // 正在接文件就先等着，别把「松手交给我」顶掉
  if (scene === 'tray' && tries < 40) {
    introTimers.push(setTimeout(() => showIntroLine(gen, tries + 1), 100))
    return
  }
  if (scene === 'strip') expand()
  introPhase = 'hold'
  finishIntro(gen)
  // 停 6 秒就收回；鼠标离开也收回（见 pet:leave）
  introTimers.push(setTimeout(() => {
    if (scene === 'expanded') collapse()
    introPhase = 'idle'
  }, introTiming.holdMs))
}

function whenReady(gen, cb) {
  if (rendererReady) { cb(); return }
  const timer = setTimeout(function poll() {
    if (!introAlive(gen, introGen, introBusy)) return
    if (!rendererReady) { introTimers.push(setTimeout(poll, 50)); return }
    cb()
  }, 50)
  introTimers.push(timer)
}

function clearIntroTimers() {
  for (const timer of introTimers) clearTimeout(timer)
  introTimers = []
}

function finishIntro(gen) {
  if (!introBusy || introBusy.gen !== gen) return
  const resolve = introBusy.resolve
  introBusy = null
  resolve()
  nearWatch.sync()
}

// 全屏程序盖住顶边时收成一条细线
function startWatch() {
  if (process.env.SIDEMATE_PET_NO_FULLSCREEN === '1') return
  stopWatch = watchForeground((rect) => {
    if (!pet || dragging || introBusy) return
    let display
    try { display = screen.getDisplayNearestPoint({ x: rest.x, y: rest.y }) } catch { return }
    const covered = coversDisplay(rect, display.bounds)
    if (covered && scene !== 'line') {
      if (Date.now() < lineHoldUntil) return
      applyScene('line')
      log('line', { rect })
      return
    }
    if (!covered && scene === 'line') applyScene('strip')
  })
}

function bind() {
  ipcMain.handle('pet:ready', () => {
    rendererReady = true
    const artifact = artifactName()
    return {
      still: stillMotion(),
      // 页面里那套尺寸跟着这个字号算（含小岛大小那档）；不在两边各存一份
      font: theme.font,
      mode: state.mode,
      message: state.message,
      scene,
      news: newsDot,
      bubble: bubbleOf({ ...state, artifact, news: newsDot }),
    }
  })
  ipcMain.on('pet:hover', () => {
    if (introBusy) return
    if (scene === 'line') {
      // 细线被碰一下就变回来
      lineHoldUntil = Date.now() + 10000
      applyScene('strip')
      return
    }
    if (scene !== 'strip') return
    clearTimeout(leaveTimer)
    if (hoverTimer) return
    // 鼠标停 0.3 秒才冒一行
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      if (onHover(scene, theme.hoverMs, theme.hoverMs).expand) expand()
    }, theme.hoverMs)
  })
  ipcMain.on('pet:leave', () => {
    clearTimeout(hoverTimer)
    hoverTimer = null
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => { leaveTimer = null; collapse() }, theme.leaveMs)
  })
  ipcMain.on('pet:measure', (_event, payload) => {
    // 页面量好那一行发过来的是一个数（也认 { width }）
    const raw = payload && typeof payload === 'object' ? payload.width : payload
    const width = Math.round(Number(raw))
    if (!Number.isFinite(width) || width === bubbleWidth) return
    bubbleWidth = width
    // 已经张开了就跟着改宽度，一改完字就放得下；别一边拉宽一边裁字
    if (scene === 'expanded') animateTo(targetBounds(), 0, easeOut)
  })
  ipcMain.on('pet:drag-start', () => {
    if (scene === 'tray' || introBusy) return
    dragging = true
    const point = cursorPoint()
    // 拖动只有吸顶一种样子：张着的先收回小条再拖。
    // 收回时小条居中对着鼠标：别把在张开那块上按下的偏移（可能两三百 px）
    // 带给 112 宽的小条，不然小条一收就往左跳
    grab = dragGrab(scene, point, pet.getBounds(), theme.island)
    if (scene !== 'strip') {
      scene = 'strip'
      send('pet:scene', { scene })
    }
    clearInterval(dragTimer)
    dragTimer = setInterval(tickDrag, 16)
  })
  ipcMain.on('pet:drag-end', () => {
    if (!dragging) return
    dragging = false
    clearInterval(dragTimer)
    const point = cursorPoint()
    const work = displayAt(screen, point).workArea
    const next = dragBounds(point, grab, { work, island: theme.island })
    scene = 'strip'
    rest = { ...rest, x: next.x, y: next.y }
    send('pet:scene', { scene })
    // 拖完了：小岛落定，任务窗跟着重摆一次（拖动中不重摆，免得一路抖）
    animateTo(targetBounds(), theme.collapseMs, easeIn, () => relayoutTask())
    grab = null
    savePlace()
    log('drag-end', { bounds: pet.getBounds(), scene })
    nearWatch.sync()
  })
  ipcMain.on('pet:drag-enter', () => {
    // 出场滑下来那一下别抢；滑完了拖文件照常接
    if (introPhase === 'slide') return
    const next = dropScene(scene)
    if (!next) return
    // 收成细线的时候也要张开接文件：不然从桌面拖过来落点只剩 64×4
    if (scene === 'line') {
      lineHoldUntil = Date.now() + 10000
      log('line-open', { scene })
    }
    // 接文件·期待：先弹一下等 250ms 再长开接文件（still 不弹不等，立刻长开）
    expectTray.enter()
  })
  ipcMain.on('pet:drag-leave', () => {
    // 期待的 250ms 里拖走了：取消，不张托
    expectTray.leave()
    clearTimeout(leaveTimer)
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      if (scene === 'tray') applyScene('strip', { immediate: true })
    }, theme.leaveMs)
  })
  ipcMain.on('pet:drop', (_event, payload) => {
    clearTimeout(leaveTimer)
    // 期待的 250ms 里松手了：托不等了，文件直接照松手处理，不能丢
    expectTray.drop()
    const paths = Array.isArray(payload?.paths) ? payload.paths : []
    const bounds = pet.getBounds()
    const at = payload?.at || { x: 0, y: 0 }
    log('drop', { paths, at, bounds })
    applyScene('strip')
    petDrop({ openTask, clearAsk: resetHeld, paths })
  })
  // 点小岛：任务窗开着就收起来，收起不到半秒的别再弹出来
  ipcMain.on('pet:click', () => {
    // 停在做完了 / 要你看一眼 / 没干成：把那一轮交给任务窗，打开就切到那条对话（可能在后台，不是眼前这条）
    const held = heldTask(state)
    const what = petClick({
      toggle: () => toggleTask(held),
      clearAsk: resetHeld,
      // 红点亮着：点一下去开最新那份早报的对话，不走开关任务窗
      news: newsDot,
      openNews: () => newsOpen(),
      // 小岛被点那一下：缩到 0.96 再弹回
      press: () => pressIsland({ send, still: stillMotion, scale: theme.pressScale, downMs: theme.pressDownMs, backMs: theme.pressBackMs }),
    })
    log('click', { what })
  })
  ipcMain.on('pet:menu', showMenu)
  ipcMain.on('pet:action', (_event, payload) => {
    const id = payload?.id
    log('action', { id })
    if (id === 'open') {
      // 成品留在任务文件夹里：在资源管理器里选中这份文件
      if (state.artifact) { void shell.showItemInFolder(state.artifact); return }
      taskOpened(heldTask(state))
      return
    }
    if (id === 'settings') openSettings()
  })
  // 页面量好那一行、准备好了：这时才把小岛张开
  ipcMain.on('pet:intro-line', () => {
    if (!introBusy) return
    showIntroLine(introBusy.gen)
  })
}

// 拖动：小岛只贴顶边，左右跟着鼠标走；鼠标在哪块屏就贴那块屏的顶边，拖多低都不离顶
function tickDrag() {
  if (!pet) return
  const point = cursorPoint()
  const work = displayAt(screen, point).workArea
  const next = dragBounds(point, grab, { work, island: theme.island })
  rest = { ...rest, x: next.x, y: next.y }
  animateTo(targetBounds(), 0, easeOut)
}

// 小岛大小那档变了：沿用字号那套把整套尺寸按比例重算（窗口、眼睛、冒的那行字、红点），
// 还是吸在屏顶、横向中心不跑；位置重存，任务窗垂下来跟着对（它每次现算小岛的位置）
function applyIslandScale(scale) {
  applyFont(BASE.font * scale)
  if (!pet || pet.isDestroyed() || !rest) return
  const work = area()
  const center = rest.x + rest.width / 2
  rest = topStrip(center - theme.island / 2, work, theme.island, theme.height)
  send('pet:layout', { font: theme.font })
  animateTo(targetBounds(), 0, easeOut)
  // 小岛大小变了：小岛的位置和高度都变了，任务窗跟着重摆（缝 0）
  relayoutTask()
  savePlace()
}

export function startPet(options) {
  openTask = options.openTask
  if (typeof options.toggleTask === 'function') toggleTask = options.toggleTask
  openSettings = options.openSettings ?? (() => {})
  if (typeof options.recent === 'function') recentList = options.recent
  newsEntry = options.news ?? null
  if (typeof options.isBusy === 'function') busyOf = options.isBusy
  if (typeof options.openNews === 'function') newsOpen = options.openNews
  if (typeof options.setTaskTop === 'function') setTaskTop = options.setTaskTop
  if (typeof options.raiseTask === 'function') raiseTask = options.raiseTask
  if (typeof options.relayoutTask === 'function') relayoutTask = options.relayoutTask
  logFile = process.env.SIDEMATE_PET_LOG || dataPaths().petLog
  // 看你：鼠标每 120ms 问一次，算好眼睛的偏移发 pet:near（条件不满足自己停）
  nearWatch = watchNear({
    getCursor: () => screen.getCursorScreenPoint(),
    getBounds: () => pet.getBounds(),
    active: nearActive,
    send: (plan) => send('pet:near', plan),
  })
  // 接文件·期待：张托前先弹一下那一摊（决定在 expect.mjs）
  expectTray = createExpect({
    send,
    still: stillMotion,
    openTray: () => { if (dropScene(scene)) applyScene('tray') },
    log,
  })
  bind()
  // 小岛大小：设置里存的那档先算进去（不在档位里当标准）；换了档才重算重摆——
// 字号那档跟小岛没关系，别把小岛白白动一下
  applyIslandScale(currentDisplay().islandScale)
  let islandNow = theme.font
  stopScaleWatch = onDisplay(({ islandScale }) => {
    if (BASE.font * islandScale === islandNow) return
    islandNow = BASE.font * islandScale
    applyIslandScale(islandScale)
  })
  createWindow()
  // 叫回小岛的一摊
  recaller = createRecaller({
    getScene: () => scene,
    // 细线变回小条：走正常的场景切换，动画和层级都照旧
    setScene: (next) => applyScene(next),
    // 露脸但不抢焦点：用户正在打字的窗口不该失焦
    showWindow: () => { if (pet && !pet.isDestroyed()) pet.showInactive() },
    // 提到前面（也不抢焦点）
    // 右键菜单开着的时候不往最前面提，免得盖住菜单
    raiseWindow: () => { if (!menuOpen()) pet.moveTop() },
    // 用户勾没勾「置顶」：只读，不改
    getOnTop: () => (topper ? topper.onTop : true),
    // 临时置顶只动窗上的层级，不动存着的勾选
    setWindowTop: (value) => {
      tempTop = !!value
      if (pet && !pet.isDestroyed()) applyOnTop(pet, value)
    },
    // 任务窗开着就跟着到前面
    showTask: () => raiseTask(),
  })
  // 任务窗跟着小岛：先把存着的选择给它
  setTaskTop(topper.onTop)
  createTray()
  startWatch()
  // 测试钩子：托盘那一套在没有真人的机器上也能驱动
  stopHook = startTestHook({
    'tray-click': trayClick,
    // 测试时把「置顶」关掉：走的是菜单那一项，存的值也跟着改
    'on-top-off': () => { setTop(false); log('test-hook', { action: 'on-top-off' }) },
    'on-top-on': () => { setTop(true); log('test-hook', { action: 'on-top-on' }) },
    // 测试时把指针位置钉住：拖动靠真鼠标动，自动化测试不动真鼠标
    'fake-cursor': (payload) => { fakeCursor = payload?.x != null ? { x: Math.round(payload.x), y: Math.round(payload.y) } : null; log('test-hook', { action: 'fake-cursor', fakeCursor }) },
  })
  app.on('before-quit', () => {
    clearInterval(dragTimer)
    clearInterval(animTimer)
    clearInterval(workTimer)
    clearIntroTimers()
    stopScaleWatch()
    nearWatch.stop()
    expectTray.stop()
    stopWatch?.()
    stopHook?.()
    tray?.destroy()
    log('quit')
  })
  // 任务窗挂在小岛下面 8px 用：每次现算小岛在屏幕上的位置。拿「看得见的小条」的底边，
  // 不拿主题里的尺寸也不拿窗口的 contentBounds——透明无边框窗在有的缩放底下会被 Windows
  // 垫高（要 30 实得 36，100% 缩放时垫到 71），底色只画主题那么高，垫出来的那一截是透明的：
  // 照窗口的底边摆，任务窗会低一截，跟小条中间裂开一条缝。
  // 细线状态也一样：墨色只画那根线那么高（theme.lineHeight），下面透明，底边按那根线算。
  const anchor = () => {
    if (pet && !pet.isDestroyed()) {
      const box = pet.getContentBounds()
      const height = visibleStripHeight(box.height, theme.height, scene, theme.lineHeight)
      return { x: box.x, y: box.y, width: box.width, height }
    }
    return { x: rest?.x ?? 0, y: rest?.y ?? 0, width: theme.island, height: theme.height }
  }
  // clearHeld：任务窗打开了，小岛那三种状态收回去，回待命
  // refreshTop：任务窗收起来了，小岛再说一遍层级
  // newsAlert(pending)：有没看的早报在等（壳那边算好传进来），这边管红点什么时候亮
  return { ingest: apply, playIntro, getState: () => state, anchor, clearHeld: resetHeld, refreshTop, newsAlert: setNewsAlert }
}

// 有没看的早报来了 / 都看完了：亮不亮红点在这里定（正在干活的等活干完）
function setNewsAlert(pending) {
  newsPending = pending === true
  syncNewsDot()
}
