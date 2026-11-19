// 任务窗贴图片和长文字的场景（被 window-main.mjs 调用，纯 node 下只 import 不炸）：
// 真的往剪贴板放一张 PNG、一段 3000 字，在输入框上触发粘贴（webContents.paste()），
// 走页面那头的分流、主进程这头的存文件，再量：小签 2 个、图片小签 28×28 缩略图、
// 贴的目录里有 贴的图-1.png 和 贴的文字-1.md、输入框里没有那 3000 字。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径，具名导入会在链接时就报错
import electron from 'electron'
const { clipboard, ClipboardItem, ipcMain, nativeImage } = electron
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { pasteDir, restoreText, saveImage, saveText } from '../../app/task/paste.mjs'
import { charsText } from '../../app/task/paste-plan.mjs'

// 一张 1×1 的真 PNG：nativeImage 解得出、存下来的文件头也是真的
const PNG_BUF = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const LONG_TEXT = '字'.repeat(3000)

// 量输入框和小签行：小签几个、图片小签的缩略图多大、输入框里有没有那 3000 字
const PASTE_METER = `(() => {
  const tags = [...document.querySelectorAll('#tags .tag')]
  const sub = (el) => (el.querySelector('.sub') ? el.querySelector('.sub').textContent : '')
  const thumb = document.querySelector('#tags .tag.image .thumb')
  const rect = thumb ? thumb.getBoundingClientRect() : null
  return {
    count: tags.length,
    names: tags.map((el) => el.querySelector('.nm').textContent),
    subs: tags.map(sub),
    thumb: rect ? { w: Math.round(rect.width), h: Math.round(rect.height), src: thumb.src.startsWith('data:image/png') } : null,
    notes: [...document.querySelectorAll('#notes div')].map((el) => el.textContent),
    inputLength: document.querySelector('#input').value.length,
    noteHidden: document.querySelector('#notes').hidden,
  }
})()`

// 长文字小签的右键菜单：多了「改回文字」
const PASTE_MENU = `(() => {
  const tag = [...document.querySelectorAll('#tags .tag')].find((el) => (el.dataset.path || '').includes('贴的文字'))
  if (!tag) return []
  tag.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  return [...document.querySelectorAll('#tagmenu button')].map((one) => one.textContent)
})()`

export async function pasteScene({ w, show, settle, opts }) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-paste-'))
  let state = createTask()
  const view = () => toTaskView(state, opts)
  const send = () => w.send('task:view', view())
  // 这几个口子照 app/task/shell.mjs 的接法：存文件、缩略图、改回文字
  ipcMain.on('task:paste', (_event, payload) => {
    if (Array.isArray(payload?.images)) {
      for (const one of payload.images) {
        const saved = saveImage(pasteDir(root), Buffer.from(one.bytes ?? []), one.mime)
        if (saved.ok) state = reduceTask(state, { type: 'paste', files: [{ path: saved.path, name: saved.name, kind: 'image' }] }).state
      }
      send()
    } else if (typeof payload?.text === 'string' && payload.text) {
      const saved = saveText(pasteDir(root), payload.text)
      state = reduceTask(state, { type: 'paste', files: [{ path: saved.path, name: saved.name, kind: 'text', sub: charsText(saved.chars) }] }).state
      send()
    }
  })
  ipcMain.handle('task:thumb', (_event, payload) => {
    try {
      const img = nativeImage.createFromPath(String(payload?.path ?? ''))
      return img.isEmpty() ? '' : img.resize({ width: 56 }).toDataURL()
    } catch {
      return ''
    }
  })
  ipcMain.handle('task:restore', (_event, payload) => {
    const path = String(payload?.path ?? '')
    try {
      const text = restoreText(path)
      state = reduceTask(state, { type: 'remove', path, pasted: true }).state
      send()
      return { ok: true, text }
    } catch {
      return { ok: false }
    }
  })

  // 点开输入胶囊（聚焦输入框），先清掉前面场景留下的字，再贴一张图、再贴一段 3000 字
  send()
  await settle()
  await w.executeJavaScript('document.querySelector("#inputwrap").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
  await sleep(350)
  await w.executeJavaScript(`(() => { const input = document.querySelector('#input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(120)
  // 这版 Electron 的剪贴板走 ClipboardItem：图片得包成 Blob 再写
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([PNG_BUF], { type: 'image/png' }) })])
  await w.paste()
  await sleep(500)
  clipboard.writeText(LONG_TEXT)
  await w.paste()
  await sleep(700) // 缩略图从主进程拿回来是异步的，等它填上
  await settle()
  const checks = await w.executeJavaScript(PASTE_METER)
  checks.menu = await w.executeJavaScript(PASTE_MENU)
  await w.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  // 存下来的文件真在贴的目录里、内容一字不差
  const dir = pasteDir(root)
  checks.files = {
    image: existsSync(join(dir, '贴的图-1.png')),
    text: existsSync(join(dir, '贴的文字-1.md')),
    textChars: existsSync(join(dir, '贴的文字-1.md')) ? Array.from(readFileSync(join(dir, '贴的文字-1.md'), 'utf8')).length : 0,
    imageBytes: existsSync(join(dir, '贴的图-1.png')) ? readFileSync(join(dir, '贴的图-1.png')).length : 0,
  }
  await show('17-贴了图和长文字', view())
  rmSync(root, { recursive: true, force: true })
  return checks
}
