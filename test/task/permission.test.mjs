// 权限申请：状态里那张权限卡、视图里的话和三个按钮、用户点了回给 dsh、小岛说「等你确认」。
// dsh 那头真的会不会来问、用户点了之后写不写得过，是 test/dsh/permission.test.mjs 的事。

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunner } from '../../app/task/run.mjs'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { t } from '../../app/copy/copy.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
const feed = (state, event) => reduceTask(state, event).state

async function until(predicate) {
  for (let i = 0; i < 400 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

const OUTSIDE = 'D:\\成品\\周报.docx'

// 一轮假活：dsh 那边来问一回权限，等着用户点
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-perm-'))
  const workspace = join(root, 'task-ws')
  const seen = { answered: [], pets: [], logs: [] }
  let ask = null
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    extensions: ['.docx'],
    log: (event, data) => seen.logs.push([event, data]),
    onPet: (event) => seen.pets.push(event),
    prepareTask: () => ({ kind: 'files', workspace, copied: [], skipped: [], snapshot: [] }),
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: () => ({ to: '', name: '', locked: false }),
    clearWorkspace: () => {},
    snapshotWorkspace: () => [],
    runTask: (options) => {
      ask = (id, decision) => {
        seen.answered.push([id, decision])
        return Promise.resolve({ ok: true, decision })
      }
      options.onEvent({ type: 'permission', taskId: options.taskId, at: 1, id: 'perm-1', tool: 'write', target: OUTSIDE, outside: true })
      return {
        sessionId: 's1',
        cancel() {},
        answerPermission: ask,
        done: new Promise((resolve) => { setTimeout(() => resolve({ type: 'end', taskId: options.taskId, at: 3, status: 'done' }), 50) }),
      }
    },
  })
  return { runner, seen, ask: () => ask }
}

const permBlock = (state) => toTaskView(state).blocks.find((one) => one.kind === 'permission')
const permById = (state, id) => toTaskView(state).blocks.find((one) => one.kind === 'permission' && one.permission.id === id).permission

test('a dsh 来问权限：对话流里出一张卡，一句话说清是什么操作、哪个文件', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '做完放到 D:\\成品', runId: 'r1' })
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-1', tool: 'write', target: OUTSIDE, outside: true })
  const block = permBlock(s)
  assert.ok(block, '没有权限卡')
  assert.equal(block.permission.id, 'perm-1')
  assert.equal(block.permission.text, `要写入任务文件夹外的 ${OUTSIDE}`)
  // 三个按钮的字
  const labels = toTaskView(s).labels
  assert.equal(labels.permTitle, '要申请权限')
  assert.equal(labels.permOnce, '允许一次')
  assert.equal(labels.permAlways, '本任务都允许')
  assert.equal(labels.permReject, '拒绝')
})

test('b 任务文件夹里的文件不用问：卡上那句话不一样', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '写个稿子', runId: 'r1' })
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-1', tool: 'edit', target: 'C:\\任务\\稿子.md', outside: false })
  assert.equal(permBlock(s).permission.text, '要修改任务文件夹里的 C:\\任务\\稿子.md')
})

test('c 用户点了：卡收掉', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '写到外面', runId: 'r1' })
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-1', tool: 'write', target: OUTSIDE, outside: true })
  assert.ok(permBlock(s))
  s = feed(s, { type: 'permission-answered', taskId: 'r1', id: 'perm-1' })
  assert.equal(permBlock(s), undefined)
})

test('d 这一轮收场了：还没点的卡收掉', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '写到外面', runId: 'r1' })
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-1', tool: 'write', target: OUTSIDE, outside: true })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'cancelled' })
  assert.equal(permBlock(s), undefined)
})

test('e 任务窗上的三个钮：点了回给 dsh（允许一次 / 本任务都允许 / 拒绝）', async () => {
  for (const decision of ['once', 'always', 'reject']) {
    const { runner, seen } = harness()
    runner.act({ type: 'send', text: '做完放到 D:\\成品' })
    await until(() => runner.view().blocks.some((one) => one.kind === 'permission'))
    const block = runner.view().blocks.find((one) => one.kind === 'permission')
    assert.equal(block.permission.text, `要写入任务文件夹外的 ${OUTSIDE}`)
    runner.act({ type: 'permission', id: block.permission.id, decision })
    await until(() => seen.answered.length > 0)
    assert.deepEqual(seen.answered, [['perm-1', decision]])
    // 点了以后卡收掉
    await until(() => !runner.view().blocks.some((one) => one.kind === 'permission'))
  }
})

test('f 小岛：有任务在等确认时说「等你确认」', async () => {
  const { runner, seen } = harness()
  runner.act({ type: 'send', text: '做完放到 D:\\成品' })
  await until(() => seen.pets.some((one) => one.type === 'confirm'))
  const pet = seen.pets.find((one) => one.type === 'confirm')
  assert.equal(pet.message, t('perm.wait'))
  assert.equal(pet.message, '等你确认')
})

test('g 任务窗在前台：不吵小岛', async () => {
  const { runner, seen } = harness()
  runner.feed({ type: 'window', foreground: true })
  runner.act({ type: 'send', text: '做完放到 D:\\成品' })
  await until(() => runner.view().blocks.some((one) => one.kind === 'permission'))
  assert.equal(seen.pets.some((one) => one.type === 'confirm'), false)
})

test('h PowerShell 越权：卡上看得到要跑的命令和模型给的理由', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '整理一下系统目录', runId: 'r1' })
  s = feed(s, {
    type: 'permission',
    taskId: 'r1',
    id: 'perm-2',
    tool: 'powershell',
    target: 'Get-ChildItem C:\Windows\System32',
    outside: false,
    justification: '看看系统目录里有哪些文件',
  })
  const perm = permBlock(s).permission
  assert.equal(perm.text, '要执行命令：Get-ChildItem C:\Windows\System32')
  assert.equal(perm.reason, '模型给的理由：看看系统目录里有哪些文件')
  // 没有理由就不显示第二行
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-3', tool: 'powershell', target: 'whoami' })
  assert.equal(permById(s, 'perm-3').reason, '')
})

test('i 改文件的工具：apply_patch 归到「要修改」，说清在任务文件夹里还是外头', () => {
  let s = createTask()
  s = feed(s, { type: 'send', text: '改一下稿子', runId: 'r1' })
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-4', tool: 'apply_patch', target: '稿子.md', outside: false })
  assert.equal(permById(s, 'perm-4').text, '要修改任务文件夹里的 稿子.md')
  s = feed(s, { type: 'permission', taskId: 'r1', id: 'perm-5', tool: 'str_replace_editor', target: OUTSIDE, outside: true })
  assert.equal(permById(s, 'perm-5').text, `要修改任务文件夹外的 ${OUTSIDE}`)
})
