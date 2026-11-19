// 拖进来的东西：正好一个文件夹就装文件夹，否则只留普通文件。
// 纯算：给什么路径，得出「文件夹」还是「哪些文件」。文件后缀、是不是文件夹也在这儿。

import { lstatSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

// 文件后缀（小写，带点）：.docx / .pdf
export const extOf = (path) => {
  const name = basename(String(path))
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

// 是文件还是文件夹；链接和不存在的一律不算
export const kindOf = (path) => {
  try {
    const st = lstatSync(path)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : ''
  } catch {
    return ''
  }
}

// 一个文件夹里有哪些认得的文件（按认得的扩展名筛，按名字排）
export function folderFiles(dir, extensions = []) {
  const ok = new Set(Array.isArray(extensions) ? extensions : [])
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.') && !name.startsWith('~') && ok.has(extOf(name)))
      .sort((a, b) => a.localeCompare(b, 'zh'))
      .map((name) => join(dir, name))
      .filter((path) => kindOf(path) === 'file')
  } catch {
    return []
  }
}

// 拖放的总口：正好一个文件夹就装文件夹，否则只留普通文件。
// 返回 { folder, files }（是文件夹）或 { files }（是文件）；一个也不是就返回 null。
export function dropFiles(paths, extensions = []) {
  const list = (Array.isArray(paths) ? paths : []).filter((path) => typeof path === 'string' && path)
  if (list.length === 1 && kindOf(list[0]) === 'dir') {
    const folder = list[0]
    return { folder, files: folderFiles(folder, extensions) }
  }
  const files = list.filter((path) => kindOf(path) === 'file')
  return files.length ? { files } : null
}
