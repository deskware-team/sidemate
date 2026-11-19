// 后台接着跑：干活中切去看别的对话、点「＋ 新任务」，正在跑的那条在后台接着跑。
// 不排队：每条对话自己一个 dsh（这里是假的 runTask）、自己一个任务文件夹，同时跑。
// 「停下」只停看着的那条；进度、产出、报错都记在它自己那条上，切回来照样看得到。
// 每句话都开新任务：什么都没拖也建任务文件夹；任务名先用第一句话前 16 个字，dsh 起好名字再换上。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { clearWorkspace, copyMaterials, prepareTask } from '../../app/workspace/index.mjs'
import { t } from '../../app/copy/copy.mjs'

const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

async function until(predicate, what = 'condition not reached') {
  for (let i = 0; i < 400 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), what)
}

// 假壳：工作区用真的 prepareTask / copyMaterials / clearWorkspace（建在临时的桌伴根下），
// dsh 是假的，每一轮由测试自己收尾。over 里给的换掉同名的那一项
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-bg-'))
  roots.push(root)
  const desk = join(root, '桌伴')
  const history = createHistory({ tasksDir: join(desk, 'tasks'), newsDir: join(desk, 'news') })
  const seen = { runs: [], handles: [], pet: [], views: [], clear: [] }
  const runner = createRunner({
    root: () => desk,
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v' }),
    extensions: ['.docx', '.md', '.txt', '.xlsx'],
    copyMaterials,
    log: () => {},
    onPet: (event) => seen.pet.push(event),
    onView: (view) => seen.views.push(view),
    onRecent: () => {},
    history,
    prepareTask: (input) => prepareTask({ ...input, root: desk }),
    snapshotWorkspace: () => [],
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: input.name, name: input.name, locked: false }),
    clearWorkspace: (dir) => { seen.clear.push(dir); clearWorkspace(dir, desk) },
    runTask: (options) => {
      let finish = null
      const handle = {
        options,
        sessionId: `s-${seen.runs.length + 1}`,
        cancelled: false,
        cancel() {
          if (this.cancelled) return
          this.cancelled = true
          finish({ type: 'end', taskId: options.taskId, at: 9, status: 'cancelled' })
        },
        steer: () => Promise.resolve({ ok: true, mode: 'steer' }),
        done: new Promise((resolve) => { finish = resolve }),
        // 这一轮在 dsh 那头报的事件
        say: (event) => options.onEvent({ taskId: options.taskId, at: 1, ...event }),
        finish: (status = 'done') => finish({ type: 'end', taskId: options.taskId, at: 9, status }),
      }
      seen.runs.push(options)
      seen.handles.push(handle)
      return handle
    },
    ...over,
  })
  // 用户自己的文件：放在桌伴根外面
  const write = (name, text = 'x') => {
    const file = join(root, '用户', name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
    return file
  }
  return { runner, history, seen, desk, write }
}

const phase = (h) => h.runner.view().phase
const said = (view) => view.flow.map((one) => [one.kind, one.text])

test('切走切回：干活中点「＋ 新任务」，那条在后台接着跑，回来看得到它的进度和回话', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写一份本周销售周报' })
  await until(() => h.seen.handles.length === 1)
  const first = h.seen.handles[0]
  const firstId = h.runner.view().top.historyId
  assert.ok(firstId, '第一条对话记上了')

  // 干活中点「＋ 新任务」：不再说「任务执行中」，直接开一条空的
  h.runner.feed({ type: 'new' })
  assert.equal(phase(h), 'empty')
  assert.deepEqual(h.runner.view().flow, [])
  assert.equal(first.cancelled, false, '后台那条没被停')
  assert.equal(h.runner.busy(), true)

  // 后台那条报的回话、等待行不进眼前这条
  first.say({ type: 'reply', text: '先看了三份材料' })
  first.say({ type: 'retry', retry: 2, maxRetries: 10, delayMs: 5_000, kind: 'busy' })
  assert.deepEqual(h.runner.view().flow, [])
  assert.equal(h.runner.view().blocks.some((one) => one.kind === 'wait'), false)

  // 切回去：还在干活，等待行、回话都在
  assert.deepEqual(h.runner.openHistory(firstId), { ok: true })
  let view = h.runner.view()
  assert.equal(view.phase, 'working')
  assert.equal(view.top.historyId, firstId)
  assert.ok(view.blocks.some((one) => one.kind === 'wait'), '等待行还在')
  assert.ok(said(view).some(([kind, text]) => kind === 'reply' && text === '先看了三份材料'))
  // 那条空的没开工，切走就不留了
  first.say({ type: 'reply', text: '写好了' })
  first.finish()
  await until(() => phase(h) === 'done')
  view = h.runner.view()
  assert.equal(said(view).at(-1)[1], '写好了')
  assert.equal(h.runner.busy(), false)
})

