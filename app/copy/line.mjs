// 错误码那一行：前一句 · Si 码 错误，原文
//
// 这一份是唯一的：截 80 个字、拼那一行、灰字那截，都只在这里写。
// 主进程和页面都能引（不引 node: 也不引 electron）。
//
// 前一句从哪儿来：桌伴那边的话在 errors.mjs 的 stops 里；设置这边自己的说法放在
// ui-settings.mjs（键名就是那边的键）。新加的码在 errors.mjs 里自带一句停下来的话。

import { entry, t } from './copy.mjs'

// 原文最多 80 个字（按字算，不切坏）
export const RAW_MAX = 80

// 两种码：桌伴自己的 Si 码（Si429）和模型请求的 dsh 码（RATE_LIMIT 429）。
// 显示的样子不一样：Si 码那行中间有「错误」两个字，dsh 码那行没有。
const SI_CODE = /^Si\d{3}$/

// 原文：一行，截到 80 个字（按字算，不切坏）；截了的末尾补一个「…」，看得出后面还有
export function rawText(raw) {
  const one = String(raw ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(one)
  return chars.length > RAW_MAX ? `${chars.slice(0, RAW_MAX).join('')}…` : one
}

// 前一句的键：给了就用给的（设置这边的说法），没给就用这个码在 errors.mjs 里那一句
export function stopKeyOf(code, own) {
  if (own) return own
  const one = entry(`codes.${code}`)
  return `stops.${one.stop}`
}

// 整行：前一句 · Si 码 错误，原文。没有原文（桌伴自己查出来的错）只到「错误」
export function errorLine(stopKey, code, raw = '', vars = {}) {
  const stop = t(stopKey, vars)
  return errorLineText(stop, code, raw)
}

// 跟前一句一样，只是前一句已经拼好了（比如带上了网址），不再去查表
export function errorLineText(stop, code, raw = '') {
  const one = rawText(raw)
  // 模型请求的错：dsh 的码（码 + HTTP 状态），不是 Si 码
  if (!SI_CODE.test(String(code ?? ''))) {
    return t(one ? 'dshLine' : 'dshLineShort', { stop: String(stop ?? ''), code, raw: one })
  }
  return t(one ? 'line.text' : 'line.short', { stop: String(stop ?? ''), code, raw: one })
}

// 停工那句后面那截灰字：「· Si429 错误，原文」；没有原文（桌伴自己的错）只到「错误」。
// 模型请求的错是 dsh 的码：「· RATE_LIMIT 429，原文」。
// 跟停工那句之间的空白由页面的样式给
export function codeTail(code, raw = '') {
  if (!code) return ''
  const one = rawText(raw)
  if (!SI_CODE.test(String(code ?? ''))) {
    return t(one ? 'dshLine' : 'dshLineShort', { stop: '', code, raw: one }).trimStart()
  }
  return t(one ? 'line.text' : 'line.short', { stop: '', code, raw: one }).trimStart()
}
