// 一句话装能力：状态里的确认卡、视图里的卡和按钮灰不灰，run.mjs 收尾接卡、
// 装上 / 不装那两个动作。方案读的是 readPlan，下载装的是 installPlan，都用假的。

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createRunner } from '../../app/task/run.mjs'
import { PENDING_DIR_NAME, PLAN_DIR_NAME, PLAN_FILE_NAME } from '../../app/abilities/install.mjs'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { t } from '../../app/copy/copy.mjs'
import { errorText } from '../../app/task/codes.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const feed = (state, event) => reduceTask(state, event).state

async function until(predicate) {
  for (let i = 0; i < 400 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

// 一份像样的方案
const PLAN = (over = {}) => ({
  id: 'md2pdf-skill',
  name: 'Markdown 转 PDF',
  source: 'github.com/some-author/md2pdf-skill',
  ref: 'main',
  does: '把 Markdown 转成 PDF',
  ok: true,
  problems: [],
  ...over,
})

// 收尾时状态里那张卡该有的内容：从哪来由 run.mjs 拼好送进来
function offered(plan) {
  return { ...plan }
}

// 跑一轮就完的流水线：只聊天不起 dsh 那套，方案相关的全用假的
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-install-'))
  const workspace = join(root, 'task-ws')
  const seen = { find: [], install: [], drop: [], deliver: [], log: [] }
  let plan = null
  let pending = null
  const artifacts = []
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    extensions: ['.docx', '.md', '.txt'],
    log: (event, data) => seen.log.push([event, data]),
    prepareTask: (input) => ({
      kind: 'files', workspace,
      copied: [], skipped: [], snapshot: [],
    }),
    finishTask: over.finishTask
      ? (prepared, extra) => over.finishTask(prepared, extra)
      : (_prepared, extra) => ({ snapshot: [], outputs: extra.outputs || [] }),
    deliverOutput: (input) => {
      seen.deliver.push(input.name)
      return { to: join(root, '产出', input.name), name: input.name, locked: false }
    },
    clearWorkspace: () => {},
    snapshotWorkspace: () => [],
    runTask: (options) => {
      options.onEvent({ type: 'reply', taskId: options.taskId, at: 1, text: '找到一个合适的。装之前先给你看一眼：' })
      // 这一轮动过的文件：测试自己给（成品、过程文件那些）
      for (const one of artifacts) {
        options.onEvent({ type: 'artifact', taskId: options.taskId, at: 2, path: one, name: basename(one) })
      }
      if (over.artifact) options.onEvent({ type: 'artifact', taskId: options.taskId, at: 2, path: join(workspace, over.artifact), name: over.artifact })
      return { sessionId: 's1', cancel() {}, done: Promise.resolve({ type: 'end', taskId: options.taskId, at: 3, status: 'done' }) }
    },
    readPlan: over.readPlan || ((ws) => { seen.find.push(ws); return plan }),
    installPlan: over.installPlan || ((input) => { seen.install.push(input); return Promise.resolve({ ok: true, id: input.id, message: '装好了：Markdown 转 PDF' }) }),
    dropPlan: over.dropPlan || ((ws, id) => { seen.drop.push([ws, id]); return { ok: true, message: '已放弃' } }),
    findPending: over.findPending || ((ws) => pending),
    dropPending: over.dropPending || ((ws, id) => { seen.drop.push([ws, id]); return { ok: true, message: '已删掉', problems: [] } }),
  })
  return { runner, root, workspace, seen, setPlan: (one) => { plan = one }, setPending: (one) => { pending = one }, setArtifacts: (list) => { artifacts.length = 0; artifacts.push(...list) } }
}

// 状态走到某一档
async function settled(runner, phase) {
  await until(() => runner.view().phase === phase)
}

const installBlock = (state) => toTaskView(state).blocks.find((one) => one.kind === 'install')

test('a 收尾找到方案：确认卡进对话流，只摆拿主意要看的：名字、从哪来、会做什么', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力', runId: 'r1' })
  s = feed(s, { type: 'reply', taskId: 'r1', text: '找到一个合适的。装之前先给你看一眼：' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  assert.equal(s.phase, 'done')
  const block = installBlock(s)
  assert.ok(block, '没有确认卡')
  assert.equal(block.install.id, 'md2pdf-skill')
  assert.equal(block.install.name, 'Markdown 转 PDF')
  assert.equal(block.install.source, 'github.com/some-author/md2pdf-skill')
  assert.equal(block.install.ref, 'main')
  assert.equal(block.install.does, '把 Markdown 转成 PDF')
  // 「下载内容」那一行去掉了
  assert.equal('summary' in block.install, false)
  assert.equal('installFetch' in toTaskView(s).labels, false)
  assert.equal(block.install.ok, true)
  assert.deepEqual(block.install.problems, [])
  assert.equal(block.install.canInstall, true)
  assert.equal(block.install.locked, false)
  assert.equal(block.round, 1)
  // 卡在模型那句话下面：最后一个块是它
  const blocks = toTaskView(s).blocks
  assert.equal(blocks[blocks.length - 1].kind, 'install')
})

test('b 方案不合格的不给「装上」；干活中两个按钮都灰', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个能力', runId: 'r1' })
  const bad = PLAN({ ok: false, problems: [t('skills.invalid')] })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(bad) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  const card = installBlock(s).install
  assert.equal(card.ok, false)
  assert.equal(card.canInstall, false)
  assert.deepEqual(card.problems, ['技能无效'])
  // 再说一句开了新一轮：卡还在，但按钮都灰着
  s = feed(s, { type: 'send', text: '再找一个', runId: 'r2' })
  const locked = installBlock(s).install
  assert.equal(locked.locked, true)
  assert.equal(locked.canInstall, false)
  // 干完又亮回来
  s = feed(s, { type: 'end', taskId: 'r2', status: 'done' })
  assert.equal(installBlock(s).install.locked, false)
})

