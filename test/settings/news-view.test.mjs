// 「新闻」页的界面：每个主题一张白卡（名字、开关、删除、一句话、频率和时间、状态行），最下面「＋ 加一个主题」。
// 界面代码跑在渲染进程里，这里用一个够用的假 DOM 把它摆起来，只验看得见的行为。
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 一个够用的假节点
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.children = []
    this.parentNode = null
    this.listeners = new Map()
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.hidden = false
    this.disabled = false
    this.title = ''
    this.dataset = {}
    this.id = ''
    this.attributes = {}
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }

  get classList() {
    const node = this
    const list = () => node.className.split(/\s+/).filter(Boolean)
    const write = (items) => { node.className = items.join(' ') }
    return {
      contains: (name) => list().includes(name),
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

  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this, ...event })
  }

  click() {
    if (this.disabled) return
    if (this.tagName === 'INPUT' && this.type === 'checkbox') {
      this.checked = !this.checked
      this.dispatch('change')
      return
    }
    this.dispatch('click')
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.removeChild(node)
      node.parentNode = this
      this.children.push(node)
    }
  }

  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    const at = before ? this.children.indexOf(before) : -1
    if (at < 0) this.children.push(node)
    else this.children.splice(at, 0, node)
  }

  removeChild(node) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parentNode = null
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }

  focus() { globalThis.document.activeElement = this }

  blur() {
    if (globalThis.document.activeElement === this) globalThis.document.activeElement = null
    this.dispatch('blur')
  }

  // 只认 '#id'、'#id tag'、'.类名' 三种写法
  querySelector(selector) {
    const [first, second] = selector.split(/\s+/)
    const match = (node, part) => part.startsWith('#') ? node.id === part.slice(1)
      : part.startsWith('.') ? node.className.split(/\s+/).includes(part.slice(1))
        : node.tagName === part.toUpperCase()
    const found = find(this, (node) => match(node, first))
    if (!found || !second) return found
    return find(found, (node) => node !== found && match(node, second))
  }
}

function find(node, test) {
  if (test(node)) return node
  for (const child of node.children) {
    const hit = find(child, test)
    if (hit) return hit
  }
  return null
}

// 搭这一页的骨架（照 page.html 里那几个 id）
function setupPage() {
  const body = new FakeNode('body')
  const make = (tag, id) => { const node = new FakeNode(tag); node.id = id; body.append(node); return node }
  make('p', 'news-notice')
  make('div', 'news-cards')
  make('button', 'news-add')
  make('p', 'news-message')
  for (const id of ['news-notify', 'news-perm']) {
    const wrap = make('span', id)
    const input = new FakeNode('input')
    input.type = 'checkbox'
    wrap.append(input)
  }
  globalThis.document = {
    activeElement: null,
    createElement: (tag) => new FakeNode(tag),
    querySelector: (selector) => body.querySelector(selector),
  }
  return body
}

setupPage()
const view = await import('../../app/settings/news-view.js')

// 卡片们
function cards() {
  return document.querySelector('#news-cards').children
}
const part = (card, cls) => find(card, (node) => node.className.split(/\s+/).includes(cls))

function topic(patch = {}) {
  return {
    id: 't-a', name: '网络安全新产品', autoName: '网络安全新产品', want: '网络安全的新产品', at: '08:30', days: 'daily',
    enabled: true, wantEmpty: false, status: { text: '今天 08:31 已生成 · 9 条', tone: 'ok' },
    running: false, queued: false, since: 0, look: true, date: '2026-11-12',
    ...patch,
  }
}

function page(topics, extra = {}) {
  return { topics, canAdd: true, ready: true, readyHint: '', notice: '', prefs: { notify: true, permission: 'deny' }, ...extra }
}

function calls() {
  const log = []
  const handler = (name) => (...args) => log.push([name, ...args])
  return {
    log,
    handlers: Object.fromEntries(['onAdd', 'onWantInput', 'onWantBlur', 'onDays', 'onAt', 'onName', 'onToggleEnabled', 'onRemove', 'onGenerate', 'onLook'].map((name) => [name, handler(name)])),
  }
}

