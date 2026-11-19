// 任务窗的 Electron 这头：无边框的透明窗，挂在小岛正下方（缝 0，贴着小条底边垂下来），点外面就收回；
// 几个通道：ready / view / act / drop / height / link / models / consent / history-list / history-open；选文件对话框、打开产出、前台判断、
// 最近的文件夹（recent.json）、task.log、换模型的数据、对话记录。对话表在 ./run.mjs，一条对话的状态和流水线在 ./session.mjs，这里只做桥。

import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell, systemPreferences } from 'electron'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { abilitiesForTask, abilityFiles, toolFailNote, withAbilities } from '../abilities/launch.mjs'
import { openSettings } from '../settings/shell.mjs'
import { runTask } from '../dsh/index.mjs'
import { loadCatalog, usable } from '../models/catalog.mjs'
import { createConsent } from '../models/consent.mjs'
import { modelFiles } from '../models/files.mjs'
import { resolveModel } from '../models/resolve.mjs'
import { openKeyring } from '../models/system-crypto.mjs'
import { openFreeConsent } from '../consent/shell.mjs'
import { iconPath } from '../assets/icon.mjs'
import { MATERIAL_EXTENSIONS, clearWorkspace, copyMaterials, prepareTask } from '../workspace/index.mjs'
import { appPaths, appRoot, dataPaths, ensureDataDir } from '../paths.mjs'
import { createRunner } from './run.mjs'
import { keyQueue } from './queue.mjs'
import { createHistory } from './history.mjs'
import { groupByDay } from './history-view.mjs'
import { openablePath } from './chips.mjs'
import { createDragIcons } from './drag-icon.mjs'
import { menuOpen } from '../main/menu-state.mjs'
import { chipOf, keyringHas, menuList } from './models-menu.mjs'
import { applyOnTop } from '../pet/on-top.mjs'
import { RECALL_TOP_MS } from '../pet/recall.mjs'
import { createReloadGuard } from './reload-guard.mjs'
import { createCloseCycle } from './close.mjs'
import { createPicker } from './pick.mjs'
import { createToggler } from './toggle.mjs'
import { httpUrl } from './markdown.mjs'
import { t } from '../copy/copy.mjs'
import { placeTaskWindow, taskMetrics, taskWindowOptions, winHeight } from './window.mjs'
import { ROLL_MS } from './motion.mjs'
import { DEFAULT_H, MIN_H, clampHeight, dragHeight, maxHeightFor, readHeight, writeHeight } from './height.mjs'
import { applyZoomFactor, currentDisplay, fontStep, onDisplay, setFontScale } from '../main/display.mjs'

const dir = dirname(fileURLToPath(import.meta.url))

// 窗：面板宽 460，挂在小岛下面 8px，高定一条（默认 520，拖底边把手改）
// 拿不到小岛就当它在主屏顶边正中
const FALLBACK = { width: 112, height: 30 }
// 设置里的字号档位：页面 zoom、窗宽和面板最低高都跟着它走（存取在 app/main/display.mjs）
let fontScale = 1
let stopDisplay = () => {}

let runner = null
let history = null // 对话记录：每个任务一条，存在它自己的任务文件夹里
// 产出卡拖出去时的小图：这种文件的系统图标，问不到用桌伴的图标
const dragIcons = createDragIcons({
  getFileIcon: (path) => app.getFileIcon(path, { size: 'large' }),
  fallback: () => nativeImage.createFromPath(iconPath),
})
let win = null
let bound = false
let wasFore = false
let logFile = ''
let heightFile = ''
// 面板的高：所有状态一样高，内容多了中间滚；拖动和记住的高度都在 ./height.mjs
let panelHeight = DEFAULT_H
let ready = false
let pendingOpen = false
let onOpen = () => {}
let onTop = true
// 小岛叫回最前时，任务窗跟着到前面：临时置顶到头了再照勾的来
let raiseTimer = null
let raiseTop = false
let anchorOf = null
let pendingAnim = ''
// 任务窗收起来了：小岛该再说一遍层级
let onHidden = () => {}
const guard = createReloadGuard()

// 选文件的对话框：开着的时候任务窗会失焦，收窗前先问它一句
const picker = createPicker({
  showOpenDialog: (target, options) => dialog.showOpenDialog(target, options),
  focus: (target) => { if (target && !target.isDestroyed()) target.focus() },
})

