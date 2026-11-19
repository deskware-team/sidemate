// 停下以后接着说、点「继续」：
// - 点「停止」后直接打一句：接着同一个会话（模型记得前面聊过什么）；上一轮还没起 dsh 就停了的，照新开的走
// - 点「继续」：发给模型的是「接着干」那句，气泡上、对话记录里写「继续」，用量的任务名还是用户原来那句

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { bindUsageStore } from '../../app/usage/index.mjs'
import { t } from '../../app/copy/copy.mjs'

const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  bindUsageStore(null)
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

async function until(predicate, what = 'condition not reached') {
  for (let i = 0; i < 300 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), what)
}

// 假壳：dsh 的每一轮由测试自己收尾；over.gate 卡住建任务文件夹那一步（还在「准备文件中」）
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-stop-'))
  roots.push(root)
  const ws = join(root, 'ws')
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const usage = join(root, 'userData')
  bindUsageStore(usage)
  const seen = { runs: [], handles: [], feed: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    extensions: ['.md'],
    log: () => {},
    onPet: () => {},
    onRecent: () => {},
    history,
    prepareTask: async (input) => {
      if (over.gate) await over.gate
      mkdirSync(ws, { recursive: true })
      return { kind: 'files', workspace: ws, copied: input.paths.map((from) => ({ from, to: from })), skipped: [], snapshot: [] }
    },
    snapshotWorkspace: () => [],
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: input.name, name: input.name, locked: false }),
    clearWorkspace: () => {},
    runTask: (options) => {
      seen.runs.push(options)
      let finish = null
      const handle = {
        sessionId: 's1',
        cancel() { finish({ type: 'end', taskId: options.taskId, at: 9, status: 'cancelled' }) },
        say: (event) => options.onEvent({ taskId: options.taskId, at: 1, ...event }),
        finish: (status = 'done') => finish({ type: 'end', taskId: options.taskId, at: 9, status }),
        done: new Promise((resolve) => { finish = resolve }),
      }
      seen.handles.push(handle)
      return handle
    },
  })
  const phase = () => runner.view().phase
  return { runner, seen, history, root, usage, phase }
}

test('点「停止」后直接打一句：接着同一个会话，模型记得前面聊过什么', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写一份周报' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'stop' })
  await until(() => h.phase() === 'stopped')
  h.runner.act({ type: 'send', text: '换个方向，只写前两段' })
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].sessionId, 's1', '开了新会话')
  assert.equal(h.seen.runs[1].prompt, '换个方向，只写前两段')
  h.seen.handles[1].finish()
  await until(() => h.phase() === 'done')
})

test('还在准备文件就点了「停止」，再打一句：模型那边什么都没见过，照新开的走（文件照常备好）', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ gate })
  const file = join(h.root, '材料.md')
  writeFileSync(file, '材料')
  h.runner.drop([file])
  h.runner.act({ type: 'send', text: '整理这份材料' })
  await until(() => h.phase() === 'working')
  h.runner.act({ type: 'stop' })
  await until(() => h.phase() === 'stopped')
  release()
  await delay(20)
  assert.equal(h.seen.runs.length, 0, '停了就不起 dsh')
  h.runner.act({ type: 'send', text: '只要第一节' })
  await until(() => h.seen.runs.length === 1)
  assert.equal(h.seen.runs[0].sessionId, undefined)
  // 文件照常备好：话里只有用户那一句，文件当资源链接给模型
  assert.equal(h.seen.runs[0].prompt, '只要第一节')
  assert.deepEqual((h.seen.runs[0].files || []).map((one) => one.name), ['材料.md'])
  h.seen.handles[0].finish()
  await until(() => h.phase() === 'done')
})

test('点「继续」：气泡和对话记录写「继续」，发给模型的是「接着干」那句，用量的任务名是用户原来那句', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写一份本周销售周报' })
  await until(() => h.seen.runs.length === 1)
  // 模型一直忙：停在「继续」
  h.seen.handles[0].say({ type: 'error', reason: 'busy', raw: '429' })
  h.seen.handles[0].finish('error')
  await until(() => h.phase() === 'paused')
  h.runner.act({ type: 'continue' })
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].prompt, t('continue'))
  assert.equal(h.seen.runs[1].sessionId, 's1')
  // 气泡上是按钮上那两个字
  const mine = h.runner.view().blocks.filter((one) => one.kind === 'user').map((one) => one.text)
  assert.deepEqual(mine, ['写一份本周销售周报', t('input.continueLabel')])
  // 用量：这一轮的任务名是用户原来那句
  h.seen.handles[1].say({ type: 'usage', inputTokens: 10, outputTokens: 5 })
  h.seen.handles[1].finish()
  await until(() => h.phase() === 'done')
  const rows = JSON.parse(readFileSync(join(h.usage, 'usage.json'), 'utf8')).records
  assert.deepEqual(rows.map((one) => one.name), ['写一份本周销售周报'])
  // 对话记录：重新打开看到的也是「继续」
  const record = h.history.get(h.history.list({})[0].id)
  assert.deepEqual(record.messages.filter((one) => one.role === 'me').map((one) => one.text), ['写一份本周销售周报', t('input.continueLabel')])
  // 点「重来」还发用户原来那句
  h.runner.act({ type: 'retry' })
  await until(() => h.seen.runs.length === 3)
  assert.equal(h.seen.runs[2].prompt, '写一份本周销售周报')
  h.seen.handles[2].finish()
  await until(() => h.phase() === 'done')
})

test('程序意外停了（已中断）：点「继续」在同一个会话上接着做', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写一份周报' })
  await until(() => h.seen.runs.length === 1)
  // dsh 崩了：这一轮标成已中断，不报错
  h.seen.handles[0].finish('interrupted')
  await until(() => h.phase() === 'stopped')
  h.runner.act({ type: 'continue' })
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].sessionId, 's1', '接着同一个会话')
  assert.equal(h.seen.runs[1].prompt, t('continue'))
  h.seen.handles[1].finish()
  await until(() => h.phase() === 'done')
})
