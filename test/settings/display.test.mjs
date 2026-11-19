// 设置页的「显示」那一段：目录里有这一项（用量和关于之间）、页面摆两行、
// 档位按钮点了发 IPC（做法照 about-view.test.mjs，用一个够用的假 DOM）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { FONT_CHOICES, ISLAND_CHOICES, renderDisplay } from '../../app/settings/display-view.js'
import { t } from '../../app/copy/copy.mjs'

const html = readFileSync(new URL('../../app/settings/page.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../app/settings/page.css', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../../app/settings/preload.cjs', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../app/settings/page.js', import.meta.url), 'utf8')

// 一个够用的假节点：按钮、radiogroup 的外壳
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.className = ''
    this.listeners = new Map()
  }
  get classList() {
    const self = this
    return {
      toggle(name, on) { self.className = String(self.className).split(/\s+/).filter(Boolean).concat(on ? [name] : []).join(' ') },
      contains(name) { return String(self.className).split(/\s+/).includes(name) },
    }
  }
  setAttribute() { /* 摆样子的属性，这里不查 */ }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
  dispatch(type, payload = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ preventDefault() {}, ...payload })
  }
  click() { this.dispatch('click') }
  replaceChildren(...kids) { this.children = kids }
  focus() { this.focused = true }
}

function fakePage() {
  return { font: new FakeNode('div'), island: new FakeNode('div') }
}

function fakeDocument(hosts) {
  return {
    querySelector: (selector) => (selector === '#font-seg' ? hosts.font : selector === '#island-seg' ? hosts.island : null),
    createElement: (tag) => new FakeNode(tag),
  }
}

test('目录里有「显示」，放在「用量」和「关于」之间', () => {
  const at = (name) => html.indexOf(`data-page="${name}"`)
  assert.ok(at('display') > 0, '目录里有显示这一项')
  assert.ok(at('usage') < at('display') && at('display') < at('about'), '显示在用量和关于之间')
})

test('页面照设计稿：标题、两行（字号、小岛大小），不摆说明小字', () => {
  // 页面里放的是文案键，字在 app/copy/ui-settings.mjs 里
  assert.match(html, /data-t="nav\.display"/)
  assert.match(html, /data-t="display\.font"/)
  assert.match(html, /data-t="display\.island"/)
  assert.equal(t('nav.display'), '显示')
  assert.equal(t('display.font'), '字号')
  assert.equal(t('display.island'), '小岛大小')
  // 说明小字和快捷键提示都删了：页面上不摆，文案里也没有
  assert.doesNotMatch(html, /data-t="display\.fontNote"/)
  assert.doesNotMatch(html, /data-t="display\.islandNote"/)
  assert.doesNotMatch(html, /data-t="display\.hint"/)
  assert.throws(() => t('display.hint'), /display\.hint/)
  // 两行在一张白卡里，中间一条分隔线
  assert.ok(html.indexOf('id="display-card"') < html.indexOf('display-line'))
})

test('档位按钮：字号四档、小岛三档，值就是档位表那几个数', () => {
  assert.deepEqual(FONT_CHOICES.map((one) => one.value), [0.9, 1, 1.15, 1.3])
  assert.deepEqual(FONT_CHOICES.map((one) => one.label), ['小', '标准', '大', '特大'])
  assert.deepEqual(ISLAND_CHOICES.map((one) => one.value), [0.85, 1, 1.25])
  assert.deepEqual(ISLAND_CHOICES.map((one) => one.label), ['小', '标准', '大'])
})

test('点击区至少 44×28；选中的深底白字，其余白底灰边', () => {
  assert.match(css, /\.seg \.seg-btn[^{]*\{[^}]*min-width: 44px;/s)
  assert.match(css, /\.seg \.seg-btn[^{]*\{[^}]*min-height: 28px;/s)
  assert.match(css, /\.seg \.seg-btn\.on[^{]*\{[^}]*background: var\(--ink\);[^}]*color: var\(--face\)/s)
})

test('摆上去：选中那颗标出来，点了报给壳（发了才重画）', () => {
  const hosts = fakePage()
  const picks = []
  const doc = fakeDocument(hosts)
  const before = globalThis.document
  globalThis.document = doc
  try {
    renderDisplay({ fontScale: 1, islandScale: 1.25 }, (kind, value) => picks.push([kind, value]))
    const fontButtons = hosts.font.children
    assert.equal(fontButtons.length, 4)
    assert.deepEqual(fontButtons.map((one) => one.textContent), ['小', '标准', '大', '特大'])
    // 标准那颗选中
    assert.ok(fontButtons[1].classList.contains('on'))
    assert.ok(!fontButtons[0].classList.contains('on'))
    // 小岛那组：大（1.25）选中
    assert.ok(hosts.island.children[2].classList.contains('on'))
    // 点「特大」：发的是 font / 1.3
    fontButtons[3].click()
    assert.deepEqual(picks, [['font', 1.3]])
    // 点小岛「小」：发的是 island / 0.85
    hosts.island.children[0].click()
    assert.deepEqual(picks, [['font', 1.3], ['island', 0.85]])
  } finally {
    globalThis.document = before
  }
})

test('键盘：左右方向键在组里切，到头不再动', () => {
  const hosts = fakePage()
  const picks = []
  let view = { fontScale: 1, islandScale: 1 }
  const before = globalThis.document
  globalThis.document = fakeDocument(hosts)
  const draw = () => renderDisplay(view, (kind, value) => {
    picks.push(value)
    view = { ...view, [kind === 'font' ? 'fontScale' : 'islandScale']: value }
    draw()
  })
  try {
    draw()
    // → 往大走：1 → 1.15 → 1.3 → 1.3（到头不再变）
    hosts.font.dispatch('keydown', { key: 'ArrowRight' })
    hosts.font.dispatch('keydown', { key: 'ArrowRight' })
    hosts.font.dispatch('keydown', { key: 'ArrowRight' })
    assert.deepEqual(picks, [1.15, 1.3, 1.3])
    // ← 往小走：1.3 → 1.15
    hosts.font.dispatch('keydown', { key: 'ArrowLeft' })
    assert.deepEqual(picks, [1.15, 1.3, 1.3, 1.15])
    // 别的键不动
    hosts.font.dispatch('keydown', { key: 'Enter' })
    assert.equal(picks.length, 4)
    assert.ok(hosts.font.children[2].focused === true, '按键后焦点挪到选中的那颗')
  } finally {
    globalThis.document = before
  }
})

test('页面和 preload 都接上了：读当前档走 settings:zoom，点了走 settings:zoom-set', () => {
  assert.match(page, /renderDisplay/, 'page.js 摆那两组按钮')
  assert.match(page, /zoomSet\(kind, value\)/)
  assert.match(preload, /zoom: \(\) => ipcRenderer\.invoke\('settings:zoom'\)/)
  assert.match(preload, /zoomSet: \(kind, value\) => ipcRenderer\.invoke\('settings:zoom-set', kind, value\)/)
})
