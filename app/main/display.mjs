// 显示偏好（字号、小岛大小）在主进程里的一份当前值：设置页的按钮和任务窗的
// Ctrl 加减都从这儿走，改了广播给开着的窗（各窗自己订阅、自己变），存取走设置.json。
// 档位和换算在 ./zoom.mjs（纯计算）；这里碰 Electron（screen、BrowserWindow 的用法）。

import { screen } from 'electron'
import { createVault } from '../byok/vault.mjs'
import { appRoot } from '../paths.mjs'
import { FONT_STEPS, ISLAND_STEPS, normalizeStep, stepScale, zoomWindowSize } from './zoom.mjs'

let vault = null
let state = null
const subs = new Set()

function useVault() {
  vault ??= createVault({ root: appRoot() })
  return vault
}

// 第一次用到才读设置.json：没这两项、或不在档位里，都当标准
function ensure() {
  if (state) return state
  const store = useVault()
  state = {
    fontScale: normalizeStep(store.fontScale(), FONT_STEPS),
    islandScale: normalizeStep(store.islandScale(), ISLAND_STEPS),
  }
  return state
}

export function currentDisplay() {
  return { ...ensure() }
}

// 订阅偏好变化（设置页按钮、任务窗 Ctrl 加减、别的什么口子改的都算）
export function onDisplay(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

function commit(next) {
  state = next
  const store = useVault()
  store.setFontScale(state.fontScale)
  store.setIslandScale(state.islandScale)
  const view = currentDisplay()
  for (const fn of subs) fn(view)
  return view
}

export function setFontScale(value) {
  return commit({ ...ensure(), fontScale: normalizeStep(value, FONT_STEPS) })
}

export function setIslandScale(value) {
  return commit({ ...ensure(), islandScale: normalizeStep(value, ISLAND_STEPS) })
}

// 任务窗的 Ctrl 加号 / 减号：往大、往小各走一档；到头不再变
export function fontStep(dir) {
  const now = ensure()
  return commit({ ...now, fontScale: stepScale(now.fontScale, FONT_STEPS, dir) })
}

// 这扇窗在屏上的工作区：拿不到（还没摆出来）就当主屏
function workAreaOf(win) {
  try {
    const box = win.getContentBounds()
    return screen.getDisplayNearestPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 }).workArea
  } catch {
    return screen.getPrimaryDisplay().workArea
  }
}

// 把页面的 zoom 放上：Ctrl 滚轮那路缩放关掉，只认档位。页面还没起来的时候
// setZoomFactor 会因没有 frame 报错，那就在 DOM 好了那一下再放
const zoomGuarded = new WeakSet()

export function applyZoomFactor(wc, scale) {
  const zoom = () => {
    wc.setVisualZoomLevelLimits(1, 1)
    wc.setZoomFactor(scale)
  }
  // Ctrl 滚轮缩放关掉：只认那四档。这条监听只装一次，别每次换档都多装一条
  if (!zoomGuarded.has(wc)) {
    zoomGuarded.add(wc)
    wc.on('zoom-changed', (event) => event.preventDefault())
  }
  if (!wc.getURL() || wc.isLoadingMainFrame()) wc.once('dom-ready', zoom)
  else zoom()
}

// 把一扇定尺寸的窗（设置窗、首次运行窗）按字号档位摆好：页面放大、内容区跟着放大、
// 超过工作区就贴工作区（里面出滚动条）。尺寸那半不受页面起没起来影响，立刻就摆。
export function applyZoomWindow(win, { width, height, scale }) {
  if (!win || win.isDestroyed()) return
  applyZoomFactor(win.webContents, scale)
  const area = workAreaOf(win)
  const size = zoomWindowSize({ width, height, scale, workArea: area })
  const box = win.getContentBounds()
  const maxX = area.x + Math.max(0, area.width - size.width)
  const maxY = area.y + Math.max(0, area.height - size.height)
  win.setContentBounds({
    x: Math.round(Math.min(Math.max(box.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(box.y, area.y), maxY)),
    width: size.width,
    height: size.height,
  })
}
