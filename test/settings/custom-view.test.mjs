// 「加一个自定义模型」弹窗：键盘能关掉这一层，标准三项和高级那几样摆在那儿。
// 这一页的界面代码跑在渲染进程里，这里用一个够用的假 DOM 把它摆起来，只验看得见的行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { openCustomDialog } from '../../app/settings/custom-view.js'

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
    this.scrollHeight = 0
    this.clientHeight = 0
    this.scrollTop = 0
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }
  hasAttribute(name) { return name in this.attributes }
  // classList：够 toggle / add / remove / contains 用
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

  click() { this.dispatch('click') }
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
      for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, ...extra })
    },
  }
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

// 树上按 class 找第一个节点
function findByClass(node, name) {
  if (String(node.className || '').split(/\s+/).includes(name)) return node
  for (const child of node.children) {
    const hit = findByClass(child, name)
    if (hit) return hit
  }
  return null
}

// 树上按标签找第一个节点
function findByTag(node, tag) {
  const want = String(tag).toUpperCase()
  if (node.tagName === want) return node
  for (const child of node.children) {
    const hit = findByTag(child, want)
    if (hit) return hit
  }
  return null
}

const PAYLOAD = {
  form: {
    id: null,
    entryId: null,
    modelIndex: null,
    mode: 'new',
    name: '',
    preset: null,
    protocol: 'openai',
    baseUrl: '',
    key: '',
    model: { id: '', contextWindow: null, maxTokens: null, efforts: [], effortValues: {}, vision: false, thinkingFormat: null },
  },
  efforts: [
    { id: 'off', label: '关' },
    { id: 'low', label: '低' },
    { id: 'high', label: '高' },
  ],
  thinkingFormats: ['deepseek', 'qwen'],
}

test('自定义模型弹窗：Esc 关掉这一层，关完把 keydown 监听撤掉', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    openCustomDialog(PAYLOAD)
    assert.equal(doc.body.children.length, 1, '弹窗摆在页面上')
    assert.equal(doc.listeners.get('keydown').size, 1, '开着一个 keydown 监听')

    doc.dispatch('keydown', { key: 'Escape' })
    assert.equal(doc.body.children.length, 0, 'Esc 之后弹窗没了')
    assert.equal(doc.listeners.get('keydown').size, 0, '监听撤掉了')
  } finally {
    delete global.document
  }
})

test('自定义模型弹窗：标准三项都在，值不预填，旁边有一行小字', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    openCustomDialog(PAYLOAD)
    const overlay = doc.body.children[0]
    for (const label of ['模型 ID', '上下文窗口', '最大输出长度']) {
      assert.ok(findByText(overlay, label), `摆着「${label}」`)
    }
    assert.ok(findByText(overlay, '在服务商的模型说明里查'), '旁边有一行小字说去哪里查')
    // 标准三项不预填
    const inputs = []
    const walk = (node) => {
      if (node.tagName === 'INPUT') inputs.push(node)
      for (const child of node.children) walk(child)
    }
    walk(overlay)
    assert.ok(inputs.length >= 3, '标准三项是三个框')
    for (const input of inputs) assert.equal(input.value, '', '框里不预填')
  } finally {
    delete global.document
  }
})

test('自定义模型弹窗：高级那几样收着，里面有输入类型、推理等级、思考参数格式', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    openCustomDialog(PAYLOAD)
    const overlay = doc.body.children[0]
    const advanced = findByTag(overlay, 'DETAILS')
    assert.ok(advanced, '高级那一段是个 details')
    assert.equal(advanced.hasAttribute('open'), false, '高级默认收着')
    assert.ok(findByText(advanced, '输入类型'), '有输入类型')
    assert.ok(findByText(advanced, '推理等级'), '有推理等级')
    assert.ok(findByText(advanced, '思考参数格式'), '有思考参数格式')
    // 推理等级默认空：只有「添加档位」那个按钮，没有档位行
    assert.ok(findByText(advanced, '＋ 添加档位'), '有个添加档位的按钮')
    const efforts = findByClass(advanced, 'efforts')
    assert.ok(efforts, '档位那一片在那儿')
    assert.equal(efforts.children.length, 0, '默认一档都没有')
  } finally {
    delete global.document
  }
})

test('自定义模型弹窗：加一个模型时条目的名字和地址是定死的', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    openCustomDialog({
      ...PAYLOAD,
      form: {
        ...PAYLOAD.form,
        id: 'c-zhipu',
        entryId: 'c-zhipu',
        mode: 'add',
        name: 'GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        preset: 'zhipu',
      },
    })
    const overlay = doc.body.children[0]
    const inputs = []
    const walk = (node) => {
      if (node.tagName === 'INPUT') inputs.push(node)
      for (const child of node.children) walk(child)
    }
    walk(overlay)
    const name = inputs.find((one) => one.value === 'GLM')
    assert.ok(name, '名字框里是 GLM')
    assert.equal(name.readOnly, true, '名字改不了')
    const url = inputs.find((one) => one.value.startsWith('https://'))
    assert.ok(url, '地址框在那儿')
    assert.equal(url.readOnly, true, '地址改不了')
  } finally {
    delete global.document
  }
})