test('两个任务同时跑：各起一个 dsh、各用各的任务文件夹，谁先做完都不挡谁；小岛说「执行中 · 2 个任务」', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  h.runner.feed({ type: 'new' })
  h.runner.act({ type: 'send', text: '写会议纪要' })
  await until(() => h.seen.handles.length === 2, '第二个任务被排队了')
  const [a, b] = h.seen.handles
  // 两个都在跑：不排队
  assert.equal(a.cancelled, false)
  assert.equal(b.cancelled, false)
  assert.notEqual(a.options.workspace, b.options.workspace, '两个任务各一个文件夹')
  assert.deepEqual(readdirSync(join(h.desk, 'tasks')).sort(), [
    `${a.options.workspace.split(/[\\/]/).pop()}`,
    `${b.options.workspace.split(/[\\/]/).pop()}`,
  ].sort())
  assert.equal(a.options.sessionId, undefined)
  assert.equal(b.options.sessionId, undefined)
  // 小岛那头：两个在跑
  assert.deepEqual(h.seen.pet.filter((one) => one.type === 'running').map((one) => one.count), [1, 2])
  // 后跑的先做完：前一个照跑，眼前这条做完了
  b.say({ type: 'reply', text: '纪要好了' })
  b.finish()
  await until(() => phase(h) === 'done')
  assert.equal(h.runner.busy(), true, '前一个还在后台跑')
  assert.deepEqual(h.seen.pet.filter((one) => one.type === 'running').at(-1), { type: 'running', count: 1 })
  a.finish()
  await until(() => !h.runner.busy())
  assert.deepEqual(h.seen.pet.filter((one) => one.type === 'running').at(-1), { type: 'running', count: 0 })
})

test('「停下」只停看着的那条：后台那条照跑', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  h.runner.feed({ type: 'new' })
  h.runner.act({ type: 'send', text: '写纪要' })
  await until(() => h.seen.handles.length === 2)
  const [a, b] = h.seen.handles
  h.runner.act({ type: 'stop' })
  await until(() => phase(h) === 'stopped')
  assert.equal(b.cancelled, true, '看着的那条停了')
  assert.equal(a.cancelled, false, '后台那条照跑')
  assert.equal(h.runner.busy(), true)
  // 关桌伴：每条都收手
  h.runner.quit()
  assert.equal(a.cancelled, true)
})

test('报错记在它自己那条上：后台那条出错，眼前这条不挂横幅；切回去才看到；小岛照「没干成」说', async () => {
  const h = harness()
  h.runner.feed({ type: 'window', foreground: true })
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const aId = h.runner.view().top.historyId
  h.runner.feed({ type: 'new' })
  h.runner.act({ type: 'send', text: '写纪要' })
  await until(() => h.seen.handles.length === 2)
  // 后台那条出错：任务窗开在前台，可看着的不是它，照样告诉小岛
  a.say({ type: 'error', reason: 'busy', raw: '429 Too Many Requests' })
  a.finish('error')
  await until(() => h.seen.pet.some((one) => one.type === 'ask' && one.taskId === a.options.taskId))
  assert.equal(h.runner.view().banner, null, '眼前这条不挂别人的横幅')
  assert.equal(phase(h), 'working')
  // 切回去：横幅、码、原文都在
  h.runner.openHistory(aId)
  const view = h.runner.view()
  assert.equal(view.phase, 'paused')
  assert.equal(view.banner.code, 'Si429')
  assert.equal(view.banner.text, t('stops.busy'))
  assert.equal(view.banner.raw, '429 Too Many Requests')
  // 看着的那条在后台接着跑
  assert.equal(h.seen.handles[1].cancelled, false)
  h.seen.handles[1].finish()
  await until(() => !h.runner.busy())
})

