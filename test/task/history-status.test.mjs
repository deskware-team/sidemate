// 历史下拉和「全部对话」那几行的状态标记：
// - 纯逻辑：一条对话现在什么状态（statusMap）、状态签名变了没有（statusChanged）、标记长什么样（markerOf）
// - 主进程：runner.statusOf（在跑的是 running、后台跑完还没回来看的是 unread、正看着的算看过）
// - 页面：标记摆在时间左边（假 DOM），状态变了开着的那层要重新要一遍列表

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createHistory } from '../../app/task/history.mjs'
import { dropdownGroups, markerOf, pageGroups, statusChanged, statusMap } from '../../app/task/history-view.mjs'
import { createRunner } from '../../app/task/run.mjs'

const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* 删不掉就留给系统清 */ } }
})

// ───────────────────────────── 纯逻辑

test('状态：在跑的是 running，在后台跑完还没回来看的是 unread，正看着的算看过', () => {
  const map = statusMap([
    { id: 'a', running: true, shown: true },
    { id: 'b', running: false, shown: false },
    { id: 'c', running: false, shown: true },
    { id: '', running: true, shown: false },
  ])
  assert.equal(map.a, 'running', '在跑的（前台后台都算）')
  assert.equal(map.b, 'unread', '后台跑完了还没回来看')
  assert.equal(map.c, '', '正看着的：用户已经看到了')
  assert.equal(map[''], undefined, '没记上哪条对话的不算')
  assert.deepEqual(statusMap(null), {}, '乱七八糟的输入也不炸')
})

test('状态签名：变了才要重新要一遍列表', () => {
  assert.equal(statusChanged('', 'a:running'), true, '第一次看见签名算变了')
  assert.equal(statusChanged('a:running', 'a:running'), false, '没变不要')
  assert.equal(statusChanged('a:running', 'a:unread'), true, '变了要')
  assert.equal(statusChanged('a:running', ''), true, '都没了也算变了：要重新要一遍')
  assert.equal(statusChanged('', ''), false, '一直都没有签名就不要')
})

test('标记：在跑的是转圈，跑完还没看的是绿点，别的没有', () => {
  assert.deepEqual(markerOf('running'), { cls: 'run', label: '进行中' })
  assert.deepEqual(markerOf('unread'), { cls: 'unread', label: '有新结果' })
  assert.equal(markerOf(''), null)
  assert.equal(markerOf('别的'), null)
})

test('下拉和整页的行：状态带着走', () => {
  const items = [
    { id: 'a', title: '写周报', kind: 'task', updatedAt: Date.now(), status: 'running' },
    { id: 'b', title: '读新闻', kind: 'task', updatedAt: Date.now(), status: 'unread' },
    { id: 'c', title: '旧的', kind: 'task', updatedAt: Date.now(), status: '' },
  ]
  const rows = dropdownGroups(items, 'a').flatMap((one) => one.rows)
  assert.equal(rows.find((one) => one.id === 'a').status, 'running')
  assert.equal(rows.find((one) => one.id === 'b').status, 'unread')
  assert.equal(rows.find((one) => one.id === 'c').status, '')
  const page = pageGroups(items).flatMap((one) => one.rows)
  assert.equal(page.find((one) => one.id === 'b').status, 'unread')
})

// ───────────────────────────── 主进程

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-histstatus-'))
  roots.push(root)
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const finishes = [] // 每轮跑完的回调：测试里自己叫它
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    prepareTask: async () => ({ kind: 'files', workspace: join(root, 'ws'), copied: [], skipped: [], snapshot: [] }),
    // 这一轮不自己跑完：等测试叫 finishes 里那个
    runTask: (options) => ({
      sessionId: 's1',
      cancel() {},
      done: new Promise((resolve) => { finishes.push(() => resolve({ type: 'end', taskId: options.taskId, at: 9, status: 'done' })) }),
    }),
    history,
    log: () => {},
    onView: () => {},
    onPet: () => {},
  })
  return { runner, finishes, history }
}

test('runner.statusOf：在跑的、后台跑完还没看的、没有', async () => {
  const { runner, finishes } = harness()
  runner.act({ type: 'send', text: '写一份周报' })
  // 起来了：historyId 也记上了
  let id = ''
  for (let i = 0; i < 100 && !id; i += 1) {
    await delay(5)
    id = runner.view().top.historyId
  }
  assert.ok(id, '这条对话记上号了')
  assert.equal(runner.statusOf(id), 'running', '正在跑')

  // 切到别的对话去：这条留在后台接着跑，还是 running
  runner.act({ type: 'new' })
  await delay(20)
  assert.equal(runner.statusOf(id), 'running', '切走了还在后台跑')

  // 后台跑完了，用户还没回来看：unread
  finishes[0]()
  for (let i = 0; i < 100 && runner.statusOf(id) !== 'unread'; i += 1) await delay(5)
  assert.equal(runner.statusOf(id), 'unread', '后台跑完了还没回来看')

  // 别的对话、没编号的：没有
  assert.equal(runner.statusOf('不存在的'), '')
  assert.equal(runner.statusOf(''), '')
})

