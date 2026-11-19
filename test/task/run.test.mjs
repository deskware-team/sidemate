// 任务窗卡三的流水线测试：runTask / prepareTask /
// clearWorkspace 全用假的，事件形状照 docs/事件.md。
// 成品留在任务文件夹根目录：模型交稿（present）或者根目录里有文件动了，才出卡。

import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { pasteDir } from '../../app/task/paste.mjs'
import { snapshotWorkspace as realSnapshot } from '../../app/workspace/index.mjs'
import { writeOffice } from '../helpers/office.mjs'
import { t, t as copy } from '../../app/copy/copy.mjs'

// 整套跑完必须是 0：谁也没接的 promise 会在这里现形
let unhandledRejections = 0
process.on('unhandledRejection', () => { unhandledRejections += 1 })

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const idle = () => new Promise((done) => setImmediate(done))

function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-run-'))
  const disk = { files: [] } // snapshotWorkspace 假装的工作区现状
  const ws = join(root, 'task-ws')
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'low', '新闻') })
  const seen = { run: [], prepare: [], finish: [], deliver: [], clear: [], pet: [], recent: [], log: [], views: [], handles: [], copyMore: [], saved: null }
  const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path }
  const doneRun = (options, status) => ({ type: 'end', taskId: options.taskId, at: 9, status })
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    // 开工前算模型：算不通就照 reason / message 报错，算得通就把 env / 补丁 / 模型都交给 runTask
    model: over.model
      ? (choice) => over.model(choice, seen)
      : (choice) => (over.noModel
        ? { ok: false, reason: 'key', code: 'Si101', stop: 'noKey', vars: { vendor: 'DeepSeek' }, message: '还没填 DeepSeek 的密钥' }
        : { ok: true, apiKey: 'test-key', env: { SIDEMATE_KEY_TEST: 'v' }, patchTexts: ['routes'], model: { value: 'deepseek/chat', effort: null }, vendor: '测试通道', free: false }),
    // 工具没调通时的那句话
    toolFailNote: over.toolFailNote,
    extensions: ['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.md', '.txt'],
    // 中途加材料（接着说时贴的）：跟开工那一遍一样拷进工作区（假的：同名拷到工作区根，但真拷文件）
    copyMaterials: over.copyMaterials
      ? (input) => over.copyMaterials(input, seen)
      : (input) => {
          seen.copyMore.push(input)
          mkdirSync(join(ws, 'received'), { recursive: true })
          const copied = input.paths.map((from) => {
            const to = join(ws, 'received', basename(from))
            copyFileSync(from, to)
            return { from, to }
          })
          return { copied, skipped: [] }
        },
    recent: over.recent ?? [],
    log: (event, data) => seen.log.push([event, data]),
    onPet: (event) => seen.pet.push(event),
    onRecent: (list) => seen.recent.push([...list]),
    onView: (view) => seen.views.push(view),
    openSettings: () => { seen.settings = (seen.settings || 0) + 1 },
    openPath: (path, reveal) => { seen.open = { path, reveal } },
    // 另存为：主进程弹系统另存为对话框，拷一份到用户选的地方
    saveAs: (path) => { seen.saved = path },
    history,
    pickFiles: over.pickFiles
      ? (cell) => over.pickFiles(cell, seen)
      : (cell) => { seen.pick = cell },
    prepareTask: over.prepareTask
      ? (input) => over.prepareTask(input, seen, root)
      : (input) => {
          seen.prepare.push(input)
          // 什么都没拖也有自己的任务文件夹（副本只记路径不真拷；接着说的测试要副本在，自己 keepCopies）
          return {
            kind: 'files', workspace: ws,
            copied: input.paths.map((from) => ({ from, to: join(ws, 'received', basename(from)) })),
            skipped: [], snapshot: [],
          }
        },
    clearWorkspace: over.clearWorkspace
      ? (dir) => over.clearWorkspace(dir, seen)
      : (dir) => { seen.clear.push(dir) },
    runTask: (options) => {
      const handle = (over.runTask || defaultRun)(options, seen, { disk, doneRun })
      seen.run.push(options)
      seen.handles.push(handle)
      return handle
    },
  })
  function defaultRun(options, seen, kit) {
    options.onEvent({ type: 'progress', taskId: options.taskId, at: 1, text: 'write 周报.docx' })
    options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '做好了' })
    options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
    return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve(kit.doneRun(options, 'done')) }
  }
  return { runner, root, ws, seen, disk, write, history }
}

// 多份材料才走打标和核出处：给只放一份材料的测试补一份第二材料
function extra(h, name = '乙.md') {
  return h.write(join(h.root, name), 'y')
}

// 真的 prepareTask 会把拖进来的拷一份进工作区：接着说时副本还在，就不重新拷、不再告诉模型
function keepCopies(h, ...paths) {
  for (const from of paths) h.write(join(h.ws, 'received', basename(from)), readFileSync(from, 'utf8'))
}

async function settled(runner, phase) {
  for (let i = 0; i < 400 && runner.view().phase !== phase; i += 1) await delay(5)
  assert.equal(runner.view().phase, phase)
}

async function until(predicate) {
  for (let i = 0; i < 400 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

// 真的工作区（用真 snapshotWorkspace 走全链路）：成品就落在任务文件夹根目录里。
function realWorld(over = {}) {
  const h = harness({
    ...over.deps,
    prepareTask: (input) => {
      const workspace = h.ws
      mkdirSync(workspace, { recursive: true })
      return {
        kind: 'files', workspace,
        // 用户给的副本：不算这一轮动过的文件（真跑的时候副本在 received\ 里）
        copied: (input.paths || []).map((from) => ({ from, to: join(workspace, 'received', basename(from)) })),
        skipped: [], snapshot: realSnapshot(workspace),
      }
    },
  })
  return h
}


test('a 拖两份文件跑一轮：过程那行不上屏，产出卡只写页数、不带钱', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      options.onEvent({ type: 'progress', taskId: options.taskId, at: 1, text: 'write 周报.docx' })
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 3 })
      options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
      kit.disk.files = ['周报.docx']
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const f1 = h.write(join(h.root, '甲.docx'), 'x')
  const f2 = h.write(join(h.root, '乙.pdf'), 'y')
  h.disk.files = []
  h.runner.drop([f1, f2])
  let v = h.runner.view()
  assert.equal(v.phase, 'ready')
  assert.equal(v.tags.length, 2)
  h.runner.act({ type: 'send', text: '汇成本周周报' })
  await settled(h.runner, 'done')
  v = h.runner.view()
  const texts = v.flow.map((one) => one.text)
  // 过程那行没了：拷贝、正在写都不上屏
  assert.ok(!texts.some((one) => /份文件拷一份|收拾干活的地方|逐句核对出处|正在写/.test(one)), texts.join('|'))
  assert.equal(v.flow.some((one) => one.kind === 'progress'), false)
  assert.equal(v.top.path.title, h.ws)
  assert.equal(h.seen.run.length, 1)
  // 桌伴不再切块打标：话里只有用户那一句，文件当资源链接给模型
  assert.equal(h.seen.run[0].prompt, '汇成本周周报')
  assert.deepEqual((h.seen.run[0].files || []).map((one) => one.name), ['甲.docx', '乙.pdf'])
  assert.equal(h.seen.run[0].workspace, h.ws)
  // dsh 直接用随包的 node 起：不另给一份
  assert.equal(h.seen.run[0].node, undefined)
  assert.equal(v.bottom.cards.length, 1)
  const card = v.bottom.cards[0]
  assert.equal(card.name, '周报.docx')
  assert.equal(card.path, join(h.ws, '周报.docx'), '成品留在任务文件夹根目录')
  assert.equal(card.label, copy('output.changed'), '模型没交稿，卡的标题是「文件变动」')
  assert.ok(card.line.includes('3 页'), card.line)
  assert.ok(!card.line.includes('这次约'), card.line)
  assert.equal(card.line, '周报.docx · 3 页', card.line) // 卡上不写出处核上几处
})