test('每句话都开新任务：什么都没拖也在 任务/ 下建自己的文件夹，没有「随手」', async () => {
  const h = harness()
  // 还没开工：胶囊写「任务列表」，点小图标打开 ~/桌伴/任务
  assert.equal(h.runner.view().top.path.text, t('top.tasks'))
  assert.equal(h.runner.view().top.path.open, join(h.desk, 'tasks'))
  h.runner.act({ type: 'send', text: '你好' })
  await until(() => h.seen.handles.length === 1)
  // 同一句话再开一个：两个任务两个文件夹（名字里带时分秒；同一秒的带序号）
  h.runner.feed({ type: 'new' })
  h.runner.act({ type: 'send', text: '你好' })
  await until(() => h.seen.handles.length === 2)
  const [a, b] = h.seen.handles.map((one) => one.options.workspace)
  assert.equal(dirname(a), join(h.desk, 'tasks'))
  assert.equal(dirname(b), join(h.desk, 'tasks'))
  assert.notEqual(a, b)
  // 任务文件夹的名字是 14 位数字：年月日时分 + 两位随机数
  assert.match(basename(a), /^\d{14}$/)
  assert.match(basename(b), /^\d{14}$/)
  assert.deepEqual(readdirSync(h.desk).sort(), ['tasks'])
  // 顶栏胶囊：开工以后就是这个任务自己的文件夹
  assert.equal(h.runner.view().top.path.open, b)
  for (const one of h.seen.handles) one.finish()
  await until(() => !h.runner.busy())
})

test('任务名：先用第一句话的前 16 个字，dsh 起好名字再换上；后面几轮不再改', async () => {
  const h = harness()
  const ask = '照这三份材料写一份本周的销售周报，重点写华东区的回款'
  h.runner.act({ type: 'send', text: ask })
  await until(() => h.seen.handles.length === 1)
  const id = h.runner.view().top.historyId
  assert.equal(h.history.get(id).title, Array.from(ask).slice(0, 16).join(''))
  // 文件夹是 14 位数字，不带标题；标题在对话记录里
  assert.match(basename(h.seen.handles[0].options.workspace), /^\d{14}$/)
  h.seen.handles[0].say({ type: 'title', text: '华东区销售周报' })
  assert.equal(h.history.get(id).title, '华东区销售周报')
  h.seen.handles[0].finish()
  await until(() => phase(h) === 'done')
  // 接着说一句：名字不动
  h.runner.act({ type: 'send', text: '再补一段风险' })
  await until(() => h.seen.handles.length === 2)
  assert.equal(h.seen.handles[1].options.sessionId, 's-1')
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
  assert.equal(h.history.get(id).title, '华东区销售周报')
})

test('新闻对话接着问：dsh 起的名字不换掉「主题 日期」', async () => {
  const h = harness()
  const issue = join(h.desk, 'news', 'ai', '2026-11-15')
  mkdirSync(issue, { recursive: true })
  const id = h.history.start({ workspace: issue, prompt: 'AI 行业 11-15', title: 'AI 行业 11-15', folder: issue, folderName: 'AI 行业', kind: 'news' })
  h.history.setResume(id, { place: { kind: 'files', dir: '' }, workspace: issue, outputDir: join(h.desk, 'news', 'AI 行业'), copied: [] })
  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  h.runner.act({ type: 'send', text: '展开第二条' })
  await until(() => h.seen.handles.length === 1)
  h.seen.handles[0].say({ type: 'title', text: '大模型新闻追问' })
  h.seen.handles[0].finish()
  await until(() => phase(h) === 'done')
  assert.equal(h.history.get(id).title, 'AI 行业 11-15')
})

