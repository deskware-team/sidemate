// 预览窗左栏的样子：颜色和尺寸都写在 app/preview/page.css 里，
// 代码只挂 data-kind。这里读那份 CSS，盯住每种类型的颜色和几个关键数字。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CSS = readFileSync(fileURLToPath(new URL('../../app/preview/page.css', import.meta.url)), 'utf8')
const PAGE = readFileSync(fileURLToPath(new URL('../../app/preview/page.js', import.meta.url)), 'utf8')

// 每种类型的底色和字色
const KIND_COLORS = {
  word: ['#e2e8f1', '#3b5b8c'],
  ppt: ['#f3e3dc', '#a24a2c'],
  excel: ['#e0ece3', '#2f6a45'],
  pdf: ['#f1dfdf', '#9a3b3b'],
  image: ['#eae4f1', '#67508c'],
  web: ['#dfecea', '#2f6966'],
  text: ['#e9e3d6', '#5f5a52'],
  zip: ['#e9e3d6', '#5f5a52'],
  file: ['#e9e3d6', '#5f5a52'],
}

test('每种类型都有颜色（底色 + 字色）', () => {
  for (const [kind, [bg, ink]] of Object.entries(KIND_COLORS)) {
    const rule = CSS.split('}').find((one) => one.includes(`[data-kind="${kind}"]`))
    assert.ok(rule, `page.css 里没有 [data-kind="${kind}"] 的规则`)
    assert.ok(rule.includes(bg), `${kind} 的底色不是 ${bg}`)
    assert.ok(rule.includes(ink), `${kind} 的字色不是 ${ink}`)
  }
})

test('材料那一组的类型块只描边，字色还是类型自己的', () => {
  const rule = CSS.split('}').find((one) => one.includes('#material-list .badge'))
  assert.ok(rule, 'page.css 里没有材料组类型块的规则')
  assert.match(rule, /background:\s*transparent/)
  assert.match(rule, /border:\s*1px solid #d6cfc1/)
})

test('选中行：白底 + 内描边 + 外阴影，行高不变', () => {
  const rule = CSS.split('}').find((one) => one.includes('#files li.active'))
  assert.ok(rule, 'page.css 里没有选中行的规则')
  assert.match(rule, /background:\s*var\(--face\)/)
  assert.match(rule, /inset 0 0 0 1px/)
  assert.match(rule, /0 1px 3px rgba\(34, 32, 28, 0\.08\)/)
})

test('左栏底色、分隔线、行距', () => {
  const side = CSS.split('}').find((one) => one.includes('#files {'))
  assert.match(side, /background:\s*var\(--side\)/)
  assert.match(CSS, /--side:\s*#f0ebe1/)
  assert.match(CSS, /padding:\s*12px 10px/)
  const divider = CSS.split('}').find((one) => one.includes('#files .divider'))
  assert.match(divider, /border-top:\s*1px solid #e0d9cc/)
  assert.match(divider, /margin:\s*10px 8px/)
  assert.match(CSS, /#files ul \{[^}]*gap:\s*2px/)
})

test('分组标题：名字 + 个数', () => {
  const title = CSS.split('}').find((one) => one.includes('#files h2'))
  assert.match(title, /font-size:\s*11px/)
  assert.match(title, /font-weight:\s*500/)
  assert.match(title, /color:\s*var\(--sub\)/)
  assert.match(title, /margin:\s*0 0 4px 8px/)
  const count = CSS.split('}').find((one) => one.includes('#files .group-count'))
  assert.match(count, /color:\s*#a39b8c/)
  assert.match(count, /font-weight:\s*400/)
  assert.match(title, /gap:\s*6px/)
})

test('一组没有文件就整组藏起来（标题、个数、列表都不显示）', () => {
  assert.match(PAGE, /doneGroup\.hidden\s*=\s*!meta\.showDone/)
  assert.match(PAGE, /materialGroup\.hidden\s*=\s*!meta\.showMaterial/)
})

test('Excel 工作表标签：重画前先清掉上一次的标签和图，一进来默认选第一张表', () => {
  const body = PAGE.slice(PAGE.indexOf('function renderImages'), PAGE.indexOf('function render('))
  assert.match(body, /els\.sheets\.textContent = ''/)
  assert.match(body, /els\.content\.textContent = ''/)
  assert.match(body, /if \(sheet === '' && names\.length > 0\) sheet = names\[0\]/)
})
