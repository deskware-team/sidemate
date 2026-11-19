// 往任务窗贴东西：太长的文字存成文件、图片存成文件、能改回文字。

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  IMAGE_TYPES,
  LONG_CHARS,
  LONG_LINES,
  isLongText,
  isSavedTextName,
  pasteDir,
  restoreText,
  saveImage,
  saveText,
} from '../../app/task/paste.mjs'
import { charsText, pastePlan } from '../../app/task/paste-plan.mjs'

// 每次测试一个自己的临时目录，测完删掉
function tempDir() {
  return mkdtempSync(join(tmpdir(), 'paste-test-'))
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true })
}

// 三个格式各一份最小的真文件头
const PNG_BUF = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('剩下的内容'),
])
const JPG_BUF = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('剩下的内容'),
])
const WEBP_BUF = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('剩下的内容'),
])

// 一张 PNG 的文件头：写清宽高（假的缩图办法靠这个认尺寸）
function pngHeader(width, height) {
  const buf = Buffer.alloc(24)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf.write('IHDR', 12, 4, 'ascii')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

// 假的缩图办法：跟主进程那头一样，太大就等比例缩到长边 maxEdge 再交回来
function pngSize(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('刚好的字数不算长，多一个就算长', () => {
  const cn = '字'.repeat(LONG_CHARS)
  assert.equal(isLongText(cn), false, '2000 个中文字不算长')
  assert.equal(isLongText(cn + '字'), true, '2001 个中文字算长')

  // emoji 也按字算，不按字节算
  const emo = '😀'.repeat(LONG_CHARS)
  assert.equal(isLongText(emo), false, '2000 个 emoji 不算长')
  assert.equal(isLongText(emo + '😀'), true, '2001 个 emoji 算长')
})

test('行数超过 50 行算长', () => {
  const fifty = Array.from({ length: LONG_LINES }, (_, i) => `第${i}行`).join('\n')
  assert.equal(isLongText(fifty), false, '50 行不算长')
  assert.equal(isLongText(fifty + '\n第51行'), true, '51 行算长')
  assert.equal(isLongText('一行\r\n二行'), false, '短文章不算长')
})

test('贴的东西放在程序数据目录的 data/paste/日期 里', () => {
  const dir = pasteDir('C:\\工作', new Date(2026, 10, 11))
  assert.equal(dir, join('C:\\工作', 'data', 'paste', '2026-11-11'))
  const auto = pasteDir('C:\\工作', new Date(2026, 0, 5))
  assert.equal(auto, join('C:\\工作', 'data', 'paste', '2026-01-05'))
})

test('连着存两次，编号是 1 和 2；删掉 1 以后又是 1', () => {
  const dir = tempDir()
  try {
    const one = saveText(dir, '第一段')
    const two = saveText(dir, '第二段')
    assert.equal(one.name, '贴的文字-1.md')
    assert.equal(two.name, '贴的文字-2.md')
    assert.equal(one.chars, 3)

    unlinkSync(one.path)
    const again = saveText(dir, '第三段')
    assert.equal(again.name, '贴的文字-1.md', '空出来的编号又用上了')
  } finally {
    cleanup(dir)
  }
})

test('存进去的内容和原文一字不差', () => {
  const dir = tempDir()
  try {
    const text = '第一行\r\n第二行\n第三行\t尾'
    const saved = saveText(dir, text)
    assert.equal(readFileSync(saved.path, 'utf8'), text, '写进去的内容变了')
    assert.equal(saved.chars, Array.from(text).length)
  } finally {
    cleanup(dir)
  }
})

test('三种图片都能存，扩展名对得上', () => {
  const dir = tempDir()
  try {
    const png = saveImage(dir, PNG_BUF, 'image/png')
    assert.equal(png.ok, true)
    assert.equal(png.name, '贴的图-1.png')
    assert.equal(png.path, join(dir, '贴的图-1.png'))

    const jpg = saveImage(dir, JPG_BUF, 'image/jpeg')
    assert.equal(jpg.ok, true)
    assert.equal(jpg.name, '贴的图-2.jpg')

    const webp = saveImage(dir, WEBP_BUF, 'image/webp')
    assert.equal(webp.ok, true)
    assert.equal(webp.name, '贴的图-3.webp')

    assert.equal(readFileSync(png.path).length, PNG_BUF.length, '图片内容不对')
  } finally {
    cleanup(dir)
  }
})

test('说是图片但内容不对、格式不支持的、空的，都不收', () => {
  const dir = tempDir()
  try {
    const fake = saveImage(dir, Buffer.from('这其实是文字', 'utf8'), 'image/png')
    assert.equal(fake.ok, false)
    assert.equal(fake.code, 'Si702')

    const gif = saveImage(dir, Buffer.from('GIF89a'), 'image/gif')
    assert.equal(gif.ok, false)
    assert.equal(gif.code, 'Si702')

    const empty = saveImage(dir, Buffer.alloc(0), 'image/png')
    assert.equal(empty.ok, false)
    assert.equal(empty.code, 'Si704')

    assert.deepEqual(readdirSync(dir), [], '不该存下任何文件')
  } finally {
    cleanup(dir)
  }
})

// 图照原样存：缩图的事交给 dsh，桌伴不替它管
test('图太大也照原样存，不报错、不缩小', () => {
  const dir = tempDir()
  try {
    const big = pngHeader(4000, 3000)
    const saved = saveImage(dir, big, 'image/png')
    assert.equal(saved.ok, true, '太大了不该报错')
    assert.equal(saved.name, '贴的图-1.png')
    assert.deepEqual(readFileSync(saved.path), big, '原样存：字节一个都不改')
  } finally {
    cleanup(dir)
  }
})

test('能改回文字：读出原文，文件也删了', () => {
  const dir = tempDir()
  try {
    const text = '贴进来的一大段\n第二行'
    const saved = saveText(dir, text)
    const back = restoreText(saved.path)
    assert.equal(back, text)
    assert.equal(existsSync(saved.path), false, '文件还在')
  } finally {
    cleanup(dir)
  }
})

test('不是贴出来的文字文件，restoreText 不动它', () => {
  const dir = tempDir()
  try {
    const other = join(dir, '别的.md')
    writeFileSync(other, '不动我', 'utf8')
    assert.throws(() => restoreText(other), TypeError)
    assert.equal(existsSync(other), true, '文件被误删了')
  } finally {
    cleanup(dir)
  }
})

test('图片类型表只有三种', () => {
  assert.deepEqual(IMAGE_TYPES, {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  })
})

test('粘贴分流：文件当材料，图存图，长字存文件，短字照旧', () => {
  // 资源管理器复制的文件：跟拖进来一样当材料，优先级最高
  assert.equal(pastePlan({ files: 2, images: 1, text: '一句话' }), 'files')
  assert.equal(pastePlan({ files: 1 }), 'files')
  // 剪贴板里是图片（截图）：存成贴的图
  assert.equal(pastePlan({ images: 1 }), 'images')
  assert.equal(pastePlan({ images: 3 }), 'images', '一次贴多张也是存图')
  // 长文字：存成文件，不往输入框里塞
  assert.equal(pastePlan({ text: '字'.repeat(LONG_CHARS + 1) }), 'longtext')
  assert.equal(pastePlan({ text: `${'行\n'.repeat(LONG_LINES + 1)}尾` }), 'longtext')
  // 普通短字：照旧贴进输入框
  assert.equal(pastePlan({ text: '一句话' }), 'text')
  assert.equal(pastePlan({ text: '字'.repeat(LONG_CHARS) }), 'text', '刚好 2000 字不算长')
  // 同一格既有字又有图：按字走（表格软件复制的格子常带一份图的 rendition）
  assert.equal(pastePlan({ images: 1, text: '一句话' }), 'text')
  assert.equal(pastePlan({ images: 1, text: '字'.repeat(LONG_CHARS + 1) }), 'longtext')
  // 什么都没有
  assert.equal(pastePlan({}), 'none')
  assert.equal(pastePlan({ text: '' }), 'none')
})

test('字数带千分位：给长文字小签的第二行用', () => {
  assert.equal(charsText(3280), '3,280 字')
  assert.equal(charsText(999), '999 字')
  assert.equal(charsText(1234567), '1,234,567 字')
  assert.equal(charsText(0), '0 字')
})

test('存下来的长文字认得出名字：改回文字只认这种文件', () => {
  assert.equal(isSavedTextName('贴的文字-1.md'), true)
  assert.equal(isSavedTextName('贴的文字-12.md'), true)
  assert.equal(isSavedTextName('贴的图-1.png'), false)
  assert.equal(isSavedTextName('别的.md'), false)
  assert.equal(isSavedTextName('贴的文字-1.md.bak'), false)
})
