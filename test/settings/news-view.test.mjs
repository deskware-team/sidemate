// 「加一个主题」弹窗：只问「想看什么」和「什么时候」，没有「从哪看」。
// 这一页的界面代码跑在渲染进程里，这里用一个够用的假 DOM 把它摆起来，只验看得见的行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openNewsDialog, renderNews, renderNewsPrefs } from '../../app/settings/news-view.js'
import { failedRows, newsRows } from '../../app/settings/news.mjs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 不能订的时候，按钮旁边写的那一句
const NOT_READY_TEXT = '仅支持 DeepSeek 原生搜索'

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

  // 树上按选择器找第一个子孙节点：只够用 #id 和 tag 两种写法
  querySelector(selector) {
    return findNode(this, (one) => {
      if (selector.startsWith('#')) return one.attributes.id === selector.slice(1)
      return one.tagName === selector.toUpperCase()
    })
  }

  // 点一下：勾选框自己翻一下，外面的 label 带着里面的勾选框一起翻
  click() {
    this.dispatch('click')
    if (this.tagName === 'INPUT' && (this.getAttribute('type') === 'checkbox' || this.getAttribute('type') === 'radio')) {
      this.checked = !this.checked
      this.dispatch('change')
      return
    }
    let node = this.parentNode
    while (node) {
      if (node.tagName === 'LABEL') {
        const box = findInput(node)
        if (box && !box.disabled) {
          box.checked = !box.checked
          box.dispatch('change')
        }
        return
      }
      node = node.parentNode
    }
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

  // 往上找第一个合的：只认 '.类名' 这一种写法
  closest(selector) {
    let cur = this
    while (cur) {
      if (selector.startsWith('.') && cur.className.split(/\s+/).includes(selector.slice(1))) return cur
      cur = cur.parentNode
    }
    return null
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }

  focus() {}
}

// 树上找第一个符合条件的节点
function findNode(node, test) {
  if (test(node)) return node
  for (const child of node.children) {
    const hit = findNode(child, test)
    if (hit) return hit
  }
  return null
}

// label 里那个勾选框
function findInput(node) {
  return findNode(node, (one) => one.tagName === 'INPUT' && one.getAttribute('type') === 'checkbox')
}

// 树上按字找第一个节点
function findByText(node, text) {
  return findNode(node, (one) => one.textContent === text)
}

// 这个节点在不在某个节点里面
function inside(node, parent) {
  let cur = node
  while (cur) {
    if (cur === parent) return true
    cur = cur.parentNode
  }
  return false
}