// 失焦和小岛那一下都从这里收：180ms 往上收再藏起来；对话框开着就等一等。
// 收只有一段动画：两下挨着来也只放一段，不叠两段。
const cycle = createCloseCycle({
  getWin: () => win,
  bounds: () => boundsFor(panelHeight),
  // 收回动画放的这 180ms 里不重排：高度不跳
  send: (kind) => { if (kind === 'in' || !stillMotion()) sendAnim(kind) },
  gate: picker,
  delay: () => (stillMotion() ? 0 : ROLL_MS),
  onHidden: (why) => {
    log('hide', { why })
    // 任务窗收起来了：小岛再说一遍层级，别被别的置顶窗压住
    onHidden()
  },
  // 因失焦收起来的记一笔：紧跟着的那一下点击别再把窗弹出来
  onBlurred: () => toggler.blurred(),
})

// 收回：照收回动画往上收，收完活接着干
function hideWindow() {
  // 收起来了就别再等着露脸：迟到的「in」会把刚收的窗又撑开
  pendingOpen = false
  return cycle.close('toggle')
}

// 点小岛：开着就收，收起不到半秒的别再弹出来；关着照旧打开
const toggler = createToggler({
  isOpen: () => cycle.visible(),
  // 正在收的时候：同一下点接着收，再点一下从收起一半的地方接着展开
  closing: () => cycle.closing(),
  reason: () => cycle.reason(),
  open: (detail) => open(detail),
  hide: () => hideWindow(),
})

