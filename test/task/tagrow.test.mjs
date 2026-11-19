// 小签行：签多了收成「+N」，点开全摆出来、最后一个是「收起」。
// 这里用一个够用的假 DOM 把 tagrow.mjs 摆起来，验看得见的行为：
// 超过三个出「+N」、提示里是藏起来的文件名、点了全出来带「收起」、再点收回、
// 去掉一个还保持展开、剩三个以内就不显示「收起」。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTagRow } from '../../app/task/tagrow.mjs'

// 一个够用的假节点：属性、事件、append、几个几何量，够摆小签行用了
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.dataset = {}
    this.children = []
    this.parent = null
    this.listeners = new Map()
    this.style = {}
    this.hidden = false
    this.disabled = false
    this.title = ''
    this.type = ''
    this._text = ''
  }

  get textContent() {
    if (this.children.length) return this.children.map((one) => one.textContent).join('')
    return this._text
  }

  set textContent(value) {
    this._text = String(value)
    this.children = []
  }

  get classList() {
    const node = this
    const list = () => node.className.split(/\s+/).filter(Boolean)
    const write = (items) => { node.className = items.join(' ') }
    return {
      add(name) { if (!list().includes(name)) write([...list(), name]) },
      remove(name) { write(list().filter((one) => one !== name)) },
      contains(name) { return list().includes(name) },
      toggle(name, force) {
        const has = list().includes(name)
        const want = force === undefined ? !has : force === true
        if (want && !has) write([...list(), name])
        if (!want && has) write(list().filter((one) => one !== name))
        return want
      },
    }
  }

  append(...nodes) {
    for (const one of nodes) {
      one.parent = this
      this.children.push(one)
    }
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  dispatch(type, extra = {}) {
    const event = { type, target: this, stopPropagation() {}, preventDefault() {}, ...extra }
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event)
  }

  click() { this.dispatch('click') }

  setAttribute(name, value) { this[name] = String(value) }

  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }

  // 摆的时候当成每个签自己一行、行高 32：这样「最多三行」的算法能测到
  get offsetTop() {
    if (!this.parent) return 0
    return this.parent.children.indexOf(this) * 32
  }

  get offsetHeight() { return 26 }
}

function fakeDocument() {
  return { createElement: (tag) => new FakeEl(tag) }
}

const LABELS = {
  tagRemove: '移除',
  tagRestore: '还原为文字',
}

// 造一个小签：路径、锁没锁（干活中这一轮带着的锁住）、显示的名字
function tag(path, lock = false, label = path) {
  return { path, lock, label, name: path }
}

// 摆一个小签行：返回 { row, list, menu, view, setView }
function setup(tags, mode = 'files') {
  const document = fakeDocument()
  global.document = document
  global.innerWidth = 1200
  const row = new FakeEl('div')
  const list = new FakeEl('div')
  const menu = new FakeEl('div')
  menu.hidden = true // 菜单一开始是藏着的
  let current = { tags, labels: LABELS, input: { mode } }
  const acts = []
  const tagRow = createTagRow({
    row,
    list,
    menu,
    act: (action) => acts.push(action),
    bridge: null,
    view: () => current,
    onRestore: () => {},
  })
  tagRow.render()
  return {
    row,
    list,
    menu,
    acts,
    // 换一批小签（去掉一个、加上新的都走这里）
    setView(next) { current = { ...current, ...next }; tagRow.render() },
    setMode(one) { current = { ...current, input: { mode: one } }; tagRow.render() },
    // 摆出来的签：不是「+N」也不是「收起」的那些
    tags() { return list.children.filter((one) => !one.className.includes('more') && !one.className.includes('collapse')) },
    more() { return list.children.find((one) => one.className.includes('more')) || null },
    collapse() { return list.children.find((one) => one.className.includes('collapse')) || null },
  }
}

