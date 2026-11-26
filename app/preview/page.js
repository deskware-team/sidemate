// 预览窗的页面：左边列出成品和材料，右边显示当前这一份（只读）。
// 显示成什么样由主进程说了算（图片直接看、分页文档一页一张图、Excel 渲成图片、
// 网页用 srcdoc 装起来、别的就说这里看不了）。这里只管摆出来和缩放。

import { paint, t } from '../copy/copy.mjs'
import {
  cannotNote,
  FIT_PADDING,
  FIT_PADDING_SHEET,
  fitPercent,
  groupMeta,
  headNote,
  kindBadge,
  kindOf,
  MAX_PAGES,
  needsHighDpi,
  pageBatches,
  rowNote,
  scrollTopAfterZoom,
  zoomStep,
  ZOOM_STEPS,
} from './model.mjs'

paint(document)

const els = {
  done: document.getElementById('done-list'),
  material: document.getElementById('material-list'),
  doneCount: document.getElementById('done-count'),
  materialCount: document.getElementById('material-count'),
  divider: document.getElementById('files-divider'),
  doneGroup: document.getElementById('done-group'),
  materialGroup: document.getElementById('material-group'),
  name: document.getElementById('head-name'),
  note: document.getElementById('head-note'),
  loading: document.getElementById('loading'),
  content: document.getElementById('content'),
  canvas: document.getElementById('canvas'),
  foot: document.getElementById('foot'),
  sheets: document.getElementById('sheets'),
  pages: document.getElementById('pages'),
  zoom: document.getElementById('zoom'),
  zoomFit: document.getElementById('zoom-fit'),
  zoomOut: document.getElementById('zoom-out'),
  zoomIn: document.getElementById('zoom-in'),
  zoomValue: document.getElementById('zoom-value'),
}

// 现在看的是哪一份、哪张表
let current = { path: '', kind: 'file' }
let sheet = ''
// 现在是哪种看法（决定缩放显不显示）
let view = ''
// 缩放：fit 是适应宽度，step 是落在某一档上
let zoom = { mode: 'fit', value: 100 }
// 分页文档：页号 → 那张图
let pageImages = new Map()
// 还没要的页（往后一批一批要）
let pending = []
let loadingBatch = false
// 换一份看的时候，作废上一份还没回来的批次
let token = 0
// 看得见的那几页要不要按 300 dpi 重渲（定时器）
let highDpiTimer = null

document.getElementById('win-close').addEventListener('click', () => window.preview.close())
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { window.preview.close(); return }
  if (!event.ctrlKey) return
  if (event.key === '=' || event.key === '+') { event.preventDefault(); zoomBy(1); return }
  if (event.key === '-') { event.preventDefault(); zoomBy(-1); return }
  if (event.key === '0') { event.preventDefault(); zoomFit() }
})
document.getElementById('btn-open').addEventListener('click', () => {
  if (current.path) window.preview.open(current.path)
})
document.getElementById('btn-reveal').addEventListener('click', () => {
  if (current.path) window.preview.reveal(current.path)
})
document.getElementById('btn-save').addEventListener('click', () => {
  if (current.path) window.preview.saveAs(current.path)
})
els.zoomFit.addEventListener('click', () => zoomFit())
els.zoomOut.addEventListener('click', () => zoomBy(-1))
els.zoomIn.addEventListener('click', () => zoomBy(1))
// Ctrl + 滚轮：在画布上缩放
els.canvas.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? 1 : -1)
}, { passive: false })
// 滚到新的一页：放大着的时候那一页也换成清楚的图
els.canvas.addEventListener('scroll', () => refreshHighDpi())
// 窗口变宽变窄：适应宽度跟着重算
window.addEventListener('resize', () => { if (zoomable()) applyZoom() })
// 预览窗已经开着，主进程又点名要看另一份（左栏也跟着换）
window.preview.onPick(async (path) => {
  const groups = await window.preview.list()
  renderList(groups)
  await select(path)
})

