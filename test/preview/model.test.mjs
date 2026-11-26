// 预览窗的纯函数：扩展名 → 类型、文件列表分组、每一行的说明、网页的 srcdoc、路径放不放行。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allowedPath,
  cannotNote,
  groupFiles,
  groupMeta,
  hasFiles,
  headNote,
  kindBadge,
  kindName,
  kindOf,
  pickFile,
  previewShown,
  rowNote,
  srcdocFor,
  taskFolderOf,
} from '../../app/preview/model.mjs'

test('扩展名 → 类型', () => {
  assert.equal(kindOf('报告.docx'), 'word')
  assert.equal(kindOf('报告.DOC'), 'word')
  assert.equal(kindOf('讲稿.pptx'), 'ppt')
  assert.equal(kindOf('表.xlsx'), 'excel')
  assert.equal(kindOf('表.csv'), 'excel')
  assert.equal(kindOf('合同.pdf'), 'pdf')
  assert.equal(kindOf('图.png'), 'image')
  assert.equal(kindOf('图.JPEG'), 'image')
  assert.equal(kindOf('网页.html'), 'web')
  assert.equal(kindOf('网页.htm'), 'web')
  assert.equal(kindOf('说明.txt'), 'text')
  assert.equal(kindOf('说明.md'), 'text')
  assert.equal(kindOf('包.zip'), 'zip')
  assert.equal(kindOf('奇怪.xyz'), 'file')
  assert.equal(kindOf('没有扩展名'), 'file')
})

test('类型的名字和类型块上的字', () => {
  assert.equal(kindName('word'), 'Word')
  assert.equal(kindName('ppt'), 'PPT')
  assert.equal(kindName('excel'), 'Excel')
  assert.equal(kindName('pdf'), 'PDF')
  assert.equal(kindName('image'), '图片')
  assert.equal(kindName('web'), '网页')
  assert.equal(kindName('text'), '文本')
  assert.equal(kindName('zip'), '压缩包')
  assert.equal(kindName('file'), '文件')
  assert.equal(kindBadge('word'), 'W')
  assert.equal(kindBadge('ppt'), 'P')
  assert.equal(kindBadge('excel'), 'X')
  assert.equal(kindBadge('pdf'), 'PDF')
  assert.equal(kindBadge('image'), '图')
  assert.equal(kindBadge('web'), 'HTML')
  assert.equal(kindBadge('text'), '文')
  assert.equal(kindBadge('zip'), 'ZIP')
})

test('文件列表分组：成品和材料，. 开头的和没名字的不进名单', () => {
  const got = groupFiles([
    { name: '报告.docx', path: 'C:/t/报告.docx' },
    { name: '材料.pdf', path: 'C:/t/received/材料.pdf', material: true },
    { name: '.hidden', path: 'C:/t/.hidden' },
    { name: '', path: 'C:/t/' },
    { name: '另一张.png', path: 'C:/t/received/另一张.png', material: true },
  ])
  assert.deepEqual(got.done.map((one) => one.name), ['报告.docx'])
  assert.deepEqual(got.material.map((one) => one.name), ['材料.pdf', '另一张.png'])
})

test('每组文件数：各数各的，只有一组时不画那条线', () => {
  const both = groupMeta({ done: [{ name: 'a.docx' }], material: [{ name: 'b.pdf' }, { name: 'c.png' }] })
  assert.equal(both.done, 1)
  assert.equal(both.material, 2)
  assert.equal(both.divider, true)
  const one = groupMeta({ done: [{ name: 'a.docx' }], material: [] })
  assert.equal(one.done, 1)
  assert.equal(one.material, 0)
  assert.equal(one.divider, false)
  const none = groupMeta({ done: [], material: [] })
  assert.equal(none.divider, false)
  assert.equal(groupMeta(undefined).divider, false)
})

test('一组没有文件就整组藏起来：不显示「材料 0」那一组', () => {
  const one = groupMeta({ done: [{ name: 'a.docx' }], material: [] })
  assert.equal(one.showDone, true)
  assert.equal(one.showMaterial, false)
  const both = groupMeta({ done: [{ name: 'a.docx' }], material: [{ name: 'b.pdf' }] })
  assert.equal(both.showDone, true)
  assert.equal(both.showMaterial, true)
  const none = groupMeta({ done: [], material: [] })
  assert.equal(none.showDone, false)
  assert.equal(none.showMaterial, false)
})

