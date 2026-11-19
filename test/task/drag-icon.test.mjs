// 产出卡拖出去时跟着鼠标走的小图：用这种文件的系统图标，按扩展名记着；问不到用兜底那张。
// 拖出去还没离开过任务窗时，任务窗不接这份文件（页面那边的规矩，照源码核）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createDragIcons } from '../../app/task/drag-icon.mjs'

const image = (name) => ({ name, isEmpty: () => false })

test('按下卡片时先问好图标，拖的时候用系统那张；同一种文件只问一次', async () => {
  const asked = []
  const icons = createDragIcons({
    getFileIcon: async (path) => { asked.push(path); return image(`sys${path.slice(path.lastIndexOf('.'))}`) },
    fallback: () => image('sidemate'),
  })
  assert.equal(icons.get('C:/t/周报.docx').name, 'sidemate', '还没问好：用兜底')
  await icons.warm('C:/t/周报.docx')
  assert.equal(icons.get('C:/t/另一份.DOCX').name, 'sys.docx', '同一种文件（不分大小写）用问好的那张')
  await icons.warm('C:/t/另一份.docx')
  assert.equal(asked.length, 1, '同一种文件只问一次')
  assert.equal(icons.get('C:/t/表.xlsx').name, 'sidemate')
})

test('问不到、问出来是空图：照旧用兜底，不炸', async () => {
  const icons = createDragIcons({
    getFileIcon: async (path) => (path.endsWith('.md') ? { isEmpty: () => true } : Promise.reject(new Error('no icon'))),
    fallback: () => image('sidemate'),
  })
  assert.equal(await icons.warm('C:/t/a.md'), null)
  assert.equal(await icons.warm('C:/t/b.pdf'), null)
  assert.equal(icons.get('C:/t/a.md').name, 'sidemate')
})

test('从自己的产出卡拖出去：没离开过任务窗就不接，出去再回来才接；拖完了主进程说一声', () => {
  const page = readFileSync(new URL('../../app/task/task.js', import.meta.url), 'utf8')
  assert.match(page, /outDrag = \{ left: false \}/)
  assert.match(page, /inOwnWindow\(\)\) return/)
  assert.match(page, /if \(outDrag\) outDrag\.left = true/)
  assert.match(page, /onDragEnd\(\(\) => \{ outDrag = null; hideDrop\(\) \}\)/)
  const shell = readFileSync(new URL('../../app/task/shell.mjs', import.meta.url), 'utf8')
  assert.match(shell, /startDrag\(\{ file: hit\.path, icon: dragIcons\.get\(hit\.path\) \}\)/)
  assert.match(shell, /webContents\.send\('task:drag-end'\)/)
})
