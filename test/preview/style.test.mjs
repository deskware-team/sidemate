// 预览窗画布的样子：滚动条是自己画的那种细的，画布占满高度，页与页之间 16，
// 一页一张图是白底带阴影。颜色和尺寸都写在 app/preview/page.css 里，这里读那份 CSS。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(fileURLToPath(new URL('../../app/preview/page.css', import.meta.url)), 'utf8')
const HTML = readFileSync(fileURLToPath(new URL('../../app/preview/page.html', import.meta.url)), 'utf8')
const SHELL = readFileSync(fileURLToPath(new URL('../../app/preview/shell.mjs', import.meta.url)), 'utf8')

test('画布和左栏用同一种细滚动条：没有上下箭头', () => {
  assert.match(CSS, /#files, #canvas \{[^}]*scrollbar-width:\s*thin/)
  assert.match(CSS, /#files::-webkit-scrollbar,\s*#canvas::-webkit-scrollbar \{[^}]*width:\s*10px/)
  assert.match(CSS, /#files::-webkit-scrollbar-track,\s*#canvas::-webkit-scrollbar-track \{[^}]*background:\s*transparent/)
  // 上下箭头那个按钮不要
  assert.match(CSS, /#files::-webkit-scrollbar-button,\s*#canvas::-webkit-scrollbar-button \{[^}]*display:\s*none/)
})

test('滑块：淡墨色、圆角 5、左右各 2px 透明边，悬停深一档', () => {
  const thumb = CSS.split('}').find((one) => one.includes('#files::-webkit-scrollbar-thumb,'))
  assert.ok(thumb, 'page.css 里没有滑块的规则')
  assert.match(thumb, /background:\s*rgba\(34, 32, 28, 0\.2\)/)
  assert.match(thumb, /border-radius:\s*5px/)
  assert.match(thumb, /border-left:\s*2px solid transparent/)
  assert.match(thumb, /border-right:\s*2px solid transparent/)
  assert.match(thumb, /background-clip:\s*padding-box/)
  const hover = CSS.split('}').find((one) => one.includes('#files::-webkit-scrollbar-thumb:hover'))
  assert.match(hover, /background:\s*rgba\(34, 32, 28, 0\.35\)/)
})

test('画布占满上条和底条之间的全部高度，内容少也铺满', () => {
  assert.match(CSS, /#canvas \{[^}]*flex:\s*1/)
  assert.match(CSS, /#canvas \{[^}]*min-height:\s*0/)
  assert.match(CSS, /#canvas \{[^}]*overflow:\s*auto/)
  assert.match(CSS, /#content \{[^}]*flex:\s*1/)
})

test('网页和文本也铺满高度', () => {
  assert.match(CSS, /#content iframe\.web \{[^}]*flex:\s*1/)
  assert.match(CSS, /#content pre\.text \{[^}]*flex:\s*1/)
})

test('一页一张图：白底、一点阴影，页与页之间 16', () => {
  const card = CSS.split('}').find((one) => one.includes('.page-card {'))
  assert.ok(card, 'page.css 里没有 .page-card 的规则')
  assert.match(card, /background:\s*var\(--face\)/)
  assert.match(card, /box-shadow:\s*0 1px 4px rgba\(0, 0, 0, \.08\)/)
  const content = CSS.split('}').find((one) => one.includes('#content {'))
  assert.match(content, /gap:\s*16px/)
})

test('底条右边有缩放那几个控件', () => {
  assert.match(HTML, /id="zoom-fit"[^>]*data-t="preview\.zoomFit"/)
  assert.match(HTML, /id="zoom-out"[^>]*data-t-title="preview\.zoomOut"/)
  assert.match(HTML, /id="zoom-in"[^>]*data-t-title="preview\.zoomIn"/)
  assert.match(HTML, /id="zoom-value"/)
  const zbtn = CSS.split('}').find((one) => one.includes('#zoom .zbtn {'))
  assert.match(zbtn, /font-size:\s*11px/)
  assert.match(zbtn, /border-radius:\s*4px/)
})

test('适应宽度开着时是选中的样子：白底、线框、500 字重、墨色', () => {
  const active = CSS.split('}').find((one) => one.includes('#zoom .zbtn.active'))
  assert.ok(active, 'page.css 里没有 #zoom .zbtn.active 的规则')
  assert.match(active, /background:\s*var\(--face\)/)
  assert.match(active, /border-color:\s*var\(--line\)/)
  assert.match(active, /font-weight:\s*500/)
  assert.match(active, /color:\s*var\(--ink\)/)
})

test('Excel 的图也按 200 dpi 渲（倍率高的屏幕上不虚）', () => {
  const toImages = SHELL.split('async function toImages(')[1]?.split('}')[0] || ''
  assert.match(toImages, /kind:\s*'images',\s*dpi:\s*PAGE_DPI/)
})
