// 对话里图片的地址核一遍（只给主进程用：这个文件引 node:，页面那边不许引）。
// 本地的图片必须在这次对话的工作区里，还是能显示的图片扩展名，核过了才给页面一个能用的地址。
// 相对路径按工作区算；绝对路径也得在工作区里。

import { basename, extname, isAbsolute, resolve } from 'node:path'
import { openablePath } from './chips.mjs'
import { imageKind } from './markdown.mjs'

// 能当图片显示的扩展名
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

// 核一遍：核过了给 { ok: true, path, name }，没核过给 { ok: false, reason }
export function imagePath(workspace, url) {
  const text = String(url ?? '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  const target = isAbsolute(text) ? text : resolve(workspace || '', text)
  const hit = openablePath(workspace, target)
  if (!hit.ok) return hit
  if (!IMAGE_EXT.test(extname(hit.path))) return { ok: false, reason: 'type' }
  return { ok: true, path: hit.path, name: basename(hit.path) }
}

// 用户右键的是哪张图：本地的（工作区里的文件，主进程再核一遍）还是 https 的
export function imageTarget(payload, workspace) {
  const path = String(payload?.path ?? '')
  if (path) {
    const hit = imagePath(workspace, path)
    return hit.ok ? { kind: 'local', path: hit.path, name: hit.name } : null
  }
  const url = String(payload?.url ?? '')
  return imageKind(url) === 'https' ? { kind: 'remote', url } : null
}
