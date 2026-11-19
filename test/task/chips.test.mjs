// 气泡里的小块：发出去的材料能点开看。
// - 气泡里出小块，不出「带了…」那行字；图片带缩略图
// - 点一块：发出去的打开请求指向工作区里的那份拷贝（不开原件）
// - 工作区外的路径主进程不认（.. 跳出、符号链接跳出都不行）
// - 拷贝不在了：灰着，鼠标是箭头
// - 历史对话（还有「全部对话」里点开的）也有这些小块

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { chipsOf, openablePath } from '../../app/task/chips.mjs'
import { createChipRow } from '../../app/task/chips-view.js'
import { createHistory } from '../../app/task/history.mjs'
import { restoreState } from '../../app/task/history-open.mjs'
import { createRunner } from '../../app/task/run.mjs'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')
const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `sidemate-${tag}-`))
  roots.push(dir)
  return dir
}

// 一个够用的假 DOM：建节点、挂事件、append、classList、几个属性
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.className = ''
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.listeners = new Map()
    this.dataset = {}
    this._text = ''
    this.title = ''
    this.type = ''
    this.disabled = false
    this.hidden = false
    this.src = ''
    this.alt = ''
  }

  get classList() {
    const node = this
    const list = () => node.className.split(/\s+/).filter(Boolean)
    return {
      add: (...names) => {
        const have = list()
        for (const name of names) if (!have.includes(name)) have.push(name)
        node.className = have.join(' ')
      },
      remove: (...names) => { node.className = list().filter((one) => !names.includes(one)).join(' ') },
      contains: (name) => list().includes(name),
      toggle: (name, on) => { if (on === false) node.classList.remove(name); else node.classList.add(name) },
    }
  }

  get textContent() {
    if (!this.children.length) return this._text
    return this.children.map((one) => one.textContent).join('')
  }

  set textContent(value) {
    this._text = String(value ?? '')
    for (const one of this.children) one.parentNode = null
    this.children = []
  }

  append(...nodes) {
    for (const one of nodes) {
      one.parentNode = this
      this.children.push(one)
    }
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null }
  removeAttribute(name) { delete this.attributes[name] }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) || []
    list.push(fn)
    this.listeners.set(type, list)
  }

  click() {
    for (const fn of this.listeners.get('click') || []) fn({ stopPropagation() {} })
  }

  cloneNode() {
    const copy = new FakeNode(this.tagName)
    copy.className = this.className
    copy.attributes = { ...this.attributes }
    return copy
  }

  // 往下找第一个合条件的
  find(pred) {
    for (const one of this.children) {
      if (pred(one)) return one
      const hit = one.find?.(pred)
      if (hit) return hit
    }
    return null
  }
}

const fakeDoc = { createElement: (tag) => new FakeNode(tag) }

// 气泡那一块：一个小块元素
function chipOf(row, index = 0) {
  const chips = row.children.filter((one) => one.className.includes('chip'))
  const one = chips[index]
  assert.ok(one, '没有找到小块')
  return one
}

test('1 材料对到工作区里的那份拷贝：图片带缩略图，对不上的没有路径', () => {
  const chips = chipsOf({
    paths: ['C:/原件/发票照片1.jpg', 'C:/原件/报销单扫描件.pdf', 'C:/原件/没拷进去.txt'],
    copied: [
      { from: 'C:/原件/发票照片1.jpg', to: 'C:/桌伴/任务/20261113-1/发票照片1.jpg' },
      { from: 'C:/原件/报销单扫描件.pdf', to: 'C:/桌伴/任务/20261113-1/报销单扫描件.pdf' },
    ],
  })
  assert.equal(chips.length, 3)
  assert.equal(chips[0].path, 'C:/桌伴/任务/20261113-1/发票照片1.jpg')
  assert.equal(chips[0].thumb, true)
  assert.equal(chips[0].kind, 'image')
  assert.equal(chips[1].thumb, false)
  assert.equal(chips[1].name, '报销单扫描件.pdf')
  // 没拷进去的：没有路径，点不开
  assert.equal(chips[2].path, '')
  assert.equal(chips[2].name, '没拷进去.txt')
})

test('2 只放工作区里的文件：外面的、.. 跳出的、符号链接跳出的都不认', () => {
  const root = tempDir('chips')
  const ws = join(root, '任务', '20261113-1')
  mkdirSync(ws, { recursive: true })
  const inside = join(ws, '发票照片1.jpg')
  writeFileSync(inside, 'jpg')
  const outside = join(root, '原件.pdf')
  writeFileSync(outside, 'pdf')
  // 工作区里指出去的链接：按真身核也不认
  const link = join(ws, '指向外面.pdf')
  try { symlinkSync(outside, link) } catch { return } // 没权限就不测这一条

  const hit = openablePath(ws, inside)
  assert.equal(hit.ok, true)
  assert.equal(hit.path, inside)

  assert.equal(openablePath(ws, outside).ok, false)
  assert.equal(openablePath(ws, outside).reason, 'outside')
  assert.equal(openablePath(ws, join(ws, '..', '..', '原件.pdf')).reason, 'outside')
  assert.equal(openablePath(ws, link).reason, 'outside')
  assert.equal(openablePath(ws, join(ws, '没这个文件.jpg')).reason, 'missing')
  assert.equal(openablePath('', inside).reason, 'no-workspace')
})

