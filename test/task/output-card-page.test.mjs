// 产出卡上的两个钮（预览、另存为）、右键菜单和拖出去：
// - 卡上只有「预览」「另存为」两个钮，没有「打开文件」
// - 右键卡上：弹系统原生菜单（主进程弹，页面只发路径）
// - 按住卡拖：页面把路径发给主进程，主进程起系统拖拽（路径得在任务文件夹里）
// - 另存为：系统另存为对话框，拷一份到用户选的地方
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

test('卡上只有「预览」和「另存为」两个钮', () => {
  assert.match(page, /buttonEl\(t\('output\.preview'\), \{ type: 'preview', path: card\.path \}, 'preview'\)/)
  assert.match(page, /buttonEl\(view\.labels\.saveAs, \{ type: 'save-as', path: card\.path \}, 'save-as'\)/)
  // 没有「打开文件」那个钮，也没有卡上的「在文件夹里显示」
  assert.equal(/type: 'open', path: card\.path/.test(page), false)
  assert.equal(/type: 'reveal', path: card\.path/.test(page), false)
})

test('右键卡上：页面发路径，主进程弹系统原生菜单', () => {
  assert.match(page, /addEventListener\('contextmenu'[\s\S]{0,200}?preventDefault\(\)/)
  assert.match(page, /bridge\.cardMenu\(card\.path\)/)
  assert.match(preload, /cardMenu: \(path\) => ipcRenderer\.send\('task:card-menu', \{ path \}\)/)
  assert.match(shell, /ipcMain\.on\('task:card-menu'/)
  assert.match(shell, /function openPreview\(path\)/)
  assert.match(shell, /Menu\.buildFromTemplate\(template\)\.popup\(\{ window: win \}\)/)
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

test('另存为走系统另存为对话框，在文件夹里显示是在资源管理器里选中这份文件', () => {
  assert.match(shell, /dialog\.showSaveDialog\(win, \{ title: t\('output\.saveAs'\)/)
  assert.match(shell, /copyFileSync\(path, done\.filePath\)/)
  assert.match(shell, /if \(reveal\) return void shell\.showItemInFolder\(path\)/)
})
