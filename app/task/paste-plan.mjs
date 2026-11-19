// 贴进任务窗的东西怎么分流：纯逻辑，不算界面、不碰文件，输入框那头直接用，单测也直接测。
// 分流的规矩：剪贴板里有别的文件（资源管理器复制的）就当拖进来的材料；有图片又没带字就存图；
// 有字就看长短：超过 2000 字或 50 行存成文件，短字照旧贴进输入框。

import { t } from '../copy/copy.mjs'

export const LONG_CHARS = 2000
export const LONG_LINES = 50

// 数一篇文章有几行：按 \r\n 或 \n 断
function countLines(text) {
  return String(text).split(/\r?\n/).length
}

// 文字算不算太长：按字数（一个字算一个，emoji 也算一个）或者行数算
export function isLongText(text) {
  const s = String(text ?? '')
  if (Array.from(s).length > LONG_CHARS) return true
  return countLines(s) > LONG_LINES
}

// 分流：images 是图片张数，files 是别的文件的个数，text 是纯文字（没字给空串）。
// 返回 'files'（当材料拖进来）· 'images'（存成贴的图）· 'longtext'（存成贴的文字）·
// 'text'（短字，照旧贴进输入框）· 'none'（剪贴板里没东西）。
// 同一格里既有字又有图时按字走（表格软件复制的格子常带一份图的 rendition，用户要的是字）。
export function pastePlan({ images = 0, files = 0, text = '' } = {}) {
  const count = (n) => Number(n) > 0
  const hasText = typeof text === 'string' && text !== ''
  if (count(files)) return 'files'
  if (count(images) && !hasText) return 'images'
  if (hasText && isLongText(text)) return 'longtext'
  if (hasText) return 'text'
  if (count(images)) return 'images'
  return 'none'
}

// 字数带千分位：3280 → 「3,280 字」，给长文字小签的第二行用
export function charsText(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  return t('tag.chars', { count: n.toLocaleString('en-US') })
}