// 假 document：body 装着弹窗，keydown 的监听记下来
function makeDocument() {
  const doc = {
    body: new FakeNode('body'),
    listeners: new Map(),
    createElement(tag) { return new FakeNode(tag) },
    // 页面里那几个节点：谁问都给同一个（主题列表、加主题那一行、整页设置那两个开关）
    nodes: {},
    querySelector(selector) {
      if (selector === '#news-list') {
        if (!doc.list) {
          doc.list = new FakeNode('ul')
          doc.body.append(doc.list)
        }
        return doc.list
      }
      const hit = /^#([\w-]+)( input)?$/.exec(selector)
      if (hit) {
        if (!doc.nodes[hit[1]]) {
          // 开关都摆在一行里（页面上的 .pref-row）
          const row = new FakeNode('div')
          row.className = 'pref-row'
          const wrap = new FakeNode('span')
          const input = new FakeNode('input')
          input.setAttribute('type', 'checkbox')
          wrap.append(input)
          row.append(wrap)
          doc.body.append(row)
          doc.nodes[hit[1]] = wrap
        }
        return hit[2] ? findInput(doc.nodes[hit[1]]) : doc.nodes[hit[1]]
      }
      return null
    },
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
  // 「加一个主题」那一行：按钮旁边一句小字
  const addRow = new FakeNode('p')
  const addButton = new FakeNode('button')
  addButton.setAttribute('id', 'news-add')
  const addNote = new FakeNode('span')
  addNote.className = 'fine'
  addRow.append(addButton, addNote)
  doc.body.append(addRow)
  doc.nodes['news-add'] = addButton
  doc.nodes['news-add-note'] = addNote
  return doc
}

// 弹窗是 body 里最后一个摆上去的东西
function dialogOf(doc) {
  return doc.body.children[doc.body.children.length - 1]
}

// 摆一个弹窗出来，返回整棵弹窗树
function openDialog() {
  const doc = makeDocument()
  global.document = doc
  global.window = { settings: {} }
  openNewsDialog({
    form: {
      id: '',
      name: 'AI 行业',
      want: '大模型的新东西',
      at: '08:30',
      days: 'daily',
    },
  })
  return dialogOf(doc)
}

test('加主题弹窗：没有「从哪看」，也没有 RSS、自动搜、MCP 的勾选框', () => {
  const dialog = openDialog()
  try {
    for (const word of ['从哪看', 'RSS', '自动搜', 'MCP']) {
      const hit = findNode(dialog, (one) => String(one.textContent).includes(word))
      assert.equal(hit, null, `弹窗里没有「${word}」`)
    }
    const box = findNode(dialog, (one) => one.tagName === 'INPUT' && one.getAttribute('type') === 'checkbox')
    assert.equal(box, null, '弹窗里一个勾选框都没有')
    const feed = findNode(dialog, (one) => one.getAttribute('placeholder') === '贴一个 RSS 地址')
    assert.equal(feed, null, '没有贴 RSS 地址的入口')
  } finally {
    delete global.document
    delete global.window
  }
})

test('加主题弹窗：只问主题名、想看什么、什么时候，想看什么不举例', () => {
  const dialog = openDialog()
  try {
    for (const label of ['主题', '关注内容', '时间']) {
      assert.ok(findByText(dialog, label), `有「${label}」这一项`)
    }
    const area = findNode(dialog, (one) => one.tagName === 'TEXTAREA')
    assert.ok(area, '想看什么是一个多行输入框')
    assert.equal(area.getAttribute('placeholder'), null, '占位字不举例')
    assert.ok(findByText(dialog, '每天'), '什么时候里有「每天」')
    assert.ok(findByText(dialog, '工作日'), '什么时候里有「工作日」')
  } finally {
    delete global.document
    delete global.window
  }
})

test('加主题弹窗：不再写新闻从哪来', () => {
  const dialog = openDialog()
  try {
    const line = findByText(dialog, '新闻内容来自你的模型搜到的网页，桌伴只做整理，不提供也不推荐新闻来源。')
    assert.equal(line, null, '这句已经删了')
  } finally {
    delete global.document
    delete global.window
  }
})

test('加主题弹窗：自动配置权限：拒绝（默认）/ 允许，标签后面有个 i 说明', async () => {
  const doc = makeDocument()
  global.document = doc
  const saved = []
  global.window = {
    settings: {
      newsSave: async (form) => {
        saved.push(form)
        return { ok: true, rows: [], topic: { id: 't-new', name: form.name } }
      },
    },
  }
  try {
    openNewsDialog({ form: { id: '', name: 'AI 行业', want: '新东西', at: '08:30', days: 'daily' } })
    const dialog = dialogOf(doc)
    assert.ok(findByText(dialog, '自动配置权限'), '有「自动配置权限」这一项')
    assert.ok(findByText(dialog, '拒绝'), '有「拒绝」')
    assert.ok(findByText(dialog, '允许'), '有「允许」')
    // 标签后面的 i：停上去看说明
    const info = findByText(dialog, 'i')
    assert.ok(info, '标签后面有个 i')
    assert.equal(info.getAttribute('title'), '自动赋予模型后台生成时的运行权限，拒绝可能会导致生成失败')
    // 默认是拒绝
    findByText(dialog, '保存').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(saved.length, 1)
    assert.equal(saved[0].permission, 'deny')
    // 选「允许」再存
    openNewsDialog({ form: { id: '', name: 'AI 行业', want: '新东西', at: '08:30', days: 'daily' } })
    const second = dialogOf(doc)
    findByText(second, '允许').click()
    findByText(second, '保存').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(saved.length, 2)
    assert.equal(saved[1].permission, 'allow')
  } finally {
    delete global.document
    delete global.window
  }
})

test('加主题弹窗：只填名字、想看什么和时间就能存下', async () => {
  const doc = makeDocument()
  global.document = doc
  const saved = []
  global.window = {
    settings: {
      newsSave: async (form) => {
        saved.push(form)
        return { ok: true, rows: [], topic: { id: 't-new', name: form.name } }
      },
    },
  }
  try {
    openNewsDialog({ form: { id: '', name: '新能源汽车', want: '新车和降价', at: '08:30', days: 'daily' } })
    const dialog = dialogOf(doc)
    findByText(dialog, '保存').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(saved.length, 1, '存了一次')
    assert.equal(saved[0].name, '新能源汽车')
    assert.equal(saved[0].want, '新车和降价')
    assert.equal(saved[0].at, '08:30')
    assert.equal(saved[0].days, 'daily')
    assert.equal('search' in saved[0], false, '不问从哪看')
    assert.equal('rss' in saved[0], false, '不问从哪看')
    assert.equal('mcp' in saved[0], false, '不问从哪看')
    assert.equal(findNode(doc.body, (one) => String(one.className).includes('overlay')), null, '存上了，弹窗关掉了')
  } finally {
    delete global.document
    delete global.window
  }
})

test('加主题弹窗：没有「自动找」「换一批」，也没有永远灰着的「下一步接上」按钮', () => {
  const dialog = openDialog()
  try {
    for (const word of ['自动找', '换一批']) {
      const hit = findNode(dialog, (one) => String(one.textContent).includes(word))
      assert.equal(hit, null, `弹窗里没有「${word}」`)
    }
    const dead = findNode(dialog, (one) => one.tagName === 'BUTTON' && one.getAttribute('title') === '下一步接上')
    assert.equal(dead, null, '没有写着「下一步接上」的按钮')
  } finally {
    delete global.document
    delete global.window
  }
})

// ————————————————————————— 「加一个主题」那个按钮 —————————————————————————

test('新闻页：模型不能联网搜时，「加一个主题」灰着，旁边写清楚为什么', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    renderNews({ rows: [], empty: true, ready: false, readyHint: NOT_READY_TEXT }, {})
    const button = doc.querySelector('#news-add')
    assert.equal(button.disabled, true, '按钮灰着')
    assert.equal(button.className.includes('off'), true, '灰着的样子')
    const note = doc.querySelector('#news-add-note')
    assert.equal(note.textContent, NOT_READY_TEXT, '旁边那一行写清楚了')
  } finally {
    delete global.document
  }
})

