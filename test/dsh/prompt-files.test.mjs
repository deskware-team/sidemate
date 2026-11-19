// 用户给的文件怎么交给 dsh：ACP 的资源链接（file:// 的 URI）；看图的模型再带上图片本身。
// 交稿（present）的那几份，桌伴照工具参数里写的路径收下。

import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileBlocks, fileLink, presentedFiles } from '../../app/dsh/prompt-files.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('一个文件一个资源链接：名字是任务文件夹里的相对路径，uri 是本机文件的地址', () => {
  const ws = join(scratch('sidemate-links-'), '202611170000')
  const file = join(ws, 'received', '范本.docx')
  mkdirSync(join(ws, 'received'), { recursive: true })
  writeFileSync(file, '范本')
  const link = fileLink(ws, file)
  assert.equal(link.type, 'resource_link')
  assert.equal(link.name, 'received/范本.docx')
  assert.ok(link.uri.startsWith('file:///'), link.uri)
  assert.ok(link.uri.endsWith('/received/%E8%8C%83%E6%9C%AC.docx') || link.uri.endsWith('/范本.docx'), link.uri)
})

test('内容块：一份文件一个链接；图另带一个图片内容块', () => {
  const ws = scratch('sidemate-blocks-')
  const doc = join(ws, 'received', '材料.txt')
  const pic = join(ws, 'received', '照片.png')
  mkdirSync(join(ws, 'received'), { recursive: true })
  writeFileSync(doc, '正文')
  writeFileSync(pic, 'png')
  const plain = fileBlocks(ws, [{ path: doc }, { path: pic }])
  assert.deepEqual(plain.map((one) => one.type), ['resource_link', 'resource_link'])
  const withImages = fileBlocks(ws, [{ path: doc }, { path: pic }], { images: true })
  assert.deepEqual(withImages.map((one) => one.type), ['resource_link', 'resource_link', 'image'])
  assert.equal(withImages[2].mimeType, 'image/png')
  assert.equal(typeof withImages[2].data, 'string')
  assert.ok(withImages[2].data.length > 0)
})

test('模型交稿的那几份：照工具参数里的路径收下', () => {
  const files = presentedFiles({ files: [{ path: '本周周报.docx', description: '给用户看的' }, { path: '  ' }, { nope: 1 }] })
  assert.deepEqual(files, [{ path: '本周周报.docx', description: '给用户看的' }])
  assert.deepEqual(presentedFiles({}), [])
  assert.deepEqual(presentedFiles(null), [])
})

test('读不出的文件只给链接：图片内容块读不出来就不给', () => {
  const ws = scratch('sidemate-nofile-')
  const blocks = fileBlocks(ws, [{ path: join(ws, '没有.png') }], { images: true })
  assert.deepEqual(blocks.map((one) => one.type), ['resource_link'])
})