test('b 网络错了给人话、能重来；重来换 runId、还是同一个工作区', async () => {
  let calls = 0
  const h = harness({
    runTask: (options, seen, kit) => {
      calls += 1
      if (calls === 1) {
        options.onEvent({ type: 'error', taskId: options.taskId, at: 5, reason: 'network', message: '没干成：连不上模型那边' })
        return { sessionId: undefined, cancel() {}, done: Promise.resolve(kit.doneRun(options, 'error')) }
      }
      options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '好了' })
      options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
      return { sessionId: 's2', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'error')
  let v = h.runner.view()
  const bad = v.flow[v.flow.length - 1]
  assert.equal(bad.kind, 'error')
  assert.equal(bad.text, copy('stops.broken'))
  assert.deepEqual(bad.buttons.map((b) => b.action), ['retry'])
  const first = h.seen.run[0]
  h.runner.act({ type: 'retry' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 2)
  assert.notEqual(h.seen.run[1].taskId, first.taskId)
  assert.equal(h.seen.run[1].workspace, first.workspace)
  assert.equal(h.seen.prepare.length, 1)
})

test('c 准备中停下立刻停、一次都不起 dsh；跑起来再停调 handle.cancel', async () => {
  let release
  const gate = new Promise((done) => { release = done })
  const slow = harness({
    prepareTask: async (input) => {
      await gate
      return { workspace: 'C:/deskware/ws', copied: [], skipped: [], snapshot: [] }
    },
  })
  slow.runner.act({ type: 'send', text: '干活' })
  await idle()
  slow.runner.act({ type: 'stop' })
  assert.equal(slow.runner.view().phase, 'stopped')
  release()
  await delay(30)
  assert.equal(slow.seen.run.length, 0)
  const running = harness({
    runTask: () => ({ sessionId: 's', cancel() { this.cancelled = true }, done: new Promise(() => {}) }),
  })
  running.runner.act({ type: 'send', text: '干活' })
  await until(() => running.seen.handles.length === 1)
  running.runner.act({ type: 'stop' })
  assert.equal(running.seen.handles[0].cancelled, true)
})

test('c2 设置变化把这一轮中断的：说改了模型设置，点「继续」接着做', async () => {
  const h = harness({
    runTask: (options) => {
      let settle = null
      return {
        sessionId: 's1',
        // 真的那一轮：停下时把「谁让停的」带在 end 事件里
        cancel(note = '') { settle({ type: 'end', taskId: options.taskId, at: 9, status: 'cancelled', note }) },
        done: new Promise((resolve) => { settle = resolve }),
      }
    },
  })
  h.runner.act({ type: 'send', text: '干活' })
  await until(() => h.seen.handles.length === 1)
  await until(() => h.runner.view().phase === 'working')
  assert.equal(h.runner.interrupt(null), 1)
  await settled(h.runner, 'stopped')
  const said = h.runner.view().flow.map((one) => one.text)
  assert.ok(said.includes(copy('St609')), said.join(' | '))
  assert.ok(!said.includes(copy('St607')), said.join(' | '))
  // 接着做：同一个会话
  h.runner.act({ type: 'continue' })
  await until(() => h.seen.handles.length === 2)
  assert.equal(h.seen.run[1].sessionId, 's1')
})

test('d 只聊天：也建自己的任务文件夹、收下清场', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '讲个笑话' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run[0].workspace, h.ws)
  assert.deepEqual(h.seen.prepare[0].paths, [])
  const v = h.runner.view()
  // 没出文件也不另说一句，不写钱
  assert.deepEqual(v.bottom, { cards: [] })
  assert.ok(!JSON.stringify(v).includes('这次约'))
  h.runner.act({ type: 'accept' })
  assert.equal(h.runner.view().phase, 'empty')
  await until(() => h.seen.clear.length === 1) // 收下排队：上一轮退完才清
  assert.deepEqual(h.seen.clear, [h.ws])
})

test('e 前台出错不打扰宠；不在前台才喂一次 error', async () => {
  const errorRun = (options, seen, kit) => {
    options.onEvent({ type: 'error', taskId: options.taskId, at: 5, reason: 'network', message: '没干成：连不上模型那边' })
    return { sessionId: undefined, cancel() {}, done: Promise.resolve(kit.doneRun(options, 'error')) }
  }
  const back = harness({ runTask: errorRun })
  back.runner.act({ type: 'send', text: '干活' })
  await settled(back.runner, 'error')
  const errors = back.seen.pet.filter((one) => one.type === 'error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, copy('stops.broken'))
  const fore = harness({ runTask: errorRun })
  fore.runner.feed({ type: 'window', foreground: true })
  fore.runner.act({ type: 'send', text: '干活' })
  await settled(fore.runner, 'error')
  assert.equal(fore.seen.pet.filter((one) => one.type === 'error').length, 0)
  // 最后一条不算「几个在跑」那条（那条只管小岛悬停那行的个数）
  const last = fore.seen.pet.filter((one) => one.type !== 'running').at(-1)
  assert.deepEqual({ type: last.type, status: last.status }, { type: 'end', status: 'cancelled' })
  assert.deepEqual(fore.seen.pet.at(-1), { type: 'running', count: 0 })
})

test('e2 做完了喂小岛的是 end done：小岛笑眼，不会出去设置', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.pet.filter((one) => one.type === 'error').length, 0, JSON.stringify(h.seen.pet))
  const last = h.seen.pet.filter((one) => one.type !== 'running').at(-1)
  assert.deepEqual({ type: last.type, status: last.status }, { type: 'end', status: 'done' })
  // 开工时告诉小岛一个在跑，做完了告诉它没有了
  assert.deepEqual(h.seen.pet.filter((one) => one.type === 'running'), [{ type: 'running', count: 1 }, { type: 'running', count: 0 }])
})