test('超过三个出「+N」，提示里是藏起来的那几个文件名', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx'), tag('e.docx')])
  try {
    assert.equal(ui.tags().length, 3, '只摆前三个')
    const more = ui.more()
    assert.ok(more, '该有「+N」')
    assert.equal(more.textContent, '+2')
    assert.equal(more.title, 'd.docx\ne.docx', '提示里列出藏起来的文件名')
    assert.equal(more.type, 'button', '「+N」得是个能 Tab 到的按钮')
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('点「+N」全摆出来，最后一个是「收起」；再点收回', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx'), tag('e.docx')])
  try {
    ui.more().click()
    assert.equal(ui.tags().length, 5, '全摆出来了')
    assert.ok(ui.collapse(), '最后一个是「收起」')
    assert.equal(ui.collapse().textContent, '收起')
    assert.equal(ui.list.children[ui.list.children.length - 1], ui.collapse(), '「收起」在最后')
    assert.equal(ui.more(), null, '展开的时候没有「+N」')
    assert.equal(ui.list.className.includes('expanded'), true, '展开的样子挂上了')
    ui.collapse().click()
    assert.equal(ui.tags().length, 3, '收回去了')
    assert.ok(ui.more(), '又见「+N」')
    assert.equal(ui.collapse(), null, '收回去了就没有「收起」')
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('展开时每个签点开的菜单跟收着时一样', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx')])
  try {
    ui.more().click()
    ui.tags()[0].click()
    assert.equal(ui.menu.hidden, false, '菜单弹出来了')
    const items = ui.menu.children.map((one) => one.textContent)
    // 只能去掉：不再有改成范本 / 改成材料
    assert.deepEqual(items, ['移除'])
    ui.menu.children[0].click()
    assert.deepEqual(ui.acts, [{ type: 'remove', path: 'a.docx' }])
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('去掉一个还保持展开；剩三个以内就不显示「收起」', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx'), tag('e.docx')])
  try {
    ui.more().click()
    assert.equal(ui.collapse().textContent, '收起')
    // 去掉一个，还剩四个：还是展开的，「收起」还在
    ui.setView({ tags: [tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx')] })
    assert.equal(ui.tags().length, 4, '四个都摆着')
    assert.ok(ui.collapse(), '还展开着，「收起」还在')
    // 去掉到只剩三个：不显示「收起」了
    ui.setView({ tags: [tag('a.docx'), tag('b.docx'), tag('c.docx')] })
    assert.equal(ui.collapse(), null, '剩三个以内没有「收起」')
    assert.equal(ui.tags().length, 3)
    assert.equal(ui.more(), null, '剩三个以内也没有「+N」')
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('多了一个新文件就收回前三个（少的不算变）', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx')])
  try {
    ui.more().click()
    assert.equal(ui.tags().length, 4, '先展开')
    // 多一个新文件：收回前三个
    ui.setView({ tags: [tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx'), tag('z.docx')] })
    assert.equal(ui.tags().length, 3, '有新文件就收着了')
    assert.ok(ui.more(), '「+N」回来了')
    assert.equal(ui.more().textContent, '+2')
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('干活中这一轮带着的小签锁住不弹菜单，「+N」和「收起」还能点；干活中挂上的还能去掉', () => {
  const ui = setup([tag('a.docx', true), tag('b.docx', false), tag('c.docx', true), tag('d.docx', true)], 'working')
  try {
    ui.tags()[0].click()
    assert.equal(ui.menu.hidden, true, '锁住的不弹菜单')
    ui.tags()[0].dispatch('contextmenu')
    assert.equal(ui.menu.hidden, true, '右键也不弹')
    // 干活中挂上、还没发出去的：能去掉
    ui.tags()[1].click()
    assert.equal(ui.menu.hidden, false)
    assert.deepEqual(ui.menu.children.map((one) => one.textContent), ['移除'])
    ui.menu.children[0].click()
    assert.deepEqual(ui.acts, [{ type: 'remove', path: 'b.docx' }])
    ui.more().click()
    assert.equal(ui.tags().length, 4, '「+N」还能点开')
    ui.collapse().click()
    assert.equal(ui.tags().length, 3, '「收起」还能点')
  } finally {
    delete global.document
    delete global.innerWidth
  }
})

test('展开最多摆三行，多了就在这一块里滚', () => {
  const ui = setup([tag('a.docx'), tag('b.docx'), tag('c.docx'), tag('d.docx'), tag('e.docx'), tag('f.docx')])
  try {
    ui.more().click()
    // 假 DOM 里每个签自己一行、行距 32（签 26 高、行间 6）：三行是 26×3 + 6×2 = 90
    assert.equal(ui.list.style.maxHeight, '90px', `太高了：${ui.list.style.maxHeight}`)
  } finally {
    delete global.document
    delete global.innerWidth
  }
})
