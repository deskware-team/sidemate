// 预览窗：桌伴里看成品和用户拖进来的材料，只读。
// 760×580、frame: false、preload、contextIsolation、sandbox；只开一个，已开就 show + focus。
// 主进程只认任务文件夹根上的文件和 received 里的文件，别的路径一律拒绝。
// Word / PPT / Excel 的转换交给常驻 dsh 里的 Office 套件（app/dsh/index.mjs 的 previewFile），
// 错误只有 unavailable / unsupported / unreadable / failed 四个码，原文只进日志。

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { appendFileSync, copyFileSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { previewFile } from '../dsh/index.mjs'
import { iconPath } from '../assets/icon.mjs'
import { dataPaths, ensureDataDir } from '../paths.mjs'
import { t } from '../copy/copy.mjs'
import { listFolder } from './list.mjs'
import { allowedPath, cssSize, hasFiles, kindOf, MAX_PAGES, pickFile, srcdocFor, taskFolderOf } from './model.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
// 读成文字的这份文件最大这么大，再大就当这里看不了
const MAX_TEXT = 2 * 1024 * 1024
// 分页文档：先要第 1 页（马上能看），往后一批 19 页；最多 30 页
const PAGE_DPI = 200
const PAGE_DPI_HI = 300

let win = null
let bound = false
// 现在看的是哪个任务文件夹、哪个文件
let current = { taskFolder: '', path: '' }

// 预览窗的日志：界面上不写错的原文，只写进这里
function log(event, data = {}) {
  ensureDataDir()
  try { appendFileSync(dataPaths().taskLog, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`) } catch { /* 日志坏了不能误事 */ }
}

function windowOptions() {
  return {
    width: 760,
    height: 580,
    minWidth: 560,
    minHeight: 420,
    useContentSize: true,
    center: true,
    // 不要系统标题栏：页面顶上那一条自己画（照设置窗的做法）
    frame: false,
    show: false,
    resizable: true,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    title: t('preview.title'),
    icon: iconPath,
    webPreferences: {
      preload: join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 渲图失败时还有一条退路：PDF 用 Electron 自带的查看器（所以插件得开着）
      plugins: true,
    },
  }
}

// 本机文件的地址：页面只认这一种
function fileUrl(path) {
  return pathToFileURL(path).href
}

// 左栏的两组：成品（任务文件夹根上）和材料（received 里的）
function listFiles() {
  return listFolder(current.taskFolder)
}

// PDF 有几页：数一下文件里的页对象（数不出来就当不知道）
function pdfPages(path) {
  try {
    const text = readFileSync(path, 'latin1')
    const hits = text.match(/\/Type\s*\/Page[^s]/g)
    return hits ? hits.length : 0
  } catch {
    return 0
  }
}

// 读成文字：太大就当这里看不了
function readText(path) {
  try {
    if (statSync(path).size > MAX_TEXT) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// Word / PPT：转成 PDF 再看
async function toPdf(path, kind) {
  const back = await previewFile({ path, kind: 'pdf' })
  if (back?.ok !== true) {
    log('preview-failed', { path, code: back?.code || 'failed', detail: back?.detail || '' })
    return { ok: false, code: back?.code || 'failed' }
  }
  return { ok: true, kind, view: 'pdf', url: fileUrl(back.path), pages: Number(back.pages) || 0, name: basename(path) }
}

// Excel：渲成图片，一张一张看（跟分页文档一样按 200 dpi，倍率高的屏幕上不虚）
async function toImages(path) {
  const back = await previewFile({ path, kind: 'images', dpi: PAGE_DPI })
  if (back?.ok !== true) {
    log('preview-failed', { path, code: back?.code || 'failed', detail: back?.detail || '' })
    return { ok: false, code: back?.code || 'failed' }
  }
  const images = imagesOf(back.images, back.dpi || PAGE_DPI)
  return { ok: true, kind: 'excel', view: 'images', images, name: basename(path) }
}

// 渲出来的那些图（改成页面能用的样子）：
// cssWidth / cssHeight 是 100%（真实大小）时占的 CSS 像素
function imagesOf(images, dpi) {
  return (images || []).map((one) => {
    const size = cssSize(one.width, one.height, dpi)
    return {
      url: fileUrl(one.file),
      width: Number(one.width) || 0,
      height: Number(one.height) || 0,
      cssWidth: size.width,
      cssHeight: size.height,
      page: Number(one.page) || 0,
      dpi: Number(dpi) || 0,
      sheet: typeof one.sheet === 'string' ? one.sheet : '',
    }
  })
}

// 分页文档（Word / PPT / PDF）：一页一张图，页数从回包里拿
// 只先要第 1 页（第一眼要快），剩下的页由页面往后要；套件对某种格式渲不出来时返回 null，
// 调用方退回 PDF 查看器
async function toPages(path, kind) {
  const first = await previewFile({ path, kind: 'images', pages: [1], dpi: PAGE_DPI })
  if (first?.ok !== true) {
    log('preview-pages-failed', { path, code: first?.code || 'failed', detail: first?.detail || '' })
    return null
  }
  const total = Number(first.pages) || 0
  return { ok: true, kind, view: 'pages', pages: total, images: imagesOf(first.images, first.dpi || PAGE_DPI) }
}

// 再要几页（页面往后接的时候，或者放大到 150% 以上重渲看得见的那几页）
async function morePages(path, pages, dpi) {
  if (!allowedPath(current.taskFolder, path)) {
    log('preview-denied', { path })
    return { ok: false, code: 'unsupported' }
  }
  const list = (Array.isArray(pages) ? pages : [])
    .map((one) => Number(one))
    .filter((one) => Number.isInteger(one) && one > 0 && one <= MAX_PAGES)
  if (list.length === 0) return { ok: false, code: 'unsupported' }
  const want = Number(dpi) >= PAGE_DPI_HI ? PAGE_DPI_HI : PAGE_DPI
  const back = await previewFile({ path, kind: 'images', pages: list, dpi: want })
  if (back?.ok !== true) {
    log('preview-pages-failed', { path, code: back?.code || 'failed', detail: back?.detail || '' })
    return { ok: false, code: back?.code || 'failed' }
  }
  return { ok: true, images: imagesOf(back.images, back.dpi || want) }
}

// 这份文件在这里怎么显示
async function showFile(path) {
  if (!allowedPath(current.taskFolder, path)) {
    log('preview-denied', { path })
    return { ok: false, code: 'unsupported' }
  }
  current.path = path
  const kind = kindOf(path)
  const name = basename(path)
  if (kind === 'image') return { ok: true, kind, view: 'image', url: fileUrl(path), name }
  if (kind === 'pdf') {
    // 一页一张图；渲不出来就退回 PDF 查看器
    const paged = await toPages(path, kind)
    if (paged) return { ...paged, name }
    return { ok: true, kind, view: 'pdf', url: fileUrl(path), pages: pdfPages(path), name }
  }
  if (kind === 'web') {
    const text = readText(path)
    if (text === null) return { ok: false, code: 'unsupported' }
    return { ok: true, kind, view: 'web', srcdoc: srcdocFor(text), name }
  }
  if (kind === 'text') {
    const text = readText(path)
    if (text === null) return { ok: false, code: 'unsupported' }
    return { ok: true, kind, view: 'text', text, name }
  }
  if (kind === 'word' || kind === 'ppt') {
    // 一页一张图；渲不出来就退回转 PDF 再看
    const paged = await toPages(path, kind)
    if (paged) return { ...paged, name }
    return toPdf(path, kind)
  }
  if (kind === 'excel') return toImages(path)
  return { ok: false, code: 'unsupported' }
}

// 用电脑上的程序打开这份文件
function openWithSystem(path) {
  if (!allowedPath(current.taskFolder, path)) return { ok: false }
  void shell.openPath(path)
  return { ok: true }
}

// 在文件夹里显示：选中当前这一份（路径照样要过 allowedPath）
function revealWithSystem(path) {
  if (!allowedPath(current.taskFolder, path)) return { ok: false }
  void shell.showItemInFolder(path)
  return { ok: true }
}

// 另存为：系统另存为对话框，拷一份到用户选的地方（照 app/task/shell.mjs 的 saveAs）
async function saveAs(path) {
  if (!allowedPath(current.taskFolder, path)) return { ok: false }
  try {
    const done = await dialog.showSaveDialog(win, { title: t('output.saveAs'), defaultPath: basename(path) })
    if (done?.canceled || !done?.filePath) return { ok: false }
    copyFileSync(path, done.filePath)
    log('preview-save-as', { path })
    return { ok: true, path: done.filePath }
  } catch (error) {
    log('preview-save-as-failed', { error: error?.message || '' })
    return { ok: false }
  }
}

function bind() {
  if (bound) return
  bound = true
  ipcMain.handle('preview:list', () => listFiles())
  ipcMain.handle('preview:show', (_event, path) => showFile(String(path ?? '')))
  ipcMain.handle('preview:pages', (_event, path, pages, dpi) => morePages(String(path ?? ''), pages, dpi))
  ipcMain.handle('preview:open', (_event, path) => openWithSystem(String(path ?? '')))
  ipcMain.handle('preview:reveal', (_event, path) => revealWithSystem(String(path ?? '')))
  ipcMain.handle('preview:save-as', (_event, path) => saveAs(String(path ?? '')))
  ipcMain.on('preview:close', () => { if (win && !win.isDestroyed()) win.close() })
}

// 打开预览窗看这份文件。任务文件夹：父目录叫 received 的，任务文件夹是它的上一层；否则就是父目录
export function openPreview(path) {
  const file = String(path ?? '')
  const folder = taskFolderOf(file)
  if (folder === '') {
    log('preview-denied', { path: file })
    return
  }
  bind()
  current = { taskFolder: folder, path: file }
  if (win && !win.isDestroyed()) {
    // 窗已经开着：换一份看
    win.show()
    win.focus()
    win.webContents.send('preview:pick', file)
    return
  }
  win = new BrowserWindow(windowOptions())
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })
  win.loadFile(join(dir, 'page.html'), { query: { path: file } })
}

// 按文件夹打开预览窗：选中最新的一份成品；没有成品就选第一份材料
export function openPreviewFolder(folder) {
  const target = String(folder ?? '')
  if (target === '') return
  const groups = listFolder(target)
  if (!hasFiles(groups)) {
    log('preview-empty', { folder: target })
    return
  }
  const pick = pickFile(groups)
  if (!pick) return
  openPreview(pick.path)
}