test('f 做完了往宠身上拖新文件：旧工作区清掉、新任务带上，对话流是空的', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '第一件' })
  await settled(h.runner, 'done')
  const oldWs = h.seen.run[0].workspace
  const file = h.write(join(h.root, '新.docx'), 'z')
  h.runner.opened({ paths: [file] })
  const v = h.runner.view()
  assert.equal(v.phase, 'ready')
  assert.equal(v.tags.length, 1)
  assert.deepEqual(v.flow, [])
  await until(() => h.seen.clear.length === 1) // 收下排队：等旧轮退完再清
  assert.deepEqual(h.seen.clear, [oldWs])
})

test('h 小岛拖过来的文件不分左右：都当文件挂上（老的 cell 字段不认）', () => {
  const h = harness()
  const one = h.write(join(h.root, '周报 范本.docx'), 'z')
  const two = h.write(join(h.root, '数据.docx'), 'z')
  h.runner.opened({ paths: [one], cell: 'template' })
  h.runner.opened({ paths: [two] })
  const view = h.runner.view()
  assert.deepEqual(view.tags.map((tag) => [tag.name, 'role' in tag]), [['周报 范本.docx', false], ['数据.docx', false]])
})

test('i 原件不盯了：收尾不说原件被改；用户给的文件拷不进来（被 Word 占着）才停工（Si803）', async () => {

  const plain = harness({
    runTask: (options, seen, kit) => {
      writeFileSync(join(plain.ws, '周报.md'), '# 周报\n正文', 'utf8')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(plain.ws, '周报.md'), name: '周报.md', pages: 1 })
      kit.disk.files = ['周报.md']
      return { sessionId: 's', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  plain.runner.act({ type: 'send', text: '干活' })
  await settled(plain.runner, 'done')
  let v = plain.runner.view()
  assert.equal(v.banner, null)
  assert.equal(v.bottom.cards.length, 1, '产出照给')
  assert.equal(v.bottom.cards[0].path, join(plain.ws, '周报.md'))
  assert.equal(plain.seen.log.some(([event]) => event === 'error-code'), false)
  // 拷用户给的文件时正被 Word 占着：停工（Si803）
  const locked = harness({
    prepareTask: () => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY', path: 'C:/材料/甲.docx' })
    },
  })
  const one = locked.write(join(locked.root, '甲.docx'), 'x')
  locked.runner.drop([one])
  locked.runner.act({ type: 'send', text: '干活' })
  await settled(locked.runner, 'error')
  v = locked.runner.view()
  assert.equal(v.flow[v.flow.length - 1].text, copy('stops.locked', { name: '甲.docx' }))
  assert.deepEqual([v.banner.level, v.banner.code], ['block', 'Si803'])
})

test('j 文件夹拖进来不记最近、在里面开干了才记；recent 只认列表里的；打开只认视图里出现过的路径', async () => {
  const h = harness({ recent: ['C:/旧的'] })
  const folder = join(h.root, '材料夹')
  h.write(join(folder, '甲.docx'), 'x')
  h.write(join(folder, '笔记.txt'), 'y')
  h.write(join(folder, '.隐藏.txt'), 'h')
  h.write(join(folder, '图.png'), 'p')
  h.runner.drop([folder])
  let v = h.runner.view()
  assert.equal(v.top.path.title, folder)
  assert.equal(v.tags.length, 2)
  // 只拖进来：不记（拖错了的文件夹不会留在右键「最近」里）
  assert.equal(h.seen.recent.length, 0)
  h.runner.act({ type: 'send', text: '整理一下' })
  await settled(h.runner, 'done')
  assert.deepEqual(h.seen.recent[h.seen.recent.length - 1], [folder, 'C:/旧的'])
  h.runner.act({ type: 'recent', dir: 'C:/没在列表里' })
  assert.equal(h.runner.view().tags.length, 2)
  h.runner.act({ type: 'open-folder', path: folder })
  assert.deepEqual(h.seen.open, { path: folder, reveal: false })
  h.seen.open = null
  h.runner.act({ type: 'open', path: 'C:/没出现过的.docx' })
  assert.equal(h.seen.open, null)
})

test('k 模型算不通一上来就说，不拷文件', async () => {
  const noKey = harness({ noModel: true })
  noKey.runner.act({ type: 'send', text: '干活' })
  await settled(noKey.runner, 'error')
  let v = noKey.runner.view()
  assert.equal(v.flow[v.flow.length - 1].text, 'DeepSeek 密钥未填写')
  assert.equal(v.banner.code, 'Si101')
  assert.deepEqual(v.flow[v.flow.length - 1].buttons.map((b) => b.action), ['settings', 'retry'])
  assert.equal(noKey.seen.run.length, 0)
  assert.equal(noKey.seen.prepare.length, 0)
})

test('k2 模型算不通：照它给的码和停工那句说，不 prepare 不 runTask', async () => {
  const h = harness({
    model: () => ({ ok: false, reason: 'consent', code: 'Si102', stop: 'consent', message: '必须阅读并同意使用须知' }),
  })
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'error')
  const v = h.runner.view()
  assert.equal(v.flow[v.flow.length - 1].text, '必须阅读并同意使用须知')
  assert.deepEqual(v.flow[v.flow.length - 1].buttons.map((b) => b.action), ['settings', 'retry'])
  assert.equal(h.seen.run.length, 0)
  assert.equal(h.seen.prepare.length, 0)
})

test('k3 模型算得通：runTask 拿到 env、补丁、模型和厂商', async () => {
  const h = harness({
    model: () => ({ ok: true, apiKey: 'k1', env: { SIDEMATE_KEY_C_A: 'a' }, patchTexts: ['routes.yaml'], model: { value: 'c-a/m1', effort: 'low' }, vendor: '自定义 A' }),
  })
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'done')
  const run = h.seen.run[0]
  assert.equal(run.apiKey, 'k1')
  assert.deepEqual(run.env, { SIDEMATE_KEY_C_A: 'a' })
  assert.deepEqual(run.patchTexts, ['routes.yaml'])
  assert.deepEqual(run.model, { value: 'c-a/m1', effort: 'low' })
  assert.equal(run.vendor, '自定义 A')
})