test('新闻页：能联网搜了（配了钥匙或者开了工具），「加一个主题」就能点，旁边不摆字', () => {
  for (const ready of [true, false]) {
    const doc = makeDocument()
    global.document = doc
    try {
      renderNews({ rows: [], empty: true, ready: true }, {})
      const button = doc.querySelector('#news-add')
      assert.equal(button.disabled, false, '能点')
      assert.equal(button.className.includes('off'), false, '不是灰的样子')
      const note = doc.querySelector('#news-add-note')
      assert.equal(note.textContent, '', '旁边不摆字')
    } finally {
      delete global.document
    }
  }
})

// ————————————————————————— 「现在生成」那几种样子 —————————————————————————

// 两个主题的行
function twoRows(ready = true) {
  return newsRows([
    { id: 't-1', name: 'AI 行业', want: '大模型的新东西', at: '08:30' },
    { id: 't-2', name: '股市', want: '行情', at: '09:00' },
  ], { ready, readyHint: NOT_READY_TEXT })
}

test('新闻列表：模型不能联网搜时，「现在生成」灰着，主题照样列着', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    renderNews({ rows: twoRows(false), busy: '' }, {})
    const list = doc.querySelector('#news-list')
    assert.equal(list.children.length, 2, '两个主题都列着')
    const button = findByText(list, '立即生成')
    assert.equal(button.disabled, true, '「现在生成」灰着')
    assert.equal(button.getAttribute('title'), NOT_READY_TEXT, '鼠标停上去写着为什么')
    const edit = findByText(list, '修改')
    assert.equal(edit.disabled, false, '「改」还能点')
  } finally {
    delete global.document
  }
})

test('新闻列表：点「现在生成」那一行变成灰的「生成中…」，别的行也先灰掉', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    const called = []
    renderNews({ rows: twoRows(), busy: 't-1' }, { onGenerate: (row) => called.push(row.id) })
    const list = doc.querySelector('#news-list')
    const busy = findByText(list, '生成中…')
    assert.ok(busy, '找得到「生成中…」')
    assert.equal(busy.disabled, true, '生成中的那一行点不了')
    const other = findByText(list, '立即生成')
    assert.ok(other, '另一行还是「现在生成」')
    assert.equal(other.disabled, true, '一次只生成一份，别的行先灰掉')
    assert.equal(other.getAttribute('title'), '', '不再写「下一步接上」')
  } finally {
    delete global.document
  }
})

test('新闻列表：没在生成的时候，「现在生成」能点，点了就告诉外面一声', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    const called = []
    renderNews({ rows: twoRows(), busy: '' }, { onGenerate: (row) => called.push(row.id) })
    const list = doc.querySelector('#news-list')
    const button = findByText(list, '立即生成')
    assert.equal(button.disabled, false, '能点')
    button.click()
    assert.deepEqual(called, ['t-1'], '点了哪一行告诉外面')
  } finally {
    delete global.document
  }
})

