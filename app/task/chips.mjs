// 气泡里的小块：用户发出去的材料，在这次任务工作区里的那份拷贝。
// 这里只算三样：这一轮带的是哪几份、对应工作区里的哪个文件、点开能不能开。
// 打开的动作在主进程做（在预览窗里看），路径的核也在主进程做。

import { existsSync, realpathSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

// 图片：带缩略图
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i
// 贴的长文字：存成 md / txt
const TEXT_EXT = /\.(md|txt)$/i

// 小块的样子：图片 / 长文字 / 别的文件
export function kindOf(path) {
  const ext = extname(String(path || '')).toLowerCase()
  if (IMAGE_EXT.test(ext)) return 'image'
  if (TEXT_EXT.test(ext)) return 'text'
  return ''
}

// 这一轮带的材料：原件路径对到工作区里的那份拷贝。
// 对不上的（没拷进去的）path 留空：那块灰着，点不开。
export function chipsOf({ paths = [], copied = [] } = {}) {
  const map = new Map()
  for (const one of Array.isArray(copied) ? copied : []) {
    if (!one || typeof one.from !== 'string' || typeof one.to !== 'string') continue
    map.set(resolve(one.from), one.to)
  }
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== 'string' || !raw) continue
    const key = resolve(raw)
    if (seen.has(key)) continue
    seen.add(key)
    const to = map.get(key) || ''
    const kind = kindOf(to || raw)
    out.push({ name: basename(to || raw), path: to, kind, thumb: kind === 'image' })
  }
  return out
}

// 点开的时候核一遍：只放当前任务工作区里的文件。
// 解析成绝对路径后必须落在工作区内（不认 .. 跳出），符号链接按真身再核一次。
export function openablePath(workspace, path) {
  if (typeof workspace !== 'string' || !workspace.trim()) return { ok: false, reason: 'no-workspace' }
  if (typeof path !== 'string' || !path.trim()) return { ok: false, reason: 'outside' }
  const root = resolve(workspace)
  const target = resolve(path)
  if (!within(root, target)) return { ok: false, reason: 'outside' }
  if (!existsSync(target)) return { ok: false, reason: 'missing' }
  const realRoot = realOf(root)
  const realTarget = realOf(target)
  if (realRoot && realTarget && !within(realRoot, realTarget)) return { ok: false, reason: 'outside' }
  return { ok: true, path: target }
}

// 在里面吗：相对路径不为空、不跳到上层、也不是别的盘
function within(root, target) {
  const rel = relative(root, target)
  if (!rel || isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

// 真身：拿不到就当没有（不拿真身去核）
function realOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return ''
  }
}