test('p1 文件夹任务：每份的工作区副本都留着，话里点出工作区那几份（不单拎范本）', async () => {
  const h = harness({
    prepareTask: (input, seen) => {
      seen.prepare.push(input)
      const src = input.paths[0]
      // 像 prepareTask 真的那样：文件夹任务把第一层每份都真拷进工作区
      const files = input.paths.length === 1
        ? readdirSync(src).sort((a, b) => a.localeCompare(b, 'zh')).map((name) => join(src, name))
        : input.paths
      const copied = files.map((from) => {
        const to = join(h.ws, 'received', basename(from))
        mkdirSync(join(h.ws, 'received'), { recursive: true })
        copyFileSync(from, to)
        return { from, to }
      })
      return { kind: 'folder', workspace: h.ws, copied, skipped: [], snapshot: [] }
    },
  })
  const folder = join(h.root, '材料夹')
  h.write(join(folder, '范本.docx'), 'x')
  h.write(join(folder, '甲.md'), 'y')
  h.runner.drop([folder])
  h.runner.act({ type: 'send', text: '照范本写周报' })
  await settled(h.runner, 'done')
  assert.equal(existsSync(join(h.ws, 'received', '范本.docx')), true) // 被删掉就是这条坏了
  // 两份都当文件：话里只有那一句，这两份当资源链接给模型
  assert.equal(h.seen.run[0].prompt, '照范本写周报')
  assert.deepEqual((h.seen.run[0].files || []).map((one) => one.name), ['范本.docx', '甲.md'])
})

test('p4a 文件夹第一层的 Word / WPS 临时文件（~$ 开头）不挂上', () => {
  const h = harness()
  const folder = join(h.root, '材料夹')
  h.write(join(folder, '~$临时.docx'), 'x')
  h.write(join(folder, '.~临时.docx'), 'y')
  h.write(join(folder, '要点.md'), 'z')
  h.runner.drop([folder])
  const names = h.runner.view().tags.map((one) => one.name)
  assert.deepEqual(names, ['要点.md'])
})

test('p6b 交稿时点停下：立刻 stopped，之后不出卡、不出错、不收尾', async () => {
  let release
  const gate = new Promise((done) => { release = done })
  const h = harness({
    runTask: (options, seen, kit) => {
      h.disk.files = ['周报.docx']
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 2 })
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: kit.doneRun(options, 'done').then(() => gate) }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '干活' })
  await until(() => h.runner.view().phase === 'working')
  h.runner.act({ type: 'stop' })
  assert.equal(h.runner.view().phase, 'stopped') // 立刻停
  release()
  await delay(120)
  const v = h.runner.view()
  assert.equal(v.phase, 'stopped')
  assert.equal(v.bottom.cards.length, 0)
  assert.equal(v.flow[v.flow.length - 1].text, t('St607'))
  assert.ok(!v.flow.some((one) => one.kind === 'error'))
})

test('p6a 停下后上一轮没退完：重来先排队，停下对排队的那一轮也立刻生效', async () => {
  let release
  const gate = new Promise((done) => { release = done })
  const h = harness({
    prepareTask: async (input, seen) => {
      seen.prepare.push(input)
      await gate
      return { kind: 'files', workspace: h.ws, copied: [], skipped: [], snapshot: [] }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '干活' })
  await until(() => h.seen.prepare.length === 1) // 第一轮还在准备文件
  h.runner.act({ type: 'stop' })
  assert.equal(h.runner.view().phase, 'stopped')
  h.runner.act({ type: 'retry' }) // 第二轮要等第一轮退完
  assert.equal(h.runner.view().phase, 'working')
  await delay(150)
  assert.equal(h.seen.run.length, 0) // 没有第二个轮次同时在跑
  h.runner.act({ type: 'stop' }) // 对还在等的那一轮立刻生效
  assert.equal(h.runner.view().phase, 'stopped')
  release()
  await delay(200)
  assert.equal(h.seen.run.length, 0) // 醒来悄悄收手：一次 runTask 都没起
  assert.equal(h.runner.view().phase, 'stopped')
})

test('p5 重来等上一轮退完再碰工作区；收下也等它退完再清场', async () => {
  let release
  const gate = new Promise((done) => { release = done })
  const h = harness({
    prepareTask: async (input, seen) => {
      seen.prepare.push(input)
      await gate
      return { kind: 'files', workspace: h.ws, copied: [], skipped: [], snapshot: [] }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '干活' })
  await until(() => h.seen.prepare.length === 1)
  h.runner.act({ type: 'stop' })
  h.runner.act({ type: 'retry' })
  await delay(120)
  assert.equal(h.seen.run.length, 0) // 上一轮没退完，第二轮还没起
  release() // 第一轮退完 → 第二轮接着干
  await until(() => h.seen.run.length === 1)
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 1)
  assert.equal(h.seen.run[0].workspace, h.ws)
})

test('p5b 收下：这一轮退完了，拖进来的新文件另开一条，旧的任务文件夹清掉', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 2 })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'done')
  const next = h.write(join(h.root, '新.docx'), 'z')
  h.runner.opened({ paths: [next] }) // 收下：另开一条
  await until(() => h.seen.clear.length === 1)
  assert.deepEqual(h.seen.clear, [h.ws])
})

test('p6c 选文件对话框炸了不连累主进程：接住、只记日志', async () => {
  const h = harness({ pickFiles: async () => { throw new Error('对话框炸了') } })
  h.runner.act({ type: 'add' })
  await until(() => h.seen.log.some((one) => one[0] === 'pick-failed'))
  assert.equal(h.runner.view().phase, 'empty')
})

test('m2 收尾顺序：产出 → 出错 → 结束', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      h.disk.files = ['周报.docx']
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 1 })
      options.onEvent({ type: 'error', taskId: options.taskId, at: 5, reason: 'network', message: '没干成：连不上模型那边' })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'error')) }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'error')
  const withCard = (view) => view.bottom.cards.length === 1
  const withErr = (view) => view.flow.some((one) => one.kind === 'error')
  const iCard = h.seen.views.findIndex(withCard)
  const iErr = h.seen.views.findIndex(withErr)
  assert.ok(iCard !== -1, '出过带产出卡的视图')
  assert.ok(iErr !== -1, '出过带出错的视图')
  assert.ok(iCard < iErr, '产出先喂，出错后喂')
  assert.equal(withErr(h.seen.views[iCard]), false, '出卡时还没说出错')
  const v = h.runner.view()
  assert.equal(v.phase, 'error')
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.flow[v.flow.length - 1].text, copy('stops.broken'))
})

test('卡上的两个钮：另存为拷一份到用户选的地方，打开文件夹是在资源管理器里选中这份文件', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx' })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  h.runner.act({ type: 'send', text: '写周报' })
  await settled(h.runner, 'done')
  const card = h.runner.view().bottom.cards[0]
  assert.equal(card.path, join(h.ws, '周报.docx'))
  // 另存为：主进程拿这份文件的路径去弹对话框
  h.runner.act({ type: 'save-as', path: card.path })
  assert.equal(h.seen.saved, card.path)
  // 打开文件夹：在资源管理器里选中这份文件
  h.runner.act({ type: 'reveal', path: card.path })
  assert.deepEqual(h.seen.open, { path: card.path, reveal: true })
  // 视图里没有的路径不认
  h.seen.saved = null
  h.runner.act({ type: 'save-as', path: join(h.ws, '没这张卡.docx') })
  assert.equal(h.seen.saved, null)
})

