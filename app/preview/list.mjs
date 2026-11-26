// 预览窗左栏那两组的文件清单：成品（任务文件夹根上）和材料（received 里的）。
// 主进程用（预览窗和任务窗都从这里数文件）；页面不引这个文件（它要 node:fs）。

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { groupFiles, kindOf } from './model.mjs'

// 材料放的那个子文件夹（跟 model.mjs 的 taskFolderOf 一套）
const RECEIVED = 'received'

// 一个文件夹里的文件（不含目录，不含 . 开头的）
export function filesIn(folder) {
  let names = []
  try { names = readdirSync(folder) } catch { return [] }
  const out = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(folder, name)
    try {
      const st = statSync(full)
      if (!st.isFile()) continue
      out.push({ name, path: full, mtime: st.mtimeMs || 0 })
    } catch {
      continue
    }
  }
  return out
}

// 这个文件夹里的成品和材料（跟左栏同一套规矩）
export function listFolder(folder) {
  if (!folder) return { done: [], material: [] }
  const entries = [...filesIn(folder), ...filesIn(join(folder, RECEIVED)).map((one) => ({ ...one, material: true }))]
  const groups = groupFiles(entries)
  const shape = (one) => ({ name: one.name, path: one.path, kind: kindOf(one.name), material: one.material === true, mtime: one.mtime || 0 })
  return { done: groups.done.map(shape), material: groups.material.map(shape) }
}
