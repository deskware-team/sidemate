// 图上的右键菜单做的事（只给主进程用）：另存为图片、复制图片。
// 本地图直接拷原文件（保持原格式，默认文件名就是原文件名）；https 的现抓下来再存。
// 这个文件引 electron，页面那边不许引。

import { clipboard, dialog, nativeImage } from 'electron'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { t } from '../copy/copy.mjs'

// https 的图：默认文件名从网址上取
function remoteName(url) {
  try {
    const name = basename(new URL(url).pathname)
    if (!name) return 'image.png'
    return name.includes('.') ? name : `${name}.png`
  } catch {
    return 'image.png'
  }
}

// 另存为图片 / 复制图片。win 是任务窗那个窗（另存为对话框挂在它下面）。
export async function imageAction(target, action, win, log) {
  try {
    if (target.kind === 'local') {
      if (action === 'copy') {
        const image = nativeImage.createFromPath(target.path)
        if (!image.isEmpty()) {
          clipboard.writeImage(image)
          log('image-copy', { path: target.path })
          return
        }
        // svg 拷不进剪贴板当图片，把源码放进去
        if (extname(target.path).toLowerCase() === '.svg') {
          clipboard.writeText(readFileSync(target.path, 'utf8'))
          log('image-copy', { path: target.path })
        }
        return
      }
      const done = await dialog.showSaveDialog(win, { title: t('output.saveAs'), defaultPath: target.name })
      if (done?.canceled || !done?.filePath) return
      copyFileSync(target.path, done.filePath)
      log('image-save', { path: done.filePath })
      return
    }
    const res = await fetch(target.url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return
    const bytes = Buffer.from(await res.arrayBuffer())
    if (action === 'copy') {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return
      clipboard.writeImage(image)
      log('image-copy', { url: target.url })
      return
    }
    const done = await dialog.showSaveDialog(win, { title: t('output.saveAs'), defaultPath: remoteName(target.url) })
    if (done?.canceled || !done?.filePath) return
    writeFileSync(done.filePath, bytes)
    log('image-save', { path: done.filePath })
  } catch (error) {
    log('image-action-failed', { error: error?.message || '' })
  }
}