test('s1 开新任务后不留「收好了」那一行，上一个任务的成品也不再能从窗上打开', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      h.disk.files = ['周报.docx']
      writeOffice(join(h.ws, '周报.docx'), '.docx', '写好的周报')
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 1 })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '写周报' })
  await settled(h.runner, 'done')
  const output = h.runner.view().bottom.cards[0].path
  h.runner.opened({ fresh: true })
  assert.deepEqual(h.runner.view().flow, [])
  h.runner.act({ type: 'open-settled' })
  assert.equal(h.seen.open ?? null, null, dirname(output))
})

test('s2 最近的任务只打开扫到的产出目录，不开新任务；全部任务和白名单也受限', () => {
  const h = harness()
  const task = join(h.root, '桌伴', 'tasks', '20261105000000')
  const out = task
  h.write(join(out, '周报.docx'), 'x')
  // 标题从那条对话记录里取（不看文件夹名）
  h.write(join(task, '.sidemate', 'conversation.json'), JSON.stringify({ title: '写周报' }))
  const listed = h.runner.view().top.recent
  assert.deepEqual(listed.tasks, [{ dir: out, name: '11-05 写周报' }])
  assert.equal(listed.allTasks, join(h.root, '桌伴', 'tasks'))
  assert.equal(h.seen.run.length, 0)
  h.runner.act({ type: 'open-recent', dir: out })
  assert.deepEqual(h.seen.open, { path: out, reveal: false })
  assert.equal(h.seen.run.length, 0)
  h.seen.open = null
  h.runner.act({ type: 'open-recent', dir: join(h.root, '桌伴', 'tasks', '别处') })
  assert.equal(h.seen.open, null)
  h.runner.act({ type: 'all-tasks', dir: listed.allTasks })
  assert.deepEqual(h.seen.open, { path: listed.allTasks, reveal: false })
  h.seen.open = null
  h.runner.act({ type: 'all-tasks', dir: join(h.root, '别处') })
  assert.equal(h.seen.open, null)
})

test('s69a 模型把周报写进任务文件夹根目录：出一张卡、留在原地', async () => {
  const h = realWorld({
    deps: {
      runTask: (options, seen, kit) => {
        const docx = writeOffice(join(h.ws, '本周周报.docx'), '.docx', '带〔S06·p2〕记号的正文')
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: docx, name: '本周周报.docx', pages: 3 })
        options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '汇成本周周报' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const docx = join(h.ws, '本周周报.docx')
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.bottom.cards[0].name, '本周周报.docx')
  assert.equal(v.bottom.cards[0].path, docx) // 卡上的 to 就是这份文件本身
  assert.equal(v.bottom.cards[0].label, copy('output.changed'))
  assert.equal(v.flow.some((one) => one.kind === 'progress'), false)
  assert.deepEqual(readdirSync(h.ws).filter((one) => !one.startsWith('.')), ['本周周报.docx']) // 没有第二份副本
})

test('s69b 第二轮：上一轮留在任务文件夹里的不重报，只出这一轮那张卡', async () => {
  const h = realWorld({
    deps: {
      runTask: (options, seen, kit) => {
        const name = seen.run.length === 0 ? '本周周报.docx' : '下周计划.docx'
        const docx = writeOffice(join(h.ws, name), '.docx', `第${seen.run.length}轮的产出`)
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: docx, name, pages: 2 })
        options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '汇成本周周报' })
  await settled(h.runner, 'done')
  assert.equal(h.runner.view().bottom.cards.length, 1)
  h.runner.act({ type: 'send', text: '再写下周计划' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  assert.equal(v.bottom.cards.length, 2)
  // 不许出副本：两张卡只指两份正品，路径一条条对上。
  // 别拿整条路径 includes('-2') 判副本：mkdtempSync 的随机后缀碰上 2 开头，路径里就有「-2」，会误报。
  assert.deepEqual(
    v.bottom.cards.map((card) => card.path).sort(),
    [join(h.ws, '本周周报.docx'), join(h.ws, '下周计划.docx')].sort(),
  )
  assert.deepEqual(readdirSync(h.ws).filter((one) => !one.startsWith('.')).sort(), ['received', '下周计划.docx', '本周周报.docx'])
})

test('s69c 第二轮改写上一轮那份（报了 artifact）：照新的算，不多出副本', async () => {
  const h = realWorld({
    deps: {
      runTask: (options, seen, kit) => {
        const docx = writeOffice(join(h.ws, '本周周报.docx'), '.docx', seen.run.length === 0 ? '第一版' : '第二版')
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: docx, name: '本周周报.docx', pages: 2 })
        options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '汇成本周周报' })
  await settled(h.runner, 'done')
  assert.equal(h.runner.view().bottom.cards.length, 1)
  h.runner.act({ type: 'send', text: '改到第二版' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const docx = join(h.ws, '本周周报.docx')
  assert.equal(v.bottom.cards.length, 2)
  assert.ok(v.bottom.cards.every((card) => card.path === docx))
  assert.deepEqual(readdirSync(h.ws).filter((one) => !one.startsWith('.')), ['received', '本周周报.docx']) // 还是只有这一份
  assert.ok(readFileSync(docx, 'utf8').includes('第二版'))
})

test('s69d 拖文件夹：模型写进任务文件夹根目录，卡上就是那份', async () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'sidemate-run-')), '周报 材料')
  let h
  h = realWorld({
    folder,
    deps: {
      runTask: (options, seen, kit) => {
        const docx = writeOffice(join(h.ws, '本周周报.docx'), '.docx', '写在工作区里的')
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: docx, name: '本周周报.docx', pages: 2 })
        options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  h.write(join(folder, '范本.docx'), 'x')
  h.write(join(folder, '乙.md'), 'y')
  h.runner.drop([folder])
  h.runner.act({ type: 'send', text: '照范本写周报' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const made = join(h.ws, '本周周报.docx')
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.bottom.cards[0].path, made)
  assert.equal(existsSync(made), true)
  assert.ok(readFileSync(made, 'utf8').includes('写在工作区里的'))
})

test('s69e 写在任务文件夹根下的照样出卡', async () => {
  const h = realWorld({
    deps: {
      runTask: (options, seen, kit) => {
        const made = h.write(join(h.ws, '报告.md'), '写在根下')
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: made, name: '报告.md' })
        options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '写份小结' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const made = join(h.ws, '报告.md')
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.bottom.cards[0].path, made)
  assert.equal(readFileSync(made, 'utf8'), '写在根下')
})

test('s69f 任务文件夹里早就有的成品：这一轮一份不写就一张卡也不出', async () => {
  const h = realWorld()
  h.write(join(h.ws, '上周的.docx'), '上一回的')
  h.write(join(h.ws, '更早的.txt'), '更早的')
  h.runner.act({ type: 'send', text: '聊聊这周' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  assert.equal(v.bottom.cards.length, 0)
  assert.deepEqual(readdirSync(h.ws).filter((one) => !one.startsWith('.')).sort(), ['上周的.docx', '更早的.txt'])
})

test('z 整套没有未处理的 rejection', () => {
  assert.equal(unhandledRejections, 0)
})

test('成品一直留在任务文件夹根目录：干完也不拷、不改名', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      const docx = writeOffice(join(h.ws, '售后服务方案.docx'), '.docx', '写好的稿子')
      kit.disk.files = ['售后服务方案.docx']
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: docx, name: '售后服务方案.docx', pages: 2 })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const material = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([material, extra(h)])
  h.runner.act({ type: 'send', text: '干活' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.bottom.cards[0].path, join(h.ws, '售后服务方案.docx'))
  assert.equal(v.bottom.cards[0].name, '售后服务方案.docx')
  assert.deepEqual(readdirSync(h.ws).filter((one) => !one.startsWith('.')), ['售后服务方案.docx'])
})

// 干活时记对话：一轮干完，记录里有一来一回、会话和交付的文件
test('历史记录：一轮干完，me、it、sessionId 和交付的文件都在', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      h.disk.files = ['周报.docx']
      options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '做好了' })
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 2 })
      options.onEvent({ type: 'usage', taskId: options.taskId, at: 3, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 })
      return { sessionId: 's9', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const one = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([one, extra(h)])
  h.runner.act({ type: 'send', text: '写一份周报' })
  await settled(h.runner, 'done')

  const items = h.history.list()
  assert.equal(items.length, 1, '一个任务一条对话')
  assert.equal(items[0].fileCount, 1)
  const record = h.history.get(items[0].id)
  assert.deepEqual(record.messages.map((m) => [m.role, m.text]), [
    ['me', '写一份周报'],
    ['it', '做好了'],
  ])
  assert.equal(record.sessionId, 's9')
  assert.deepEqual(record.files, [{ name: '周报.docx', path: join(h.ws, '周报.docx') }])
  assert.equal(record.folder, h.ws, '拖文件的任务记工作区那个文件夹')
  assert.equal(record.folderName, 'task-ws')
  // 接着聊要用的东西也记了
  assert.equal(record.resume.workspace, h.ws)
  assert.deepEqual(record.resume.place, { kind: 'files', dir: h.ws })
  // 挂着的文件记成一列（不再分 template / materials）
  assert.deepEqual(record.resume.files, [one, join(h.root, '乙.md')])
  assert.equal('template' in record.resume, false)
  assert.equal('materials' in record.resume, false)
  assert.equal(record.resume.copied.length, 2)
})

// 打开一条历史：对话流重画成记录里的样子，下一句拿着记录里的 sessionId 续接那个会话
test('打开历史接着聊：下一句的 runTask 拿到的是记录里的 sessionId', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      if (seen.run.length === 0) {
        h.disk.files = ['周报.docx']
        options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '做好了' })
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '周报.docx'), name: '周报.docx', pages: 2 })
      } else {
        options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '补好了' })
      }
      return { sessionId: 's9', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const one = h.write(join(h.root, '甲.docx'), 'x')
  const two = extra(h)
  keepCopies(h, one, two) // 工作区还在，副本也在
  h.runner.drop([one, two])
  h.runner.act({ type: 'send', text: '写一份周报' })
  await settled(h.runner, 'done')

  const id = h.history.list()[0].id
  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  let v = h.runner.view()
  assert.equal(v.phase, 'done')
  assert.equal(v.top.historyId, id, '视图带着当前那条：历史下拉里高亮它')
  assert.equal(v.top.path.title, h.ws, '顶栏变成那个文件夹')
  assert.deepEqual(v.flow.map((item) => [item.kind, item.text]), [
    ['user', '写一份周报'],
    ['reply', '做好了'],
  ])
  assert.equal(v.bottom.cards.length, 1)
  assert.equal(v.bottom.cards[0].name, '周报.docx')

  h.runner.act({ type: 'send', text: '再补一段' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 2)
  assert.equal(h.seen.run[1].sessionId, 's9', '续接的是记录里的会话')
  assert.equal(h.seen.run[1].workspace, h.ws, '还在同一个工作区')
  assert.equal(h.seen.run[1].prompt, '再补一段', '接着聊不重新打标')
  assert.equal(h.seen.prepare.length, 1, '不重新拷文件')

  // 接着聊的话记回同一条对话
  const record = h.history.get(id)
  assert.deepEqual(record.messages.map((m) => [m.role, m.text]), [
    ['me', '写一份周报'],
    ['it', '做好了'],
    ['me', '再补一段'],
    ['it', '补好了'],
  ])
})

