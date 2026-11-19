// 只读扫出还有产出的旧任务；也保存宠右键「最近的文件夹」的纯菜单模板。
// 任务都在程序数据目录的 tasks\ 下，文件夹名是 14 位数字（年月日时分+两位随机数）。
// 成品留在任务文件夹根目录：根目录下有文件就算这个任务有产出。
// 菜单里写「11-15 任务名」：日期从文件夹名里取，任务名从那条对话记录里取（不看文件夹名）。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { appPaths } from '../paths.mjs'
import { t } from '../copy/copy.mjs'

function outputEntry(fs, dir, name) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true })
    if (!files.some((one) => one.isFile())) return null
    return { dir, out: dir, name, mtime: fs.statSync(dir).mtimeMs }
  } catch {
    return null
  }
}

// 那条对话记录里的标题：文件不在、坏了都当没有
function titleOf(fs, dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(join(dir, '.sidemate', 'conversation.json'), 'utf8'))
    const title = typeof raw?.title === 'string' ? raw.title.trim() : ''
    return title
  } catch {
    return ''
  }
}

// 菜单里写「11-15 任务名」：日期从 14 位数字的文件夹名里取（20261116193042 → 11-15）
function dayOf(name) {
  const match = /^(\d{4})(\d{2})(\d{2})\d{4}\d{2}$/.exec(String(name ?? ''))
  return match ? `${match[2]}-${match[3]}` : ''
}

function taskName(fs, dir, name) {
  const day = dayOf(name)
  const title = titleOf(fs, dir) || name
  return day ? `${day} ${title}` : title
}

// 最多五个任务，按产出目录的修改时间排序。
export function recentTasks(root, fs = { readdirSync, statSync, readFileSync }) {
  const tasksDir = appPaths(root).tasks
  let entries
  try {
    entries = fs.readdirSync(tasksDir, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const one of entries) {
    if (!one.isDirectory()) continue
    const dir = join(tasksDir, one.name)
    const item = outputEntry(fs, dir, taskName(fs, dir, one.name))
    if (item) found.push(item)
  }
  found.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name, 'zh'))
  return found.slice(0, 5)
}

// 回调只从本函数拿到的条目闭包取路径，菜单本身不收外部路径。
export function recentMenuTemplate(folders, tasks, allTasks, actions = {}) {
  const submenu = []
  for (const dir of folders) {
    submenu.push({ label: dir.name, click: () => actions.openFolder?.(dir.dir) })
  }
  if (folders.length && tasks.length) submenu.push({ type: 'separator' })
  for (const task of tasks) {
    submenu.push({ label: task.name, click: () => actions.openTask?.(task.out) })
  }
  if (!folders.length && !tasks.length) submenu.push({ label: t('menu.recentEmpty'), enabled: false })
  if (allTasks) {
    if (submenu.length) submenu.push({ type: 'separator' })
    submenu.push({ label: t('menu.allTasks'), click: () => actions.openAll?.(allTasks) })
  }
  return { label: t('menu.recent'), submenu }
}
