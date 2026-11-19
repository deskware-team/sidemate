// 往任务窗里贴东西：贴一大段文字、贴一张图片。
// 太长或太多的文字不塞进输入框，存成一个 md 文件当材料；图片也存成文件当材料。
// 贴进来的图照原样存成文件，不缩小（dsh 发给模型前自己会缩）。
// 用户还能「改回文字」，把存下来的文件取回去。这个文件只管存和取，不管界面。
// 多长算长、怎么分流这些不算界面的判断在 ./paste-plan.mjs，跟输入框那头共用。

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dataPaths } from '../paths.mjs'
import { t } from '../copy/copy.mjs'

export { LONG_CHARS, LONG_LINES, isLongText } from './paste-plan.mjs'

// 只认这三种图
export const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}

// 存下来的文字长这样：贴的文字-1.md
const TEXT_PREFIX = t('tag.textName')
const IMAGE_PREFIX = t('tag.imageName')

// 名字里的字当正则用时要先转义
function escapeRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 存下来的文字长什么样：改回文字那一步只认这种文件
const TEXT_NAME = new RegExp(`^${escapeRegExp(TEXT_PREFIX)}(\\d+)\\.md$`)

// 名字像不像存下来的长文字：改回文字那一步只认这种文件
export function isSavedTextName(name) {
  return TEXT_NAME.test(String(name ?? ''))
}

// 今天贴在哪儿：程序数据目录 data\paste\YYYY-MM-DD，按本地日期
export function pasteDir(root, at = new Date()) {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return join(dataPaths(root).paste, `${y}-${m}-${d}`)
}

// 找一个还没被占用的编号：贴的文字-1、贴的文字-2……
// 同一类共用一个号：图片不管哪种格式，都顺着往下数
function nextIndex(dir, prefix, exts) {
  for (let n = 1; ; n += 1) {
    const taken = exts.some((ext) => existsSync(join(dir, `${prefix}${n}${ext}`)))
    if (!taken) return n
  }
}

// 存一大段文字：建目录，写原文，一个字都不改
export function saveText(dir, text) {
  const s = String(text ?? '')
  mkdirSync(dir, { recursive: true })
  const n = nextIndex(dir, TEXT_PREFIX, ['.md'])
  const name = `${TEXT_PREFIX}${n}.md`
  const path = join(dir, name)
  writeFileSync(path, s, 'utf8')
  return { path, name, chars: Array.from(s).length }
}

// 图片的文件头对不对：对不上就当这个格式不支持
function headerOk(buffer, mime) {
  if (mime === 'image/png') {
    return buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50
      && buffer[2] === 0x4e && buffer[3] === 0x47
  }
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  return false
}

// 存一张图片：先看类型和大小，再看文件头，对得上才写。
// 图太大也照原样存（缩图的事交给 dsh，桌伴不替它管）。
export function saveImage(dir, buffer, mime) {
  const ext = IMAGE_TYPES[mime]
  if (!ext) return { ok: false, code: 'Si702' }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (!buf.length) return { ok: false, code: 'Si704' }
  if (!headerOk(buf, mime)) return { ok: false, code: 'Si702' }
  mkdirSync(dir, { recursive: true })
  const n = nextIndex(dir, IMAGE_PREFIX, Object.values(IMAGE_TYPES))
  const name = `${IMAGE_PREFIX}${n}${ext}`
  const path = join(dir, name)
  writeFileSync(path, buf)
  return { ok: true, path, name }
}

// 把存下来的文字取回去：读完就删掉这个文件。
// 只认「贴的文字-数字.md」这个名字，别的一律不碰，防止误删别的文件。
export function restoreText(path) {
  const name = String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  if (!TEXT_NAME.test(name)) throw new TypeError('not a saved pasted text file')
  const text = readFileSync(path, 'utf8')
  unlinkSync(path)
  return text
}