// 干活中也能打开历史：正在跑的那条留在后台接着跑（详细的在 ./background.test.mjs）
test('打开历史：干活中也能开，这一轮在后台照干、不被打断', async () => {
  const h = harness({
    runTask: () => ({ sessionId: 's', cancel() { this.cancelled = true }, done: new Promise(() => {}) }),
  })
  h.runner.act({ type: 'send', text: '干活' })
  await until(() => h.seen.handles.length === 1)
  // 历史记录存在任务自己的文件夹里（.sidemate\conversation.json）
  const old = join(h.root, 'tasks', '20261101000000')
  mkdirSync(old, { recursive: true })
  const id = h.history.start({ workspace: old, prompt: '以前的一次' })
  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  assert.equal(h.runner.view().phase, 'done', '看的是那条历史')
  assert.equal(h.seen.handles[0].cancelled, undefined, '后台那轮没被停')
  assert.equal(h.runner.busy(), true)
})

// 工作区不在了：只读展示，再说一句提醒重开；「＋ 新任务」照旧清空
test('打开历史：工作区不在了只读，发一句提醒重开', async () => {
  const h = harness() // 假的 prepareTask 没真建目录：工作区不在
  // 这条对话记在它自己的文件夹里（.sidemate\conversation.json），
  // 记着「接着聊要用的工作区」——那个工作区没了（人把文件夹删了）
  const folder = join(h.root, 'tasks', '20261101000000')
  const gone = join(h.root, 'tasks', '20261101000001')
  mkdirSync(folder, { recursive: true })
  const id = h.history.start({ workspace: folder, prompt: '聊聊' })
  h.history.setResume(id, { place: { kind: 'files', dir: gone }, workspace: gone, copied: [] })
  // 先换去一条空的，再从历史里打开它（正看着的那条再点一次不重开）
  h.runner.feed({ type: 'new' })
  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  assert.equal(h.runner.view().phase, 'done')

  h.runner.act({ type: 'send', text: '接着说' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 0, '一次 dsh 都不再起')
  const v = h.runner.view()
  assert.ok(v.flow.some((item) => item.text === t('St803')), v.flow.map((i) => i.text).join('|'))

  h.runner.feed({ type: 'new' })
  assert.equal(h.runner.view().phase, 'empty', '「＋ 新任务」照旧清空')
  assert.equal(h.runner.view().top.historyId, '', '新任务后不再高亮哪一条')
})

// 新闻的文件夹是产出本身，不是临时工作区：点开新闻对话接着问就在内部日期目录里干，
// 给模型的第一句前面悄悄带一行指路的话（界面和历史里都不出现），产出的文件交到
// ~/桌伴/新闻/<主题名>/；点「＋ 新任务」时不清那个文件夹，也不打 settle / clear-failed
test('打开新闻对话：接着问带指路那行、产出交到 新闻/<主题名>/，新任务不清它', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '做好了' })
      options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(options.workspace, '新闻.docx'), name: '新闻.docx', pages: 2 })
      kit.disk.files = ['新闻.docx']
      return { sessionId: 'news-s1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  const issue = join(h.root, 'low', '新闻', 't-it', '2026-11-12')
  const paper = h.write(join(issue, '新闻.md'), '# IT 行业 · 2026-11-12 新闻')
  const out = join(h.root, '桌伴', '新闻', 'IT 行业')
  const id = h.history.start({ workspace: issue, prompt: 'IT 行业 · 11-12', folder: issue, folderName: 'IT 行业', kind: 'news' })
  h.history.setResume(id, { place: { kind: 'files', dir: '' }, workspace: issue, outputDir: out, copied: [] })
  h.history.addFile(id, { name: basename(paper), path: paper })
  h.history.say(id, 'it', '今天的新闻整理好了')

  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  assert.equal(h.runner.view().phase, 'done')

  // 接着问：还在那个内部日期目录里干活，不重新拷文件；给模型的第一句前面悄悄带指路那行
  h.runner.act({ type: 'send', text: '转成 Word' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 1)
  assert.equal(h.seen.run[0].workspace, issue, '接着问还在内部日期目录里')
  assert.equal(h.seen.prepare.length, 0, '不重新拷文件')
  // 指路那行是桌伴自己加的：说清楚这不是用户说的，界面上照旧不显示
  assert.equal(h.seen.run[0].prompt, `${copy('deskHint')}${copy('newsHint', { file: copy('report.file') })}\n转成 Word`, '给模型的话带指路那行')
  assert.equal(h.seen.run[0].prompt, '（桌伴提示，不是用户说的）这份新闻的全文在工作区的「新闻.md」里\n转成 Word')
  const v = h.runner.view()
  assert.equal(v.flow.some((one) => one.kind === 'user' && one.text === '转成 Word'), true)
  assert.equal(v.flow.some((one) => one.text.includes('「新闻.md」里')), false)
  const record = h.history.get(id)
  assert.equal(record.messages.some((one) => one.text === '转成 Word'), true)
  assert.equal(record.messages.some((one) => one.text.includes('「新闻.md」里')), false)
  // 产出的文件就落在新闻那天的目录里，任务窗照常出产出卡
  assert.equal(v.bottom.cards.some((one) => one.name === '新闻.docx'), true)
  assert.equal(v.bottom.cards.some((one) => one.path === join(issue, '新闻.docx')), true)

  // 同一段对话里再说一句：不再带指路那行（只在点开后的第一句带）
  h.runner.act({ type: 'send', text: '再补一段' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 2)
  assert.equal(h.seen.run[1].prompt, '再补一段')
  assert.equal(h.seen.run[1].sessionId, 'news-s1', '续接同一个会话')

  h.runner.feed({ type: 'new' })
  assert.equal(h.runner.view().phase, 'empty', '「＋ 新任务」照旧清空')
  await delay(20) // 收下排着队：等那条链走完再断言
  assert.deepEqual(h.seen.clear, [], '新闻的文件夹不是临时工作区，不清')
  assert.ok(!h.seen.log.some(([event]) => event === 'settle' || event === 'clear-failed'),
    `不该再有 settle / clear-failed：${JSON.stringify(h.seen.log)}`)
  assert.equal(h.runner.view().top.historyId, '', '新任务后不再高亮哪一条')
})

// 贴的图和长文字：主进程存成文件、当材料加小签；贴的图-1.png / 贴的文字-1.md 落在 桌伴/贴的/日期 下
test('贴的图、贴的长文字：存成文件、加材料、小签带第二行', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('一张图')])
  const h = harness()
  h.runner.pasteImages([{ bytes: new Uint8Array(png), mime: 'image/png' }])
  h.runner.pasteText('字'.repeat(3000))
  const v = h.runner.view()
  assert.equal(v.phase, 'ready')
  assert.deepEqual(v.tags.map((one) => [one.name, one.kind, one.sub]), [
    ['贴的图-1.png', 'image', '图片'],
    ['贴的文字-1.md', 'text', '3,000 字'],
  ])
  const dir = pasteDir(join(h.root, '桌伴'))
  const image = join(dir, '贴的图-1.png')
  const text = join(dir, '贴的文字-1.md')
  assert.equal(readFileSync(image).equals(png), true, '图的内容一字节不差')
  assert.equal(readFileSync(text, 'utf8'), '字'.repeat(3000), '文字内容一字不差')
  assert.equal(v.notes, undefined, '长文字存成文件不另说一句（小签上写了字数）')
  // 一次贴多张：多个小签
  h.runner.pasteImages([{ bytes: new Uint8Array(png), mime: 'image/png' }])
  assert.equal(h.runner.view().tags.length, 3)
  // 存不上的（格式不对）：输入框上方一行提示（Si702），不加小签
  h.runner.pasteImages([{ bytes: new Uint8Array(Buffer.from('不是图')), mime: 'image/gif' }])
  assert.equal(h.runner.view().tags.length, 3)
  assert.deepEqual(h.runner.view().banner, { level: 'notice', text: '图片格式不支持', code: 'Si702', raw: '', buttons: [] })
  // 点 × 收起
  h.runner.act({ type: 'dismiss' })
  assert.equal(h.runner.view().banner, null)
})