test('3 气泡里出小块，不出「带了…」那行字', () => {
  // 页面里不再有「带了 …」那句
  assert.equal(page.includes('带了 ${'), false)
  assert.match(page, /chipRow\.render\(block\)/)
  // 状态里这一轮的材料先摆名字，拷贝到了再补路径
  const started = reduceTask(createTask(), { type: 'send', text: '把这些报销单理一下', runId: 'r1' }).state
  const bubble = started.flow.find((one) => one.kind === 'user')
  assert.ok(bubble)
  assert.deepEqual(bubble.files, [])
  const withChips = reduceTask(started, { type: 'chips', taskId: 'r1', files: [{ name: '报销单扫描件.pdf', path: 'C:/ws/报销单扫描件.pdf', kind: '' }] }).state
  const view = toTaskView(withChips, { exists: () => true })
  const block = view.blocks.find((one) => one.kind === 'user')
  assert.equal(block.files.length, 1)
  assert.equal(block.files[0].name, '报销单扫描件.pdf')
  assert.equal(block.files[0].path, 'C:/ws/报销单扫描件.pdf')
  assert.equal(block.files[0].missing, false)
})

test('4 图片那块带缩略图，点一下发出去的打开请求指向工作区里的拷贝', async () => {
  const opened = []
  const row = createChipRow({
    doc: fakeDoc,
    bridge: {
      thumb: (path) => Promise.resolve(`data:image/png;base64,${path.length}`),
      openChip: (path) => { opened.push(path); return Promise.resolve({ ok: true }) },
    },
  })
  const block = {
    kind: 'user',
    round: 1,
    text: '把这些报销单理一下',
    files: [
      { name: '发票照片1.jpg', label: '发票照片1.jpg', path: 'C:/ws/发票照片1.jpg', kind: 'image', thumb: true, missing: false },
      { name: '报销单扫描件.pdf', label: '报销单扫描件.pdf', path: 'C:/ws/报销单扫描件.pdf', kind: '', thumb: false, missing: false },
    ],
  }
  const el = row.render(block)
  assert.ok(el)
  assert.equal(el.className, 'chips')
  const first = chipOf(el, 0)
  // 图片那块带缩略图
  const img = first.find((one) => one.tagName === 'IMG')
  assert.ok(img, '图片那块没有缩略图')
  assert.equal(img.className, 'thumb')
  await delay(1)
  assert.match(String(img.src), /^data:image\/png/)
  // 别的文件带图标 + 文件名
  const second = chipOf(el, 1)
  assert.equal(second.find((one) => one.tagName === 'IMG'), null)
  assert.equal(second.find((one) => one.className === 'nm').textContent, '报销单扫描件.pdf')
  // 点一下：发出去的打开请求指向工作区里的那份拷贝
  first.click()
  assert.deepEqual(opened, ['C:/ws/发票照片1.jpg'])
})

test('5 放不下收成「+N」，点开摆全部', () => {
  const row = createChipRow({ doc: fakeDoc, bridge: { openChip: () => Promise.resolve({ ok: true }) } })
  const files = [1, 2, 3, 4, 5].map((n) => ({ name: `文件${n}.pdf`, label: `文件${n}.pdf`, path: `C:/ws/文件${n}.pdf`, kind: '', thumb: false, missing: false }))
  const el = row.render({ kind: 'user', round: 3, text: '材料', files })
  // 收着：三个 + 一个「+N」
  assert.equal(el.children.length, 4)
  const more = el.children[3]
  assert.match(more.textContent, /^\+2$/)
  more.click()
  assert.equal(el.children.length, 5)
})

test('6 拷贝不在了：灰着，鼠标是箭头，不另写提示', () => {
  const opened = []
  const row = createChipRow({ doc: fakeDoc, bridge: { openChip: (path) => { opened.push(path); return Promise.resolve({ ok: true }) } } })
  const block = {
    kind: 'user',
    round: 1,
    text: '把这些报销单理一下',
    files: [{ name: '报销单扫描件.pdf', label: '报销单扫描件.pdf', path: 'C:/ws/报销单扫描件.pdf', kind: '', thumb: false, missing: true }],
  }
  const el = row.render(block)
  const chip = chipOf(el, 0)
  assert.equal(chip.classList.contains('gone'), true)
  assert.equal(chip.disabled, true)
  assert.equal(chip.title || '', '')
  // 灰着的不点：发不出打开请求
  chip.click()
  assert.deepEqual(opened, [])
  // 主进程说开不了（文件没了）：当场灰着
  const row2 = createChipRow({ doc: fakeDoc, bridge: { openChip: () => Promise.resolve({ ok: false, reason: 'missing' }) } })
  const el2 = row2.render({
    kind: 'user',
    round: 2,
    text: '再看看',
    files: [{ name: '发票照片1.jpg', label: '发票照片1.jpg', path: 'C:/ws/发票照片1.jpg', kind: 'image', thumb: true, missing: false }],
  })
  const chip2 = chipOf(el2, 0)
  chip2.click()
  return delay(1).then(() => {
    assert.equal(chip2.classList.contains('gone'), true)
    assert.equal(chip2.title, '')
  })
})

