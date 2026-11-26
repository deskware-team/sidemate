// 预览窗的纯函数：扩展名 → 类型、文件列表分组、每一行的说明、网页的 srcdoc、路径放不放行。
// 页面和主进程都用这个文件：不引 node:，也不引 electron（页面的 CSP 只放行自己目录下的脚本）。

import { t } from '../copy/copy.mjs'

// 扩展名 → 类型（Map 不用对象，免得 'constructor' 这种撞上）
const BY_EXT = new Map([
  ['doc', 'word'], ['docx', 'word'],
  ['ppt', 'ppt'], ['pptx', 'ppt'],
  ['xls', 'excel'], ['xlsx', 'excel'], ['csv', 'excel'],
  ['pdf', 'pdf'],
  ['png', 'image'], ['jpg', 'image'], ['jpeg', 'image'], ['gif', 'image'], ['webp', 'image'], ['bmp', 'image'],
  ['html', 'web'], ['htm', 'web'],
  ['txt', 'text'], ['md', 'text'],
  ['zip', 'zip'],
])

// 类型名（界面上的那一个词）
export function kindName(kind) {
  if (kind === 'word') return t('preview.kindWord')
  if (kind === 'ppt') return t('preview.kindPpt')
  if (kind === 'excel') return t('preview.kindExcel')
  if (kind === 'pdf') return t('preview.kindPdf')
  if (kind === 'image') return t('preview.kindImage')
  if (kind === 'web') return t('preview.kindWeb')
  if (kind === 'text') return t('preview.kindText')
  if (kind === 'zip') return t('preview.kindZip')
  return t('preview.kindFile')
}

// 类型块上的那一个字（或几个字母）
export function kindBadge(kind) {
  if (kind === 'word') return 'W'
  if (kind === 'ppt') return 'P'
  if (kind === 'excel') return 'X'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'image') return t('preview.badgeImage')
  if (kind === 'web') return 'HTML'
  if (kind === 'text') return t('preview.badgeText')
  if (kind === 'zip') return 'ZIP'
  return t('preview.badgeText')
}

// 扩展名 → 类型；认不出来的算「文件」
export function kindOf(name) {
  const text = String(name ?? '')
  const dot = text.lastIndexOf('.')
  const ext = dot > 0 ? text.slice(dot + 1).toLowerCase() : ''
  return BY_EXT.get(ext) || 'file'
}

// 文件列表分组：成品（任务文件夹根上）和材料（received 里的）。
// 目录和 . 开头的文件不进名单（这条名单只列文件）
export function groupFiles(entries) {
  const done = []
  const material = []
  for (const one of entries || []) {
    if (!one || typeof one.name !== 'string' || one.name === '') continue
    if (one.name.startsWith('.')) continue
    if (one.material === true) material.push(one)
    else done.push(one)
  }
  return { done, material }
}

// 这个对话有没有东西可看：成品或材料有一份就算（跟左栏同一套）
export function hasFiles(groups) {
  return (groups?.done || []).length + (groups?.material || []).length > 0
}

// 挑一份看：成品里最新的那份（mtime 最大的）；没有成品就挑第一份材料
export function pickFile(groups) {
  const done = groups?.done || []
  if (done.length > 0) {
    let best = done[0]
    for (const one of done.slice(1)) {
      if (Number(one?.mtime || 0) > Number(best?.mtime || 0)) best = one
    }
    return best
  }
  return (groups?.material || [])[0] || null
}

// 顶栏那个「预览」按钮：这次对话有成品或材料才显示
export function previewShown(preview) {
  return Boolean(preview) && Number(preview.count) > 0
}

// 左栏两组各有几个文件，以及两组之间要不要画那条线（只有一组时不画）
// showDone / showMaterial：一组没有文件就整组藏起来（标题、个数、列表都不显示）
export function groupMeta(groups) {
  const done = (groups?.done || []).length
  const material = (groups?.material || []).length
  return {
    done,
    material,
    divider: done > 0 && material > 0,
    showDone: done > 0,
    showMaterial: material > 0,
  }
}

// 左栏每一行下面那行说明：成品写类型，材料写「类型 · 你给的」
export function rowNote(kind, material) {
  if (material === true) return t('preview.noteMaterial', { kind: kindName(kind) })
  return kindName(kind)
}

// 上条下面那行说明：知道页数写页数，知道表数写表数，都不知道就只写「只读」
export function headNote(kind, info = {}) {
  const name = kindName(kind)
  const pages = Number(info.pages) || 0
  const sheets = Number(info.sheets) || 0
  if (pages > 0) return t('preview.notePages', { kind: name, n: pages })
  if (sheets > 0) return t('preview.noteSheets', { kind: name, n: sheets })
  return t('preview.noteReadonly', { kind: name })
}

// 看不了的那一块：说明按错的种类分三种
export function cannotNote(code) {
  if (code === 'unavailable') return t('preview.cannotUnavailable')
  if (code === 'unsupported') return t('preview.cannotUnsupported')
  return t('preview.cannotFailed')
}

// 网页的 srcdoc：最前面加一行 CSP，里面的脚本和外链都锁住
export function srcdocFor(html) {
  const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'\">"
  return `${csp}\n${String(html ?? '')}`
}