// 左栏的两组
function renderList(groups) {
  const meta = groupMeta(groups)
  els.doneCount.textContent = String(meta.done)
  els.materialCount.textContent = String(meta.material)
  els.divider.hidden = !meta.divider
  // 一组没有文件就整组藏起来（标题、个数、列表都不显示），不留「材料 0」那一行
  els.doneGroup.hidden = !meta.showDone
  els.materialGroup.hidden = !meta.showMaterial
  const put = (list, entries, material) => {
    list.textContent = ''
    for (const one of entries || []) {
      const kind = kindOf(one.name)
      const row = document.createElement('li')
      row.dataset.path = one.path
      row.dataset.kind = kind
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.dataset.kind = kind
      badge.textContent = kindBadge(kind)
      const text = document.createElement('div')
      text.className = 'row-text'
      const name = document.createElement('div')
      name.className = 'row-name'
      name.textContent = one.name
      const note = document.createElement('div')
      note.className = 'row-note'
      note.textContent = rowNote(kind, material)
      text.append(name, note)
      row.append(badge, text)
      row.addEventListener('click', () => { select(one.path) })
      list.append(row)
    }
  }
  put(els.done, groups?.done, false)
  put(els.material, groups?.material, true)
}

function markActive(path) {
  for (const row of document.querySelectorAll('#files li')) {
    row.classList.toggle('active', row.dataset.path === path)
  }
}

// 看不了的那一块
function showCannot(code) {
  els.name.textContent = ''
  els.note.textContent = ''
  const box = document.createElement('div')
  box.className = 'cannot'
  const badge = document.createElement('div')
  badge.className = 'badge'
  badge.dataset.kind = current.kind
  badge.textContent = kindBadge(current.kind)
  const title = document.createElement('h3')
  title.textContent = t('preview.cannotTitle')
  const note = document.createElement('p')
  note.textContent = cannotNote(code)
  const button = document.createElement('button')
  button.className = 'btn'
  button.type = 'button'
  button.textContent = t('preview.open')
  button.addEventListener('click', () => { if (current.path) window.preview.open(current.path) })
  box.append(badge, title, note, button)
  els.content.append(box)
}

// ───────── 缩放

// 哪些看法能缩放：分页文档、Excel、图片（文本和网页不缩放）
function zoomable() {
  return view === 'pages' || view === 'images' || view === 'image'
}

// 这一份最宽的一张图有多宽（CSS 像素，100% = 真实大小）：适应宽度拿它算
function naturalWidth() {
  let width = 0
  for (const img of els.content.querySelectorAll('img.zoomable')) {
    const one = Number(img.dataset.w) || 0
    if (one > width) width = one
  }
  return width
}

// 这一种看法的适应宽度：上限和要减掉的内边距
// （图片和 Excel 适应宽度最多 100%；Excel 的图外面还有 12 的白边）
function fitLimit() {
  if (view === 'pages') return { max: 400, padding: FIT_PADDING }
  if (view === 'images') return { max: 100, padding: FIT_PADDING_SHEET }
  return { max: 100, padding: FIT_PADDING }
}

// 缩放档位：所有看法都一样（图片和 Excel 也能放到 200%）
function steps() {
  return ZOOM_STEPS
}

// 现在放大到百分之几
function percentNow() {
  if (!zoomable()) return 100
  if (zoom.mode === 'fit') return fitPercent(naturalWidth(), els.canvas.clientWidth, fitLimit())
  return zoom.value
}

// 把缩放落到每一张图上，并更新底条上的字
function applyZoom() {
  const percent = percentNow()
  const scale = percent / 100
  for (const img of els.content.querySelectorAll('img.zoomable')) {
    const width = (Number(img.dataset.w) || 0) * scale
    img.style.width = width > 0 ? `${Math.round(width)}px` : ''
  }
  els.zoomValue.textContent = t('preview.zoomValue', { n: Math.round(percent) })
  // 适应宽度：这一颗按钮在适应宽度时是选中的样子（跟底条的工作表标签一样）
  els.zoomFit.classList.toggle('active', zoom.mode === 'fit')
  // 到头了按钮就灰掉
  els.zoomOut.disabled = zoomStep(percent, -1, steps()) === null
  els.zoomIn.disabled = zoomStep(percent, 1, steps()) === null
}