test('新闻列表：生成出来以后，第二行末尾写着今天交上的时刻', async () => {
  const doc = makeDocument()
  global.document = doc
  try {
    const rows = twoRows().map((row) => (
      row.id === 't-1' ? { ...row, status: { text: '今天 08:31 已生成', tone: 'ok' } } : row
    ))
    renderNews({ rows, busy: '' }, {})
    const list = doc.querySelector('#news-list')
    const status = findByText(list, '今天 08:31 已生成')
    assert.ok(status, '第二行末尾有那句话')
    assert.equal(status.className.includes('rowstatus'), true)
    assert.equal(findByText(list, '生成中…'), null, '按钮恢复原样')
  } finally {
    delete global.document
  }
})

test('新闻列表：没生成出来，第二行末尾用红字写那句话', async () => {
  const doc = makeDocument()
  global.document = doc
  try {
    const rows = failedRows(twoRows(), 't-1', '模型没交出选题')
    renderNews({ rows, busy: '' }, {})
    const list = doc.querySelector('#news-list')
    const status = findByText(list, '模型没交出选题')
    assert.ok(status, '第二行末尾写着那句话')
    assert.equal(status.className.includes('bad'), true, '是红字')
  } finally {
    delete global.document
  }
})

test('新闻页：没配密钥、也没搜索工具时，页面上方写一句提醒', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    renderNews({ rows: twoRows(), busy: '', notice: '没配置 DeepSeek 密钥和搜索工具，可能搜不到新闻' }, {})
    const list = doc.querySelector('#news-list')
    const note = findByText(list, '没配置 DeepSeek 密钥和搜索工具，可能搜不到新闻')
    assert.ok(note, '列表上方有那句话')
    assert.equal(list.children[0], note, '那句在最前面')
    assert.equal(list.children.length, 3, '两个主题 + 那句提醒')
  } finally {
    delete global.document
  }
})

test('新闻页：配了密钥或者开了搜索工具，就不写那句提醒', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    renderNews({ rows: twoRows(), busy: '', notice: '' }, {})
    const list = doc.querySelector('#news-list')
    assert.equal(list.children.length, 2, '只有两个主题')
  } finally {
    delete global.document
  }
})

test('整页的设置：只有「好了说不说」一个开关；「休眠错过后补生成」那一行撤了，页面里没有「交成」那行', () => {
  const doc = makeDocument()
  global.document = doc
  try {
    const calls = []
    renderNewsPrefs({ catchUp: false, notify: true }, { onToggle: (key, on) => calls.push([key, on]) })
    // 错过的都不补跑了，那一行从页面上拿掉
    assert.equal(doc.body.children.includes(doc.nodes['news-catchup'].closest('.pref-row')), false, '那一行没了')
    assert.equal(doc.nodes['news-notify'].children[0].checked, true, '好了说不说照读进来的摆')
    doc.nodes['news-notify'].children[0].dispatch('change')
    assert.deepEqual(calls, [['notify', true]], '拨了开关告诉外面一声')
    // 页面里连「交成」那一行的节点都没了
    const html = readFileSync(join(appRoot, 'app', 'settings', 'page.html'), 'utf8')
    assert.equal(html.includes('news-output'), false)
    assert.equal(html.includes('交成'), false)
  } finally {
    delete global.document
  }
})

test('加主题弹窗：「保存并生成」存完关掉弹窗，再告诉外面去生成', async () => {
  const doc = makeDocument()
  global.document = doc
  const saved = []
  global.window = {
    settings: {
      newsSave: async (form) => ({ ok: true, rows: [], topic: { id: 't-new', name: form.name } }),
    },
  }
  try {
    openNewsDialog(
      { form: { id: '', name: 'AI 行业', want: '新东西', at: '08:30', days: 'daily' } },
      { onSaved: (back, options) => saved.push({ back, options }) },
    )
    const dialog = dialogOf(doc)
    assert.equal(findByText(dialog, '生成下一步接上'), null, '不再写「生成下一步接上」')
    findByText(dialog, '保存并生成').click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(saved.length, 1, '存完告诉外面一声')
    assert.equal(saved[0].options.generate, true, '而且是接着去生成')
    assert.equal(findNode(doc.body, (one) => String(one.className).includes('overlay')), null, '弹窗关掉了')
  } finally {
    delete global.document
    delete global.window
  }
})
