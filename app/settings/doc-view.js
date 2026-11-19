// 关于页的全文：.md 的（隐私与使用声明、Kilo 模型使用须知）照 Markdown 排好，别的（许可证）原样摆。
// 解析用任务窗回话那一份（app/task/markdown.mjs），这里只建节点，字一律走 textContent，不碰 HTML。
// 链接只当字摆出来（停上去看得到地址）：设置窗里点链接会把整页跳走。

import { markdownBlocks } from '../task/markdown.mjs'

// 行内的粗体、代码、链接
function inline(node, list) {
  for (const one of list) {
    if (one.code) {
      const code = document.createElement('code')
      code.textContent = one.text
      node.append(code)
    } else if (one.bold) {
      const strong = document.createElement('strong')
      strong.textContent = one.text
      if (one.link) strong.title = one.link
      node.append(strong)
    } else if (one.link) {
      const span = document.createElement('span')
      span.className = 'link'
      span.title = one.link
      span.textContent = one.text
      node.append(span)
    } else {
      node.append(document.createTextNode(one.text))
    }
  }
}

function blockEl(block) {
  if (block.type === 'h') {
    // 一级标题落成 h3，往下依次小一号；全文页自己的大标题是 h2
    const h = document.createElement(`h${Math.min(6, block.level + 2)}`)
    inline(h, block.segs)
    return h
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const list = document.createElement(block.type)
    for (const item of block.items) {
      const li = document.createElement('li')
      inline(li, item)
      list.append(li)
    }
    return list
  }
  if (block.type === 'quote') {
    const quote = document.createElement('blockquote')
    inline(quote, block.segs)
    return quote
  }
  if (block.type === 'code') {
    const pre = document.createElement('pre')
    pre.textContent = block.text
    return pre
  }
  if (block.type === 'hr') return document.createElement('hr')
  if (block.type === 'table') {
    const table = document.createElement('table')
    for (const row of [block.head, ...block.rows]) {
      const tr = document.createElement('tr')
      for (const cell of row) {
        const td = document.createElement(row === block.head ? 'th' : 'td')
        inline(td, cell)
        tr.append(td)
      }
      table.append(tr)
    }
    return table
  }
  const p = document.createElement('p')
  inline(p, block.segs || [])
  return p
}

// .md 全文摊成块：Windows 上检出、打包的文件是 \r\n 换行，先统一成 \n，不然 # 和 ** 认不出来；
// 开头那个一级标题跟页标题重复，不摆一遍
export function docBlocks(text) {
  const blocks = markdownBlocks(String(text ?? '').replace(/\r\n?/g, '\n'))
  if (blocks[0] && blocks[0].type === 'h' && blocks[0].level === 1) blocks.shift()
  return blocks
}

// 把一份全文摆进 box：.md 排版，别的原样
export function renderDoc(box, name, text) {
  box.replaceChildren()
  const markdown = /\.md$/i.test(String(name ?? ''))
  box.classList.toggle('md', markdown)
  if (!markdown) {
    box.textContent = String(text ?? '')
    return
  }
  for (const block of docBlocks(text)) box.append(blockEl(block))
}