// 改回文字：取回原文、删掉文件、去掉小签；只认 桌伴/贴的 里的 贴的文字-数字.md
test('改回文字：取回原文去掉小签，别的文件不认也不碰', async () => {
  const h = harness()
  h.runner.pasteText('贴回来的\n一段字')
  const v = h.runner.view()
  const path = v.tags[0].path
  assert.deepEqual(h.runner.restorePaste(path), { ok: true, text: '贴回来的\n一段字' })
  assert.equal(h.runner.view().tags.length, 0, '小签去掉了')
  assert.equal(existsSync(path), false, '文件也删了')
  // 不在 贴的/ 里的同名文件：不认、不删
  const fake = h.write(join(h.root, '贴的文字-1.md'), '冒充的')
  assert.deepEqual(h.runner.restorePaste(fake), { ok: false })
  assert.equal(existsSync(fake), true, '没被误删')
  assert.deepEqual(h.runner.restorePaste('C:/别处/贴的文字-9.md'), { ok: false })
  assert.deepEqual(h.runner.restorePaste(''), { ok: false })
})

// 接着说时贴的图：拷进已经在用的工作区，只把新的这份告诉模型（旧文件同一个会话里它早看过）
test('接着说时贴的图：拷进工作区，只喂新贴的那份', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('一张图')])
  const h = harness()
  const one = h.write(join(h.root, '甲.md'), 'x')
  const two = h.write(join(h.root, '乙.md'), 'y')
  keepCopies(h, one, two)
  h.runner.drop([one, two])
  h.runner.act({ type: 'send', text: '写一份周报' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.copyMore.length, 0)

  // 做完了贴一张图，再说一句：图拷进工作区，这句后面列上它的名字
  h.runner.pasteImages([{ bytes: new Uint8Array(png), mime: 'image/png' }])
  assert.equal(h.runner.view().phase, 'done', '不重开任务')
  assert.equal(h.runner.view().tags.at(-1).name, '贴的图-1.png')
  h.runner.act({ type: 'send', text: '把图里的表也带上' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.copyMore.length, 1, '只拷新贴的那份')
  assert.equal(h.seen.copyMore[0].workspace, h.ws)
  assert.equal(h.seen.copyMore[0].paths.length, 1)
  assert.equal(basename(h.seen.copyMore[0].paths[0]), '贴的图-1.png')
  assert.equal(h.seen.run[1].prompt, '把图里的表也带上')
  assert.deepEqual((h.seen.run[1].files || []).map((one) => one.name), ['贴的图-1.png'])
  assert.equal(h.seen.run[1].sessionId, 's1', '同一个会话')
})