test('每个主题一张卡：名字、那句话、频率、时间、开关、状态行、「看看」都照数据摆；按给的顺序', () => {
  const { handlers } = calls()
  view.renderNews(page([topic(), topic({ id: 't-b', name: '新能源车电池', want: '新能源车', at: '07:30', days: 'weekdays', look: false, status: { text: '今天未到时间', tone: '' } })]), handlers)
  assert.equal(cards().length, 2)
  const [a, b] = cards()
  assert.equal(part(a, 'news-name').value, '网络安全新产品')
  assert.equal(part(a, 'news-want').value, '网络安全的新产品')
  assert.equal(part(a, 'news-at').value, '08:30')
  assert.equal(part(a, 'news-status').textContent, '今天 08:31 已生成 · 9 条')
  assert.equal(part(a, 'news-look').hidden, false)
  assert.equal(part(a, 'news-generate').textContent, '立即生成')
  assert.equal(find(a, (node) => node.type === 'checkbox').checked, true)
  assert.equal(part(b, 'news-name').value, '新能源车电池')
  assert.equal(part(b, 'news-days').value, 'weekdays')
  assert.equal(part(b, 'news-look').hidden, true)
  // 换个顺序、删掉一个：卡跟着变，节点重用
  view.renderNews(page([topic({ id: 't-b', name: '新能源车电池' })]), handlers)
  assert.equal(cards().length, 1)
  assert.equal(cards()[0], b)
})

test('正在生成：状态行写「正在生成… 已用 …」，按钮写「生成中…」点不了；排队中也点不了', () => {
  const { handlers } = calls()
  const since = Date.now() - 80_000
  view.renderNews(page([topic({ running: true, since, look: false, status: { text: '', tone: 'busy' } }), topic({ id: 't-b', queued: true, status: { text: '排队中，等前一个生成完', tone: 'busy' } })]), handlers)
  const [a, b] = cards()
  assert.match(part(a, 'news-status').textContent, /^正在生成… 已用 1 分 2\d 秒$/)
  assert.equal(part(a, 'news-generate').textContent, '生成中…')
  assert.equal(part(a, 'news-generate').disabled, true)
  assert.equal(part(b, 'news-status').textContent, '排队中，等前一个生成完')
  assert.equal(part(b, 'news-generate').disabled, true)
  view.renderNews(page([]), handlers)
})

