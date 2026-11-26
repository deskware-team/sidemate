// 设置窗里「删东西之前问一句」的那个小窗：主钮在危险操作时是红底，默认焦点在「取消」上。
// 界面跑在渲染进程里，这里用一个够用的假 DOM 把小窗摆起来，只验看得见的事。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openAskDialog } from '../../app/settings/ask-view.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 一个够用的假节点：建节点、挂事件、append、remove、focus，够摆小窗用了
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.listeners = new Map()
    this.textContent = ''
    this.type = ''
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  dispatch(type) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this })
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue
      if (node.parentNode) node.parentNode.removeChild(node)
      node.parentNode = this
      this.children.push(node)
    }
  }

  removeChild(node) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentNode = null
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }

  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this }
}

// 假 document：body 装着小窗，记着现在焦点在谁身上
function makeDocument() {
  const doc = {
    body: new FakeNode('body'),
    activeElement: null,
    listeners: new Map(),
    createElement(tag) {
      const node = new FakeNode(tag)
      node.ownerDocument = doc
      return node
    },
    addEventListener(type, fn) {
      if (!doc.listeners.has(type)) doc.listeners.set(type, new Set())
      doc.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      const set = doc.listeners.get(type)
      if (set) set.delete(fn)
    },
  }
  doc.body.ownerDocument = doc
  return doc
}

// 树上按字找第一个节点
function findByText(node, text) {
  if (node.textContent === text) return node
  for (const child of node.children) {
    const hit = findByText(child, text)
    if (hit) return hit
  }
  return null
}

function setup() {
  const doc = makeDocument()
  global.document = doc
  return doc
}

function teardown() {
  delete global.document
}

test('小窗：危险操作时主钮是红底那一个，默认焦点在「取消」上', async () => {
  const doc = setup()
  try {
    const promise = openAskDialog({ text: '删掉它？', ok: '删除', cancel: '取消', danger: true })
    const ok = findByText(doc.body, '删除')
    const cancel = findByText(doc.body, '取消')
    assert.ok(ok, '有主钮')
    assert.ok(cancel, '有取消钮')
    assert.equal(ok.className, 'btn danger-ok', '主钮是危险操作那一个')
    assert.equal(cancel.className, 'btn', '取消钮还是普通钮')
    assert.equal(doc.activeElement, cancel, '焦点默认在「取消」上')
    cancel.dispatch('click')
    assert.equal(await promise, false, '点「取消」是不删')
  } finally {
    teardown()
  }
})

test('小窗：不传 danger 时跟原来一样（主钮普通，焦点不动）', async () => {
  const doc = setup()
  try {
    const promise = openAskDialog({ text: '要重起吗', ok: '继续保存', cancel: '取消' })
    const ok = findByText(doc.body, '继续保存')
    assert.equal(ok.className, 'btn', '主钮还是普通钮')
    assert.equal(doc.activeElement, null, '焦点不动')
    ok.dispatch('click')
    assert.equal(await promise, true, '点主钮是照旧做')
  } finally {
    teardown()
  }
})

test('设置窗里不再用系统自带的 confirm', () => {
  const dir = resolve(appRoot, 'app', 'settings')
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(resolve(dir, name), 'utf8')
    assert.equal(/window\.confirm/.test(text), false, `app/settings/${name} 里还在用 window.confirm`)
  }
})
