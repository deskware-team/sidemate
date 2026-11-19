// 「关于」页里「开机时自动打开桌伴」那一行：开关摆上去、拨了发 IPC。
// 页面那一段在 app/settings/page.html 里，这里查它在不在、样子对不对；
// 摆开关的代码跑在渲染进程里，用一个够用的假 DOM 把它摆起来。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { renderLoginItem } from '../../app/settings/about-view.js'
import { t } from '../../app/copy/copy.mjs'

const html = readFileSync(new URL('../../app/settings/page.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../app/settings/page.css', import.meta.url), 'utf8')

// 一个够用的假节点：勾选框、开关外壳
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.checked = false
    this.attributes = {}
    this.listeners = new Map()
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  dispatch(type) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type })
  }
}

function fakeDocument() {
  const input = new FakeNode('input')
  const wrap = new FakeNode('span')
  return {
    input,
    wrap,
    querySelector(selector) {
      if (selector === '#login-item-input') return input
      if (selector === '#login-item') return wrap
      return null
    },
  }
}

test('关于页里有「开机自动启动」这一行，在声明和许可上面', () => {
  // 页面里放的是文案键，字在 app/copy/ui-settings.mjs 里
  assert.match(html, /data-t="aboutPage\.loginTitle"/)
  assert.equal(t('aboutPage.loginTitle'), '开机自动启动')
  // 这一行下面不摆解释小字
  assert.doesNotMatch(html, /data-t="aboutPage\.loginNote"/)
  assert.doesNotMatch(html, /data-t="aboutPage\.tagline"/)
  assert.throws(() => t('aboutPage.loginNote'), /aboutPage\.loginNote/)
  assert.match(html, /id="login-item-input"/)
  // 那一行在声明和许可那张卡上面
  assert.ok(html.indexOf('id="login-item-card"') < html.indexOf('id="doc-list"'), '这一行在声明和许可上面')
})

test('那张卡高 65：上下 12，标题和提示之间 4', () => {
  const card = css.slice(css.indexOf('#login-item-card {'))
  assert.match(card, /min-height:\s*65px/, '卡高 65')
  assert.match(card, /padding:\s*12px 16px/, '上下 12、左右 16')
  const text = css.slice(css.indexOf('#login-item-card .pref-text'))
  assert.match(text, /gap:\s*4px/, '标题和提示之间 4')
})

test('整行能点：卡是勾选框的标签，勾选框在卡里', () => {
  const card = html.slice(html.indexOf('<label id="login-item-card"'), html.indexOf('</label>', html.indexOf('<label id="login-item-card"')))
  assert.ok(card, '卡是个标签')
  assert.match(card, /for="login-item-input"/, '标签指着那个勾选框')
  assert.match(card, /id="login-item-input"/, '勾选框在卡里')
  // 标签里不另起一个标签：免得点一下切两次
  assert.equal((card.match(/<label/g) || []).length, 1, '卡里没有别的标签')
})

test('Tab + 空格能切：勾选框是能聚焦的真勾选框', () => {
  assert.match(html, /<input type="checkbox" id="login-item-input">/)
  const card = html.slice(html.indexOf('<label id="login-item-card"'), html.indexOf('</label>', html.indexOf('<label id="login-item-card"')))
  assert.ok(!/hidden|disabled/.test(card), '勾选框没被藏起来也没被禁用')
})

test('开关显示主进程给的状态', () => {
  const doc = fakeDocument()
  global.document = doc
  try {
    renderLoginItem({ open: true, packaged: true }, {})
    assert.equal(doc.input.checked, true)
    renderLoginItem({ open: false, packaged: true }, {})
    assert.equal(doc.input.checked, false)
  } finally {
    delete global.document
  }
})

test('拨了开关：告诉外面一声', () => {
  const doc = fakeDocument()
  global.document = doc
  const seen = []
  try {
    renderLoginItem({ open: true, packaged: true }, { onToggle: (on) => seen.push(on) })
    doc.input.checked = false
    doc.input.dispatch('change')
    assert.deepEqual(seen, [false], '拨开关告诉外面')

    // 重画以后再拨，还是走新的那个动作
    const later = []
    renderLoginItem({ open: false, packaged: true }, { onToggle: (on) => later.push(on) })
    doc.input.dispatch('change')
    assert.deepEqual(later, [false], '重画以后用新的动作')
  } finally {
    delete global.document
  }
})

test('点一下只切一次：重画好几遍，监听器还是一个', () => {
  const doc = fakeDocument()
  global.document = doc
  const seen = []
  try {
    renderLoginItem({ open: true, packaged: true }, { onToggle: (on) => seen.push(on) })
    renderLoginItem({ open: true, packaged: true }, { onToggle: (on) => seen.push(on) })
    renderLoginItem({ open: true, packaged: true }, { onToggle: (on) => seen.push(on) })
    doc.input.checked = false
    doc.input.dispatch('change')
    assert.deepEqual(seen, [false], '一次拨动只叫一声')
  } finally {
    delete global.document
  }
})
