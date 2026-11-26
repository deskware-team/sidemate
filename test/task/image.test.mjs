// 对话里的图片：地址分三类（工作区里的本地文件 / https 网址 / 别的写法）。
// 本地的由主进程核一遍：得在工作区里、文件得在、还得是图片扩展名。

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageKind, markdownBlocks } from '../../app/task/markdown.mjs'
import { imagePath } from '../../app/task/image-path.mjs'

const roots = []
test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 上删不掉就留给系统清 */ } }
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-img-'))
  roots.push(dir)
  return dir
}

const segsOf = (text) => markdownBlocks(text).flatMap((one) => one.segs ?? [])

test('图片地址分三类：相对、绝对是本地文件，https 是网址，别的写法不显示', () => {
  assert.equal(imageKind('图.png'), 'local')
  assert.equal(imageKind('子目录/图.png'), 'local')
  assert.equal(imageKind('C:\\工作区\\图.png'), 'local')
  assert.equal(imageKind('C:/工作区/图.png'), 'local')
  assert.equal(imageKind('\\\\服务器\\共享\\图.png'), 'local')
  assert.equal(imageKind('https://example.com/a.png'), 'https')
  assert.equal(imageKind('HTTPS://example.com/a.png'), 'https')
  assert.equal(imageKind('http://example.com/a.png'), 'other')
  assert.equal(imageKind('data:image/png;base64,AAAA'), 'other')
  assert.equal(imageKind('javascript:alert(1)'), 'other')
  assert.equal(imageKind('file:///C:/秘密.png'), 'other')
  assert.equal(imageKind(''), 'other')
})

test('图片认出来了：说明是 alt，地址是地址', () => {
  const all = segsOf('看这张 ![门店照片](图.png) 就知道了')
  const image = all.find((one) => one.image)
  assert.ok(image, '没认出图片')
  assert.equal(image.text, '门店照片')
  assert.equal(image.image, '图.png')
  // https 的也认
  const web = segsOf('![远图](https://example.com/a.png)').find((one) => one.image)
  assert.equal(web.image, 'https://example.com/a.png')
})

test('别的写法不显示：http、data:、javascript: 都不出图片', () => {
  for (const url of ['http://example.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
    const all = segsOf(`![说明](${url})`)
    assert.equal(all.some((one) => one.image), false, url)
  }
  // http 和 data: 认得出是图片写法，整段不显示
  for (const url of ['http://example.com/a.png', 'data:image/png;base64,AAAA']) {
    assert.equal(segsOf(`![说明](${url})`).length, 0, url)
  }
  // 代码里的不是图片
  const code = segsOf('`![说明](图.png)`')
  assert.equal(code.some((one) => one.image), false)
})

test('主进程核路径：工作区里的图片放行，别的都不认', () => {
  const root = tempDir()
  const ws = join(root, '任务', '20261126-1')
  mkdirSync(ws, { recursive: true })
  const inside = join(ws, '门店照片.png')
  writeFileSync(inside, 'png')
  writeFileSync(join(ws, '说明.txt'), 'txt')
  const outside = join(root, '外面.png')
  writeFileSync(outside, 'png')

  // 相对路径：按工作区算
  const rel = imagePath(ws, '门店照片.png')
  assert.equal(rel.ok, true)
  assert.equal(rel.path, inside)
  assert.equal(rel.name, '门店照片.png')
  // 绝对路径：在工作区里也放行
  assert.equal(imagePath(ws, inside).ok, true)
  // 工作区外的、跳出去的、没这个文件的、不是图片的：都不认
  assert.equal(imagePath(ws, outside).ok, false)
  assert.equal(imagePath(ws, join(ws, '..', '..', '外面.png')).reason, 'outside')
  assert.equal(imagePath(ws, '没这个文件.png').reason, 'missing')
  assert.equal(imagePath(ws, '说明.txt').reason, 'type')
  assert.equal(imagePath('', '门店照片.png').reason, 'no-workspace')
})