test('c 正在下载：卡留着，按钮都灰着', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '装一个', runId: 'r1' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  s = feed(s, { type: 'install-busy', id: 'md2pdf-skill' })
  const card = installBlock(s).install
  assert.equal(card.busy, true)
  assert.equal(card.locked, true)
  assert.equal(card.canInstall, true)
})

test('d 同一个方案又找到一回：换一张卡，不叠两张', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '装一个', runId: 'r1' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN({ name: '新的名字' })) })
  const blocks = toTaskView(s).blocks.filter((one) => one.kind === 'install')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].install.name, '新的名字')
})

test('e 装上了：卡收掉，对话流里跟一句它说的气泡', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '装一个', runId: 'r1' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  s = feed(s, { type: 'install-done', id: 'md2pdf-skill' })
  const view = toTaskView(s)
  assert.equal(view.blocks.some((one) => one.kind === 'install'), false)
  const replies = view.blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies[replies.length - 1].text, t('install.done'))
  assert.equal(replies[replies.length - 1].round, 1)
})

test('f 没装上：卡留着，红字写明原因，还能再点', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '装一个', runId: 'r1' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  s = feed(s, { type: 'install-fail', id: 'md2pdf-skill', message: '连接失败 · Si906 错误，HTTP 503' })
  const card = installBlock(s).install
  assert.ok(card, '卡没留住')
  assert.equal(card.error, '连接失败 · Si906 错误，HTTP 503')
  assert.equal(card.busy, false)
  // 没带原因的那句也有话说
  s = feed(s, { type: 'install-fail', id: 'md2pdf-skill', message: '' })
  assert.equal(installBlock(s).install.error, errorText('Si906'))
})

test('g 不装了：卡收掉，跟一句「已取消安装」', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '装一个', runId: 'r1' })
  s = feed(s, { type: 'install', taskId: 'r1', install: offered(PLAN()) })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  s = feed(s, { type: 'install-drop', id: 'md2pdf-skill' })
  const view = toTaskView(s)
  assert.equal(view.blocks.some((one) => one.kind === 'install'), false)
  const replies = view.blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies[replies.length - 1].text, t('install.drop'))
})

test('g1 一轮收尾：「pending-skills/」里的文件不当产出交出去', async () => {
  const h = harness()
  mkdirSync(join(h.workspace, PENDING_DIR_NAME, 'mindmap-skill'), { recursive: true })
  writeFileSync(join(h.workspace, PENDING_DIR_NAME, 'mindmap-skill', 'SKILL.md'), '技能')
  writeFileSync(join(h.workspace, '周报.md'), '本周的周报')
  h.setArtifacts([
    join(h.workspace, PENDING_DIR_NAME, 'mindmap-skill', 'SKILL.md'),
    join(h.workspace, '周报.md'),
  ])
  h.setPending({ id: 'mindmap-skill', dir: join(h.workspace, PENDING_DIR_NAME, 'mindmap-skill') })
  h.runner.act({ type: 'send', text: '帮我装一个画思维导图的技能' })
  await settled(h.runner, 'done')
  // 只有周报出了卡，pending-skills 里的文件一份都不算产出
  const cards = h.runner.view().blocks.filter((one) => one.kind === 'card')
  assert.deepEqual(cards.map((one) => one.card.name), ['周报.md'])
})

test('h 模型自己下的东西：不装，收尾删掉，并说一句', async () => {
  const h = harness()
  h.setPending({ id: 'any2pdf', dir: join(h.workspace, PENDING_DIR_NAME, 'any2pdf') })
  h.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(h.runner, 'done')
  assert.deepEqual(h.seen.drop, [[h.workspace, 'any2pdf']])
  const blocks = h.runner.view().blocks
  assert.equal(blocks.some((one) => one.kind === 'install'), false)
  const replies = blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies[replies.length - 1].text, t('install.note'))
})

