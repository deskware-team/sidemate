import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { addRecent, createTask, fitName, fitPath, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { t as copy } from '../../app/copy/copy.mjs'

const at = Date.UTC(2026, 10, 1, 12, 0, 0) // 周日闲时
const usage = (extra = {}) => ({ at, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0, ...extra })
const working = (text = '干活', runId = 'w1') => reduceTask(createTask(), { type: 'send', text, runId }).state

// 视图里每个值走一遍：不许有 undefined、不许有 NaN
const walk = (value, where = 'view') => {
  assert.notEqual(value, undefined, `${where} 是 undefined`)
  if (value === null) return
  if (Array.isArray(value)) {
    value.forEach((one, i) => walk(one, `${where}[${i}]`))
    return
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) walk(value[k], `${where}.${k}`)
    return
  }
  assert.equal(Number.isNaN(value), false, `${where} 是 NaN`)
}

test('1 空任务的视图逐个对', () => {
  const s = createTask()
  assert.equal(s.phase, 'empty')
  assert.equal(s.round, 0)
  assert.equal(s.runId, null)
  assert.equal(s.prompt, '')
  assert.equal(s.foreground, false)
  assert.equal(s.look, false)
  const v = toTaskView(s)
  assert.equal(v.phase, 'empty')
  assert.equal(v.title, '桌伴')
  // 还没开工：任务文件夹还没建，胶囊写「任务列表」
  assert.deepEqual(s.place, { kind: 'files', dir: '' })
  assert.deepEqual(v.top.path, { text: copy('top.tasks'), title: copy('top.tasks'), open: '' })
  assert.equal(v.top.newTask, copy('top.newTask'))
  // 干活中也能点「＋ 新任务」、也能开历史：视图里不再有锁
  assert.equal('locked' in v.top, false)
  assert.deepEqual(v.tags, [])
  assert.equal('enabled' in v.top.recent, false)
  assert.deepEqual(v.top.recent.items, [])
  assert.deepEqual(v.top.recent.tasks, [])
  assert.equal(v.top.recent.allTasks, '')
  assert.deepEqual(v.input, { mode: 'empty', hint: copy('input.hint'), button: 'send', canSend: true, focus: false })
  assert.deepEqual(v.flow, [])
  assert.deepEqual(v.blocks, [])
  // 对话区空着不放提示；底下那层只有卡；输入框上方什么都没有
  assert.equal(v.flowHint, undefined)
  assert.deepEqual(v.bottom, { cards: [] })
  assert.equal(v.banner, null)
  assert.equal(v.remind, null)
  assert.deepEqual(v.labels, {
    addFile: copy('input.fileLabel'), send: copy('input.send'), stop: copy('input.stop'), latest: copy('flow.latest'),
    continue: copy('input.continueLabel'),
    reveal: copy('output.reveal'), saveAs: copy('output.saveAs'), retry: copy('output.retry'),
    settings: copy('desk.goSettings'), newTask: copy('top.newTask'), askTail: copy('flow.askTail'),
    dismiss: copy('input.dismiss'),
    tagRemove: copy('tag.remove'),
    tagRestore: copy('tag.restore'),
    steer: copy('St502'),
    installTitle: copy('install.title'), installName: copy('install.name'),
    installFrom: copy('install.from'), installDoes: copy('install.does'),
    installYes: copy('install.yes'), installNo: copy('install.no'),
    permTitle: copy('perm.title'), permOnce: copy('perm.once'),
    permAlways: copy('perm.always'), permReject: copy('perm.reject'),
  })
  const v2 = toTaskView(s, { root: 'C:/Users/slow/桌伴', recent: ['C:/Users/slow/Desktop/本周材料', 'C:/别的'] })
  // 没有「随手」了：点小图标打开 ~/桌伴/任务
  assert.deepEqual(v2.top.path, { text: copy('top.tasks'), title: join('C:/Users/slow/桌伴', 'tasks'), open: join('C:/Users/slow/桌伴', 'tasks') })
  assert.deepEqual(v2.top.recent.items, [
    { dir: 'C:/Users/slow/Desktop/本周材料', name: '本周材料' },
    { dir: 'C:/别的', name: '别的' },
  ])
  // 拖了文件还没开工：任务路径待定，输入框聚焦
  const r = reduceTask(s, { type: 'drop', files: ['C:/材料/一份.pdf'] }).state
  const rv = toTaskView(r)
  assert.equal(rv.phase, 'ready')
  assert.deepEqual(rv.top.path, { text: copy('top.tasks'), title: copy('top.tasks'), open: '' })
  assert.deepEqual(toTaskView(r, { root: 'C:/Users/slow/桌伴' }).top.path, { text: copy('top.tasks'), title: join('C:/Users/slow/桌伴', 'tasks'), open: join('C:/Users/slow/桌伴', 'tasks') })
  // 占位字不随状态换：还是那一句
  assert.deepEqual(rv.input, { mode: 'files', hint: copy('input.hint'), button: 'send', canSend: true, focus: true })
})

test('2 一列文件：拖进来的接在后面、去重、文件夹重装、remove；不再分范本和材料', () => {
  let s = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/上周周报.docx', 'C:/材料/一.pdf', 'C:/材料/二.pdf'] }).state
  assert.equal(s.phase, 'ready')
  assert.deepEqual(s.files, [
    { path: 'C:/材料/上周周报.docx', name: '上周周报.docx' },
    { path: 'C:/材料/一.pdf', name: '一.pdf' },
    { path: 'C:/材料/二.pdf', name: '二.pdf' },
  ])
  assert.deepEqual(s.place, { kind: 'files', dir: '' })
  // 状态里没有范本 / 材料那两格了
  assert.equal('template' in s, false)
  assert.equal('materials' in s, false)
  // 已经挂着的跳过，新的接在后面；老的 cell 字段不认（当没给）
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/一.pdf', 'C:/材料/三.pdf'], cell: 'template' }).state
  assert.deepEqual(s.files.map((m) => m.path), ['C:/材料/上周周报.docx', 'C:/材料/一.pdf', 'C:/材料/二.pdf', 'C:/材料/三.pdf'])
  assert.equal(reduceTask(s, { type: 'drop', files: ['C:/材料/一.pdf'] }).state, s)
  // 改成范本 / 改成材料没了：move 原样返回
  assert.equal(reduceTask(s, { type: 'move', path: 'C:/材料/一.pdf', to: 'template' }).state, s)
  // 文件夹清空重装
  const re = reduceTask(s, { type: 'drop', folder: 'C:/周材料', files: ['C:/周材料/一.pdf', 'C:/周材料/二.pdf'] })
  assert.deepEqual(re.state.place, { kind: 'folder', dir: 'C:/周材料' })
  assert.deepEqual(re.state.files.map((m) => m.path), ['C:/周材料/一.pdf', 'C:/周材料/二.pdf'])
  assert.equal(re.state.phase, 'ready')
  // remove：folder 的去空留 ready，files 的去空回 empty
  let t = re.state
  t = reduceTask(t, { type: 'remove', path: 'C:/周材料/一.pdf' }).state
  t = reduceTask(t, { type: 'remove', path: 'C:/周材料/二.pdf' }).state
  assert.equal(t.phase, 'ready')
  assert.deepEqual(t.place, { kind: 'folder', dir: 'C:/周材料' })
  let u = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  u = reduceTask(u, { type: 'remove', path: 'C:/材料/一.pdf' }).state
  assert.equal(u.phase, 'empty')
  assert.deepEqual(u.place, { kind: 'files', dir: '' })
  // 没挂着的去不掉：原样返回
  const w = working('干活')
  assert.equal(reduceTask(w, { type: 'remove', path: 'C:/材料/一.pdf' }).state, w)
  let d = working('写', 'd1')
  d = reduceTask(d, { type: 'end', taskId: 'd1', status: 'done' }).state
  assert.equal(reduceTask(d, { type: 'remove', path: 'C:/材料/一.pdf' }).state, d)
  // 小签上只能去掉：视图里不带范本的记号
  const tags = toTaskView(reduceTask(createTask(), { type: 'drop', files: ['C:/材料/上周周报.docx', 'C:/材料/一.pdf'] }).state).tags
  assert.deepEqual(tags.map((one) => [one.name, 'role' in one, one.lock]), [['上周周报.docx', false, false], ['一.pdf', false, false]])
})

test('2d 干活中拖进来、贴进来的：挂在输入框上当待发的，跟下一句或插的那句一起发出去', () => {
  let s = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  s = reduceTask(s, { type: 'send', text: '汇成周报', runId: 'g1' }).state
  const flow = s.flow.length
  // 干活中拖进来：挂上，对话流里不添话，也不停这一轮
  const dropped = reduceTask(s, { type: 'drop', files: ['C:/材料/二.pdf', 'C:/材料/一.pdf'] })
  assert.equal(dropped.settle, false)
  assert.equal(dropped.start, null)
  s = dropped.state
  assert.equal(s.phase, 'working')
  assert.equal(s.flow.length, flow)
  assert.deepEqual(s.files.map((one) => one.name), ['一.pdf', '二.pdf'])
  // 拖的是文件夹：挂上里面的文件，地点不换
  s = reduceTask(s, { type: 'drop', folder: 'C:/周材料', files: ['C:/周材料/三.md'] }).state
  assert.deepEqual(s.files.map((one) => one.name), ['一.pdf', '二.pdf', '三.md'])
  assert.deepEqual(s.place, { kind: 'files', dir: '' })
  // 干活中贴的图也挂上
  s = reduceTask(s, { type: 'paste', files: [{ path: 'C:/贴的/贴的图-9.png', name: '贴的图-9.png', kind: 'image' }] }).state
  assert.deepEqual(s.files.map((one) => one.name), ['一.pdf', '二.pdf', '三.md', '贴的图-9.png'])
  // 小签：这一轮带着的锁住，干活中挂上的没锁（能去掉）
  assert.deepEqual(toTaskView(s).tags.map((one) => [one.name, one.lock]), [['一.pdf', true], ['二.pdf', false], ['三.md', false], ['贴的图-9.png', false]])
  // 干活中去掉：这一轮带着的去不掉，挂上的能去
  assert.equal(reduceTask(s, { type: 'remove', path: 'C:/材料/一.pdf' }).state, s)
  s = reduceTask(s, { type: 'remove', path: 'C:/周材料/三.md' }).state
  assert.deepEqual(s.files.map((one) => one.name), ['一.pdf', '二.pdf', '贴的图-9.png'])
  // 插一句：挂上的跟着这句发，气泡里摆成小块；发出去以后就锁住了
  s = reduceTask(s, { type: 'steer', taskId: 'g1', id: 'st1', text: '加上这两份', files: [{ name: '二.pdf', path: 'C:/ws/二.pdf', kind: '' }] }).state
  assert.deepEqual(toTaskView(s).blocks.find((one) => one.kind === 'steer').files.map((one) => one.name), ['二.pdf'])
  assert.deepEqual(toTaskView(s).tags.map((one) => [one.name, one.lock]), [['一.pdf', true], ['二.pdf', true], ['贴的图-9.png', false]])
  // 这一轮做完、发下一句：所有挂着的都跟着发（模型那头新的那几份由 run.mjs 拷进工作区）
  s = reduceTask(s, { type: 'end', taskId: 'g1', status: 'done' }).state
  const next = reduceTask(s, { type: 'send', text: '再补一段', runId: 'g2' })
  assert.deepEqual(next.start.files, ['C:/材料/一.pdf', 'C:/材料/二.pdf', 'C:/贴的/贴的图-9.png'])
  assert.equal(next.start.resume, true)
})

