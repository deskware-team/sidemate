// 回话里的 Markdown 画成 DOM：标题、段落、列表、表格、引用、代码块、分隔线照排，链接可点，不露星号。
// 统计图（chart 代码块）交给 ./chart-svg.js 画，流程图（mermaid 代码块）交给 ./mermaid-view.js 画，
// 公式交给 ./math-view.js 画，图片交给 ./image-view.js 摆。
// 纯页面代码：不引 node:、不引 electron。

import { httpUrl, markdownBlocks } from './markdown.mjs'
import { chartEl } from './chart-svg.js'
import { mermaidEl } from './mermaid-view.js'
import { mathEl } from './math-view.js'
import { imageEl } from './image-view.js'
import { setChartTarget, svgSource } from './chart-export.js'

// 链接：点了交主进程用系统浏览器开，页面不自己跳；裸网址太长中间省一点，地址仍是原网址
function linkEl(one, bridge) {
  const a = document.createElement('a')
  a.href = one.link
  a.title = one.link
  const show = one.text === one.link && one.text.length > 42
    ? `${one.text.slice(0, 24)}…${one.text.slice(-12)}` : one.text
  if (one.bold) {
    const strong = document.createElement('strong')
    strong.textContent = show
    a.append(strong)
  } else {
    a.textContent = show
  }
  a.addEventListener('click', (event) => {
    event.preventDefault()
    if (bridge) bridge.openLink(one.link)
  })
  return a
}

// 行内的粗体、代码、链接、公式、图片：只建节点，文字一律走 textContent
function segs(node, list, bridge) {
  for (const one of list) {
    if (one.math) {
      node.append(mathEl(one.text, false))
    } else if (one.image) {
      node.append(imageEl(one.text, one.image, bridge))
    } else if (one.code) {
      const code = document.createElement('code')
      code.textContent = one.text
      node.append(code)
    } else if (one.link && httpUrl(one.link)) {
      node.append(linkEl(one, bridge))
    } else if (one.bold) {
      const strong = document.createElement('strong')
      strong.textContent = one.text
      node.append(strong)
    } else {
      node.append(document.createTextNode(one.text))
    }
  }
}

// 图上点右键：弹系统菜单（另存为图片 / 复制图片），主进程那边弹。
// 图还没画出来的时候不弹这个菜单（普通代码块右键就是普通的）。
function chartMenuOn(el, kind, title, bridge) {
  el.addEventListener('contextmenu', (event) => {
    const svg = el.querySelector('svg')
    if (!svg) return
    event.preventDefault()
    setChartTarget({ kind, title, source: svgSource(svg) })
    if (bridge && typeof bridge.chartMenu === 'function') bridge.chartMenu({ kind, title })
  })
}

// 回话里的 Markdown：标题、列表、表格、分隔线照排，链接可点，不露星号
export function markdownEl(text, bridge) {
  const wrap = document.createElement('div')
  wrap.className = 'md'
  for (const block of markdownBlocks(text)) {
    if (block.type === 'h') {
      const h = document.createElement(`h${Math.min(6, block.level + 2)}`)
      segs(h, block.segs, bridge)
      wrap.append(h)
    } else if (block.type === 'p') {
      const p = document.createElement('p')
      // 「来源：…」的段落：小号灰字，里面的链接照旧可点
      if (block.src) p.className = 'src'
      segs(p, block.segs, bridge)
      wrap.append(p)
    } else if (block.type === 'ul' || block.type === 'ol') {
      const list = document.createElement(block.type)
      for (const item of block.items) {
        const li = document.createElement('li')
        segs(li, item, bridge)
        list.append(li)
      }
      wrap.append(list)
    } else if (block.type === 'table') {
      const table = document.createElement('table')
      const head = document.createElement('thead')
      const hrow = document.createElement('tr')
      for (const cell of block.head) {
        const th = document.createElement('th')
        segs(th, cell, bridge)
        hrow.append(th)
      }
      head.append(hrow)
      table.append(head)
      const body = document.createElement('tbody')
      for (const row of block.rows) {
        const tr = document.createElement('tr')
        for (const cell of row) {
          const td = document.createElement('td')
          segs(td, cell, bridge)
          tr.append(td)
        }
        body.append(tr)
      }
      table.append(body)
      wrap.append(table)
    } else if (block.type === 'quote') {
      const quote = document.createElement('blockquote')
      segs(quote, block.segs, bridge)
      wrap.append(quote)
    } else if (block.type === 'code') {
      const pre = document.createElement('pre')
      pre.textContent = block.text
      wrap.append(pre)
    } else if (block.type === 'chart') {
      const el = chartEl(block.spec)
      chartMenuOn(el, 'chart', block.spec.title || '', bridge)
      wrap.append(el)
    } else if (block.type === 'mermaid') {
      const el = mermaidEl(block.text)
      chartMenuOn(el, 'flow', '', bridge)
      wrap.append(el)
    } else if (block.type === 'math') {
      wrap.append(mathEl(block.text, true))
    } else if (block.type === 'hr') {
      wrap.append(document.createElement('hr'))
    }
  }
  return wrap
}