test('开历史对话不用先停：那条在后台跑完就收拾临时文件，回来看到的是做完的样子，还能接着聊', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const aWs = a.options.workspace
  const aId = h.runner.view().top.historyId
  // 这一轮在工作区里留下的：根目录里是成品，别的目录是过程文件
  writeFileSync(join(aWs, '周报.docx'), '产出')
  mkdirSync(join(aWs, 'notes'), { recursive: true })
  writeFileSync(join(aWs, 'notes', '草稿.md'), '过程')
  // 另开一条做完的历史对话来看（工作区还在）
  const ws = join(h.desk, 'tasks', '20261101000000')
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, '旧副本.md'), '旧')
  const old = h.history.start({ workspace: ws, prompt: '旧的那件事', folder: ws, folderName: '旧的' })
  h.history.setResume(old, { place: { kind: 'files', dir: ws }, workspace: ws, copied: [] })
  assert.deepEqual(h.runner.openHistory(old), { ok: true })
  assert.equal(h.runner.view().top.historyId, old)
  assert.deepEqual(h.seen.clear, [], '在跑的那条切走时不收拾')
  // 后台那条做完了：眼前这条不动，它的临时文件在这一刻收拾掉，产出留着
  a.say({ type: 'reply', text: '周报写好了' })
  a.finish()
  await until(() => h.seen.clear.length === 1)
  assert.equal(h.seen.clear[0], aWs)
  // 过程目录（对话记录）留着，根目录里的成品留着，别的清掉
  assert.deepEqual(readdirSync(aWs).sort(), ['.sidemate', '周报.docx'])
  assert.equal(h.runner.view().top.historyId, old)
  // 回去看：做完的样子，回话都在；离开那条旧的，照旧收拾它
  h.runner.openHistory(aId)
  await until(() => h.seen.clear.length === 2)
  assert.equal(h.seen.clear[1], ws)
  assert.deepEqual(readdirSync(ws).sort(), ['.sidemate', '旧副本.md'], '旧的那条清空了过程文件，根目录里的成品和对话记录留着（从历史打开还能接着聊）')
  assert.equal(phase(h), 'done')
  assert.ok(said(h.runner.view()).some(([, text]) => text === '周报写好了'))
  // 接着聊：还是那个会话、那个文件夹
  h.runner.act({ type: 'send', text: '再补一段' })
  await until(() => h.seen.handles.length === 2)
  assert.equal(h.seen.handles[1].options.sessionId, 's-1')
  assert.equal(h.seen.handles[1].options.workspace, aWs)
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
  // 在眼前做完的这一轮不收拾（接着说还要用）；收下时照旧清
  assert.equal(h.seen.clear.length, 2)
  h.runner.feed({ type: 'new' })
  await until(() => h.seen.clear.length === 3)
  assert.equal(h.seen.clear[2], aWs)
})

test('后台那条收拾时文件夹空了也留着：回来接着聊还是那个文件夹，同一个会话', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '你好' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const aId = h.runner.view().top.historyId
  h.runner.feed({ type: 'new' })
  a.finish()
  await until(() => h.seen.clear.length === 1)
  assert.equal(existsSync(a.options.workspace), true, '没有产出：空文件夹也留着')
  h.runner.openHistory(aId)
  h.runner.act({ type: 'send', text: '再说一句' })
  await until(() => h.seen.handles.length === 2)
  assert.equal(h.seen.handles[1].options.workspace, a.options.workspace)
  assert.equal(h.seen.handles[1].options.sessionId, 's-1')
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
})

test('纯聊天做完、点「＋ 新任务」，从历史点开再问一句：照常接着聊，不回「任务文件夹不存在」', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '解释一下什么是复利' })
  await until(() => h.seen.handles.length === 1)
  const id = h.runner.view().top.historyId
  h.seen.handles[0].say({ type: 'reply', text: '复利就是利滚利。' })
  h.seen.handles[0].finish()
  await until(() => phase(h) === 'done')
  // 收下：工作区清空，任务文件夹留着
  h.runner.feed({ type: 'new' })
  await until(() => h.seen.clear.length === 1)
  assert.equal(existsSync(h.seen.handles[0].options.workspace), true)
  // 从历史点开那条再问一句：dsh 起第二次，接着同一个会话，不回 St803
  assert.deepEqual(h.runner.openHistory(id), { ok: true })
  h.runner.act({ type: 'send', text: '那单利呢？' })
  await until(() => h.seen.handles.length === 2, 'dsh 没起第二次')
  assert.equal(h.seen.handles[1].options.sessionId, 's-1')
  assert.equal(h.seen.handles[1].options.workspace, h.seen.handles[0].options.workspace)
  assert.equal(said(h.runner.view()).some(([, text]) => text === t('St803')), false)
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
})

