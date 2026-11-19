// 输入框上方那句提醒点名哪几份：图片都算；PDF 只算没有文字层的（扫描件），有字的不算。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { deflateSync } from 'node:zlib'
import { looksScanned, unseenNames } from '../../app/task/unseen.mjs'

const dir = mkdtempSync(join(tmpdir(), 'sidemate-unseen-'))
after(() => rmSync(dir, { recursive: true, force: true }))

// 拼一份 PDF：objects 是一串对象正文，流用 { dict, data } 写
function pdf(name, objects) {
  let body = '%PDF-1.5\n'
  const parts = [Buffer.from(body, 'latin1')]
  objects.forEach((one, i) => {
    if (typeof one === 'string') {
      parts.push(Buffer.from(`${i + 1} 0 obj ${one} endobj\n`, 'latin1'))
    } else {
      parts.push(Buffer.from(`${i + 1} 0 obj << ${one.dict} /Length ${one.data.length} >>\nstream\n`, 'latin1'), one.data, Buffer.from('\nendstream\nendobj\n', 'latin1'))
    }
  })
  parts.push(Buffer.from('trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'))
  body = Buffer.concat(parts)
  const path = join(dir, name)
  writeFileSync(path, body)
  return path
}

const catalog = '<< /Type /Catalog /Pages 2 0 R >>'
const pages = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'

test('扫描件：只有一张压缩的图、内容流里只画图，算看不了', () => {
  const path = pdf('扫描件.pdf', [
    catalog, pages,
    '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    { dict: '/Type /XObject /Subtype /Image /Width 2 /Height 2 /Filter /FlateDecode', data: deflateSync(Buffer.from('BT /F1 12 Tf fake')) },
    { dict: '/Filter /FlateDecode', data: deflateSync(Buffer.from('q 100 0 0 100 0 0 cm /Im1 Do Q')) },
  ])
  assert.equal(looksScanned(path), true)
})

test('有字的 PDF：字体藏在压缩的对象流里、或者只在压缩的内容流里设了字体，都算有字', () => {
  const objStm = pdf('对象流.pdf', [
    '<< /Type /Catalog /Pages 2 0 R >>',
    { dict: '/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', data: deflateSync(Buffer.from('4 0 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')) },
  ])
  assert.equal(looksScanned(objStm), false)
  const content = pdf('内容流.pdf', [
    '<< /Type /Catalog >>',
    { dict: '/Filter /FlateDecode', data: deflateSync(Buffer.from('BT /F1 12 Tf (Hi) Tj ET')) },
  ])
  assert.equal(looksScanned(content), false)
})

test('认不出的一律当有字：打不开、加了密、没有这个文件', () => {
  assert.equal(looksScanned(join(dir, '没有这个.pdf')), false)
  const locked = join(dir, '加密.pdf')
  writeFileSync(locked, '%PDF-1.4\n1 0 obj << /Filter /Standard /V 2 >> endobj\ntrailer << /Encrypt 1 0 R >>\n%%EOF\n')
  assert.equal(looksScanned(locked), false)
  const empty = join(dir, '空的.pdf')
  writeFileSync(empty, '')
  assert.equal(looksScanned(empty), false)
})

test('文件变了再翻一遍：同一个路径从扫描件换成有字的', () => {
  const path = pdf('会变.pdf', [catalog, pages, { dict: '/Filter /FlateDecode', data: deflateSync(Buffer.from('q /Im1 Do Q')) }])
  assert.equal(looksScanned(path), true)
  pdf('会变.pdf', [catalog, pages, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Pad (让文件长度变一变) >>'])
  assert.equal(looksScanned(path), false)
})

test('点名：图片都算，PDF 只算扫描件，别的不算；名字照小签上的', () => {
  const files = [
    { path: 'C:/发票/发票照片1.JPG', name: '发票照片1.JPG' },
    { path: 'C:/发票/截图.webp', name: '截图.webp' },
    { path: 'C:/发票/扫描件.pdf', name: '扫描件.pdf' },
    { path: 'C:/发票/合同.pdf', name: '合同.pdf' },
    { path: 'C:/发票/说明.docx', name: '说明.docx' },
    null,
  ]
  const scanned = (path) => path.endsWith('扫描件.pdf')
  assert.deepEqual(unseenNames(files, { scanned }), ['发票照片1.JPG', '截图.webp', '扫描件.pdf'])
  assert.deepEqual(unseenNames([], { scanned }), [])
  assert.deepEqual(unseenNames(undefined, { scanned }), [])
})

test('现在的模型看得了图：一份都不算，PDF 也不翻；没带图和 PDF 就不问模型', () => {
  let flipped = 0
  const scanned = () => { flipped += 1; return true }
  const files = [{ path: 'C:/发票/发票照片1.jpg', name: '发票照片1.jpg' }, { path: 'C:/发票/扫描件.pdf', name: '扫描件.pdf' }]
  assert.deepEqual(unseenNames(files, { sees: () => true, scanned }), [])
  assert.equal(flipped, 0)
  let asked = 0
  assert.deepEqual(unseenNames([{ path: 'C:/说明.docx', name: '说明.docx' }], { sees: () => { asked += 1; return false }, scanned }), [])
  assert.equal(asked, 0)
})