test('7 工作区里没有那份拷贝：视图里那块灰着', () => {
  const state = reduceTask(createTask(), { type: 'send', text: '理一下', runId: 'r1' }).state
  const withChips = reduceTask(state, { type: 'chips', taskId: 'r1', files: [{ name: '报销单扫描件.pdf', path: 'C:/ws/报销单扫描件.pdf', kind: '' }] }).state
  const view = toTaskView(withChips, { exists: () => false })
  const block = view.blocks.find((one) => one.kind === 'user')
  assert.equal(block.files[0].missing, true)
})

test('8 跑起来的时候，气泡里的小块指向工作区里的拷贝', async () => {
  const root = tempDir('chips-run')
  const ws = join(root, 'ws')
  mkdirSync(ws, { recursive: true })
  const original = join(root, '原件', '发票照片1.jpg')
  mkdirSync(dirname(original), { recursive: true })
  writeFileSync(original, 'jpg')
  const copied = join(ws, '发票照片1.jpg')
  writeFileSync(copied, 'jpg')
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const seen = { views: [], runs: [] }
  let finish = null
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    log: () => {},
    onView: (view) => seen.views.push(view),
    onPet: () => {},
    onRecent: () => {},
    history,
    prepareTask: () => ({
      kind: 'files', workspace: ws,
      copied: [{ from: original, to: copied }], skipped: [], snapshot: [],
    }),
    snapshotWorkspace: () => [],
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: input.name, name: input.name, locked: false }),
    clearWorkspace: () => {},
    runTask: (options) => {
      seen.runs.push(options)
      return {
        sessionId: 's1',
        cancel() {},
        steer: () => Promise.resolve({ ok: true, mode: 'steer' }),
        done: new Promise((resolve2) => { finish = resolve2 }),
      }
    },
  })
  // 贴一张图当材料
  runner.feed({ type: 'paste', files: [{ path: original, name: '发票照片1.jpg', kind: 'image' }] })
  runner.act({ type: 'send', text: '把这张发票理一下' })
  for (let i = 0; i < 200 && !seen.runs.length; i += 1) await delay(5)
  assert.equal(seen.runs.length, 1, '这一轮没起来')
  const view = runner.view()
  const bubble = view.blocks.find((one) => one.kind === 'user')
  assert.ok(bubble, JSON.stringify(view.blocks))
  assert.equal(bubble.files.length, 1)
  assert.equal(bubble.files[0].path, copied)
  assert.equal(bubble.files[0].thumb, true)
  assert.equal(bubble.files[0].missing, false)
  // 工作区是这次任务的工作区
  assert.equal(runner.workspace(), ws)
  finish({ type: 'end', taskId: seen.runs[0].taskId, at: 9, status: 'done' })
  await delay(20)
})

test('9 历史对话里也有这些小块（全部对话里点开的也是这一份）', () => {
  const root = tempDir('chips-history')
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const id = history.start({
    // 记录放在这个任务文件夹里（.sidemate\conversation.json）
    workspace: join(root, 'tasks', '20261113000000'),
    prompt: '把这些报销单理一下',
    folder: 'C:/桌伴/tasks/20261113-1',
    folderName: '20261113-1',
    kind: 'task',
    files: [{ name: '发票照片1.jpg', path: 'C:/桌伴/tasks/20261113-1/发票照片1.jpg', kind: 'image' }],
  })
  const record = history.get(id)
  assert.equal(record.messages[0].files.length, 1)
  assert.equal(record.messages[0].files[0].name, '发票照片1.jpg')
  // 重开这条对话：气泡里照样是小块
  const state = restoreState(record, {})
  const user = state.flow.find((one) => one.kind === 'user')
  assert.ok(user)
  assert.equal(user.files.length, 1)
  assert.equal(user.files[0].path, 'C:/桌伴/tasks/20261113-1/发票照片1.jpg')
  const view = toTaskView(state, { exists: () => true })
  const block = view.blocks.find((one) => one.kind === 'user')
  assert.equal(block.files[0].name, '发票照片1.jpg')
  assert.equal(block.files[0].thumb, true)
  assert.equal(block.files[0].missing, false)
})
