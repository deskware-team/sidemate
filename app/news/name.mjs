// 主题名从那句话自动总结出来：先用本地规则立刻给一个，后台再问模型要个更好的。
// 纯函数，不引 node：主进程和页面都能用。

import { t } from '../copy/copy.mjs'

// 名字里不能有的字符（跟旧的主题名一个规矩）
const BAD_CHARS = /[/\\:*?"<>|]/g
// 同一个规矩，用来一个一个挑（不能带 g 标志，test 会记着上一次的位置）
const BAD_ONE = /[/\\:*?"<>|]/

// 开头这几个词不要：字在 app/copy/ui-settings.mjs（newsPage.nameLead）
function leadWords() {
  return t('newsPage.nameLead').split(/\s+/).filter(Boolean)
}

// 结尾这几个词不要：字在 app/copy/ui-settings.mjs（newsPage.nameTail）
function tailWords() {
  return t('newsPage.nameTail').split(/\s+/).filter(Boolean)
}

// 本地规则起一个名字：先取第一个逗号、句号、分号前那段，再去掉开头结尾那几个词和「的」，
// 最后截到 8 个字。空话给空串。
export function localName(want) {
  let text = String(want ?? '').trim()
  if (!text) return ''
  text = text.split(/[，,。；;]/)[0].trim()
  let changed = true
  while (changed) {
    changed = false
    for (const word of leadWords()) {
      if (text.length > word.length && text.startsWith(word)) {
        text = text.slice(word.length).trim()
        changed = true
        break
      }
    }
  }
  changed = true
  while (changed) {
    changed = false
    for (const word of tailWords()) {
      if (text.length > word.length && text.endsWith(word)) {
        text = text.slice(0, -word.length).trim()
        changed = true
        break
      }
    }
  }
  text = text.replace(/的/g, '').replace(BAD_CHARS, '').trim()
  // 还是超过 8 个字：先去空格，再去「和、与、及、顿号」这些连接的字，最后才硬截
  if (Array.from(text).length > 8) text = text.replace(/\s+/g, '')
  if (Array.from(text).length > 8) text = text.replace(/[和与及、]/g, '')
  return Array.from(text).slice(0, 8).join('')
}

// 去掉不能当路径用的字符（不 trim：打字的时候两头的空格留着）
export function stripBadChars(text) {
  return Array.from(String(text ?? '')).filter((one) => !BAD_ONE.test(one)).join('')
}

// 用户自己改的名字：去掉不能当路径用的字符，最多 8 个字（中文一个字算一个）
export function clipUserName(text) {
  return Array.from(stripBadChars(text)).slice(0, 8).join('')
}

// 用户自己改的名字存下来的样子：两头空格去掉，再收拾干净
export function cleanUserName(text) {
  return clipUserName(String(text ?? '').trim())
}

// 模型整段回话里取名字：它有时先客套一句（「好的，我直接给你提炼一个……」）再给名字，
// 所以只认最后一行不空的，再收拾干净。
export function nameFromReply(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((one) => one.trim()).filter(Boolean)
  return cleanName(lines[lines.length - 1] || '')
}

// 模型回来的那句话收拾干净：标点、引号、空格都不要，截到 8 个字。
// 少于 2 个字给空串（那种留着本地规则那个）。
// 超过 8 个字的不硬截（「新能源车和动力电池」截成「新能源车和动力电」不像话）：先去掉「的、和、与、及」
// 这几个连接的字，还超就当没给，留着本地规则那个。
export function cleanName(text) {
  let out = String(text ?? '')
    .replace(/[\p{P}\p{S}\s]/gu, '')
    .trim()
  if (Array.from(out).length > 8) out = out.replace(/[的和与及]/g, '')
  const size = Array.from(out).length
  return size >= 2 && size <= 8 ? out : ''
}