test('i 一轮收尾：工作区里有方案就出卡，方案文件不当产出交出去', async () => {
  const h = harness()
  mkdirSync(join(h.workspace, PLAN_DIR_NAME, 'md2pdf-skill'), { recursive: true })
  writeFileSync(join(h.workspace, PLAN_DIR_NAME, 'md2pdf-skill', PLAN_FILE_NAME), '{}')
  writeFileSync(join(h.workspace, '周报.md'), '本周的周报')
  h.setArtifacts([
    join(h.workspace, PLAN_DIR_NAME, 'md2pdf-skill', PLAN_FILE_NAME),
    join(h.workspace, '周报.md'),
  ])
  h.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  h.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(h.runner, 'done')
  assert.deepEqual(h.seen.find, [h.workspace])
  // 只有周报出了卡，方案文件不算产出
  const cards = h.runner.view().blocks.filter((one) => one.kind === 'card')
  assert.deepEqual(cards.map((one) => one.card.name), ['周报.md'])
  const card = h.runner.view().blocks.find((one) => one.kind === 'install')
  assert.ok(card, '没出确认卡')
  assert.equal(card.install.name, 'Markdown 转 PDF')
  // 来源分两截：仓库地址和版本，卡上隔开摆，不用「·」连
  assert.equal(card.install.source, 'github.com/some-author/md2pdf-skill')
  assert.equal(card.install.ref, 'main')
})

test('j 没有方案的：不出卡，照常收尾', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '讲个笑话' })
  await settled(h.runner, 'done')
  assert.equal(h.runner.view().blocks.some((one) => one.kind === 'install'), false)
})

test('k 装上：按方案下载，装进 ~/桌伴/技能，收卡跟一句；没装上红字留着卡', async () => {
  const h = harness()
  h.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  h.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(h.runner, 'done')
  h.runner.act({ type: 'install-skill', id: 'md2pdf-skill' })
  await until(() => !h.runner.view().blocks.some((one) => one.kind === 'install'))
  assert.equal(h.seen.install.length, 1)
  assert.equal(h.seen.install[0].id, 'md2pdf-skill')
  assert.equal(h.seen.install[0].userDir, join(h.root, '桌伴', 'skills'))
  // 方案用完就删
  assert.deepEqual(h.seen.drop, [[h.workspace, 'md2pdf-skill']])
  const replies = h.runner.view().blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies[replies.length - 1].text, t('install.done'))

  // 连不上：前一句只说「连接失败」，GitHub 回的状态接在后面，细节进日志
  const bad = harness({
    installPlan: () => Promise.resolve({ ok: false, id: 'md2pdf-skill', message: '连接失败', raw: 'HTTP 503', detail: 'http: HTTP 503 (SKILL.md)' }),
  })
  bad.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  bad.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(bad.runner, 'done')
  bad.runner.act({ type: 'install-skill', id: 'md2pdf-skill' })
  await until(() => bad.runner.view().blocks.some((one) => one.kind === 'install' && one.install.error))
  const card = bad.runner.view().blocks.find((one) => one.kind === 'install')
  assert.equal(card.install.error, '连接失败 · Si906 错误，HTTP 503')
  // 还能再点：按钮不灰
  assert.equal(card.install.locked, false)
  // 细节写进了日志
  const logged = bad.seen.log.find(([event]) => event === 'install')
  assert.equal(logged[1].detail, 'http: HTTP 503 (SKILL.md)')
  assert.equal(logged[1].raw, 'HTTP 503')
  // 不是连不上的（文件过大这类）：只说那一类，没有后半截
  const big = harness({
    installPlan: () => Promise.resolve({ ok: false, id: 'md2pdf-skill', message: '文件过大', raw: '', detail: 'big: scripts 300000 bytes > 204800' }),
  })
  big.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  big.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(big.runner, 'done')
  big.runner.act({ type: 'install-skill', id: 'md2pdf-skill' })
  await until(() => big.runner.view().blocks.some((one) => one.kind === 'install' && one.install.error))
  assert.equal(big.runner.view().blocks.find((one) => one.kind === 'install').install.error, '文件过大 · Si906 错误')
})

test('l 不装：删掉方案，收卡跟一句', async () => {
  const h = harness()
  h.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  h.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(h.runner, 'done')
  h.runner.act({ type: 'install-drop', id: 'md2pdf-skill' })
  await until(() => !h.runner.view().blocks.some((one) => one.kind === 'install'))
  assert.deepEqual(h.seen.drop, [[h.workspace, 'md2pdf-skill']])
  const replies = h.runner.view().blocks.filter((one) => one.kind === 'reply')
  assert.equal(replies[replies.length - 1].text, t('install.drop'))
})

test('k2 方案不在了：卡上写安装失败，带 Si906 码', async () => {
  const h = harness()
  h.setPlan({
    id: 'md2pdf-skill',
    ok: true,
    problems: [],
    plan: { id: 'md2pdf-skill', name: 'Markdown 转 PDF', owner: 'some-author', repo: 'md2pdf-skill', ref: 'main', does: '把 Markdown 转成 PDF' },
  })
  h.runner.act({ type: 'send', text: '帮我装一个 Markdown 转 PDF 的能力' })
  await settled(h.runner, 'done')
  h.setPlan(null) // 方案没了
  h.runner.act({ type: 'install-skill', id: 'md2pdf-skill' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'install' && one.install.error))
  const card = h.runner.view().blocks.find((one) => one.kind === 'install')
  assert.equal(card.install.error, '安装失败 · Si906 错误')
  assert.equal(h.seen.install.length, 0, '方案没了就不该去下载')
})
