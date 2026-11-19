// 产出卡上的两个钮（另存为、打开文件夹）和拖出去：
// - 卡上只有这两个钮，没有「打开文件」
// - 按住卡拖：页面把路径发给主进程，主进程起系统拖拽（路径得在任务文件夹里）
// - 另存为：系统另存为对话框，拷一份到用户选的地方；打开文件夹：在资源管理器里选中这份文件
// 页面那几行是脚本里的（app/task/task.js），这里照源码断言；主进程那几行是 app/task/shell.mjs。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')
const preload = readFileSync(join(here, '../../app/task/preload.cjs'), 'utf8')
const shell = readFileSync(join(here, '../../app/task/shell.mjs'), 'utf8')

test('卡上只有「另存为」和「打开文件夹」两个钮', () => {
  assert.match(page, /buttonEl\(view\.labels\.saveAs, \{ type: 'save-as', path: card\.path \}, 'save-as'\)/)
  assert.match(page, /buttonEl\(view\.labels\.reveal, \{ type: 'reveal', path: card\.path \}, 'reveal'\)/)
  // 没有「打开文件」那个钮
  assert.equal(/type: 'open', path: card\.path/.test(page), false)
})

test('卡能拖出去：按住拖就把路径发给主进程', () => {
  assert.match(page, /el\.draggable = true/)
  assert.match(page, /addEventListener\('dragstart',[\s\S]{0,200}?bridge\.dragOut\(card\.path\)/)
  assert.match(preload, /dragOut: \(path\) => ipcRenderer\.send\('task:drag-out', \{ path \}\)/)
})

test('主进程起系统拖拽：只放任务文件夹里的文件', () => {
  assert.match(shell, /ipcMain\.on\('task:drag-out'/)
  assert.match(shell, /openablePath\(workspace, String\(payload\?\.path \?\? ''\)\)/)
  assert.match(shell, /win\.webContents\.startDrag\(\{ file: hit\.path/)
})

test('另存为走系统另存为对话框，打开文件夹是在资源管理器里选中这份文件', () => {
  assert.match(shell, /dialog\.showSaveDialog\(win, \{ title: t\('output\.saveAs'\)/)
  assert.match(shell, /copyFileSync\(path, done\.filePath\)/)
  assert.match(shell, /if \(reveal\) return void shell\.showItemInFolder\(path\)/)
})
