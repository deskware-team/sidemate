// 回话里的行内格式：只认 **粗体**（三个以上星号包住的也当粗体，不露星号）、`代码`、
// 行内公式（\(...\) 和 $...$）、# 标题、- 列表这几样。
// 别的（链接、图片、表格、引用、斜体）都当普通字，不解析。
// 纯函数：进一段字，出一批片段，页面那边只管建节点，不碰 HTML。

// 行首缩进留着、井号和后面的空格去掉，整行粗体
const HEADING = /^([ \t]*)(#{1,6})[ \t]+(.*)$/
// 行首缩进留着、- * + 换成 ·
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/

// 行内公式：\(...\) 和 $...$。从 from 起找，找不到就返回 null（照普通字）。
// $ 有三条规矩（防误伤价格）：开头的 $ 后面不能是空格；结尾的 $ 前面不能是空格；
// 结尾的 $ 后面不能紧跟数字。所以「花了 $5 和 $10」不算公式。
// 代码里的不算：反引号那一段在 inline() 里先被吃掉了，根本到不了这里。
export function findMath(text, from) {
  const src = String(text ?? '')
  const ch = src[from]
  if (ch === '\\' && src[from + 1] === '(') {
    const close = src.indexOf('\\)', from + 2)
    if (close === -1) return null
    const inner = src.slice(from + 2, close)
    if (!inner.trim()) return null
    return { text: inner, end: close + 2 }
  }
  if (ch !== '$') return null
  // $$...$$：成对的两个
  if (src[from + 1] === '$') {
    const close = src.indexOf('$$', from + 2)
    if (close === -1) return null
    const inner = src.slice(from + 2, close)
    if (!inner.trim()) return null
    return { text: inner, end: close + 2 }
  }
  // 开头的 $ 后面不能是空格
  const first = src[from + 1]
  if (first === undefined || /\s/.test(first)) return null
  for (let i = from + 1; i < src.length; i += 1) {
    if (src[i] !== '$') continue
    if (/\s/.test(src[i - 1])) continue // 结尾的 $ 前面不能是空格
    if (src[i + 1] !== undefined && /[0-9]/.test(src[i + 1])) continue // 结尾的 $ 后面不能紧跟数字
    const inner = src.slice(from + 1, i)
    if (!inner.trim()) continue
    return { text: inner, end: i + 1 }
  }
  return null
}

// 从 from 起这串连续星号有几个
const starRun = (text, from) => {
  let end = from
  while (end < text.length && text[end] === '*') end += 1
  return end - from
}

// 一段字拆成 [{ text, bold, code }]：bold 是整段粗、code 是整段代码
function inline(text, boldBase) {
  const out = []
  let buf = ''
  const flush = () => {
    if (!buf) return
    out.push({ text: buf, bold: boldBase === true, code: false })
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        // 代码里的 ** 不算粗体；粗体里的代码也不加粗
        out.push({ text: text.slice(i + 1, end), bold: false, code: true })
        i = end + 1
        continue
      }
      buf += ch
      i += 1
      continue
    }
    if (ch === '$' || (ch === '\\' && text[i + 1] === '(')) {
      const hit = findMath(text, i)
      if (hit) {
        flush()
        out.push({ text: hit.text, bold: false, code: false, math: true })
        i = hit.end
        continue
      }
    }
    if (ch === '*') {
      const open = starRun(text, i)
      // 两个以上星号包住的当粗体（**字**、***字***、****字****），包不到的星号照原样当字
      if (open >= 2) {
        let close = -1
        for (let j = i + open; j < text.length; j += 1) {
          if (text[j] === '*' && starRun(text, j) >= 2) { close = j; break }
        }
        if (close !== -1) {
          flush()
          for (const one of inline(text.slice(i + open, close), true)) out.push(one)
          i = close + starRun(text, close)
          continue
        }
        buf += text.slice(i, i + open)
        i += open
        continue
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

// 整段话按行分好；一行是 [{ text, bold, code }] 的数组
export function parseInline(text) {
  const src = typeof text === 'string' ? text : String(text ?? '')
  return src.split('\n').map((line) => {
    const head = HEADING.exec(line)
    if (head) return inline(head[1] + head[3], true)
    const bullet = BULLET.exec(line)
    if (bullet) return inline(bullet[1] + '· ' + bullet[3], false)
    return inline(line, false)
  })
}

// 一段话摊平成片段序列，行与行之间用 \n 隔开（行数、换行照原样）
export function inlineSegments(text) {
  const lines = parseInline(text)
  const out = []
  lines.forEach((line, index) => {
    if (index > 0) out.push({ text: '\n', bold: false, code: false })
    for (const one of line) out.push(one)
  })
  return out
}