function log(event, data = {}) {
  if (!logFile) return
  ensureDataDir()
  try { appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`) } catch { /* 日志坏了不能误事 */ }
}

function readRecent(file) {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

// 窗在、看得见、没最小化、有焦点才算前台
function visible() {
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()
}

function foreground() {
  const now = visible()
  if (now === wasFore) return
  wasFore = now
  runner?.feed({ type: 'window', foreground: now })
  // 任务窗到前台了：小岛那三种状态收回去，回待命
  if (now) onOpen()
}

function push(view) {
  if (win && !win.isDestroyed()) win.webContents.send('task:view', view)
}

// Windows 里关了动画就不动
function stillMotion() {
  try { return systemPreferences.getAnimationSettings().prefersReducedMotion === true } catch { return false }
}

// 小岛在哪儿：{x, y, width, height}；拿不到就退回主屏顶边正中
function anchorBox() {
  const box = typeof anchorOf === 'function' ? anchorOf() : null
  if (box && Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.y))) {
    return { x: Number(box.x), y: Number(box.y), width: Number(box.width) || FALLBACK.width, height: Number(box.height) || FALLBACK.height }
  }
  const area = screen.getPrimaryDisplay().workArea
  return { x: Math.round(area.x + (area.width - FALLBACK.width) / 2), y: area.y, width: FALLBACK.width, height: FALLBACK.height }
}

// 挂在小岛正下方：看得见的面板顶边紧贴看得见的小条底边（缝 0，窗顶那圈透明余量
// 在算法里扣掉），跟小岛水平居中；面板最低 360（字号档位大时跟着放大）、
// 最高工作区减 120，还得贴得住屏幕底。算法在 ./window.mjs
function boundsFor(next) {
  const box = anchorBox()
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  const area = screen.getDisplayNearestPoint(point).workArea
  const placed = placeTaskWindow({
    island: box, workArea: area, panel: next,
    maxPanel: maxHeightFor(area.height), clamp: clampHeight,
    scale: fontScale, minPanel: MIN_H * fontScale,
  })
  panelHeight = placed.panelHeight
  return placed.bounds
}

function sendAnim(kind) {
  pendingAnim = kind
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.send('task:anim', kind)
    pendingAnim = ''
  }
}

// 小岛改了大小、或者被拖走了：任务窗跟着重摆到小岛正下方（缝 0）。
// 开着的时候才重摆；收着的下次露脸自然摆对。拖动中不重摆（跟着鼠标一路抖），
// 拖完那一下重摆一次。
function relayout() {
  if (!win || win.isDestroyed() || !win.isVisible()) return false
  try {
    win.setBounds(boundsFor(panelHeight))
    return true
  } catch {
    return false
  }
}

// 字号档位变了：开着的窗立刻变（页面 zoom + 重摆）；收着的窗下次露脸重摆
function applyFontScale(next) {
  fontScale = next
  if (!win || win.isDestroyed()) return
  applyZoomFactor(win.webContents, fontScale)
  if (win.isVisible()) win.setBounds(boundsFor(panelHeight))
}

// 任务窗里的 Ctrl 加号 / 减号 / 0：在设置那四档里走，到头不再变。
// Ctrl 滚轮那路缩放已经关了（zoom-changed 拦掉），Electron 自带的缩放快捷键也让位给这儿，
// 所以只认这四档
function onTaskKey(event, input) {
  if (!input.control || input.type !== 'keyDown' || input.repeat) return
  const key = String(input.key || '')
  const code = String(input.code || '')
  if (key === '=' || key === '+' || code === 'NumpadAdd') {
    fontStep(1)
    event.preventDefault()
  } else if (key === '-' || code === 'NumpadSubtract') {
    fontStep(-1)
    event.preventDefault()
  } else if (key === '0' || code === 'Numpad0') {
    setFontScale(1)
    event.preventDefault()
  }
}

function createWindow() {
  const metrics = taskMetrics(fontScale)
  win = new BrowserWindow({
    ...taskWindowOptions({ width: metrics.winW, height: winHeight(panelHeight, fontScale), onTop, icon: iconPath }),
    webPreferences: { preload: join(dir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // 字号跟着设置走；Ctrl 滚轮那路缩放关掉，只认四档（页面没起来会在 DOM 好了那一下再放）
  applyZoomFactor(win.webContents, fontScale)
  win.webContents.on('before-input-event', onTaskKey)
  win.once('ready-to-show', () => { if (pendingAnim) sendAnim(pendingAnim) })
  // 别的置顶窗一被激活就会抢走层级：窗口自己动的时候再说一遍
  win.on('focus', () => { applyOnTop(win, raiseTop || onTop); raiseAbove(); startKeepAbove() })
  win.on('show', () => { applyOnTop(win, raiseTop || onTop); raiseAbove(); startKeepAbove() })
  win.on('hide', () => stopKeepAbove())
  win.on('closed', () => stopKeepAbove())
  for (const name of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'closed']) win.on(name, foreground)
  // 失焦不收：从资源管理器往里拖文件、切去别的程序看一眼，窗口都留着；只有再点一下小岛才收
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = details?.reason || 'unknown'
    const exitCode = details?.exitCode ?? null
    log('render-gone', { reason, exitCode })
    if (!win || win.isDestroyed() || reason === 'clean-exit') return
    const plan = guard.gone({ reason, exitCode })
    if (!plan.reload) {
      log('render-gave-up', { reason, exitCode, count: plan.count })
      return
    }
    log('render-reload', { reason, exitCode, count: plan.count })
    win.webContents.loadFile(join(dir, 'task.html'))
  })
  win.loadFile(join(dir, 'task.html'))
  applyOnTop(win, onTop)
}

// 提到小岛前面：Windows 上两个同样置顶的窗，层级按最后一次设层级/激活排。
// 小岛被点到、或者小岛自己再说一遍层级的时候，会把自己提到最前；任务窗得再抢回来，
// 不然小岛那条透明的一截（Windows 垫出来的那截，虽然透明还是小岛的窗，还接点击）
// 压在任务窗顶上，点任务窗顶边会打到小岛、把任务窗收了。
function raiseAbove() {
  if (!win || win.isDestroyed() || menuOpen()) return false
  try {
    applyOnTop(win, raiseTop || onTop)
    win.moveTop()
    return true
  } catch {
    return false
  }
}

// 小岛抢了层级以后，任务窗要抢回来：任务窗顶上那截跟小岛垫出来的那截叠着，
// 小岛在前的话，点任务窗顶边会打到小岛、把任务窗收了。
// 只在任务窗看着的时候定期抢（用户一点外面任务窗就收，收之前那一小会儿抢一下无害）。
let keepAboveTimer = null
function keepAbove() {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  // 右键菜单开着（小岛的、编辑菜单）：菜单在最前面，这会儿别抢
  if (menuOpen()) return
  try {
    win.moveTop()
  } catch {
    /* 提不上就下回再说 */
  }
}
function startKeepAbove() {
  if (keepAboveTimer) return
  keepAboveTimer = setInterval(keepAbove, 500)
  keepAboveTimer.unref?.()
}
function stopKeepAbove() {
  if (!keepAboveTimer) return
  clearInterval(keepAboveTimer)
  keepAboveTimer = null
}

// 露脸：先按最终高度摆好，再露脸；页面第一帧是收起状态，下一帧才垂下来
function showNow() {
  cycle.show()
  // 再说一遍层级：Windows 上别的置顶窗一激活就会抢走
  applyOnTop(win, onTop)
  // 露脸的小岛在前面的话，任务窗得排到它前面
  raiseAbove()
  startKeepAbove()
}

// 宠和托盘都从这里叫窗：没有就建，有就弄到前面；带 detail 就顺手喂事件
function open(detail) {
  toggler.opened()
  cycle.cancel()
  log('open', { detail: detail ? 1 : 0 })
  if (!win || win.isDestroyed()) createWindow()
  if (win.isMinimized()) win.restore()
  if (ready) {
    // 页面说了一声准备好了：直接摆好露脸
    pendingOpen = false
    showNow()
  } else {
    // 页面还没起来：先别露脸，等它说一声（免得先闪出一块，再跳一下）
    pendingOpen = true
  }
  if (detail) runner.opened(detail)
  // 小岛在等这个：任务窗开了，做完了、要你看一眼、没干成就收回去
  onOpen()
}

// ipcMain 只注册一次，只收任务窗自己 webContents 发来的
const mine = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents

// 任务窗「换模型」要的数据：能用的模型一行一行，加当前选的（没选就是清单默认）。
// 钥匙只在主进程里看，不出渲染进程。
function modelsPayload() {
  const files = modelFiles()
  const catalog = loadCatalog(files.catalog)
  const consented = createConsent({ file: files.consent }).status().agreed === true
  const list = menuList({ catalog, hasKey: keyringHas(openKeyring()), consented })
  const current = chipOf({ catalog, list, choice: runner?.model?.() ?? null, working: false })
  return { list, current }
}

// 配没配能看图的模型（能用的里面有没有勾了看图的）：输入框上方那句提醒说「去配」还是「去选」
function hasVisionModel() {
  try {
    const files = modelFiles()
    const catalog = loadCatalog(files.catalog)
    const consented = createConsent({ file: files.consent }).status().agreed === true
    const ready = new Set(usable(catalog, { hasKey: keyringHas(openKeyring()), consented }).map((one) => `${one.entry}/${one.model}`))
    return (catalog.entries || []).some((entry) => (entry?.models || []).some((model) => model?.vision === true && ready.has(`${entry.id}/${model.id}`)))
  } catch {
    return false
  }
}

// 现在选的模型看不看得懂图：清单里这个模型勾没勾「看图」（vision）。
// choice 是任务里选的；没选用清单默认。找不到就读作看得见，免得误拦。
function visionOf(choice) {
  try {
    const catalog = loadCatalog(modelFiles().catalog)
    const picked = choice && typeof choice.entry === 'string' ? choice : catalog.default
    const entry = (catalog.entries || []).find((one) => one && one.id === picked?.entry) || null
    const model = entry && Array.isArray(entry.models) ? entry.models.find((one) => one && one.id === picked?.model) : null
    return model ? model.vision === true : true
  } catch {
    return true
  }
}

// 小签上的缩略图：只给当前视图里带图的小签算，缩成 56 宽的 data: 给页面
function thumbOf(path) {
  if (!win || win.isDestroyed() || typeof path !== 'string' || !path) return ''
  const now = runner?.view()
  if (!now) return ''
  const onTag = (now.tags || []).some((one) => one.path === path && one.thumb)
  // 气泡里的小块也带缩略图：那一轮的拷贝也算
  const onChip = (now.blocks || []).some((one) => one.kind === 'user' && (one.files || []).some((f) => f.path === path && f.thumb))
  if (!onTag && !onChip) return ''
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return ''
    return img.resize({ width: 56 }).toDataURL()
  } catch {
    return ''
  }
}

function bind() {
  if (bound) return
  bound = true
  ipcMain.handle('task:ready', (event) => {
    if (!mine(event)) return null
    const view = runner.view()
    log('ready', { phase: view.phase })
    if (pendingAnim) sendAnim(pendingAnim)
    // 高度是定好的，不等页面量：说一声就露脸
    ready = true
    if (pendingOpen) {
      pendingOpen = false
      showNow()
    }
    return view
  })
  ipcMain.on('task:act', (event, action) => {
    if (!mine(event)) return
    runner.act(action)
  })
  // 换模型：列表和当前选的；免费通道没同意时先弹说明，同意了页面再选
  ipcMain.handle('task:models', (event) => {
    if (!mine(event)) return null
    return modelsPayload()
  })
  ipcMain.handle('task:consent', async (event) => {
    if (!mine(event)) return false
    const parent = win && !win.isDestroyed() ? win : undefined
    return (await openFreeConsent({ parent })) === true
  })
  ipcMain.on('task:drop', (event, payload) => { if (mine(event)) runner.drop(payload?.paths) })
  // 页面里按 Esc：弹层、下拉、菜单都没开的时候收任务窗（跟点小岛收起一样）
  ipcMain.on('task:hide', (event) => { if (mine(event)) hideWindow() })
  // 贴进来的图片 / 长文字：主进程存成文件、加小签；取回文字也走主进程（只认贴出来的那几个文件）
  ipcMain.on('task:paste', (event, payload) => {
    if (!mine(event)) return
    if (Array.isArray(payload?.images)) runner.pasteImages(payload.images)
    else if (typeof payload?.text === 'string') runner.pasteText(payload.text)
  })
  ipcMain.handle('task:restore', (event, payload) => {
    if (!mine(event)) return { ok: false }
    return runner.restorePaste(String(payload?.path ?? ''))
  })
  ipcMain.handle('task:thumb', (event, payload) => {
    if (!mine(event)) return ''
    return thumbOf(String(payload?.path ?? ''))
  })
  // 点气泡里的小块：用系统默认程序打开这次任务工作区里的那份拷贝（不开原件）。
  // 只放工作区里的文件：解析成绝对路径后必须在工作区内，符号链接按真身再核一遍。
  ipcMain.handle('task:open-chip', (event, payload) => {
    if (!mine(event)) return { ok: false, reason: 'denied' }
    const workspace = runner?.workspace?.() || ''
    const hit = openablePath(workspace, String(payload?.path ?? ''))
    if (!hit.ok) {
      log('chip-denied', { reason: hit.reason })
      return hit
    }
    openPath(hit.path, false)
    return { ok: true, path: hit.path }
  })
  // 从产出卡里把文件拖出去：系统拖拽（主进程起拖，页面只发路径）
  ipcMain.on('task:drag-out', (event, payload) => {
    if (!mine(event) || !win || win.isDestroyed()) return
    const workspace = runner?.workspace?.() || ''
    const hit = openablePath(workspace, String(payload?.path ?? ''))
    if (!hit.ok) {
      log('drag-denied', { reason: hit.reason })
      return
    }
    try {
      // 跟着鼠标走的是这种文件的系统图标（按下卡片时已经问好）；startDrag 要等放下才回来
      win.webContents.startDrag({ file: hit.path, icon: dragIcons.get(hit.path) })
      log('drag-out', { path: hit.path })
    } catch (error) {
      log('drag-out-failed', { error: error?.message || '' })
    }
    void dragIcons.warm(hit.path)
    // 拖完了：页面那边「刚从自己这儿拖出去」的记号收掉
    if (win && !win.isDestroyed()) win.webContents.send('task:drag-end')
  })
  // 按下产出卡（还没真拖）：先把这种文件的系统图标问好
  ipcMain.on('task:drag-prep', (event, payload) => {
    if (!mine(event)) return
    const hit = openablePath(runner?.workspace?.() || '', String(payload?.path ?? ''))
    if (hit.ok) void dragIcons.warm(hit.path)
  })
  // 拖底边把手改高度：页面只量指针，算法在 ./height.mjs；抬手那一下记进 userData
  ipcMain.on('task:height', (event, payload) => {
    if (!mine(event) || !win || win.isDestroyed()) return
    const wanted = dragHeight(payload?.from, payload?.startY, payload?.nowY)
    if (!Number.isFinite(wanted)) return
    const bounds = boundsFor(wanted)
    win.setBounds(bounds)
    if (payload?.commit === true) {
      writeHeight(heightFile, panelHeight)
      log('height', { h: panelHeight })
    }
  })
  // 回话里的链接：渲染进程已挑过一遍，这里再核一遍：new URL 解析得动、
  // 协议是 http(s)、不带空白和控制字符才开，开的是规范化后的 href
  ipcMain.on('task:link', (event, payload) => {
    if (!mine(event)) return
    const url = httpUrl(payload)
    if (url) void shell.openExternal(url)
  })
  // 历史对话的列表：能搜、能筛，按天分好组交给页面
  ipcMain.handle('task:history-list', (event, payload) => {
    if (!mine(event)) return null
    const items = history.list({ query: String(payload?.query ?? ''), kind: payload?.kind ?? null })
    return { items, groups: groupByDay(items) }
  })
  // 打开一条历史对话：干活中也能开，正在跑的那条在后台接着跑
  ipcMain.handle('task:history-open', (event, payload) => {
    if (!mine(event)) return null
    return runner.openHistory(String(payload?.id ?? ''))
  })
}

async function pickFiles() {
  const chosen = await picker.pick(win, {
    title: t('input.pickTitle'),
    filters: [{ name: t('input.pickKind'), extensions: MATERIAL_EXTENSIONS.map((one) => one.slice(1)) }],
    properties: ['openFile', 'multiSelections'],
  })
  if (chosen && !chosen.canceled && chosen.filePaths.length) runner.drop(chosen.filePaths)
}

function openPath(path, reveal) {
  if (reveal) return void shell.showItemInFolder(path)
  // 任务列表那个文件夹还没建过（一个任务都没开过）：先建出来再打开
  if (path === appPaths().tasks) {
    try { mkdirSync(path, { recursive: true }) } catch { /* 建不了就交给打开 */ }
  }
  void shell.openPath(path)
}

// 另存为：系统另存为对话框，把这份文件拷一份到用户选的地方
async function saveAs(path) {
  if (typeof path !== 'string' || !path) return { ok: false }
  try {
    const done = await dialog.showSaveDialog(win, { title: t('output.saveAs'), defaultPath: basename(path) })
    if (done?.canceled || !done?.filePath) return { ok: false }
    copyFileSync(path, done.filePath)
    log('save-as', { path })
    return { ok: true, path: done.filePath }
  } catch (error) {
    log('save-as-failed', { error: error?.message || '' })
    return { ok: false }
  }
}

// 小岛被叫回最前时，任务窗跟着到前面
// 不抢焦点（用户正在打字的窗口不该失焦），也不改用户勾的「保持在最前」
function raiseFront() {
  if (!win || win.isDestroyed() || !win.isVisible()) return false
  try {
    win.showInactive()
    if (!onTop) {
      // 没勾「保持在最前」时它会被别的窗盖住：临时置顶一下，才提得到前面
      raiseTop = true
      applyOnTop(win, true)
      clearTimeout(raiseTimer)
      raiseTimer = setTimeout(() => { raiseTimer = null; raiseTop = false; applyOnTop(win, onTop) }, RECALL_TOP_MS)
    }
    win.moveTop()
  } catch {
    return false
  }
  return true
}

export function startTask(options = {}) {
  logFile = dataPaths().taskLog
  // 面板高度是窗的状态，跟 Electron 的 profile 放一起（%LOCALAPPDATA%\sidemate\electron\）
  heightFile = join(app.getPath('userData'), 'task-height.json')
  // 字号档位：设置里存的那份（不在档位里当标准），改了立刻生效
  fontScale = currentDisplay().fontScale
  stopDisplay = onDisplay(({ fontScale: next }) => applyFontScale(next))
  // 上次拖到多高：读不出来就用默认 520，先按主屏夹一遍，露脸前 boundsFor 还会再夹
  panelHeight = clampHeight(readHeight(heightFile) ?? DEFAULT_H, maxHeightFor(screen.getPrimaryDisplay().workArea.height))
  if (typeof options.onOpen === 'function') onOpen = options.onOpen
  if (typeof options.onHidden === 'function') onHidden = options.onHidden
  const recentFile = dataPaths().recent
  // 对话记录：每个任务一条，存在它自己的任务文件夹里（.sidemate\conversation.json）
  const paths = appPaths()
  history = createHistory({ tasksDir: paths.tasks, newsDir: paths.news })
  anchorOf = typeof options.anchor === 'function' ? options.anchor : null
  runner = createRunner({
    runTask, prepareTask, clearWorkspace,
    // 每把密钥的排队器：同一把钥匙同时只能跑几个请求
    keyQueue,
    root: appRoot,
    // 开工前先算清楚用哪个模型。算好以后再并上能力
    //（技能开关、外部工具服务）：能力的补丁排在模型补丁后面，钥匙进子进程环境变量。
    // repo 和桌伴根跟 app/dsh/index.mjs 里 DSH_SKILL_DIR / DSH_USER_SKILL_DIR 同一套算法。
    model: (choice) => {
      const keyring = openKeyring()
      const picked = resolveModel({ choice: choice ?? null, files: modelFiles(), keyring })
      return withAbilities(picked, abilitiesForTask({
        files: abilityFiles({ repo: resolve(dir, '..', '..'), deskRoot: appRoot() }),
        keyring,
        log,
        // 有没有 DeepSeek 的钥匙：有才挂联网搜索（没钥匙挂着只会报错）
        hasSearchKey: typeof picked?.apiKey === 'string' && picked.apiKey !== '',
      }))
    },
    // 工具没调通时的那句话
    toolFailNote: (name, input) => toolFailNote(name, abilityFiles({ repo: resolve(dir, '..', '..'), deskRoot: appRoot() }), input),
    extensions: MATERIAL_EXTENSIONS,
    copyMaterials,
    visionOf,
    hasVisionModel,
    recent: readRecent(recentFile),
    onRecent: (list) => {
      ensureDataDir()
      try { writeFileSync(recentFile, `${JSON.stringify(list, null, 2)}\n`) } catch { /* 存不下就只记内存 */ }
    },
    onPet: options.onPet,
    // 小岛平时那几句里要不要加「拖个图片试试？」：现在的模型看不看得了图
    onSees: (sees) => options.onPet?.({ type: 'sees', sees }),
    onView: push,
    // dsh 那边模型选项变了（热加载）：模型下拉重算一份推给页面
    modelsChanged: () => {
      if (win && !win.isDestroyed()) win.webContents.send('task:models', modelsPayload())
    },
    openSettings,
    pickFiles,
    openPath,
    saveAs,
    history,
    log,
  })
  bind()
  app.on('before-quit', () => { clearTimeout(raiseTimer); stopDisplay(); runner.quit() })
  // 小岛在任务窗之后才起来：等这一拍走完再告诉它现在的模型看不看得了图
  setImmediate(() => options.onPet?.({ type: 'sees', sees: runner.sees() }))
  log('boot')
  return {
    open,
    recent: () => runner.recent(),
    isOpen: () => cycle.isOpen(),
    // detail：打开时交给任务窗（小岛点开时带着它说的那一轮的 taskId）
    toggle: (detail) => toggler.toggle(detail),
    // 打开一条对话（早报入口用）：跟任务窗历史下拉同一个口子，干活中也能开，那条在后台接着跑
    openHistory: (id) => runner.openHistory(String(id ?? '')),
    // 小岛的「保持在最顶」：任务窗跟着
    setOnTop: (value) => {
      onTop = !!value
      applyOnTop(win, onTop)
      // 小岛刚改完层级（它自己会提到最前），任务窗抢回前面来
      raiseAbove()
      return onTop
    },
    // 小岛叫回最前时，任务窗跟着到前面
    raise: raiseFront,
    // 小岛改了大小或被拖走：任务窗跟着重摆到小岛正下方（缝 0）
    relayout,
    // 提到小岛前面：小岛自己抢了层级的时候用（层级在小岛那头，任务窗自己抢回来）
    raiseAbove,
    // 有没有任务在干活（看着的、切到后台的都算）：小岛的新闻红点等手头的活干完再亮
    busy: () => runner?.busy() === true,
    // 正在跑的任务在用哪些模型（'条目/模型'）
    inUse: () => runner?.inUse() ?? [],
    // 中断正在跑的会话：给了名单只停这些，不给就全停
    interrupt: (choices) => runner?.interrupt(choices) ?? 0,
  }
}
