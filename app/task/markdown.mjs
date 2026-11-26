// 回话里的 Markdown：标题、段落、列表、表格、引用、代码块、分隔线，加上行内的粗体、代码和链接。
// 纯函数：进一段字，出一批块；页面那边只管建节点，不碰 HTML。
// 认不出来的（斜体）当普通字，不解析；链接只认 http(s)，别的协议整串当普通字。
// 图片（![说明](地址)）和公式（$...$、$$...$$）也在这里认：图片分成本地文件和 https 网址两类，
// 公式切成块（单独一段的居中显示）和行内两样。

import { inlineSegments } from './inline.mjs'
import { t } from '../copy/copy.mjs'

const HEAD = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const FENCE = /^\s*```/
// 带语言标的代码块：```chart、```json …
const FENCE_LANG = /^\s*```([A-Za-z0-9_+-]*)\s*$/
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
// 单独一行的 ---、***、___：分隔线，不露字符
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
// [文字](网址) 优先，其次光秃秃的 http(s) 网址；网址里不带空格、尖括号和括号
// 开头的 ! 是图片：![说明](地址)
const LINK = /(!?)\[([^\]\n]*)\]\(([^()\s]+)\)|(https?:\/\/[^\s<>()]+)/gi
// 网址尾巴上的句读不算网址的一部分；右括号要配上对才留下
const TAIL = /[.,;:!?、。，；：！？"”'’』」》]/

// 链接只认 http:// 和 https://，两头（摊开、主进程开浏览器前）都用这一个函数。
// 先看开头是不是 http(s)://，再看带不带空白或控制字符，再用 new URL 解析：
// 解析不动、协议不对的一律不算；算数的返回解析器规范化后的 href，
// 交给 shell.openExternal 的是它，不是原字符串。
export function httpUrl(candidate) {
  const url = String(candidate ?? '')
  if (!/^https?:\/\//i.test(url)) return null
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return null
  let parsed
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return parsed.href
}

// 光秃秃的网址尾巴：句读去掉，没配上的右括号也去掉
function trimTail(url) {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    const head = url.slice(0, end)
    const opens = (head.match(/[(（]/g) || []).length
    const closes = (head.match(/[)）]/g) || []).length
    if (!TAIL.test(ch) && !((ch === ')' || ch === '）') && closes > opens)) break
    end -= 1
  }
  return url.slice(0, end)
}

// 图片地址分三类：'local' 工作区里的本地文件（相对或绝对路径）、'https' 网址、'other' 别的写法。
// 别的写法（http:、data:、javascript:、file: 等）一律不显示。
export function imageKind(url) {
  const text = String(url ?? '').trim()
  if (!text) return 'other'
  if (/^https:\/\//i.test(text)) return 'https'
  // 盘符（C:\…、C:/…）和 UNC 路径（\\服务器\共享\…）是本地文件，不是协议
  if (/^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text)) return 'local'
  // 带协议头的（http:、data:、javascript:…）不是文件
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return 'other'
  return 'local'
}

// 一段字拆成普通片段和链接片段：{ text } 或 { text, link }；不认的协议整串留在普通片段里
function splitLinks(text) {
  const out = []
  let last = 0
  for (const hit of text.matchAll(LINK)) {
    const image = hit[1] === '!'
    const bare = hit[4] !== undefined
    const url = bare ? trimTail(hit[4]) : httpUrl(hit[3])
    // 图片：地址分三类，别的写法不显示
    if (image) {
      if (hit.index > last) out.push({ text: text.slice(last, hit.index) })
      if (imageKind(hit[3]) !== 'other') out.push({ text: hit[2] || hit[3], image: hit[3] })
      last = hit.index + hit[0].length
      continue
    }
    // [文字](不是网址的东西)：多半是模型指着任务文件夹里的文件（[摘要.docx](摘要.docx)），只留文字，不露方括号和括号
    if (!url && !bare) {
      if (hit.index > last) out.push({ text: text.slice(last, hit.index) })
      out.push({ text: hit[2] || hit[3] })
      last = hit.index + hit[0].length
      continue
    }
    if (!url) continue
    if (hit.index > last) out.push({ text: text.slice(last, hit.index) })
    out.push({ text: bare || !hit[2] ? url : hit[2], link: url })
    last = hit.index + (bare ? url.length : hit[0].length)
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  // 整段都被吃掉了（比如一个不显示的图片写法）：不留空片段
  if (out.length) return out
  return last >= text.length ? [] : [{ text }]
}

// 行内片段过一遍链接：代码片段里的网址不当链接，其余的拆出 [文字](网址) 和裸网址
function withLinks(list) {
  const out = []
  for (const one of list) {
    if (one.code || one.math || !one.text) { out.push(one); continue }
    for (const piece of splitLinks(one.text)) {
      if (piece.image) { out.push({ text: piece.text, bold: one.bold, code: false, image: piece.image }); continue }
      out.push(piece.link
        ? { text: piece.text, bold: one.bold, code: false, link: piece.link }
        : { text: piece.text, bold: one.bold, code: false })
    }
  }
  return out
}

const segs = (text) => withLinks(inlineSegments(String(text ?? '')))

// 一行表格拆成格子：去掉首尾的空格子
function cells(line) {
  const parts = String(line).split('|')
  if (parts.length && parts[0].trim() === '') parts.shift()
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map((one) => one.trim())
}

const isTable = (lines, i) => lines[i].includes('|') && i + 1 < lines.length && RULE.test(lines[i + 1])

// chart 代码块：里面是一段 JSON，画成统计图。格式（写给模型看的那份在 app/copy/harness.mjs）：
// {
//   "type": "bar" | "line" | "pie",
//   "title": "三家门店本周客流",
//   "unit": "人次",
//   "categories": ["东湖店", "南站店", "西苑店"],
//   "series": [{ "name": "本周", "data": [2160, 1980, 1650] }],
//   "source": "门店客流.xlsx · Sheet1 B2:B4"
// }
// series 可以有 1–4 组；pie 只用第一组；source 可选。
// 字段不对、JSON 坏了、块还没闭合（回话还在一个字一个字出来）：都退回普通代码块，不报错。
const CHART_TYPES = new Set(['bar', 'line', 'pie'])

function chartSpec(text) {
  let obj
  try { obj = JSON.parse(text) } catch { return null }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (!CHART_TYPES.has(obj.type)) return null
  const categories = obj.categories
  if (!Array.isArray(categories) || !categories.length) return null
  if (!categories.every((one) => typeof one === 'string')) return null
  const series = obj.series
  if (!Array.isArray(series) || !series.length || series.length > 4) return null
  const out = []
  for (const one of series) {
    if (!one || typeof one !== 'object' || Array.isArray(one)) return null
    const data = one.data
    if (!Array.isArray(data) || data.length !== categories.length) return null
    // 只要非负的数：纵轴从 0 起，负数画不了
    if (!data.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null
    out.push({ name: typeof one.name === 'string' ? one.name : '', data: data.slice() })
  }
  const spec = { type: obj.type, categories: categories.slice(), series: out }
  if (typeof obj.title === 'string' && obj.title) spec.title = obj.title
  if (typeof obj.unit === 'string' && obj.unit) spec.unit = obj.unit
  if (typeof obj.source === 'string' && obj.source) spec.source = obj.source
  return spec
}

// 单独一段的公式：$$...$$ 和 \[...\]，居中显示。没闭合的照普通字。
function displayMath(text) {
  const dollars = /^\s*\$\$([\s\S]+)\$\$\s*$/.exec(text)
  if (dollars && !dollars[1].includes('$$')) return dollars[1].trim()
  const brackets = /^\s*\\\[([\s\S]+?)\\\]\s*$/.exec(text)
  if (brackets && !brackets[1].includes('\\]')) return brackets[1].trim()
  return ''
}

// 一段话摊成 [{ type, ... }]：
// h 标题 · p 段落 · ul / ol 列表 · table 表格 · quote 引用 · code 代码块 · chart 统计图 ·
// mermaid 流程图 · math 公式 · hr 分隔线
export function markdownBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (FENCE.test(line)) {
      const lang = FENCE_LANG.exec(line)
      const buf = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) { buf.push(lines[i]); i += 1 }
      const closed = i < lines.length
      if (closed) i += 1
      // chart 代码块：解析得出就画成图，解析不出（或者还没闭合）就照旧当代码块
      if (closed && lang && lang[1].toLowerCase() === 'chart') {
        const spec = chartSpec(buf.join('\n'))
        if (spec) { blocks.push({ type: 'chart', spec }); continue }
      }
      // mermaid 代码块：写完了（块闭合）才画成流程图；还没写完照旧当代码块
      if (closed && lang && lang[1].toLowerCase() === 'mermaid') {
        blocks.push({ type: 'mermaid', text: buf.join('\n') })
        continue
      }
      // math 代码块：写完了才当公式；还没写完照旧当代码块
      if (closed && lang && lang[1].toLowerCase() === 'math') {
        blocks.push({ type: 'math', text: buf.join('\n') })
        continue
      }
      blocks.push({ type: 'code', text: buf.join('\n') })
      continue
    }
    if (isTable(lines, i)) {
      const head = cells(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(cells(lines[i])); i += 1 }
      blocks.push({ type: 'table', head: head.map(segs), rows: rows.map((row) => row.map(segs)) })
      continue
    }
    if (HR.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue }
    const head = HEAD.exec(line)
    if (head) { blocks.push({ type: 'h', level: head[1].length, segs: segs(head[2]) }); i += 1; continue }
    const bullet = BULLET.exec(line)
    if (bullet) {
      const items = []
      while (i < lines.length) {
        const one = BULLET.exec(lines[i])
        if (!one) break
        items.push(segs(one[1]))
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }
    const ordered = ORDERED.exec(line)
    if (ordered) {
      const items = []
      while (i < lines.length) {
        const one = ORDERED.exec(lines[i])
        if (!one) break
        items.push(segs(one[1]))
        i += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }
    const quote = QUOTE.exec(line)
    if (quote) { blocks.push({ type: 'quote', segs: segs(quote[1]) }); i += 1; continue }
    if (line.trim() === '') { i += 1; continue }
    const buf = []
    while (i < lines.length && lines[i].trim() !== '' && !HEAD.test(lines[i]) && !BULLET.test(lines[i])
      && !ORDERED.test(lines[i]) && !QUOTE.test(lines[i]) && !HR.test(lines[i]) && !FENCE.test(lines[i]) && !isTable(lines, i)) {
      buf.push(lines[i])
      i += 1
    }
    if (!buf.length) { i += 1; continue }
    // 单独一段的公式：$$...$$、\[...\]，居中显示
    const formula = displayMath(buf.join('\n'))
    if (formula) { blocks.push({ type: 'math', text: formula }); continue }
    // 以「来源：」开头的段落（连续几行来源合成的一段也算）标上 src，页面给小号灰字
    const para = { type: 'p', segs: segs(buf.join('\n')) }
    if (buf[0].trim().startsWith(t('source.prefix'))) para.src = true
    blocks.push(para)
  }
  return blocks
}
