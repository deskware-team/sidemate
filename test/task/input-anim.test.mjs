// 输入胶囊展开 / 收起的样式底子（量 task.css 这份文件本身）：
// 圆角收起 / 展开统一用 --radius-input（20px）、时长和曲线放在变量里、关了「显示动画」直接切。
// 展开收起真在走的过渡由 window.test.mjs 在真窗口里量。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInputAnim } from '../../app/task/input-anim.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const css = readFileSync(join(here, '../../app/task/task.css'), 'utf8')

// 取第一条匹配选择器的规则体；找不到返回空串，断言自然会说没写上
const block = (text, selector) => {
  const at = text.indexOf(selector)
  if (at < 0) return ''
  const open = text.indexOf('{', at)
  return text.slice(open + 1, text.indexOf('}', open))
}

test('圆角：收起和展开都用 --radius-input，值是 20px', () => {
  assert.match(block(css, ':root'), /--radius-input:\s*20px/, ':root 里没有 --radius-input: 20px')
  assert.match(block(css, '#inputwrap.fold'), /border-radius:\s*var\(--radius-input\)/, 'fold 没用 --radius-input')
  assert.match(block(css, '#inputwrap.open'), /border-radius:\s*var\(--radius-input\)/, 'open 没用 --radius-input')
})

test('时长和曲线：展开 200ms、收起 160ms，各配各的曲线', () => {
  const root = block(css, ':root')
  assert.match(root, /--t-input-out:\s*200ms/, '展开时长不是 200ms')
  assert.match(root, /--t-input-in:\s*160ms/, '收起时长不是 160ms')
  assert.match(root, /--curve-out:\s*cubic-bezier\(0\.2,\s*0\.8,\s*0\.2,\s*1\)/, '展开曲线不对')
  assert.match(root, /--curve-in:\s*cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/, '收起曲线不对')
  assert.match(block(css, '#inputwrap.grow'), /transition:\s*height\s+var\(--t-input-out\)\s+var\(--curve-out\)/, '展开的过渡没接变量')
  assert.match(block(css, '#inputwrap.shrink'), /transition:\s*height\s+var\(--t-input-in\)\s+var\(--curve-in\)/, '收起的过渡没接变量')
})

test('别的尺寸不动：fold 高 42、展开的输入 66 高、发送钮 28×28', () => {
  assert.match(block(css, '#inputwrap.fold'), /height:\s*42px/, '收起高不是 42')
  assert.match(block(css, '#inputwrap.open #input'), /height:\s*66px/, '展开的输入不是 66 高')
  const send = block(css, '#send')
  assert.match(send, /width:\s*28px/, '发送钮不是 28 宽')
  assert.match(send, /height:\s*28px/, '发送钮不是 28 高')
})

test('关了「显示动画」：胶囊的高度过渡和小签的淡入淡出都关掉', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(at >= 0, '没有 prefers-reduced-motion 的 media')
  const still = css.slice(at)
  assert.match(block(still, '#inputwrap.grow, #inputwrap.shrink'), /transition:\s*none/, 'reduced-motion 下还有 transition')
  assert.match(block(still, '#inputwrap.grow #chiprow, #inputwrap.shrink #chiprow'), /animation:\s*none/, 'reduced-motion 下小签还在淡入淡出')
})

// 假的 DOM 元素：只够 createInputAnim 量高、切类、收监听用
function fakeWrap(heights) {
  const classes = new Set(['fold'])
  const listeners = {}
  return {
    classes,
    style: { height: '' },
    rows: 1,
    classList: {
      add: (...names) => names.forEach((one) => classes.add(one)),
      remove: (...names) => names.forEach((one) => classes.delete(one)),
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name) },
      contains: (name) => classes.has(name),
    },
    getBoundingClientRect: () => ({ height: classes.has('fold') ? heights.fold : heights.open }),
    get offsetHeight() { return 1 },
    addEventListener: (kind, fn) => { (listeners[kind] ||= []).push(fn) },
    removeEventListener: (kind, fn) => { listeners[kind] = (listeners[kind] || []).filter((one) => one !== fn) },
    fire: (kind, event) => { for (const fn of listeners[kind] || []) fn(event) },
  }
}

test('关了「显示动画」：直接切类，不挂 height、不等 transitionend', () => {
  const wrap = fakeWrap({ fold: 42, open: 120 })
  const anim = createInputAnim({ wrap, input: wrap, reduce: () => true })
  anim.to(true)
  assert.equal(wrap.classes.has('open'), true, '没切成展开')
  assert.equal(wrap.classes.has('morph'), false, 'reduced-motion 还挂了过渡类')
  assert.equal(wrap.style.height, '', 'reduced-motion 还挂着行内 height')
  assert.equal(wrap.rows, 3, '行数没切')
  anim.to(false)
  assert.equal(wrap.classes.has('fold'), true, '没收回去')
  assert.equal(wrap.rows, 1)
})

test('展开：定在旧值再放到新值，走完了把 height 还给自动', () => {
  const wrap = fakeWrap({ fold: 42, open: 120 })
  const anim = createInputAnim({ wrap, input: wrap, reduce: () => false })
  anim.to(true)
  assert.equal(wrap.style.height, '120px', 'height 没放到新值')
  assert.equal(wrap.classes.has('grow'), true, '没挂展开的过渡类')
  assert.equal(wrap.classes.has('open'), true)
  wrap.fire('transitionend', { target: wrap, propertyName: 'height' })
  assert.equal(wrap.style.height, '', '走完没把 height 还给自动')
  assert.equal(wrap.classes.has('grow'), false, '走完没摘过渡类')
  assert.equal(wrap.classes.has('open'), true)
  // 别人的 transitionend 不该把它收掉
  anim.to(false)
  wrap.fire('transitionend', { target: {}, propertyName: 'height' })
  wrap.fire('transitionend', { target: wrap, propertyName: 'opacity' })
  assert.equal(wrap.style.height, '42px', '没收起到 42')
  wrap.fire('transitionend', { target: wrap, propertyName: 'height' })
  assert.equal(wrap.classes.has('fold'), true, '走完没切成一行胶囊')
  assert.equal(wrap.classes.has('open'), false)
  assert.equal(wrap.style.height, '')
})