test('每一行的说明：成品写类型，材料写「类型 · 你给的」', () => {
  assert.equal(rowNote('word', false), 'Word')
  assert.equal(rowNote('word', true), 'Word · 你给的')
  assert.equal(rowNote('image', true), '图片 · 你给的')
})

test('上条下面那行说明：知道页数写页数，知道表数写表数', () => {
  assert.equal(headNote('pdf'), 'PDF · 只读')
  assert.equal(headNote('pdf', { pages: 3 }), 'PDF · 3 页 · 只读')
  assert.equal(headNote('excel', { sheets: 2 }), 'Excel · 2 张表 · 只读')
  assert.equal(headNote('word', { pages: 0, sheets: 0 }), 'Word · 只读')
})

test('看不了的那一块：按错的种类分三种', () => {
  assert.equal(cannotNote('unsupported'), '可以用电脑上的程序打开')
  assert.equal(cannotNote('failed'), '这份没转出来，可以用电脑上的程序打开')
  assert.equal(cannotNote('unreadable'), '这份没转出来，可以用电脑上的程序打开')
  assert.equal(cannotNote('unavailable'), '预览还没准备好，可以用电脑上的程序打开')
})

test('网页的 srcdoc：最前面加一行 CSP', () => {
  const got = srcdocFor('<p>hi</p>')
  assert.ok(got.startsWith('<meta http-equiv="Content-Security-Policy"'))
  assert.match(got, /default-src 'none'/)
  assert.match(got, /script-src 'unsafe-inline'/)
  assert.match(got, /style-src 'unsafe-inline'/)
  assert.match(got, /img-src data:/)
  assert.match(got, /connect-src 'none'/)
  assert.ok(got.endsWith('<p>hi</p>'))
})

test('任务文件夹：父目录叫 received 的，任务文件夹是它的上一层；否则就是父目录', () => {
  assert.equal(taskFolderOf('C:/tasks/t1/received/材料.pdf'), 'C:/tasks/t1')
  assert.equal(taskFolderOf('C:/tasks/t1/报告.docx'), 'C:/tasks/t1')
  assert.equal(taskFolderOf('C:\\tasks\\t1\\received\\材料.pdf'), 'C:/tasks/t1')
  assert.equal(taskFolderOf('报告.docx'), '')
})

test('有没有东西可看：成品或材料有一份就算', () => {
  assert.equal(hasFiles({ done: [{ name: 'a.docx' }], material: [] }), true)
  assert.equal(hasFiles({ done: [], material: [{ name: 'b.pdf' }] }), true)
  assert.equal(hasFiles({ done: [], material: [] }), false)
  assert.equal(hasFiles(undefined), false)
})

test('挑一份看：成品里最新的那份，没有成品就第一份材料', () => {
  const groups = {
    done: [
      { name: '老.docx', mtime: 100 },
      { name: '新.docx', mtime: 300 },
      { name: '中的.docx', mtime: 200 },
    ],
    material: [{ name: '材料.pdf', mtime: 50 }],
  }
  assert.equal(pickFile(groups).name, '新.docx')
  assert.equal(pickFile({ done: [], material: groups.material }).name, '材料.pdf')
  assert.equal(pickFile({ done: [], material: [] }), null)
  assert.equal(pickFile(undefined), null)
})

test('顶栏「预览」按钮：这次对话有成品或材料才显示', () => {
  assert.equal(previewShown({ path: 'C:/t', count: 1 }), true)
  assert.equal(previewShown({ path: 'C:/t', count: 0 }), false)
  assert.equal(previewShown({ path: '', count: 0 }), false)
  assert.equal(previewShown(undefined), false)
})

test('路径只放行任务文件夹根上的文件和 received 里的文件', () => {
  const folder = 'C:/tasks/t1'
  assert.equal(allowedPath(folder, 'C:/tasks/t1/报告.docx'), true)
  assert.equal(allowedPath(folder, 'C:/tasks/t1/received/材料.pdf'), true)
  assert.equal(allowedPath(folder, 'C:/tasks/t1/sub/别的.pdf'), false)
  assert.equal(allowedPath(folder, 'C:/tasks/t1/received/sub/材料.pdf'), false)
  assert.equal(allowedPath(folder, 'C:/tasks/t2/报告.docx'), false)
  assert.equal(allowedPath(folder, 'C:/tasks/t1/../t2/报告.docx'), false)
  assert.equal(allowedPath(folder, ''), false)
  assert.equal(allowedPath('', 'C:/tasks/t1/报告.docx'), false)
})