test('2b 贴的图和长文字：当文件加小签，不重开任务；收下以后也能去掉', () => {
  // 空任务里贴一张图、一段长文字：都进文件，任务变 ready
  let s = createTask()
  s = reduceTask(s, { type: 'paste', files: [{ path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-1.png', name: '贴的图-1.png', kind: 'image' }] }).state
  assert.equal(s.phase, 'ready')
  assert.deepEqual(s.place, { kind: 'files', dir: '' })
  s = reduceTask(s, { type: 'paste', files: [{ path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的文字-1.md', name: '贴的文字-1.md', kind: 'text', sub: '3,280 字' }] }).state
  assert.deepEqual(s.files.map((m) => [m.path, m.kind, m.sub]), [
    ['C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-1.png', 'image', ''],
    ['C:/Users/slow/桌伴/贴的/2026-11-12/贴的文字-1.md', 'text', '3,280 字'],
  ])
  // 一次贴多张图：多个小签；重复贴同一份不重加
  s = reduceTask(s, { type: 'paste', files: [
    { path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-2.png', name: '贴的图-2.png', kind: 'image' },
    { path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-1.png', name: '贴的图-1.png', kind: 'image' },
  ] }).state
  assert.equal(s.files.length, 3)
  // 干活中贴的：挂上，跟下一句一起发，也不另说一句
  const w = working('干活', 'p1')
  const busy = reduceTask(w, { type: 'paste', files: [{ path: 'C:/贴的图-9.png', name: '贴的图-9.png', kind: 'image' }] })
  assert.deepEqual(busy.state.files.map((one) => one.name), ['贴的图-9.png'])
  assert.equal(busy.state.flow.length, w.flow.length)
  // 没贴上（格式不支持、什么都没贴上）：输入框上方一行提示（Si702 / Si704），不加小签
  const bad = reduceTask(createTask(), { type: 'paste', files: [], code: 'Si702' })
  assert.deepEqual(toTaskView(bad.state).banner, { level: 'notice', text: copy('stops.pasteType'), code: 'Si702', raw: '', buttons: [] })
  assert.equal(bad.state.files.length, 0)
  // 点 × 收起
  assert.equal(toTaskView(reduceTask(bad.state, { type: 'dismiss' }).state).banner, null)
  // 做完了接着说时贴的：不重开任务，照旧进下一轮
  let d = working('写', 'd1')
  d = reduceTask(d, { type: 'end', taskId: 'd1', status: 'done' }).state
  const cards = d.cards.length
  d = reduceTask(d, { type: 'paste', files: [{ path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-3.png', name: '贴的图-3.png', kind: 'image' }] }).state
  assert.equal(d.phase, 'done', '不重开任务')
  assert.equal(d.cards.length, cards, '产出卡还在')
  assert.equal(d.files.at(-1).name, '贴的图-3.png')
  // 收下以后去掉贴的：可以；去掉原来拖的：还是不行
  d = reduceTask(d, { type: 'remove', path: 'C:/Users/slow/桌伴/贴的/2026-11-12/贴的图-3.png', pasted: true }).state
  assert.equal(d.files.length, 0)
  const d2 = reduceTask(d, { type: 'paste', files: [{ path: 'C:/x/贴的文字-2.md', name: '贴的文字-2.md', kind: 'text', sub: '2,000 字' }] }).state
  assert.notEqual(reduceTask(d2, { type: 'remove', path: 'C:/x/贴的文字-2.md' }).state, d2, '小签菜单里的去掉（不带 pasted）对贴出来的也能去')
  assert.equal(reduceTask(d2, { type: 'remove', path: 'C:/x/贴的文字-2.md' }).state.files.length, 0)
  // 拖进来的（没带 kind）收尾态里也能去：去掉读不了的那份，再点重来就不带它了
  let o = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/乙.md'] }).state
  o = reduceTask(o, { type: 'send', text: '写', runId: 'd9' }).state
  o = reduceTask(o, { type: 'end', taskId: 'd9', status: 'done' }).state
  const o2 = reduceTask(o, { type: 'remove', path: 'C:/材料/乙.md' }).state
  assert.notEqual(o2, o, '拖进来的在收尾态里能去掉')
  assert.equal(o2.files.length, 0)
  // 去掉以后点重来：这一轮不带那份了
  const o3 = reduceTask(o2, { type: 'retry', runId: 'd10' }).state
  assert.deepEqual(o3.flow.at(-1).files, [], '重来不带去掉的那份')
  // 干活中带不带 pasted 都不让去掉
  assert.equal(reduceTask(working('干活'), { type: 'remove', path: 'C:/x/贴的文字-2.md', pasted: true }).state.phase, 'working')
  assert.equal(reduceTask(working('干活'), { type: 'remove', path: 'C:/x/贴的文字-2.md', pasted: true }).state.files.length, 0)
})

test('2c 贴的图和长文字的小签和灰字：缩略图、第二行小字、改回文字、看不了图', () => {
  let s = createTask()
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/拖来的图.PNG', 'C:/材料/说明.docx'] }).state
  s = reduceTask(s, { type: 'paste', files: [
    { path: 'C:/桌伴/贴的/2026-11-12/贴的图-1.png', name: '贴的图-1.png', kind: 'image' },
    { path: 'C:/桌伴/贴的/2026-11-12/贴的文字-1.md', name: '贴的文字-1.md', kind: 'text', sub: '3,280 字' },
  ] }).state
  const v = toTaskView(s)
  // 拖进来的图自己按扩展名认：带缩略图、第二行写「图片」，但没有改回文字
  assert.deepEqual(v.tags.map((t) => [t.name, t.kind, t.sub, t.thumb, t.restore]), [
    ['拖来的图.PNG', 'image', '图片', true, false],
    ['说明.docx', '', '', false, false],
    ['贴的图-1.png', 'image', '图片', true, false],
    ['贴的文字-1.md', 'text', '3,280 字', false, true],
  ])
  // 再贴同一份不会重加
  const more = reduceTask(s, { type: 'paste', files: [
    { path: 'C:/桌伴/贴的/2026-11-12/贴的文字-1.md', name: '贴的文字-1.md', kind: 'text', sub: '3,280 字' },
  ] }).state
  const v2 = toTaskView(more)
  assert.equal(v2.tags.length, 4)
  // 贴了长文字：不另说一句（小签上已经写了字数）
  assert.equal(v2.notes, undefined)
  // 现在的模型看不了图：输入框上方说一句（拦着发）
  const asked = []
  const pics = (files) => { asked.push(files.map((one) => one.name)); return files.filter((one) => /\.(png|jpe?g)$/i.test(one.name)).map((one) => one.name) }
  // 一个能看图的模型都没配：去设置·模型里配
  const blind = toTaskView(s, { unseen: pics })
  assert.deepEqual(blind.remind, { text: copy('St601'), label: '模型配置', action: 'settings', block: true })
  assert.equal(blind.input.canSend, false)
  // 配了但没选：打开换模型的菜单去选
  const pick = toTaskView(s, { unseen: pics, hasVision: () => true })
  assert.deepEqual(pick.remind, { text: copy('St601'), label: '选择模型', action: 'models', block: true })
  // 看得了（壳说一份都没有）、没告诉我们（测试的假壳）：不提醒
  assert.equal(toTaskView(s, { unseen: () => [] }).remind, null)
  assert.equal(toTaskView(s).remind, null)
  // 发出去：干活中不说；干完了这几份已经发过（进了「我说的」那一条），也不再说
  const sent = reduceTask(s, { type: 'send', text: '把这堆发票汇成表', runId: 'u1' }).state
  assert.equal(toTaskView(sent, { unseen: pics }).remind, null)
  const done = reduceTask(sent, { type: 'end', taskId: 'u1', status: 'done' }).state
  assert.equal(toTaskView(done, { unseen: pics }).remind, null)
  // 接着说时又贴了一张：只问新贴的这一张
  asked.length = 0
  const again = reduceTask(done, { type: 'paste', files: [{ path: 'C:/桌伴/贴的/2026-11-12/贴的图-2.png', name: '贴的图-2.png', kind: 'image' }] }).state
  assert.equal(toTaskView(again, { unseen: pics }).remind.text, copy('St601'))
  assert.deepEqual(asked, [['贴的图-2.png']])
  // 小签菜单多一项：贴的长文字才有改回文字
  assert.equal(v.labels.tagRestore, copy('tag.restore'))
})

test('3 一整个任务：拖文件、发话、跑完出卡', () => {
  let s = createTask()
  const see = () => walk(toTaskView(s))
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/上周周报.docx'] }).state
  see()
  const six = ['一.pdf', '二.pdf', '三.pdf', '四.pdf', '五.pdf', '六.pdf'].map((n) => `C:/材料/${n}`)
  s = reduceTask(s, { type: 'drop', files: six }).state
  see()
  assert.equal(s.files.length, 7)
  const sent = reduceTask(s, { type: 'send', text: ' 汇成本周周报 ', runId: 'r1' })
  s = sent.state
  see()
  assert.equal(sent.start.runId, 'r1')
  assert.equal(sent.start.round, 1)
  assert.equal(sent.start.prompt, '汇成本周周报')
  assert.equal(sent.start.resume, false)
  assert.deepEqual(sent.start.place, { kind: 'files', dir: '' })
  // 一列文件原样带过去：没有范本和材料之分
  assert.deepEqual(sent.start.files, ['C:/材料/上周周报.docx', ...six])
  assert.equal('template' in sent.start, false)
  assert.equal(sent.pet, 'work')
  assert.equal(sent.notify, '')
  let v = toTaskView(s)
  assert.equal(s.phase, 'working')
  // 干活中：输入框不锁，能插一句
  assert.equal(v.input.button, 'send')
  assert.equal(v.input.canSend, true)
  assert.equal(v.input.hint, copy('input.hint'))
  assert.equal(v.flow.at(-1).kind, 'user')
  assert.equal(v.flow.at(-1).text, '汇成本周周报')
  const before = s.flow.length
  s = reduceTask(s, { type: 'step', taskId: 'r1', step: 'prepare' }).state
  see()
  assert.equal(s.flow.length, before)
  s = reduceTask(s, { type: 'step', taskId: 'r1', step: 'copy' }).state
  see()
  assert.equal(s.flow.length, before)
  assert.equal(s.flow.some((one) => one.kind === 'progress'), false)
  // 干活中：对话流最下面一行浅字，只说在干什么（换得太快不闪：还是先来的那一步）
  const workingBlocks = toTaskView(s).blocks
  assert.equal(workingBlocks.at(-1).kind, 'working')
  assert.equal(workingBlocks.at(-1).text, copy('St201'))
  assert.equal('since' in workingBlocks.at(-1), false)
  const dir = 'C:/Users/slow/桌伴/任务/1104-汇成本周周报'
  s = reduceTask(s, { type: 'workspace', taskId: 'r1', dir }).state
  v = toTaskView(s)
  // 开工以后胶囊上照样写「任务列表」，文件夹路径只在停上去的提示里
  assert.equal(v.top.path.text, copy('top.tasks'))
  assert.equal(v.top.path.title, dir)
  assert.equal(v.top.path.open, dir)
  const p1 = reduceTask(s, { type: 'progress', taskId: 'r1', text: 'write 本周周报.docx' })
  s = p1.state
  see()
  // 过程行没了：进度只把小岛留在干活中，对话流里不添东西
  assert.equal(s.flow.some((one) => one.kind === 'progress'), false)
  assert.equal(p1.pet, 'work')
  assert.equal(p1.petText, '')
  s = reduceTask(s, { type: 'reply', taskId: 'r1', text: '本周周报写好了。' }).state
  see()
  const u = usage({ inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 50_000, cacheWriteTokens: 10_000 })
  s = reduceTask(s, { type: 'usage', taskId: 'r1', ...u }).state
  see()
  s = reduceTask(s, { type: 'output', taskId: 'r1', name: '本周周报.docx', to: `${dir}/本周周报.docx`, pages: 3 }).state
  see()
  const ended = reduceTask(s, { type: 'end', taskId: 'r1', status: 'done' })
  s = ended.state
  see()
  assert.equal(s.phase, 'done')
  assert.equal(s.flow.at(-1).kind, 'reply')
  assert.equal(s.flow.at(-1).text, '本周周报写好了。')
  assert.equal(s.flow.some((one) => one.kind === 'progress'), false)
  // 干完了：「正在工作」那一行没了
  assert.equal(toTaskView(s).blocks.some((one) => one.kind === 'working'), false)
  assert.equal(ended.pet, 'done')
  // 任务窗这头不说「做完了」（小岛自己说「做完了！」）
  assert.equal(ended.notify, '')
  assert.equal(s.look, true)
  v = toTaskView(s)
  const card = v.bottom.cards[0]
  assert.equal(card.id, '1')
  assert.equal(card.name, '本周周报.docx')
  assert.equal(card.path, `${dir}/本周周报.docx`)
  assert.equal(card.label, copy('output.made'))
  assert.equal(card.line, '本周周报.docx · 3 页')
  assert.equal(card.old, false)
  assert.deepEqual(Object.keys(v.bottom), ['cards'])
})

test('4 taskId 对不上的一律原样返回', () => {
  const s = working('写', 't1')
  for (const event of [
    { type: 'step', taskId: '别的', step: 'prepare' },
    { type: 'workspace', taskId: '别的', dir: 'C:/任务/别的' },
    { type: 'progress', taskId: '别的', text: 'write 本周周报.docx' },
    { type: 'reply', taskId: '别的', text: '好了。' },
    { type: 'usage', taskId: '别的', ...usage({ inputTokens: 1_000 }) },
    { type: 'output', taskId: '别的', name: 'a.docx', to: 'C:/o/a.docx' },
    { type: 'error', taskId: '别的', reason: 'network' },
    { type: 'end', taskId: '别的', status: 'done' },
  ]) {
    assert.equal(reduceTask(s, event).state, s)
  }
  // 还没开跑（runId 空）时后台事件一律不收；status 不认识也原样
  const fresh = createTask()
  assert.equal(reduceTask(fresh, { type: 'progress', taskId: null, text: 'write a.docx' }).state, fresh)
  assert.equal(reduceTask(fresh, { type: 'end', taskId: null, status: 'done' }).state, fresh)
  assert.equal(reduceTask(s, { type: 'end', taskId: 't1', status: 'weird' }).state, s)
  // error、end 只在 working 响应
  let d = working('写', 't2')
  d = reduceTask(d, { type: 'end', taskId: 't2', status: 'done' }).state
  assert.equal(reduceTask(d, { type: 'error', taskId: 't2', reason: 'key' }).state, d)
  assert.equal(reduceTask(d, { type: 'end', taskId: 't2', status: 'error' }).state, d)
})

test('5 等你回话：问句收尾进 asking', () => {
  const askOnce = (mark, fg) => {
    let s = createTask()
    if (fg) s = reduceTask(s, { type: 'window', foreground: true }).state
    s = reduceTask(s, { type: 'send', text: '把材料改成正式口吻', runId: 'q1' }).state
    // 什么都没拖也是一个任务：任务文件夹建好前胶囊写「任务列表」
    assert.deepEqual(s.place, { kind: 'files', dir: '' })
    assert.equal(toTaskView(s).top.path.text, copy('top.tasks'))
    s = reduceTask(s, { type: 'reply', taskId: 'q1', text: `你要哪一份材料${mark}` }).state
    return reduceTask(s, { type: 'end', taskId: 'q1', status: 'done' })
  }
  let step = askOnce('？', false)
  let s = step.state
  assert.equal(s.phase, 'asking')
  assert.equal(s.look, true)
  assert.equal(step.pet, 'look')
  assert.equal(step.notify, copy('flow.askTail'))
  let v = toTaskView(s)
  assert.equal(v.flow.at(-1).kind, 'reply')
  assert.equal(v.flow.at(-1).tail, copy('flow.askTail'))
  assert.deepEqual(v.input, { mode: 'ask', hint: copy('input.hint'), button: 'send', canSend: true, focus: true })
  // 没出文件也不另说一句
  assert.deepEqual(v.bottom, { cards: [] })
  walk(v)
  step = askOnce('?', false)
  assert.equal(step.state.phase, 'asking')
  step = askOnce('？', true)
  assert.equal(step.pet, 'idle')
  assert.equal(step.notify, '')
  assert.equal(step.state.look, false)
  // 这一轮有卡就是 done
  let d = working('写', 'q2')
  d = reduceTask(d, { type: 'output', taskId: 'q2', name: '一.docx', to: 'C:/o/一.docx' }).state
  d = reduceTask(d, { type: 'reply', taskId: 'q2', text: '起这个名行吗？' }).state
  d = reduceTask(d, { type: 'end', taskId: 'q2', status: 'done' }).state
  assert.equal(d.phase, 'done')
  walk(toTaskView(d))
  // 接着发一句：上一轮的 ask 清掉
  const again = reduceTask(s, { type: 'send', text: '就用第一份', runId: 'q3' })
  assert.equal(again.start.resume, true)
  assert.equal(again.start.round, 2)
  assert.equal(toTaskView(again.state).flow.find((one) => one.kind === 'reply').tail, '')
})

test('6 只聊天：没卡不是问句 → done，收下回空', () => {
  let s = working('讲个笑话', 'c1')
  const u = usage({ inputTokens: 1_000 })
  s = reduceTask(s, { type: 'reply', taskId: 'c1', text: '好。' }).state
  s = reduceTask(s, { type: 'usage', taskId: 'c1', ...u }).state
  s = reduceTask(s, { type: 'end', taskId: 'c1', status: 'done' }).state
  assert.equal(s.phase, 'done')
  assert.deepEqual(toTaskView(s).bottom, { cards: [] })
  walk(toTaskView(s))
  const acc = reduceTask(s, { type: 'accept' })
  assert.equal(acc.settle, true)
  assert.equal(acc.pet, 'idle')
  assert.equal(acc.state.phase, 'empty')
  assert.deepEqual(acc.state.flow, [])
  assert.equal(acc.state.cards.length, 0)
  // 没有 usage 时也一样
  let t = working('再讲一个', 'c2')
  t = reduceTask(t, { type: 'reply', taskId: 'c2', text: '好。' }).state
  t = reduceTask(t, { type: 'end', taskId: 'c2', status: 'done' }).state
  assert.deepEqual(toTaskView(t).bottom, { cards: [] })
  walk(toTaskView(t))
})

test('7 出错的话：每种 reason 的字和按钮', () => {
  const cases = [
    // 停工那句照码说（app/copy/errors.mjs）：开工前算不通的由 resolveModel 点名用哪一句
    [{ reason: 'key', code: 'Si101', stop: 'noKey', vars: { vendor: 'DeepSeek' } }, 'DeepSeek 密钥未填写', 2],
    // 模型服务说密钥不对（Si401）：「密钥无效」（跟设置里测试说的同一句），后面带码和原文
    [{ reason: 'key', raw: '401 Unauthorized' }, '密钥无效', 2],
    [{ reason: 'consent', code: 'Si102', stop: 'consent' }, '必须阅读并同意使用须知', 2],
    [{ reason: 'missing', code: 'Si103', stop: 'missing' }, '模型不可用', 2],
    [{ reason: 'model' }, '模型不可用', 2],
    [{ reason: 'quota' }, '模型请求失败，已保存执行进度', 1],
    [{ reason: 'network' }, '模型连接中断，已保存执行进度', 1],
    [{ reason: 'crash' }, '程序崩溃', 1],
    [{ reason: 'locked', name: '周报范本.docx' }, copy('stops.locked', { name: '周报范本.docx' }), 1],
    [{ reason: '没听过的' }, copy('stops.other'), 1],
  ]
  for (const [evt, text, n] of cases) {
    const step = reduceTask(working('写', 'e1'), { type: 'error', taskId: 'e1', ...evt })
    assert.equal(step.state.phase, 'error', text)
    const last = step.state.flow.at(-1)
    assert.equal(last.kind, 'error')
    assert.equal(last.text, text)
    assert.equal(last.buttons.length, n)
    assert.equal(step.pet, 'fail')
    assert.equal(step.notify, text)
    assert.equal(step.state.look, true)
    const bad = toTaskView(step.state)
    assert.equal(bad.flow.at(-1).text, text)
    // 页面上是输入框上方的红色横幅，按钮跟着横幅走
    assert.deepEqual([bad.banner.level, bad.banner.text, bad.banner.buttons.length], ['block', text, n])
    assert.equal(bad.blocks.some((one) => one.kind === 'error'), false)
    walk(bad)
  }
  const keyStep = reduceTask(working('写', 'e2'), { type: 'error', taskId: 'e2', reason: 'key' })
  assert.deepEqual(keyStep.state.flow.at(-1).buttons, [{ action: 'settings', label: '去设置' }, { action: 'retry', label: '重试' }])
  // 前台不打扰
  const fg = reduceTask(reduceTask(createTask(), { type: 'window', foreground: true }).state, { type: 'send', text: '写', runId: 'e3' })
  const fgErr = reduceTask(fg.state, { type: 'error', taskId: 'e3', reason: 'network' })
  assert.equal(fgErr.pet, 'idle')
  assert.equal(fgErr.notify, '')
  // end error 前面没来 error → 兜底那句
  const endErr = reduceTask(working('写', 'e4'), { type: 'end', taskId: 'e4', status: 'error' })
  assert.equal(endErr.state.phase, 'error')
  assert.equal(endErr.state.flow.at(-1).text, copy('stops.other'))
  assert.deepEqual(endErr.state.flow.at(-1).buttons, [{ action: 'retry', label: '重试' }])
  assert.equal(endErr.pet, 'fail')
  assert.equal(endErr.notify, copy('stops.other'))
  walk(toTaskView(endErr.state))
})

test('7b 模型一直忙：停在这儿，给「接着干」和「换个模型」', () => {
  const step = reduceTask(working('写', 'b1'), { type: 'error', taskId: 'b1', reason: 'busy', vendor: '智谱' })
  assert.equal(step.state.phase, 'paused')
  const last = step.state.flow.at(-1)
  assert.equal(last.kind, 'error')
  assert.equal(last.text, '模型忙，已保存执行进度')
  assert.deepEqual(last.buttons, [{ action: 'continue', label: copy('input.continueLabel') }, { action: 'models', label: copy('input.swapModel') }])
  // 小岛照「等你回话」的样子
  assert.equal(step.pet, 'look')
  assert.equal(step.notify, last.text)
  const v = toTaskView(step.state)
  assert.equal(v.input.mode, 'paused')
  assert.equal(v.input.button, 'continue')
  assert.equal(v.input.canSend, true)
  walk(v)
  // 前台不打扰
  const fg = reduceTask(reduceTask(createTask(), { type: 'window', foreground: true }).state, { type: 'send', text: '写', runId: 'b2' })
  const fgBusy = reduceTask(fg.state, { type: 'error', taskId: 'b2', reason: 'busy' })
  assert.equal(fgBusy.pet, 'idle')
  assert.equal(fgBusy.notify, '')
})

test('7c 模型忙着重试：出一行等待，秒数自己倒数；模型一说话那行就没了', () => {
  const now = Date.now()
  let s = working('写', 'w9')
  const wait = reduceTask(s, { type: 'wait', taskId: 'w9', text: '智谱那边忙，20 秒后再试（第 3 次，最多 10 次）', until: now + 20_000, retry: 3, max: 10 })
  s = wait.state
  const row = s.flow.at(-1)
  assert.equal(row.kind, 'wait')
  assert.equal(row.text, '智谱那边忙，20 秒后再试（第 3 次，最多 10 次）')
  assert.equal(row.buttons.length, 1)
  assert.equal(row.buttons[0].action, 'stop')
  assert.equal(row.until, now + 20_000)
  // 小岛还是干活中
  assert.equal(wait.pet, 'work')
  const block = toTaskView(s).blocks.at(-1)
  assert.equal(block.kind, 'wait')
  assert.equal(block.until, now + 20_000)
  walk(toTaskView(s))
  // 再来一次等待：还是一行，不攒着
  s = reduceTask(s, { type: 'wait', taskId: 'w9', text: '智谱那边忙，40 秒后再试（第 4 次，最多 10 次）', until: now + 40_000, retry: 4, max: 10 }).state
  assert.equal(s.flow.filter((one) => one.kind === 'wait').length, 1)
  // 模型说话了：那行等待没了
  s = reduceTask(s, { type: 'reply', taskId: 'w9', text: '好了' }).state
  assert.equal(s.flow.some((one) => one.kind === 'wait'), false)
  // 不是干活中的时候来的等待事件：原样不动
  const idle = reduceTask(createTask(), { type: 'wait', taskId: 'x', text: '等等' })
  assert.equal(idle.state.phase, 'empty')
})

test('7d 接着干：同一个会话里只说一句短话，原来的要求和文件不再发一遍；换个模型以后也能接着干', () => {
  let s = reduceTask(working('写个总结', 'c1'), { type: 'error', taskId: 'c1', reason: 'busy', vendor: '智谱' }).state
  // 换个模型：选中的模型管下一轮
  s = reduceTask(s, { type: 'model', entry: 'free', model: 'kilo-auto/free', effort: null }).state
  assert.equal(s.model.entry, 'free')
  const cont = reduceTask(s, { type: 'continue', runId: 'c2' })
  s = cont.state
  assert.equal(s.phase, 'working')
  // 接着干是同一会话里的一句短话：dsh 那边记着原来那句要求，不再带上。
  // 那句只给模型：气泡上写按钮上的「继续」，用量的任务名还是用户原来那句
  assert.equal(s.flow.at(-1).kind, 'user')
  assert.equal(s.flow.at(-1).text, copy('input.continueLabel'))
  assert.equal(cont.start.prompt, copy('continue'))
  assert.equal(cont.start.said, copy('input.continueLabel'))
  assert.equal(cont.start.utterance, '写个总结')
  assert.equal(cont.start.resume, true)
  assert.equal(cont.start.model.entry, 'free')
  // 用户原来那句还记着：再点「重来」发的还是它
  assert.equal(s.prompt, '写个总结')
  // 带着文件也一样：只说那一句，文件名不再列一遍，也不再重新切块
  const withFiles = reduceTask(reduceTask(createTask(), { type: 'drop', files: ['C:/材料/上周周报.docx', 'C:/材料/数据.xlsx'] }).state, { type: 'send', text: '照上周周报写一份', runId: 'c5' }).state
  const pausedFiles = reduceTask(withFiles, { type: 'error', taskId: 'c5', reason: 'busy' }).state
  const contFiles = reduceTask(pausedFiles, { type: 'continue', runId: 'c6' })
  assert.equal(contFiles.start.prompt, copy('continue'))
  assert.equal('refeed' in contFiles.start, false)
  // 停在这儿的时候直接发话：也是同一个会话
  const paused = reduceTask(working('写', 'c3'), { type: 'error', taskId: 'c3', reason: 'busy' }).state
  const said = reduceTask(paused, { type: 'send', text: '换个方向写', runId: 'c4' })
  assert.equal(said.start.resume, true)
})

test('7e 工具调用对不上：这一轮没干成，给「重来」（重开一轮，不接那个废掉的会话）', () => {
  const step = reduceTask(working('写个周报', 't1'), { type: 'error', taskId: 't1', reason: 'toolcall' })
  assert.equal(step.state.phase, 'error')
  const last = step.state.flow.at(-1)
  assert.equal(last.kind, 'error')
  assert.equal(last.text, copy('stops.toolcall'))
  // 这种错不能「接着干」：那个会话已经废了，只给重来
  assert.deepEqual(last.buttons, [{ action: 'retry', label: '重试' }])
  assert.equal(step.pet, 'fail')
  walk(toTaskView(step.state))
  // 点重来：重开一轮（不接那个会话），还是原来那句话
  const again = reduceTask(step.state, { type: 'retry', runId: 't2' })
  assert.equal(again.state.phase, 'working')
  assert.equal(again.start.resume, false)
  assert.equal(again.start.prompt, '写个周报')
  assert.equal(again.start.round, 2)
})

test('8 停下：stop、end cancelled、stopped 里再发', () => {
  let s = working('写个总结', 's1')
  const stop = reduceTask(s, { type: 'stop' })
  assert.equal(stop.cancel, true)
  assert.equal(stop.state, s)
  assert.equal(stop.pet, null)
  s = reduceTask(s, { type: 'output', taskId: 's1', name: '半成品.docx', to: 'C:/o/半成品.docx' }).state
  const ended = reduceTask(s, { type: 'end', taskId: 's1', status: 'cancelled' })
  s = ended.state
  assert.equal(s.phase, 'stopped')
  const last = s.flow.at(-1)
  assert.equal(last.kind, 'note')
  assert.equal(last.text, copy('St607'))
  // 停下以后也给「接着干」：接着原来那件事往下干
  assert.deepEqual(last.buttons, [{ action: 'continue', label: '继续' }, { action: 'retry', label: '重试' }])
  assert.equal(ended.pet, 'idle')
  assert.equal(ended.notify, '')
  assert.equal(s.look, false)
  assert.equal(toTaskView(s).input.hint, copy('input.hint'))
  walk(toTaskView(s))
  // 停下以后直接打一句：接着同一个会话（模型记得前面聊过什么），产出卡不算旧的
  const resent = reduceTask(s, { type: 'send', text: '再写一次', runId: 's2' })
  assert.equal(resent.start.resume, true)
  assert.equal(resent.start.round, 2)
  assert.equal(resent.start.prompt, '再写一次')
  assert.equal(toTaskView(resent.state).bottom.cards[0].old, false)
  walk(toTaskView(resent.state))
  // 停下以后点「接着干」：同一个会话里说一句短话
  const cont = reduceTask(s, { type: 'continue', runId: 's3' })
  assert.equal(cont.state.phase, 'working')
  assert.equal(cont.start.resume, true)
  assert.equal(cont.start.prompt, copy('continue'))
  // 接着干以后再点重来：发的还是用户原来那句
  const ended2 = reduceTask(cont.state, { type: 'error', taskId: 's3', reason: 'network' }).state
  assert.equal(reduceTask(ended2, { type: 'retry', runId: 's4' }).start.prompt, '写个总结')
})

test('8b 程序意外停了：跟用户点停下一样，能点「继续」接着做', () => {
  let s = working('写个总结', 's1')
  const ended = reduceTask(s, { type: 'end', taskId: 's1', status: 'interrupted' })
  s = ended.state
  assert.equal(s.phase, 'stopped')
  const last = s.flow.at(-1)
  assert.equal(last.kind, 'note')
  assert.equal(last.text, copy('St608'))
  assert.deepEqual(last.buttons, [{ action: 'continue', label: '继续' }, { action: 'retry', label: '重试' }])
  assert.equal(ended.pet, 'idle')
  walk(toTaskView(s))
  // 点「继续」：同一个会话上接着做
  const cont = reduceTask(s, { type: 'continue', runId: 's2' })
  assert.equal(cont.state.phase, 'working')
  assert.equal(cont.start.resume, true)
  assert.equal(cont.start.prompt, copy('continue'))
})

test('8c 改了模型设置中断的：说改了模型设置，不说用户点的停下', () => {
  const s = working('写个总结', 's1')
  const ended = reduceTask(s, { type: 'end', taskId: 's1', status: 'cancelled', note: 'settings' })
  assert.equal(ended.state.phase, 'stopped')
  const last = ended.state.flow.at(-1)
  assert.equal(last.kind, 'note')
  assert.equal(last.text, copy('St609'))
  assert.notEqual(last.text, copy('St607'))
  assert.notEqual(last.text, copy('St608'))
  assert.deepEqual(last.buttons, [{ action: 'continue', label: '继续' }, { action: 'retry', label: '重试' }])
})

test('9 重来：error 里 retry，working 里原样', () => {
  let s = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/范本一.docx', 'C:/材料/一份.pdf'] }).state
  s = reduceTask(s, { type: 'send', text: '照范本写一份', runId: 'r1' }).state
  s = reduceTask(s, { type: 'output', taskId: 'r1', name: '成品.docx', to: 'C:/o/成品.docx' }).state
  s = reduceTask(s, { type: 'error', taskId: 'r1', reason: 'network' }).state
  assert.equal(reduceTask(s, { type: 'retry' }).state, s)
  const retried = reduceTask(s, { type: 'retry', runId: 'r2' })
  assert.equal(retried.start.runId, 'r2')
  assert.equal(retried.start.resume, false)
  assert.equal(retried.start.round, 2)
  assert.equal(retried.start.prompt, '照范本写一份')
  assert.deepEqual(retried.start.files, ['C:/材料/范本一.docx', 'C:/材料/一份.pdf'])
  assert.equal(retried.state.phase, 'working')
  assert.equal(retried.pet, 'work')
  const user = retried.state.flow.filter((one) => one.kind === 'user')
  assert.equal(user.length, 2)
  assert.equal(retried.state.flow.at(-1).text, '照范本写一份')
  assert.equal(toTaskView(retried.state).bottom.cards[0].old, true)
  assert.deepEqual(retried.state.flow.find((one) => one.kind === 'error').buttons, [])
  assert.equal(reduceTask(retried.state, { type: 'retry', runId: 'r3' }).state, retried.state)
})

test('10 做完再说一句：算下一轮，卡不变旧', () => {
  let s = working('写周报', 'n1')
  s = reduceTask(s, { type: 'output', taskId: 'n1', name: '周报.docx', to: 'C:/o/周报.docx', pages: 2 }).state
  s = reduceTask(s, { type: 'end', taskId: 'n1', status: 'done' }).state
  const again = reduceTask(s, { type: 'send', text: '再补一段风险', runId: 'n2' })
  assert.equal(again.start.resume, true)
  assert.equal(again.start.round, 2)
  assert.equal(again.start.prompt, '再补一段风险')
  assert.deepEqual(again.start.files, [])
  assert.equal(again.state.cards, s.cards)
  assert.equal(toTaskView(again.state).bottom.cards[0].old, false)
  assert.equal(toTaskView(again.state).bottom.cards.length, 1)
})

test('11a 聊完往任务窗里拖文件：挂在这条对话上，下一句接着这个会话发，不换新任务', () => {
  let s = working('写周报', 'd0')
  s = reduceTask(s, { type: 'output', taskId: 'd0', name: '周报.docx', to: 'C:/o/周报.docx' }).state
  s = reduceTask(s, { type: 'end', taskId: 'd0', status: 'done' }).state
  const flowBefore = s.flow.length
  const dropped = reduceTask(s, { type: 'drop', files: ['C:/o/周报.docx'] })
  assert.equal(dropped.settle, false, '不收拾、不换任务')
  assert.equal(dropped.state.phase, 'done')
  assert.equal(dropped.state.flow.length, flowBefore, '对话流还在')
  assert.equal(dropped.state.cards.length, 1, '产出卡还在')
  assert.deepEqual(dropped.state.files.map((one) => one.name).includes('周报.docx'), true)
  // 接着说：同一个会话
  const sent = reduceTask(dropped.state, { type: 'send', text: '把第二段改短', runId: 'd0b' })
  assert.equal(sent.start.resume, true)
})

test('11 聊完往小岛上拖（新的一件事）：settle 换新任务，new 的三种走法', () => {
  let s = working('写周报', 'd1')
  s = reduceTask(s, { type: 'output', taskId: 'd1', name: '周报.docx', to: 'C:/o/周伴输出/周报.docx' }).state
  s = reduceTask(s, { type: 'end', taskId: 'd1', status: 'done' }).state
  s = reduceTask(s, { type: 'window', foreground: true }).state
  const dropped = reduceTask(s, { type: 'drop', files: ['C:/材料/新.pdf'], fresh: true })
  assert.equal(dropped.settle, true)
  assert.equal(dropped.pet, 'idle')
  assert.equal(dropped.state.phase, 'ready')
  assert.deepEqual(dropped.state.flow, [])
  assert.equal(dropped.state.cards.length, 0)
  assert.equal(dropped.state.usages.length, 0)
  assert.equal(dropped.state.files.length, 1)
  assert.equal(dropped.state.foreground, true)
  // 没卡时也一样：新任务的对话流是空的
  let t = working('写', 'd2')
  t = reduceTask(t, { type: 'end', taskId: 'd2', status: 'done' }).state
  const dropped2 = reduceTask(t, { type: 'drop', folder: 'C:/周材料', files: ['C:/周材料/一.pdf'] })
  assert.deepEqual(dropped2.state.flow, [])
  assert.deepEqual(dropped2.state.place, { kind: 'folder', dir: 'C:/周材料' })
  // working 里拖：挂在输入框上等下一句，不换任务、不另说一句、顶栏地点不换
  const w = working('干活', 'd3')
  const d1step = reduceTask(w, { type: 'drop', files: ['C:/材料/x.pdf'] })
  assert.deepEqual(d1step.state.files, [{ path: 'C:/材料/x.pdf', name: 'x.pdf' }])
  assert.deepEqual(d1step.state.place, w.place)
  assert.equal(d1step.state.flow, w.flow)
  assert.equal(d1step.settle, false)
  // new：working 原样（这一条留在后台接着跑，另开一条由 run.mjs 管）；done → settle + 空的新任务；ready → 回到空
  const w2 = reduceTask(d1step.state, { type: 'new' })
  assert.equal(w2.state, d1step.state)
  assert.equal(w2.settle, false)
  const newed = reduceTask(s, { type: 'new' })
  assert.equal(newed.settle, true)
  assert.equal(newed.pet, 'idle')
  assert.equal(newed.state.phase, 'empty')
  assert.deepEqual(newed.state.flow, [])
  let ready = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  const cleared = reduceTask(ready, { type: 'new' })
  assert.equal(cleared.settle, false)
  assert.equal(cleared.state.phase, 'empty')
  assert.deepEqual(cleared.state.flow, [])
  const empty = createTask()
  assert.equal(reduceTask(empty, { type: 'new' }).state, empty)
})

test('12 前台：look 被窗口接管后清掉', () => {
  let s = working('写', 'f1')
  s = reduceTask(s, { type: 'reply', taskId: 'f1', text: '哪一份？' }).state
  s = reduceTask(s, { type: 'end', taskId: 'f1', status: 'done' }).state
  assert.equal(s.phase, 'asking')
  assert.equal(s.look, true)
  const w1 = reduceTask(s, { type: 'window', foreground: true })
  assert.equal(w1.pet, 'idle')
  assert.equal(w1.state.look, false)
  assert.equal(w1.state.foreground, true)
  const w2 = reduceTask(w1.state, { type: 'window', foreground: true })
  assert.equal(w2.pet, null)
  assert.equal(w2.state, w1.state)
  const w3 = reduceTask(w1.state, { type: 'window', foreground: false })
  assert.equal(w3.state.foreground, false)
  // look 不是 true 时来前台：只记 foreground，宠不动
  const plain = reduceTask(working('写', 'f2'), { type: 'window', foreground: true })
  assert.equal(plain.state.foreground, true)
  assert.equal(plain.state.look, false)
  assert.equal(plain.pet, null)
})

test('13 产出卡不写钱、不写用量', () => {
  let s = working('写', 'm1')
  const u1 = usage({ inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 50_000, cacheWriteTokens: 10_000 })
  s = reduceTask(s, { type: 'usage', taskId: 'm1', ...u1 }).state
  s = reduceTask(s, { type: 'output', taskId: 'm1', name: '一.docx', to: 'C:/o/一.docx' }).state
  s = reduceTask(s, { type: 'end', taskId: 'm1', status: 'done' }).state
  s = reduceTask(s, { type: 'send', text: '再改', runId: 'm2' }).state
  s = reduceTask(s, { type: 'usage', taskId: 'm2', ...usage({ searches: 1 }) }).state
  s = reduceTask(s, { type: 'output', taskId: 'm2', name: '二.docx', to: 'C:/o/二.docx', pages: 5 }).state
  const v = toTaskView(s)
  const [second, first] = v.bottom.cards
  // 卡上只有文件名和页数，一分钱、一个 token 都不写
  assert.equal(first.line, '一.docx')
  assert.equal(second.line, '二.docx · 5 页')
  const money = /这次约|元|毛|分|token|用量|万/i
  for (const card of v.bottom.cards) assert.equal(money.test(card.line), false, card.line)
  assert.equal(money.test(JSON.stringify(v)), false)
  // 没 usage 的卡也是空的
  const dry = reduceTask(working('写', 'm3'), { type: 'output', taskId: 'm3', name: '三.docx', to: 'C:/o/三.docx' }).state
  assert.equal(toTaskView(dry).bottom.cards[0].line, '三.docx')
})

test('14 fitName、fitPath、addRecent', () => {
  assert.equal(fitName('第三季度工程项目建设进展情况汇报.docx', 30), '第三季度工程项目…况汇报.docx')
  assert.equal(fitName('短.docx', 30), '短.docx')
  assert.equal(fitName('第三季度工程项目建设进展情况汇报.docx', 19), '第三季度…汇报.docx')
  assert.equal(fitPath('C:/Users/slow/Desktop/很长很长的一个文件夹名字/本周材料', 20), 'C:/ … /本周材料')
  assert.equal(fitPath('C:\\Users\\slow\\Desktop\\很长很长的一个文件夹名字\\本周材料', 20), 'C:\\ … \\本周材料')
  assert.equal(fitPath('C:/本周材料', 4), 'C:/本周材料')
  assert.equal(fitPath('C:/两级/本周材料', 4), 'C:/ … /本周材料')
  assert.equal(fitPath('C:/Users/slow/Desktop/本周材料', 60), 'C:/Users/slow/Desktop/本周材料')
  assert.deepEqual(addRecent(['C:/a', 'C:/b'], 'C:/c'), ['C:/c', 'C:/a', 'C:/b'])
  assert.deepEqual(addRecent(['C:/a', 'C:/B'], 'c:/b'), ['c:/b', 'C:/a'])
  assert.deepEqual(addRecent(['C:/a', 'C:/b', 'C:/c', 'C:/d', 'C:/e'], 'C:/f'), ['C:/f', 'C:/a', 'C:/b', 'C:/c', 'C:/d'])
  assert.deepEqual(addRecent(undefined, 'C:/a'), ['C:/a'])
})

test('15 不改传进来的东西：全程冻住再喂', () => {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) deepFreeze(value[k])
      Object.freeze(value)
    }
    return value
  }
  let s = deepFreeze(createTask())
  const feed = (event) => {
    s = deepFreeze(reduceTask(s, deepFreeze({ ...event })).state)
  }
  feed({ type: 'drop', files: ['C:/材料/周报范本.docx'] })
  feed({ type: 'drop', files: ['C:/材料/一.pdf', 'C:/材料/二.pdf', 'C:/材料/三.pdf', 'C:/材料/四.pdf', 'C:/材料/五.pdf', 'C:/材料/六.pdf'] })
  feed({ type: 'send', text: '汇成本周周报', runId: 'z1' })
  feed({ type: 'step', taskId: 'z1', step: 'prepare' })
  feed({ type: 'step', taskId: 'z1', step: 'copy' })
  feed({ type: 'workspace', taskId: 'z1', dir: 'C:/Users/slow/桌伴/任务/1104-汇成本周周报' })
  feed({ type: 'progress', taskId: 'z1', text: 'write 本周周报.docx' })
  feed({ type: 'progress', taskId: 'z1', text: 'write 本周周报.docx' })
  feed({ type: 'reply', taskId: 'z1', text: '写好了。' })
  feed({ type: 'usage', taskId: 'z1', ...usage({ inputTokens: 1_000 }) })
  feed({ type: 'output', taskId: 'z1', name: '本周周报.docx', to: 'C:/o/本周周报.docx', pages: 3 })
  feed({ type: 'end', taskId: 'z1', status: 'done' })
  feed({ type: 'retry', runId: 'z2' })
  feed({ type: 'error', taskId: 'z2', reason: 'network' })
  feed({ type: 'retry', runId: 'z3' })
  feed({ type: 'stop' })
  feed({ type: 'end', taskId: 'z3', status: 'cancelled' })
  feed({ type: 'send', text: '再来', runId: 'z4' })
  feed({ type: 'end', taskId: 'z4', status: 'done' })
  feed({ type: 'accept' })
  assert.equal(s.phase, 'empty')
  toTaskView(s, deepFreeze({ root: 'C:/Users/slow/桌伴', recent: ['C:/周材料'] }))
})

test('16 界面字里没有禁词', () => {
  const bad = /terminal|git|patch|mcp|token/i
  const views = []
  let s = createTask()
  views.push(toTaskView(s))
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/范本.docx'] }).state
  views.push(toTaskView(s, { root: 'C:/Users/slow/桌伴', recent: ['C:/周材料'] }))
  s = reduceTask(s, { type: 'send', text: '汇成本周周报', runId: 'g1' }).state
  views.push(toTaskView(s))
  s = reduceTask(s, { type: 'error', taskId: 'g1', reason: 'key' }).state
  views.push(toTaskView(s))
  s = reduceTask(s, { type: 'retry', runId: 'g2' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'g2', text: '哪一份？' }).state
  s = reduceTask(s, { type: 'end', taskId: 'g2', status: 'done' }).state
  views.push(toTaskView(s))
  s = reduceTask(s, { type: 'send', text: '第一份', runId: 'g3' }).state
  s = reduceTask(s, { type: 'usage', taskId: 'g3', ...usage({ inputTokens: 1_000 }) }).state
  s = reduceTask(s, { type: 'output', taskId: 'g3', name: '本周周报.docx', to: 'C:/o/本周周报.docx', pages: 3 }).state
  assert.equal(toTaskView(s).bottom.cards[0].line, '本周周报.docx · 3 页')
  s = reduceTask(s, { type: 'end', taskId: 'g3', status: 'cancelled' }).state
  views.push(toTaskView(s))
  // 带 bottom.none 的钱那句和出卡的视图也扫
  let q = working('聊', 'g4')
  q = reduceTask(q, { type: 'usage', taskId: 'g4', ...usage({ inputTokens: 100_000 }) }).state
  q = reduceTask(q, { type: 'reply', taskId: 'g4', text: '好了。' }).state
  q = reduceTask(q, { type: 'end', taskId: 'g4', status: 'done' }).state
  views.push(toTaskView(q))
  for (const v of views) {
    assert.equal(bad.test(JSON.stringify(v)), false, JSON.stringify(v).slice(0, 120))
  }
})

test('17 一份都装不上的 drop：原样返回、不收下', () => {
  const fresh = createTask()
  const e = reduceTask(fresh, { type: 'drop', files: [] })
  assert.equal(e.state, fresh)
  assert.equal(e.settle, false)
  assert.equal(e.pet, null)
  const ready = reduceTask(fresh, { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  const r = reduceTask(ready, { type: 'drop', files: [] })
  assert.equal(r.state, ready)
  assert.equal(r.settle, false)
  assert.equal(r.pet, null)
  // done 有卡、done 没卡、error 里都一样
  let d = working('写', 'k1')
  d = reduceTask(d, { type: 'output', taskId: 'k1', name: '周.docx', to: 'C:/o/周.docx' }).state
  d = reduceTask(d, { type: 'end', taskId: 'k1', status: 'done' }).state
  const dres = reduceTask(d, { type: 'drop', files: [] })
  assert.equal(dres.state, d)
  assert.equal(dres.settle, false)
  assert.equal(dres.pet, null)
  let n = working('聊', 'k2')
  n = reduceTask(n, { type: 'reply', taskId: 'k2', text: '好。' }).state
  n = reduceTask(n, { type: 'end', taskId: 'k2', status: 'done' }).state
  const nres = reduceTask(n, { type: 'drop', files: [] })
  assert.equal(nres.state, n)
  assert.equal(nres.settle, false)
  assert.equal(nres.pet, null)
  let bad = working('写', 'k3')
  bad = reduceTask(bad, { type: 'error', taskId: 'k3', reason: 'network' }).state
  const bres = reduceTask(bad, { type: 'drop', files: [] })
  assert.equal(bres.state, bad)
  assert.equal(bres.settle, false)
  assert.equal(bres.pet, null)
})

test('18 非 working 里后台事件照收、宠不动；working 里 pet work', () => {
  let d = working('写', 'v1')
  d = reduceTask(d, { type: 'reply', taskId: 'v1', text: '好了。' }).state
  d = reduceTask(d, { type: 'end', taskId: 'v1', status: 'done' }).state
  assert.equal(d.phase, 'done')
  const flowBefore = d.flow.length
  const s1 = reduceTask(d, { type: 'step', taskId: 'v1', step: 'prepare' })
  assert.equal(s1.state.phase, 'done')
  assert.equal(s1.state.flow.length, flowBefore)
  assert.equal(s1.pet, null)
  const s2 = reduceTask(s1.state, { type: 'progress', taskId: 'v1', text: 'write 本周.docx' })
  assert.equal(s2.state.flow.length, flowBefore)
  assert.equal(s2.state.flow.some((one) => one.kind === 'progress'), false)
  assert.equal(s2.pet, null)
  const s3 = reduceTask(s2.state, { type: 'reply', taskId: 'v1', text: '补一句。' })
  assert.equal(s3.state.flow.at(-1).kind, 'reply')
  assert.equal(s3.pet, null)
  const s4 = reduceTask(s3.state, { type: 'output', taskId: 'v1', name: '补.docx', to: 'C:/o/补.docx' })
  assert.equal(s4.state.cards.length, 1)
  assert.equal(s4.pet, null)
  walk(toTaskView(s4.state))
  const w = working('写', 'v2')
  assert.equal(reduceTask(w, { type: 'step', taskId: 'v2', step: 'prepare' }).pet, 'work')
  assert.equal(reduceTask(w, { type: 'progress', taskId: 'v2', text: 'write 本周.docx' }).pet, 'work')
  assert.equal(reduceTask(w, { type: 'reply', taskId: 'v2', text: '好了。' }).pet, 'work')
  assert.equal(reduceTask(w, { type: 'output', taskId: 'v2', name: 'a.docx', to: 'C:/o/a.docx' }).pet, 'work')
})

test('19 空文本、缺名字的后台事件原样返回', () => {
  const w = working('写', 'v3')
  for (const event of [
    { type: 'progress', taskId: 'v3', text: '' },
    { type: 'progress', taskId: 'v3', text: '  \n ' },
    { type: 'progress', taskId: 'v3', text: 1 },
    { type: 'reply', taskId: 'v3', text: '' },
    { type: 'reply', taskId: 'v3', text: '  \n ' },
    { type: 'reply', taskId: 'v3', text: 1 },
    { type: 'output', taskId: 'v3', to: 'C:/o/a.docx' },
    { type: 'output', taskId: 'v3', name: '', to: 'C:/o/a.docx' },
    { type: 'output', taskId: 'v3', name: 123, to: 'C:/o/a.docx' },
  ]) {
    assert.equal(reduceTask(w, event).state, w)
  }
})

test('20 没出文件时不另说一句，也不写钱', () => {
  let s = working('聊', 'b1')
  s = reduceTask(s, { type: 'reply', taskId: 'b1', text: '好。' }).state
  s = reduceTask(s, { type: 'usage', taskId: 'b1', ...usage() }).state
  s = reduceTask(s, { type: 'end', taskId: 'b1', status: 'done' }).state
  assert.deepEqual(toTaskView(s).bottom, { cards: [] })
  let t = working('聊', 'b2')
  t = reduceTask(t, { type: 'reply', taskId: 'b2', text: '好。' }).state
  t = reduceTask(t, { type: 'end', taskId: 'b2', status: 'done' }).state
  assert.deepEqual(toTaskView(t).bottom, { cards: [] })
})

test('21 error 里 send 标旧卡；done、asking 里 retry', () => {
  let e = working('写', 'y1')
  e = reduceTask(e, { type: 'output', taskId: 'y1', name: '一.docx', to: 'C:/o/一.docx' }).state
  e = reduceTask(e, { type: 'error', taskId: 'y1', reason: 'network' }).state
  const sent = reduceTask(e, { type: 'send', text: '再来', runId: 'y2' })
  assert.equal(sent.start.resume, false)
  assert.equal(sent.start.round, 2)
  const cards = toTaskView(sent.state).bottom.cards
  assert.equal(cards.length, 1)
  assert.equal(cards[0].old, true)
  let d = working('写周报', 'y3')
  d = reduceTask(d, { type: 'output', taskId: 'y3', name: '周.docx', to: 'C:/o/周.docx' }).state
  d = reduceTask(d, { type: 'end', taskId: 'y3', status: 'done' }).state
  const dr = reduceTask(d, { type: 'retry', runId: 'y4' })
  assert.equal(dr.start.resume, false)
  assert.equal(dr.start.round, 2)
  assert.equal(dr.start.prompt, '写周报')
  assert.equal(dr.state.flow.filter((one) => one.kind === 'user').length, 2)
  assert.equal(dr.state.flow.at(-1).text, '写周报')
  let a = working('问', 'y5')
  a = reduceTask(a, { type: 'reply', taskId: 'y5', text: '哪一份？' }).state
  a = reduceTask(a, { type: 'end', taskId: 'y5', status: 'done' }).state
  assert.equal(a.phase, 'asking')
  const ar = reduceTask(a, { type: 'retry', runId: 'y6' })
  assert.equal(ar.start.resume, false)
  assert.equal(ar.start.round, 2)
  assert.equal(ar.state.flow.filter((one) => one.kind === 'user').length, 2)
})

test('23 新任务不留「收好了」那一行；最近分两组的视图形状', () => {
  let s = working('写周报', 'h1')
  const out = 'C:/桌伴/任务/2026-11-05-写周报/周报.docx'
  s = reduceTask(s, { type: 'output', taskId: 'h1', name: '周报.docx', to: out }).state
  s = reduceTask(s, { type: 'end', taskId: 'h1', status: 'done' }).state
  const next = reduceTask(s, { type: 'new' }).state
  assert.deepEqual(next.flow, [])
  assert.equal('settledDir' in next, false)
  assert.deepEqual(toTaskView(next).flow, [])

  const task = { dir: 'C:/桌伴/任务/2026-11-05-写周报', out: 'C:/桌伴/任务/2026-11-05-写周报', name: '11-05 写周报', mtime: 1 }
  const v = toTaskView(createTask(), { recentTasks: [task], allTasks: 'C:/桌伴/任务' })
  assert.deepEqual(v.top.recent.items, [])
  assert.deepEqual(v.top.recent.tasks, [{ dir: task.out, name: '11-05 写周报' }])
  assert.equal(v.top.recent.allTasks, 'C:/桌伴/任务')
  // 干活中最近那两组照样列着：切去看别的，这条在后台接着跑
  const busy = toTaskView(working('忙', 'h3'), { recentTasks: [task] })
  assert.deepEqual(busy.top.recent.tasks, v.top.recent.tasks)
})

test('22 一轮出几张卡：卡上只有页数；脚本不算产出', () => {
  const u = usage({ inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 50_000, cacheWriteTokens: 10_000 })
  // 同一轮两张卡：卡上各写各的，一分钱不写
  let s = working('写', 'c1')
  s = reduceTask(s, { type: 'usage', taskId: 'c1', ...u }).state
  s = reduceTask(s, { type: 'output', taskId: 'c1', name: '周报.docx', to: 'C:/o/周报.docx', pages: 3 }).state
  s = reduceTask(s, { type: 'output', taskId: 'c1', name: '附表.xlsx', to: 'C:/o/附表.xlsx' }).state
  const one = toTaskView(s)
  assert.equal(one.bottom.cards.length, 2)
  assert.equal(one.bottom.cards[0].name, '附表.xlsx')
  assert.equal(one.bottom.cards[0].label, copy('output.made'))
  assert.equal(one.bottom.cards[0].line, '附表.xlsx')
  assert.equal(one.bottom.cards[1].line, '周报.docx · 3 页')
  assert.equal(one.bottom.cards[1].line.includes('这次约'), false)
  walk(one)
  // 两轮各一张卡：各写各的
  const u2 = usage({ searches: 1 })
  let d = working('写', 'c2')
  d = reduceTask(d, { type: 'usage', taskId: 'c2', ...u }).state
  d = reduceTask(d, { type: 'output', taskId: 'c2', name: '一.docx', to: 'C:/o/一.docx' }).state
  d = reduceTask(d, { type: 'end', taskId: 'c2', status: 'done' }).state
  d = reduceTask(d, { type: 'send', text: '再写', runId: 'c3' }).state
  d = reduceTask(d, { type: 'usage', taskId: 'c3', ...u2 }).state
  d = reduceTask(d, { type: 'output', taskId: 'c3', name: '二.docx', to: 'C:/o/二.docx', pages: 5 }).state
  const two = toTaskView(d)
  assert.equal(two.bottom.cards.length, 2)
  assert.equal(two.bottom.cards[0].line, '二.docx · 5 页')
  assert.equal(two.bottom.cards[1].line, '一.docx')
  // 过程那行没了：进度只管把小岛留在干活中，对话流里不添东西
  const script = reduceTask(working('写', 'c4'), { type: 'progress', taskId: 'c4', text: 'write build_report.py' })
  assert.equal(script.pet, 'work')
  assert.equal(script.state.flow.some((one) => one.kind === 'progress'), false)
  assert.equal(toTaskView(script.state).blocks.some((one) => one.kind === 'progress'), false)
  const doc = reduceTask(working('写', 'c5'), { type: 'progress', taskId: 'c5', text: 'write 周报.docx' })
  assert.equal(doc.pet, 'work')
  assert.equal(doc.state.flow.some((one) => one.kind === 'progress'), false)
  assert.equal(toTaskView(doc.state).blocks.some((one) => one.kind === 'progress'), false)
  // 只出了脚本、没出文档：照旧走「没出文件」那一套
  let n = working('写', 'c6')
  n = reduceTask(n, { type: 'usage', taskId: 'c6', ...u }).state
  n = reduceTask(n, { type: 'end', taskId: 'c6', status: 'done' }).state
  const nv = toTaskView(n)
  assert.deepEqual(nv.bottom, { cards: [] })
})

test('24 过程那行没了：拷贝那一步不上屏', () => {
  const copyText = /份文件拷一份/
  // 没范本没材料：copy 这一步什么都不加
  let s = working('说句话', 'n1')
  const before = s.flow.length
  s = reduceTask(s, { type: 'step', taskId: 'n1', step: 'copy' }).state
  assert.equal(s.flow.length, before)
  assert.equal(s.flow.some((one) => copyText.test(one.text)), false)
  // 显式给 0 也算 0：一样不加
  let z = working('说句话', 'n2')
  const before2 = z.flow.length
  z = reduceTask(z, { type: 'step', taskId: 'n2', step: 'copy', count: 0 }).state
  assert.equal(z.flow.length, before2)
  assert.equal(z.flow.some((one) => copyText.test(one.text)), false)
  // 1 份范本 + 2 份材料：也不加
  let f = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/范本.docx'] }).state
  f = reduceTask(f, { type: 'drop', files: ['C:/材料/一.pdf', 'C:/材料/二.pdf'] }).state
  f = reduceTask(f, { type: 'send', text: '汇成周报', runId: 'n3' }).state
  const before3 = f.flow.length
  f = reduceTask(f, { type: 'step', taskId: 'n3', step: 'copy' }).state
  assert.equal(f.flow.length, before3)
  assert.equal(f.flow.some((one) => copyText.test(one.text)), false)
  // 显式给数时也不加
  let g = working('说句话', 'n4')
  const before4 = g.flow.length
  g = reduceTask(g, { type: 'step', taskId: 'n4', step: 'copy', count: 2 }).state
  assert.equal(g.flow.length, before4)
  assert.equal(g.flow.some((one) => copyText.test(one.text)), false)
  // 页面上一个过程块也没有
  assert.equal(toTaskView(g).blocks.some((one) => one.kind === 'progress'), false)
})

test('25 小岛的五种：做完了是笑眼（done），没干成是平线（fail），要你看一眼是 look', () => {
  // 不在前台：做完了 → done（小岛笑眼），不是 look、不是 fail
  let s = working('写', 'p1')
  s = reduceTask(s, { type: 'output', taskId: 'p1', name: '周报.docx', to: 'C:/o/周报.docx' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'p1', text: '写好了。' }).state
  const done = reduceTask(s, { type: 'end', taskId: 'p1', status: 'done' })
  assert.equal(done.pet, 'done')
  // 任务窗这头不再有「做完了」那一句：小岛自己说「做完了！」
  assert.equal(done.petText, '')
  assert.equal(done.notify, '')
  // 没干成 → fail（小岛平线）
  const fail = reduceTask(working('写', 'p2'), { type: 'error', taskId: 'p2', reason: 'quota' })
  assert.equal(fail.pet, 'fail')
  assert.equal(fail.petText, copy('stops.fail'))
  // 它问你一句 → look（小岛睁大 + 红点）
  let q = working('写', 'p3')
  q = reduceTask(q, { type: 'reply', taskId: 'p3', text: '要不要再短一点？' }).state
  const ask = reduceTask(q, { type: 'end', taskId: 'p3', status: 'done' })
  assert.equal(ask.pet, 'look')
  assert.equal(ask.petText, '要不要再短一点？')
  assert.equal(ask.notify, copy('flow.askTail'))
  // 任务窗开着、在前台：小岛就待命，用户已经看着了
  const fore = reduceTask(reduceTask(createTask(), { type: 'window', foreground: true }).state, { type: 'send', text: '写', runId: 'p4' })
  const foreDone = reduceTask(fore.state, { type: 'end', taskId: 'p4', status: 'done' })
  assert.equal(foreDone.pet, 'idle')
  // 干活中：过程那一行没了，小岛只看「正在工作 · x 秒」
  // 进度只把小岛留在干活中，对话流里不添东西
  const progress = reduceTask(working('写', 'p5'), { type: 'progress', taskId: 'p5', text: 'read 周报.docx' })
  assert.equal(progress.pet, 'work')
  assert.equal(progress.petText, '')
  assert.equal(toTaskView(progress.state).blocks.some((one) => one.kind === 'progress'), false)
  const withFile = reduceTask(
    reduceTask(createTask(), { type: 'drop', files: ['C:/材料/一.pdf'] }).state,
    { type: 'send', text: '写', runId: 'p6' },
  )
  const read = reduceTask(withFile.state, { type: 'progress', taskId: 'p6', text: 'read 一.pdf' })
  assert.equal(read.pet, 'work')
  assert.equal(read.petText, '')
  assert.equal(read.state.flow.some((one) => one.kind === 'progress'), false)
})

test('26 过程那一行没了；模型说的每一段一个气泡', () => {
  let s = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/范本.docx'] }).state
  s = reduceTask(s, { type: 'send', text: '汇成本周周报', runId: 'm1' }).state
  // 过程、进度都不上屏：一个过程块也没有
  s = reduceTask(s, { type: 'step', taskId: 'm1', step: 'copy' }).state
  s = reduceTask(s, { type: 'progress', taskId: 'm1', text: 'read 一.pdf' }).state
  s = reduceTask(s, { type: 'progress', taskId: 'm1', text: 'write 周报.docx' }).state
  assert.equal(toTaskView(s).blocks.some((one) => one.kind === 'progress'), false)
  assert.equal(s.flow.some((one) => one.kind === 'progress'), false)

  // 干活中：最下面一行浅字，只说在干什么（换得太快不闪，还是先来的那一步）
  let blocks = toTaskView(s).blocks
  assert.deepEqual(blocks.map((one) => one.kind), ['user', 'working'])
  assert.equal(blocks.at(-1).text, copy('St201'))

  // 一轮里模型说了两段（中间夹着工具调用）：两个气泡，按顺序排
  s = reduceTask(s, { type: 'reply', taskId: 'm1', text: '没有什么工具，我先把材料看一遍。' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'm1', text: '看完了，开始写周报。' }).state
  blocks = toTaskView(s).blocks
  const replies = blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies.length, 2)
  assert.equal(replies[0].text, '没有什么工具，我先把材料看一遍。')
  assert.equal(replies[1].text, '看完了，开始写周报。')
  assert.deepEqual(blocks.map((one) => one.kind), ['user', 'reply', 'reply', 'working'])

  // 同一段被流式补全（那段话变长了）：还是同一个气泡，不重复
  s = reduceTask(s, { type: 'reply', taskId: 'm1', text: '看完了，开始写周报。这周有三条风险。' }).state
  blocks = toTaskView(s).blocks
  assert.equal(blocks.filter((one) => one.kind === 'reply').length, 2)
  assert.equal(blocks.filter((one) => one.kind === 'reply').at(-1).text, '看完了，开始写周报。这周有三条风险。')

  // 做完：过程行和「正在工作」都没了，回答和产出卡还在
  s = reduceTask(s, { type: 'output', taskId: 'm1', name: '本周周报.docx', to: 'C:/o/本周周报.docx', pages: 3 }).state
  s = reduceTask(s, { type: 'reply', taskId: 'm1', text: '周报写好了。' }).state
  s = reduceTask(s, { type: 'end', taskId: 'm1', status: 'done' }).state
  blocks = toTaskView(s).blocks
  assert.equal(blocks.some((one) => one.kind === 'working'), false)
  assert.equal(blocks.some((one) => one.kind === 'progress'), false)
  assert.deepEqual(blocks.map((one) => one.kind), ['user', 'reply', 'reply', 'reply', 'card'])
  walk(toTaskView(s))

  // 下一轮：最下面又是那一行状态
  const again = reduceTask(s, { type: 'send', text: '再补一段', runId: 'm2' })
  const two = toTaskView(again.state).blocks
  assert.equal(two.at(-1).kind, 'working')
})

test('27 等你一句话：红字挂在这一轮最后一段上', () => {
  let s = working('写', 'a1')
  s = reduceTask(s, { type: 'reply', taskId: 'a1', text: '我先看看材料。' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'a1', text: '用哪一份？' }).state
  const asked = reduceTask(s, { type: 'end', taskId: 'a1', status: 'done' })
  assert.equal(asked.state.phase, 'asking')
  const replies = toTaskView(asked.state).blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies.length, 2)
  assert.equal(replies[0].ask, false)
  assert.equal(replies[1].ask, true)
  assert.equal(toTaskView(asked.state).flow.at(-1).tail, copy('flow.askTail'))
})

test('产出卡只写几页，不写别的', () => {
  let s = working('写', 'c1')
  s = reduceTask(s, { type: 'output', taskId: 'c1', name: '本周周报.docx', to: 'C:/o/本周周报.docx', pages: 3 }).state
  const card = toTaskView(s).bottom.cards[0]
  assert.equal(card.label, copy('output.made'))
  assert.equal(card.line, '本周周报.docx · 3 页')
  assert.equal(/核实|出处/.test(JSON.stringify(card)), false, JSON.stringify(card))
})

test('壳补的一句（工具没调通）：单独一行，不是它说的话', () => {
  const s = working()
  const step = reduceTask(s, { type: 'note', text: '「库存服务」（MCP）这会儿连不上，这一轮没用上它', taskId: 'w1' })
  const view = toTaskView(step.state)
  const one = view.flow.find((item) => item.kind === 'note')
  assert.equal(one.text, '「库存服务」（MCP）这会儿连不上，这一轮没用上它')
  assert.equal(view.flow.some((item) => item.kind === 'reply'), false, '这一句不是它说的话')
  // 空文本和别轮的都不收
  const empty = reduceTask(s, { type: 'note', text: '  ', taskId: 'w1' })
  assert.equal(empty.state, s)
  const foreignOne = reduceTask(s, { type: 'note', text: '别的轮', taskId: 'w2' })
  assert.equal(foreignOne.state, s)
})

test('壳补的一句只走一个 note：看图那条带「去设置」，能力那条不带，文字都去掉首尾空白', () => {
  const s = working()
  const caps = { action: 'settings-caps', label: '去设置' }
  const first = reduceTask(s, { type: 'note', text: ' 这几张图这一轮看不了：a.png。 ', buttons: [caps, { bad: true }], taskId: 'w1' })
  const second = reduceTask(first.state, { type: 'note', text: '「库存服务」（MCP）这会儿连不上', taskId: 'w1' })
  const notes = second.state.flow.filter((item) => item.kind === 'note')
  assert.equal(notes.length, 2)
  assert.equal(notes[0].text, '这几张图这一轮看不了：a.png。')
  assert.deepEqual(notes[0].buttons, [caps])
  assert.deepEqual(notes[1].buttons, [])
})