// ───────────────────────────── 页面（假 DOM）

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.children = []
    this.dataset = {}
    this.listeners = new Map()
    this.title = ''
    this.type = ''
    this.hidden = false
    this.value = ''
    this._text = ''
  }

  get textContent() {
    if (!this.children.length) return this._text
    return this.children.map((one) => one.textContent).join('')
  }

  set textContent(value) {
    this._text = String(value ?? '')
    this.children = []
  }

  get lastChild() { return this.children[this.children.length - 1] }

  get classList() {
    const node = this
    const list = () => String(node.className || '').split(/\s+/).filter(Boolean)
    return {
      add: (...names) => { node.className = [...new Set([...list(), ...names])].join(' ') },
      remove: (...names) => { node.className = list().filter((one) => !names.includes(one)).join(' ') },
      contains: (name) => list().includes(name),
      toggle: (name, on) => { if (on === false) node.classList.remove(name); else node.classList.add(name) },
    }
  }

  append(...nodes) { for (const one of nodes) this.children.push(one) }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) || []
    list.push(fn)
    this.listeners.set(type, list)
  }

  focus() {}
}

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node)
  for (const one of node.children || []) findAll(one, pred, out)
  return out
}

const hasClass = (node, name) => String(node.className || '').split(/\s+/).includes(name)

test('页面：标记摆在时间左边，状态变了开着的那层要重新要列表', async () => {
  globalThis.document = { createElement: (tag) => new FakeNode(tag) }
  const { createHistoryView } = await import('../../app/task/history-view.js')

  const items = [
    { id: 'a', title: '写周报', kind: 'task', updatedAt: Date.now(), status: 'running' },
    { id: 'b', title: '读新闻', kind: 'task', updatedAt: Date.now(), status: 'unread' },
    { id: 'c', title: '旧的', kind: 'task', updatedAt: Date.now(), status: '' },
  ]
  const calls = []
  const list = async (payload) => { calls.push(payload); return { items } }
  const where = new FakeNode('div')
  const panel = new FakeNode('div')
  const view = createHistoryView({ where, panel, list, open: async () => ({ ok: true }) })

  view.toggle()
  await delay(20)
  const rows = findAll(where, (one) => hasClass(one, 'hrow') && one.dataset.id)
  assert.equal(rows.length, 3, '三行都画出来了')

  const metaOf = (id) => rows.find((one) => one.dataset.id === id).children.find((one) => hasClass(one, 'hmeta'))
  const run = metaOf('a').children.find((one) => hasClass(one, 'hmark'))
  assert.ok(run, '在跑的那行有个标记')
  assert.ok(hasClass(run, 'run'), '是转圈')
  assert.equal(run.title, '进行中', '停上去有那句话')
  assert.equal(metaOf('a').children.indexOf(run), 0, '标记在时间左边')
  assert.equal(metaOf('a').children[1].textContent.length > 0, true, '后面是时间')

  const unread = metaOf('b').children.find((one) => hasClass(one, 'hmark'))
  assert.ok(unread && hasClass(unread, 'unread'), '跑完没看的是个绿点')
  assert.equal(unread.title, '有新结果')
  assert.equal(metaOf('c').children.find((one) => hasClass(one, 'hmark')), undefined, '没状态的不画标记')

  // 整页那套行也有
  view.openPage()
  await delay(20)
  const pageRows = findAll(panel, (one) => hasClass(one, 'hrow') && one.dataset.id)
  const pageMeta = pageRows.find((one) => one.dataset.id === 'b').children.find((one) => hasClass(one, 'hmeta'))
  assert.ok(pageMeta.children.find((one) => hasClass(one, 'hmark')), '整页那套行也有标记')
  assert.ok(pageMeta.children.find((one) => hasClass(one, 'hmark')).title === '有新结果')

  // 状态变了才重新要列表：没变不要
  const before = calls.length
  view.setView({ currentId: 'a', statusSig: 'a:running,b:unread' })
  await delay(20)
  const after = calls.length
  assert.ok(after > before, '签名第一次来，要一次')
  view.setView({ currentId: 'a', statusSig: 'a:running,b:unread' })
  await delay(20)
  assert.equal(calls.length, after, '没变不要')
  view.setView({ currentId: 'a', statusSig: 'a:unread,b:unread' })
  await delay(20)
  assert.ok(calls.length > after, '变了要一次')
})
