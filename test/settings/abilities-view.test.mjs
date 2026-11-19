// 「加一个 MCP」弹窗：永远灰着、鼠标停上去写「下一步接上」的占位按钮不摆出来。
// 规矩是「点不中的别像按钮」——这种按钮看着能点其实点不动，直接不显示。
// 界面代码跑在渲染进程里，这里用一个够用的假 DOM 把弹窗摆起来，只验看得见的事。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openMcpDialog } from '../../app/settings/abilities-view.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 一个够用的假节点：建节点、挂事件、append、remove、几个属性，够摆弹窗用了
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.listeners = new Map()
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.hidden = false
    this.disabled = false
    this.readOnly = false
    this.dataset = {}
    this.scrollHeight = 0
    this.clientHeight = 0
    this.scrollTop = 0
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }

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

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
  }

  removeEventListener(type, fn) {
    const set = this.listeners.get(type)
    if (set) set.delete(fn)
  }

  dispatch(type, extra = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this, ...extra })
  }

  querySelector(selector) {
    return findNode(this, (one) => {
      if (selector.startsWith('#')) return one.attributes.id === selector.slice(1)
      return one.tagName === selector.toUpperCase()
    })
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue
      if (node.parentNode) node.parentNode.removeChild(node)
      node.parentNode = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes) {
    this.children = []
    this.append(...nodes)
  }

  removeChild(node) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentNode = null
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
}

// 树上找第一个符合条件的节点
function findNode(node, test_) {
  if (test_(node)) return node
  for (const child of node.children) {
    const hit = findNode(child, test_)
    if (hit) return hit
  }
  return null
}

// 树上按字找第一个节点
function findByText(node, text) {
  return findNode(node, (one) => one.textContent === text)
}

// 树上所有符合条件的节点
function findAll(node, test_) {
  const hits = []
  const walk = (one) => {
    if (test_(one)) hits.push(one)
    for (const child of one.children) walk(child)
  }
  walk(node)
  return hits
}

// 假 document：body 装着弹窗，keydown 的监听记下来
function makeDocument() {
  const doc = {
    body: new FakeNode('body'),
    listeners: new Map(),
    createElement(tag) { return new FakeNode(tag) },
    addEventListener(type, fn) {
      if (!doc.listeners.has(type)) doc.listeners.set(type, new Set())
      doc.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      const set = doc.listeners.get(type)
      if (set) set.delete(fn)
    },
    dispatch(type, extra = {}) {
      for (const fn of [...(doc.listeners.get(type) || [])]) fn({ type, ...extra })
    },
  }
  return doc
}

// 摆一个「加一个 MCP」弹窗出来，返回整棵弹窗树
function openDialog() {
  const doc = makeDocument()
  global.document = doc
  global.window = {
    settings: {
      abilitiesProbe: async () => ({ ok: true, tools: [] }),
      abilitiesMcpSave: async () => ({ ok: true }),
      abilitiesParse: async () => ({ entries: [], problems: [] }),
    },
    confirm: () => true,
  }
  openMcpDialog({
    form: { id: '', name: '', url: '', authKind: 'header', authName: 'Authorization', hasSavedKey: false },
  })
  return doc.body.children[0]
}

// 占位按钮：点不动的、鼠标停上去写「下一步接上」的那种
function isPlaceholder(node) {
  if (node.tagName !== 'BUTTON') return false
  if (node.disabled !== true) return false
  return node.getAttribute('title') === '下一步接上'
}

test('MCP 弹窗：不摆永远灰着的占位按钮', () => {
  const dialog = openDialog()

  // 「＋ 再加一个请求头」不摆了
  assert.equal(findByText(dialog, '＋ 再加一个请求头'), null, '弹窗里不再有「＋ 再加一个请求头」')
  assert.equal(findAll(dialog, (one) => (one.textContent || '').includes('再加一个请求头')).length, 0, '没有任何地方还写「再加一个请求头」')

  // 一个点不动的占位按钮都不剩
  const placeholders = findAll(dialog, isPlaceholder)
  assert.deepEqual(placeholders.map((one) => one.textContent), [], '弹窗里没有灰着、写着「下一步接上」的按钮')

  // 找得出来才算数：往树里塞一个同样的占位按钮，检查器得能揪出来
  const probe = new FakeNode('button')
  probe.setAttribute('title', '下一步接上')
  probe.disabled = true
  probe.textContent = '＋ 检查器用的假按钮'
  dialog.append(probe)
  assert.equal(findAll(dialog, isPlaceholder).length, 1, '检查器能认出占位按钮（反向验证）')
})

test('MCP 弹窗：钥匙那行不再摆「加密存在这台电脑上」那句小字', () => {
  const dialog = openDialog()
  assert.equal(findByText(dialog, '加密存在这台电脑上'), null, '那句小字删了')
})

test('MCP 弹窗：「本机程序」那一页填程序和参数，测一下交给主进程的是 stdio 那份', async () => {
  const doc = makeDocument()
  global.document = doc
  const probed = []
  global.window = {
    settings: {
      abilitiesProbe: async (form) => { probed.push(form); return { ok: true, tools: ['search'] } },
      abilitiesMcpSave: async () => ({ ok: true }),
      abilitiesParse: async () => ({ entries: [], problems: [] }),
    },
    confirm: () => true,
  }
  try {
    openMcpDialog({ form: { id: '', name: '', url: '', authKind: 'header', authName: 'Authorization', hasSavedKey: false } })
    const dialog = doc.body.children[0]
    findByText(dialog, '本机程序').dispatch('click')
    const inputs = findAll(dialog, (one) => one.tagName === 'INPUT' || one.tagName === 'TEXTAREA')
    const command = inputs.find((one) => one.getAttribute('placeholder') === '完整路径，或 npx 这类能直接运行的名字')
    assert.ok(command, '有程序那一格')
    command.value = 'C:\\tools\\search.exe'
    const area = inputs.find((one) => one.tagName === 'TEXTAREA' && one.parentNode && (one.parentNode.children || []).some((kid) => kid.textContent === '参数（一行一个，选填）'))
    assert.ok(area, '有参数那一格')
    area.value = 'serve\n--fast'
    findByText(dialog, '测试').dispatch('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(probed.length, 1, '测一下交给了主进程')
    assert.equal(probed[0].transport, 'stdio')
    assert.equal(probed[0].command, 'C:\\tools\\search.exe')
    assert.equal(probed[0].args, 'serve\n--fast')
  } finally {
    delete global.document
    delete global.window
  }
})

test('能力页的代码里不再有「下一步接上」这句占位话', () => {
  for (const file of ['app/settings/abilities-view.js', 'app/settings/abilities.mjs']) {
    const text = readFileSync(resolve(appRoot, file), 'utf8')
    assert.equal(text.includes('下一步接上'), false, `${file} 里不再写「下一步接上」`)
    assert.equal(text.includes('再加一个请求头'), false, `${file} 里不再写「再加一个请求头」`)
  }
})