// 换一档缩放：画布中间那一点不动（缩放前后按比例挪滚动位置）
function changeZoom(next) {
  if (!zoomable()) return
  const oldTop = els.canvas.scrollTop
  const oldHeight = els.canvas.scrollHeight
  const viewport = els.canvas.clientHeight
  const oldLeft = els.canvas.scrollLeft
  const oldWidth = els.canvas.scrollWidth
  const viewWidth = els.canvas.clientWidth
  zoom = next
  applyZoom()
  const newHeight = els.canvas.scrollHeight
  els.canvas.scrollTop = scrollTopAfterZoom(oldTop, oldHeight, newHeight, viewport)
  // 横向也是中间那一点不动（横向没有「顶」这一说，所以不贴边）
  const newWidth = els.canvas.scrollWidth
  els.canvas.scrollLeft = scrollTopAfterZoom(oldLeft, oldWidth, newWidth, viewWidth, { keepEdge: false })
  refreshHighDpi()
}

// 放大一档 / 缩小一档
function zoomBy(dir) {
  const step = zoomStep(percentNow(), dir, steps())
  if (step === null) return
  changeZoom({ mode: 'step', value: step })
}

// 回到适应宽度
function zoomFit() {
  changeZoom({ mode: 'fit', value: 100 })
}

// ───────── 分页文档（一页一张图）

// 一页：白底、阴影，图片在里面
function pageCard(one) {
  const card = document.createElement('div')
  card.className = 'page-card'
  card.dataset.page = String(one.page)
  const img = document.createElement('img')
  img.className = 'zoomable'
  img.dataset.w = String(one.cssWidth)
  img.dataset.h = String(one.cssHeight)
  img.alt = ''
  img.src = one.url
  card.append(img)
  return card
}

// 看得见的是哪几页
function visiblePages() {
  const box = els.canvas.getBoundingClientRect()
  const out = []
  for (const card of els.content.querySelectorAll('.page-card')) {
    const rect = card.getBoundingClientRect()
    if (rect.bottom > box.top && rect.top < box.bottom) out.push(Number(card.dataset.page))
  }
  return out.sort((a, b) => a - b)
}

// 屏幕上真正需要的 dpi 超过 200：看得见的那几页按 300 dpi 重渲（套件有缓存）
function refreshHighDpi() {
  if (view !== 'pages') return
  if (!needsHighDpi(percentNow(), window.devicePixelRatio)) return
  clearTimeout(highDpiTimer)
  highDpiTimer = setTimeout(async () => {
    const want = visiblePages().filter((one) => (pageImages.get(one)?.dpi || 0) < 300)
    if (want.length === 0) return
    const mine = token
    const back = await window.preview.pages(current.path, want, 300)
    if (mine !== token || !back || back.ok !== true) return
    for (const one of back.images || []) {
      // 换一张更清楚的图，但显示的大小不变（宽高还是 200 dpi 那一份的）
      const old = pageImages.get(one.page)
      pageImages.set(one.page, { url: one.url, dpi: 300, w: old?.w || one.cssWidth, h: old?.h || one.cssHeight })
      const card = els.content.querySelector(`.page-card[data-page="${one.page}"]`)
      if (!card) continue
      card.querySelector('img').src = one.url
    }
    applyZoom()
  }, 250)
}

// 后面的页一批一批要（要到了就接在后面）
async function loadNext() {
  if (loadingBatch || pending.length === 0) return
  const batch = pending.shift()
  loadingBatch = true
  const mine = token
  const back = await window.preview.pages(current.path, batch, 200)
  loadingBatch = false
  if (mine !== token) return
  if (!back || back.ok !== true) { pending = []; return }
  const more = els.content.querySelector('.more')
  for (const one of back.images || []) {
    if (pageImages.has(one.page)) continue
    pageImages.set(one.page, { url: one.url, w: one.cssWidth, h: one.cssHeight, dpi: one.dpi || 200 })
    els.content.insertBefore(pageCard(one), more)
  }
  applyZoom()
  loadNext()
}

// 分页文档：前几页马上显示，后面的往后接
function renderPages(back) {
  view = 'pages'
  const total = Number(back.pages) || 0
  els.note.textContent = headNote(back.kind, { pages: total })
  els.pages.textContent = t('preview.pages', { n: total })
  els.foot.hidden = false
  els.zoom.hidden = false
  for (const one of back.images || []) {
    pageImages.set(one.page, { url: one.url, w: one.cssWidth, h: one.cssHeight, dpi: one.dpi || 200 })
    els.content.append(pageCard(one))
  }
  // 超过 30 页：最后一页下面写一句（后面的页看不了）
  const more = document.createElement('p')
  more.className = 'more'
  more.textContent = t('preview.morePages', { n: MAX_PAGES })
  more.hidden = total <= MAX_PAGES
  els.content.append(more)
  // 后面的页：前 5 页已经要过了，剩下的往后一批一批要
  pending = pageBatches(total).slice(1)
  loadNext()
}