test('后台做完收拾过、回来接着问：原来给的文件重新拷进工作区，并告诉模型', async () => {
  const h = harness()
  const sheet = h.write('销售表.xlsx', '一月 二月')
  h.runner.drop([sheet])
  h.runner.act({ type: 'send', text: '哪个月卖得最好' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const ws = a.options.workspace
  assert.ok(readdirSync(join(ws, 'received')).includes('销售表.xlsx'), '第一轮开工时工作区里有这份')
  const id = h.runner.view().top.historyId
  // 跑的时候点「＋ 新任务」，它在后台做完：收拾掉副本
  h.runner.feed({ type: 'new' })
  a.say({ type: 'reply', text: '三月卖得最好' })
  a.finish()
  await until(() => h.seen.clear.length === 1)
  assert.equal(existsSync(join(ws, 'received', '销售表.xlsx')), false, '副本收拾掉了')
  // 从历史切回去，接着问：副本又拷回来了，发给模型的话里提了这份文件
  h.runner.openHistory(id)
  h.runner.act({ type: 'send', text: '那第二名呢？' })
  await until(() => h.seen.handles.length === 2)
  const second = h.seen.handles[1].options
  assert.equal(second.sessionId, 's-1')
  assert.ok(readdirSync(join(ws, 'received')).includes('销售表.xlsx'), '第二轮开工时工作区里又有这份了')
  assert.equal(second.prompt, '那第二名呢？')
  // 这份文件当资源链接给模型（不再把名字拼进话里）
  assert.ok((second.files || []).some((one) => String(one.name).includes('销售表.xlsx')), `模型不知道有这份文件：${JSON.stringify(second.files)}`)
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
})

test('后台停在「继续」（模型忙）的那条：先不收拾，回来点「继续」草稿都还在', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const ws = a.options.workspace
  writeFileSync(join(ws, 'draft.py'), 'print(1)')
  h.runner.feed({ type: 'new' })
  a.say({ type: 'error', reason: 'busy', raw: '429' })
  a.finish('error')
  await until(() => h.seen.pet.some((one) => one.type === 'ask' && one.taskId === a.options.taskId))
  await delay(30)
  assert.deepEqual(h.seen.clear, [], '停在「继续」的不收拾')
  assert.equal(existsSync(join(ws, 'draft.py')), true)
  // 回去点「继续」：接着同一个会话，草稿还在
  h.runner.openHistory(h.history.list({})[0].id)
  assert.equal(phase(h), 'paused')
  h.runner.act({ type: 'continue' })
  await until(() => h.seen.handles.length === 2)
  assert.equal(h.seen.handles[1].options.sessionId, 's-1')
  assert.equal(existsSync(join(ws, 'draft.py')), true)
  h.seen.handles[1].finish()
  await until(() => phase(h) === 'done')
})

test('后台做完、对话流里有装技能卡的那条：先不收拾，回来点「安装」还读得到方案', async () => {
  const plan = { id: 'pdf-tools', ok: true, plan: { name: 'PDF 工具' } }
  const h = harness({ readPlan: () => plan })
  h.runner.act({ type: 'send', text: '帮我装个处理 PDF 的技能' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  h.runner.feed({ type: 'new' })
  a.finish()
  await until(() => !h.runner.busy())
  await delay(30)
  assert.deepEqual(h.seen.clear, [], '有装技能卡的不收拾')
  // 回去：卡还在，离开它时再收拾
  h.runner.openHistory(h.history.list({})[0].id)
  assert.ok(h.runner.view().blocks.some((one) => one.kind === 'install'))
  h.runner.feed({ type: 'new' })
  await until(() => h.seen.clear.length === 1)
})

test('做完了喂小岛的那一声带着这一轮交出去的文件（小岛的「打开」开它）；这一轮没交文件就不带', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  const ws = h.seen.handles[0].options.workspace
  // 模型交稿了：成品就写在任务文件夹根目录里
  const product = join(ws, '周报.md')
  writeFileSync(product, '# 本周周报\n')
  h.seen.handles[0].say({ type: 'present', files: [{ path: product }] })
  h.seen.handles[0].finish()
  await until(() => phase(h) === 'done')
  const done = h.seen.pet.filter((one) => one.type === 'end' && one.status === 'done')
  assert.equal(done.length, 1)
  assert.equal(done[0].path, product)
  // 纯聊天：做完了不带文件
  const chat = harness()
  chat.runner.act({ type: 'send', text: '解释一下复利' })
  await until(() => chat.seen.handles.length === 1)
  chat.seen.handles[0].finish()
  await until(() => chat.runner.view().phase === 'done')
  assert.equal(chat.seen.pet.find((one) => one.type === 'end' && one.status === 'done').path, '')
})

test('小岛点开时带着那一轮的 taskId：任务窗切到后台做完的那条，不是眼前这条', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.handles.length === 1)
  const a = h.seen.handles[0]
  const aId = h.runner.view().top.historyId
  h.runner.feed({ type: 'new' })
  assert.equal(h.runner.view().top.historyId, '')
  a.say({ type: 'reply', text: '周报写好了' })
  a.finish()
  await until(() => h.seen.pet.some((one) => one.type === 'end' && one.status === 'done' && one.taskId === a.options.taskId))
  h.runner.opened({ taskId: a.options.taskId })
  assert.equal(h.runner.view().top.historyId, aId)
  assert.ok(said(h.runner.view()).some(([, text]) => text === '周报写好了'))
  // 认不出的 taskId：照旧开眼前这条
  h.runner.opened({ taskId: 'run-none' })
  assert.equal(h.runner.view().top.historyId, aId)
})