test('输入、频率、时间、开关、删除、立即生成、看看都转给外面，带着那张卡的 id', () => {
  const { log, handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  const card = cards()[0]
  part(card, 'news-want').dispatch('input')
  part(card, 'news-want').dispatch('blur')
  part(card, 'news-days').dispatch('change')
  part(card, 'news-at').dispatch('change')
  find(card, (node) => node.type === 'checkbox').click()
  part(card, 'news-remove').click()
  part(card, 'news-generate').click()
  part(card, 'news-look').click()
  assert.deepEqual(log.map((one) => one.slice(0, 2)), [
    ['onWantInput', 't-a'], ['onWantBlur', 't-a'], ['onDays', 't-a'], ['onAt', 't-a'],
    ['onToggleEnabled', 't-a'], ['onRemove', 't-a'], ['onGenerate', 't-a'], ['onLook', 't-a'],
  ])
  assert.equal(log[5][2], '网络安全新产品', '删除带着名字（问那一句要用）')
  // 再画一遍不重复接
  view.renderNews(page([topic()]), handlers)
  part(cards()[0], 'news-look').click()
  assert.equal(log.filter((one) => one[0] === 'onLook').length, 2)
  view.renderNews(page([]), handlers)
})

test('那句话空着：「立即生成」灰样子，点了不生成、写那一句；开关也打不开', () => {
  const { log, handlers } = calls()
  view.renderNews(page([topic({ want: '', wantEmpty: true, enabled: false })]), handlers)
  const card = cards()[0]
  assert.equal(part(card, 'news-generate').classList.contains('off'), true)
  part(card, 'news-generate').click()
  assert.equal(document.querySelector('#news-message').textContent, '先写一句想看什么')
  find(card, (node) => node.type === 'checkbox').click()
  assert.equal(find(card, (node) => node.type === 'checkbox').checked, false)
  assert.equal(log.length, 0)
  view.renderNews(page([]), handlers)
})

test('不能联网搜：「立即生成」真点不了，停上去写着为什么', () => {
  const { handlers } = calls()
  view.renderNews(page([topic()], { ready: false, readyHint: '仅支持 DeepSeek 原生搜索' }), handlers)
  const button = part(cards()[0], 'news-generate')
  assert.equal(button.disabled, true)
  assert.equal(button.title, '仅支持 DeepSeek 原生搜索')
  view.renderNews(page([]), handlers)
})

test('正打着字的时候重画，不把刚打的字盖掉', () => {
  const { handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  const want = part(cards()[0], 'news-want')
  want.focus()
  want.value = '网络安全的新产品，只要国内'
  view.renderNews(page([topic()]), handlers)
  assert.equal(want.value, '网络安全的新产品，只要国内')
  document.activeElement = null
  view.renderNews(page([]), handlers)
})

test('卡顶上那个名字是个输入框：最多 8 个字，回车存，失焦也存，Esc 放弃', () => {
  const { log, handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  const input = part(cards()[0], 'news-name')
  assert.equal(input.tagName, 'INPUT')
  assert.equal(input.maxLength, 8)
  assert.equal(input.value, '网络安全新产品')
  assert.equal(input.placeholder, '网络安全新产品', '清空了回到自动：占位是自动起的那个名字')
  assert.equal(input.title, '点一下可以改，最多 8 个字；清空就按那句话自动起')
  // 打字：超过 8 个字截掉，不能当路径用的字符去掉
  input.value = '一二三四五六七八九十'
  input.dispatch('input')
  assert.equal(input.value, '一二三四五六七八')
  input.value = 'a/b:c'
  input.dispatch('input')
  assert.equal(input.value, 'abc')
  // 回车：存
  input.value = '安全新品'
  input.dispatch('input')
  input.dispatch('keydown', { key: 'Enter' })
  assert.deepEqual(log.at(-1), ['onName', 't-a', '安全新品'])
  // 失焦：也存
  input.value = '别的名字'
  input.dispatch('input')
  input.dispatch('blur')
  assert.deepEqual(log.at(-1), ['onName', 't-a', '别的名字'])
  // Esc：这一次改的丢掉，不存
  input.value = '写了又不要'
  input.dispatch('input')
  input.dispatch('keydown', { key: 'Escape' })
  assert.equal(input.value, '别的名字', '回到上一次存下的名字')
  assert.equal(log.filter((one) => one[0] === 'onName').length, 2, 'Esc 不存')
  view.renderNews(page([]), handlers)
})

test('名字改过以后跟着那张卡一起存；存上了就不带了', () => {
  const { handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  assert.equal(view.newsFormValues('t-a').name, undefined, '没改过名字：这次不带')
  const input = part(cards()[0], 'news-name')
  input.value = '安全新品'
  input.dispatch('input')
  input.dispatch('keydown', { key: 'Enter' })
  assert.equal(view.newsFormValues('t-a').name, '安全新品', '改过的名字跟着存')
  // 存上了（清单上的名字变了）：这次就不带了
  view.renderNews(page([topic({ name: '安全新品' })]), handlers)
  assert.equal(view.newsFormValues('t-a').name, undefined)
})

test('正打着字的时候重画，名字也不盖掉', () => {
  const { handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  const input = part(cards()[0], 'news-name')
  input.focus()
  input.value = '安全新'
  view.renderNews(page([topic()]), handlers)
  assert.equal(input.value, '安全新')
  document.activeElement = null
  view.renderNews(page([]), handlers)
})

test('「＋ 加一个主题」：点了在最下面加一张空卡；空卡存成真的一项后换成新 id；订满了按钮灰着写为什么', () => {
  const { log, handlers } = calls()
  view.renderNews(page([topic()]), handlers)
  document.querySelector('#news-add').click()
  assert.deepEqual(log.at(-1), ['onAdd'])
  view.renderNews(page([topic()]), handlers, true)
  assert.equal(cards().length, 2)
  const blank = cards()[1]
  assert.equal(part(blank, 'news-name').placeholder, '新主题')
  assert.equal(document.querySelector('#news-add').disabled, true, '空卡还在时不再加')
  // 空卡里写的字带得走
  part(blank, 'news-want').value = '新能源车'
  assert.equal(view.newsFormValues(view.NEW_CARD).want, '新能源车')
  view.adoptNewCard('t-new')
  view.renderNews(page([topic(), topic({ id: 't-new', name: '新能源车', want: '新能源车' })]), handlers)
  assert.equal(cards()[1], blank, '还是那张卡')
  part(blank, 'news-look').click()
  assert.deepEqual(log.at(-1), ['onLook', 't-new'])
  // 订满了
  view.renderNews(page([topic()], { canAdd: false }), handlers)
  assert.equal(document.querySelector('#news-add').disabled, true)
  assert.equal(document.querySelector('#news-add').getAttribute('title'), '最多订 5 个主题')
  view.renderNews(page([]), handlers)
})

test('整页的设置：好了说不说、后台权限两个开关，照给的摆，拨了转给外面', () => {
  const log = []
  view.renderNewsPrefs({ notify: false, permission: 'allow' }, { onToggle: (key, on) => log.push([key, on]) })
  const notify = document.querySelector('#news-notify input')
  const perm = document.querySelector('#news-perm input')
  assert.equal(notify.checked, false)
  assert.equal(perm.checked, true)
  notify.click()
  perm.click()
  assert.deepEqual(log, [['notify', true], ['permission', false]])
})

test('page.html：卡片由脚本画，页面上只有容器和「＋ 加一个主题」；「休眠错过后补生成」那一行撤了', () => {
  const html = readFileSync(join(appRoot, 'app', 'settings', 'page.html'), 'utf8')
  assert.match(html, /id="news-cards"/)
  assert.match(html, /id="news-add"[^>]*data-t="newsPage\.add"/)
  assert.doesNotMatch(html, /news-catchup/)
  assert.doesNotMatch(html, /id="news-want"/)
})