// Excel：一张表一张表看，底条左边列工作表名。
// 点标签会重画：先把上一次的标签和图清掉，不然标签会越点越多；一进来默认选第一张表
function renderImages(back) {
  view = 'images'
  const images = back.images || []
  const names = []
  for (const one of images) {
    if (one.sheet && !names.includes(one.sheet)) names.push(one.sheet)
  }
  els.sheets.textContent = ''
  els.content.textContent = ''
  if (sheet === '' && names.length > 0) sheet = names[0]
  els.note.textContent = headNote(back.kind, { sheets: names.length })
  if (names.length > 0) {
    for (const name of names) {
      const tab = document.createElement('button')
      tab.className = name === sheet ? 'tab active' : 'tab'
      tab.type = 'button'
      tab.textContent = name
      tab.addEventListener('click', () => {
        sheet = name
        renderImages(back)
      })
      els.sheets.append(tab)
    }
  }
  els.foot.hidden = false
  els.zoom.hidden = false
  const shown = sheet === '' ? images : images.filter((one) => one.sheet === sheet)
  for (const one of shown) {
    const card = document.createElement('div')
    card.className = 'sheet-card'
    const img = document.createElement('img')
    img.className = 'zoomable'
    img.dataset.w = String(one.cssWidth || 0)
    img.dataset.h = String(one.cssHeight || 0)
    img.alt = ''
    img.src = one.url
    card.append(img)
    els.content.append(card)
  }
  applyZoom()
}

function render(back) {
  els.content.textContent = ''
  els.sheets.textContent = ''
  els.pages.textContent = ''
  els.foot.hidden = true
  els.zoom.hidden = true
  view = ''
  zoom = { mode: 'fit', value: 100 }
  pageImages = new Map()
  pending = []
  clearTimeout(highDpiTimer)
  if (!back || back.ok !== true) {
    showCannot(back?.code || 'failed')
    return
  }
  els.name.textContent = back.name || ''
  const shown = back.view
  if (shown === 'image') {
    const img = document.createElement('img')
    img.className = 'pic zoomable'
    img.alt = ''
    img.src = back.url
    // 图多大要等它自己加载完才知道
    img.addEventListener('load', () => {
      img.dataset.w = String(img.naturalWidth || 0)
      img.dataset.h = String(img.naturalHeight || 0)
      applyZoom()
    })
    els.content.append(img)
    view = 'image'
    els.zoom.hidden = false
    els.foot.hidden = false
    els.note.textContent = headNote(back.kind, {})
  } else if (shown === 'pdf') {
    const frame = document.createElement('iframe')
    frame.className = 'pdf'
    frame.src = `${back.url}#toolbar=0&navpanes=0&view=FitH`
    els.content.append(frame)
    els.note.textContent = headNote(back.kind, { pages: back.pages })
    if (Number(back.pages) > 0) {
      els.pages.textContent = t('preview.pages', { n: back.pages })
      els.foot.hidden = false
    }
  } else if (shown === 'text') {
    const pre = document.createElement('pre')
    pre.className = 'text'
    pre.textContent = back.text || ''
    els.content.append(pre)
    els.note.textContent = headNote(back.kind, {})
  } else if (shown === 'web') {
    const frame = document.createElement('iframe')
    frame.className = 'web'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.srcdoc = back.srcdoc || ''
    els.content.append(frame)
    els.note.textContent = headNote(back.kind, {})
  } else if (shown === 'pages') {
    renderPages(back)
  } else if (shown === 'images') {
    renderImages(back)
  }
  if (zoomable()) applyZoom()
}

// 换一份看
async function select(path) {
  current = { path, kind: kindOf(path) }
  sheet = ''
  token += 1
  const mine = token
  markActive(path)
  els.loading.hidden = false
  els.content.textContent = ''
  const back = await window.preview.show(path)
  // 回来的路上又点了一份：这份不要了（慢的那份不能盖掉快的那份）
  if (mine !== token) return
  els.loading.hidden = true
  render(back)
}

async function init() {
  const groups = await window.preview.list()
  renderList(groups)
  const wanted = new URLSearchParams(location.search).get('path')
  if (wanted) await select(wanted)
}

init()