// ───────── 缩放和分页（页面上和主进程都用这几条）
//
// 缩放档位：手动缩放就落在这几档上（图片和 Excel 也能放到 200%）
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200]
// 适应宽度时减掉的内边距：画布左右各 16；Excel 的图外面还套一层 12 的白边
export const FIT_PADDING = 32
export const FIT_PADDING_SHEET = 56
// 分页文档最多显示多少页（再多就用电脑上的程序打开）
export const MAX_PAGES = 30
// 先要第几页（马上能看的那一页；总页数这时才知道）
export const FIRST_PAGES = 1
// 往后一批要几页（一次最多 20 张是插件的上限）
export const PAGE_BATCH = 19
// 屏幕上真正需要的 dpi 超过这个数，才值得按 300 dpi 重渲
export const SCREEN_DPI_BASE = 200

// 把百分数夹在能看的范围里（太小和太大都没法看）
export function clampPercent(value) {
  const one = Number(value)
  if (!Number.isFinite(one)) return 100
  return Math.max(10, Math.min(400, Math.round(one)))
}

// 适应宽度：页宽撑满画布（减去左右各 16 的内边距）。
// max 是这条看法的上限：图片和 Excel 不放大（最多 100%），分页文档可以超过 100%。
export function fitPercent(naturalWidth, canvasWidth, { padding = FIT_PADDING, max = 400 } = {}) {
  const width = Number(naturalWidth)
  const space = Number(canvasWidth)
  if (!(width > 0) || !(space > padding)) return 100
  return clampPercent(Math.min(((space - padding) / width) * 100, max))
}

// 一张图在 100% 时占多大（CSS 像素）：100% = 真实大小，
// 所以图像素 × 96 / dpi；dpi 不知道（0）就按像素本身。
export function cssSize(width, height, dpi) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const d = Number(dpi) || 0
  if (!(d > 0)) return { width: w, height: h }
  return { width: Math.round((w * 96) / d), height: Math.round((h * 96) / d) }
}

// 屏幕上真正需要的 dpi：百分数 × 屏幕倍率 × 96；超过 200 才按 300 dpi 重渲
export function needsHighDpi(percent, devicePixelRatio = 1) {
  const one = Number(percent)
  const ratio = Number(devicePixelRatio) || 1
  if (!Number.isFinite(one)) return false
  return (one / 100) * ratio * 96 > SCREEN_DPI_BASE
}

// 缩放一档：dir 是 1（放大）或 -1（缩小）；到头了返回 null
export function zoomStep(percent, dir, steps = ZOOM_STEPS) {
  const one = Number(percent)
  if (dir > 0) {
    for (const step of steps) if (step > one) return step
    return null
  }
  for (let at = steps.length - 1; at >= 0; at -= 1) if (steps[at] < one) return steps[at]
  return null
}

// 分批要页：先要前 first 页，往后每批 size 页，最多要 max 页
export function pageBatches(total, { first = FIRST_PAGES, size = PAGE_BATCH, max = MAX_PAGES } = {}) {
  const all = Math.max(0, Math.min(Math.floor(Number(total)) || 0, max))
  const out = []
  const head = Math.min(Math.max(0, first), all)
  if (head > 0) out.push(pageRange(1, head))
  let from = head + 1
  while (from <= all) {
    const to = Math.min(from + Math.max(1, size) - 1, all)
    out.push(pageRange(from, to))
    from = to + 1
  }
  return out
}

// 从 from 到 to 的页号（含两头）
export function pageRange(from, to) {
  const out = []
  for (let one = Math.max(1, from); one <= to; one += 1) out.push(one)
  return out
}

// 缩放时保持画布中间那一点不动：oldTop 是缩放前的滚动位置，oldHeight / newHeight 是缩放前后的内容高度
// 顶上了就还顶着，贴底了就还贴着底；keepEdge: false 时一直按中间那一点算（横向用这个）
export function scrollTopAfterZoom(oldTop, oldHeight, newHeight, viewport, { keepEdge = true } = {}) {
  const top = Number(oldTop) || 0
  const before = Number(oldHeight) || 0
  const after = Number(newHeight) || 0
  const view = Number(viewport) || 0
  if (!(before > 0) || !(view > 0)) return 0
  if (keepEdge) {
    if (top <= 0) return 0
    if (top >= before - view) return Math.max(0, after - view)
  }
  const ratio = (top + view / 2) / before
  const max = Math.max(0, after - view)
  return Math.max(0, Math.min(max, Math.round(ratio * after - view / 2)))
}

// 路径归一：斜杠统一成 /，去掉结尾的斜杠
function norm(path) {
  return String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function dirOf(path) {
  const at = path.lastIndexOf('/')
  return at > 0 ? path.slice(0, at) : ''
}

function baseOf(path) {
  const at = path.lastIndexOf('/')
  return at >= 0 ? path.slice(at + 1) : path
}

// 任务文件夹：父目录叫 received 的，任务文件夹是它的上一层；否则就是父目录
export function taskFolderOf(path) {
  const parent = dirOf(norm(path))
  if (parent === '') return ''
  return baseOf(parent) === 'received' ? dirOf(parent) : parent
}

// 这个路径放不放行：只放行任务文件夹根上的文件，和 received 里的文件
export function allowedPath(taskFolder, path) {
  const folder = norm(taskFolder).toLowerCase()
  const target = norm(path)
  if (folder === '' || target === '') return false
  if (!target.toLowerCase().startsWith(`${folder}/`)) return false
  const parts = target.slice(folder.length + 1).split('/')
  if (parts.length === 0 || parts.length > 2) return false
  if (parts.some((one) => one === '' || one === '.' || one === '..')) return false
  return parts.length === 1 || parts[0].toLowerCase() === 'received'
}