// 接着说但没贴新东西：照旧不重新打标（跟原来一样）
test('接着说没贴新东西：不重新拷、不重新打标', async () => {
  const h = harness()
  const one = h.write(join(h.root, '甲.md'), 'x')
  const two = h.write(join(h.root, '乙.md'), 'y')
  keepCopies(h, one, two)
  h.runner.drop([one, two])
  h.runner.act({ type: 'send', text: '写一份周报' })
  await settled(h.runner, 'done')
  h.runner.act({ type: 'send', text: '再补一段' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.copyMore.length, 0)
  assert.equal(h.seen.run[1].prompt, '再补一段')
})

// 一轮交了两份同类成品：两张卡都出，交的是哪一份由模型自己说，桌伴不替它说
test('一轮交了两份同类成品：两张卡都出，桌伴不替模型说交的是哪一份', async () => {
  const h = realWorld({
    deps: {
      runTask: (options, seen, kit) => {
        writeOffice(join(h.ws, '本周小结.docx'), '.docx', '第一份')
        writeOffice(join(h.ws, '本周小结-2.docx'), '.docx', '第二份')
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '本周小结.docx'), name: '本周小结.docx', pages: 2 })
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 4, path: join(h.ws, '本周小结-2.docx'), name: '本周小结-2.docx', pages: 2 })
        options.onEvent({ type: 'reply', taskId: options.taskId, at: 5, text: '本周小结.docx 写好了，另一份是备稿。' })
        return { sessionId: 's1', cancel() {}, done: Promise.resolve(kit.doneRun(options, 'done')) }
      },
    },
  })
  const file = h.write(join(h.root, '甲.docx'), 'x')
  h.runner.drop([file, extra(h)])
  h.runner.act({ type: 'send', text: '写份本周小结' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  assert.equal(v.bottom.cards.length, 2)
  const said = v.flow.filter((one) => one.kind === 'reply').map((one) => one.text).join('\n')
  assert.equal(said, '本周小结.docx 写好了，另一份是备稿。')
})

// 开工前不再把外部工具服务连一遍：模型那句话原样发，不带「桌伴提示」，界面上也不多一行
test('开工前不预检外部工具服务：话原样发，不多一行', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '再帮我查一下铅笔的库存' })
  await settled(h.runner, 'done')
  assert.equal(h.seen.run.length, 1)
  assert.equal(h.seen.run[0].prompt, '再帮我查一下铅笔的库存')
  assert.equal(h.runner.view().flow.some((one) => one.kind === 'note'), false)
})

test('工具没调通：说一句，别让用户以为它拿到了结果', async () => {
  const h = harness({
    toolFailNote: (name) => `「${name}」这次没调通，没拿到结果`,
    runTask: (options, seen, kit) => {
      options.onEvent({ type: 'tool-call', taskId: options.taskId, at: 1, name: 'mcp__stock__check_stock' })
      options.onEvent({ type: 'tool-failed', taskId: options.taskId, at: 2, name: 'mcp__stock__check_stock' })
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  h.runner.act({ type: 'send', text: '再帮我查一下铅笔的库存' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const note = v.flow.find((one) => one.kind === 'note')
  assert.ok(note, '工具没调通要说一句')
  assert.ok(note.text.includes('mcp__stock__check_stock'), note.text)
})

test('模型自己改文件、读文件出错（dsh 的保护，下一步自己改好）：对话里不说，日志里记着', async () => {
  const h = harness({
    toolFailNote: (name) => `「${name}」这次没调通，没拿到结果`,
    runTask: (options, seen, kit) => {
      options.onEvent({ type: 'tool-call', taskId: options.taskId, at: 1, name: 'edit' })
      options.onEvent({ type: 'tool-failed', taskId: options.taskId, at: 2, name: 'edit', error: 'Error: old_string matched 2 times' })
      options.onEvent({ type: 'tool-failed', taskId: options.taskId, at: 3, name: 'write', error: 'Error: file changed since it was read' })
      options.onEvent({ type: 'tool-failed', taskId: options.taskId, at: 4, name: 'web_fetch', error: 'Error: 403' })
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  h.runner.act({ type: 'send', text: '写一份周报' })
  await settled(h.runner, 'done')
  const notes = h.runner.view().flow.filter((one) => one.kind === 'note').map((one) => one.text)
  assert.deepEqual(notes, ['「web_fetch」这次没调通，没拿到结果'], JSON.stringify(notes))
  const logged = h.seen.log.filter(([event]) => event === 'tool-failed').map(([, data]) => data)
  assert.deepEqual(logged.map((one) => [one.name, one.quiet]), [['edit', true], ['write', true], ['web_fetch', false]])
  assert.equal(logged[0].error, 'Error: old_string matched 2 times')
})

test('外部工具服务的配置 dsh 不认：说一行灰字，这一轮照跑', async () => {
  const h = harness({
    runTask: (options, seen, kit) => {
      options.onEvent({ type: 'mcp-config-failed', taskId: options.taskId, at: 1 })
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve(kit.doneRun(options, 'done')) }
    },
  })
  h.runner.act({ type: 'send', text: '查一下铅笔的库存' })
  await settled(h.runner, 'done')
  const v = h.runner.view()
  const note = v.flow.find((one) => one.kind === 'note')
  assert.ok(note, '要有一行灰字')
  assert.equal(note.text, copy('St411'))
})
