// 顶栏右上那个「预览」按钮：
// - 这次对话有成品或材料才显示（主进程数文件，页面只管显示）
// - 点了打开预览窗（主进程挑最新的一份成品；没有成品就看第一份材料）
// 页面那几行是脚本里的（app/task/task.js），这里照源码断言；主进程那几行是 app/task/run.mjs 和 app/task/shell.mjs。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTask } from '../../app/task/state.mjs'
import { toTaskView } from '../../app/task/view.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')
const run = readFileSync(join(here, '../../app/task/run.mjs'), 'utf8')
const shell = readFileSync(join(here, '../../app/task/shell.mjs'), 'utf8')

test('视图里带着「预览」按钮要用的两样：文件夹和文件数', () => {
  const state = { ...createTask(), place: { kind: 'files', dir: 'C:/tasks/t1' } }
  const withFiles = toTaskView(state, { preview: { path: 'C:/tasks/t1', count: 2 } })
  assert.deepEqual(withFiles.top.preview, { path: 'C:/tasks/t1', count: 2 })
  // 主进程没给（还没开工、没数到文件）：按钮不显示
  const none = toTaskView(state)
  assert.deepEqual(none.top.preview, { path: '', count: 0 })
})

test('页面：有成品或材料才露出这个钮，点了发 preview-folder', () => {
  assert.match(page, /els\.previewbtn\.hidden = !previewShown\(preview\)/)
  assert.match(page, /els\.previewbtn\.title = t\('output\.preview'\)/)
  assert.match(page, /act\(\{ type: 'preview-folder', path: preview\.path \}\)/)
  // 原来的「打开文件夹」那个钮没有了
  assert.equal(/openfolder/.test(page), false)
})

test('主进程：preview-folder 打开预览窗，路径得是这一条对话的文件夹', () => {
  assert.match(run, /type === 'preview-folder'/)
  assert.match(run, /deps\.openPreviewFolder\?\.\(path\)/)
  assert.match(shell, /function openPreviewFolder\(path\)/)
  assert.match(shell, /openPreviewFolderWindow\(path\)/)
  // 打开文件夹这件事以后走预览窗的「在文件夹里显示」和成品卡右键
  assert.equal(/type: 'open-folder'/.test(page), false)
})
