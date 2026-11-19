// 成品留在任务文件夹根目录：模型交稿（present）的那几份是成品，
// 没交稿但根目录里有文件动了也算「文件变动」。过程文件、用户给的副本都不算。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createFileWatcher } from '../../app/dsh/artifacts.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('这一轮写出来的成品算动过的文件', () => {
  const root = scratch('sidemate-mid-')
  const ws = join(root, '任务')
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, '本周周报.docx'), '成品')
  const watcher = createFileWatcher(ws)
  writeFileSync(join(ws, '另一份.docx'), '又一份')
  // 开工前就有的那份不算这一轮动过的
  const changed = watcher.changed()
  assert.deepEqual(changed.map((one) => one.name).sort(), ['另一份.docx'])
  // 再问一次：不重复报
  assert.deepEqual(watcher.changed(), [])
})

test('用户给的副本和过程文件不算动过的文件', () => {
  const root = scratch('sidemate-only-')
  const ws = join(root, '任务')
  mkdirSync(join(ws, 'received'), { recursive: true })
  mkdirSync(join(ws, '.sidemate'), { recursive: true })
  writeFileSync(join(ws, 'received', '范本.docx'), '用户的')
  writeFileSync(join(ws, '.sidemate', '过程.txt'), '过程的')
  const watcher = createFileWatcher(ws)
  writeFileSync(join(ws, 'received', '新来的.docx'), '用户的')
  writeFileSync(join(ws, '.sidemate', '临时.txt'), '过程的')
  writeFileSync(join(ws, '说明.txt'), '说明')
  const changed = watcher.changed()
  assert.deepEqual(changed.map((one) => one.name), ['说明.txt'])
})

test('改过的文件也算动过的（内容变了）', () => {
  const root = scratch('sidemate-edit-')
  const ws = join(root, '任务')
  mkdirSync(ws, { recursive: true })
  const file = join(ws, '周报.docx')
  writeFileSync(file, '第一版')
  const watcher = createFileWatcher(ws)
  writeFileSync(file, '第二版')
  assert.deepEqual(watcher.changed().map((one) => one.name), ['周报.docx'])
})
