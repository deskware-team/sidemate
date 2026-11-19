// 干活中途插一句：任务窗这一层。
// - 插进去的话立刻冒成「我说的」气泡，下面一行灰字（插进去了、排队都是同一句）
// - 插的话进对话历史，重新打开还看得到
// - 插不进去就排队：这一轮干完把那句发出去
// - 干活中输入框不锁

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { t } from '../../app/copy/copy.mjs'

const page = readFileSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '../../app/task/task.js'), 'utf8')
const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 假的壳：dsh 那边只给一个能插话的把手，插话走哪条路由 mode 说了算
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-steer-run-'))
  roots.push(root)
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const seen = { views: [], logs: [], runs: [] }
  let finish = null
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    log: (event, data) => seen.logs.push([event, data]),
    onView: (view) => seen.views.push(view),
    onPet: () => {},
    onRecent: () => {},
    history,
    prepareTask: () => ({
      kind: 'files', workspace: join(root, 'ws'),
      copied: [], skipped: [], snapshot: [],
    }),
    snapshotWorkspace: () => [],
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: input.name, name: input.name, locked: false }),
    clearWorkspace: () => {},
    runTask: (options) => {
      seen.runs.push(options)
      const handle = {
        sessionId: 's1',
        cancel() { this.cancelled = true },
        steer: (text) => over.steer ? over.steer(text, seen) : Promise.resolve({ ok: true, mode: 'steer' }),
        done: new Promise((resolve) => { finish = resolve }),
      }
      return handle
    },
  })
  // 这轮干完了（收尾那一段由 runner 自己走）
  const settle = async (status = 'done') => {
    for (let i = 0; i < 200 && !finish; i += 1) await delay(5)
    assert.ok(finish, '这一轮没起来')
    finish({ type: 'end', taskId: seen.runs[seen.runs.length - 1].taskId, at: 9, status })
    for (let i = 0; i < 200 && runner.view().phase !== 'done'; i += 1) await delay(5)
  }
  return { runner, seen, settle, history, root }
}

async function until(predicate) {
  for (let i = 0; i < 300 && !predicate(); i += 1) await delay(5)
}

test('插进去：气泡立刻冒出来，灰字写「已发送，正在等待模型响应」', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '照范本，用这些材料写一份本周周报。' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'steer', text: '只写销售和库存两块就行' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'steer'))
  const view = h.runner.view()
  const bubble = view.blocks.find((one) => one.kind === 'steer')
  assert.ok(bubble, JSON.stringify(view.blocks))
  assert.equal(bubble.text, '只写销售和库存两块就行')
  assert.equal(bubble.status, 'steer')
  assert.equal(view.labels.steer, '已发送，正在等待模型响应')
  // 灰字那行：走通了就是这一句
  assert.match(page, /view && status \? view\.labels\.steer : ''/)
  // 插进去了：这一轮照常干完，不另起一轮
  await h.settle()
  await delay(20)
  assert.equal(h.seen.runs.length, 1)
  // 这一轮干完了：那行「正在等待模型响应」不再写
  assert.equal(h.runner.view().blocks.find((one) => one.kind === 'steer').status, '')
})

test('插进去以后模型说了话：那行「正在等待模型响应」收起来', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写周报' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'steer', text: '怎么样了？' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'steer'))
  h.seen.runs[0].onEvent({ type: 'reply', taskId: h.seen.runs[0].taskId, text: '快好了，正在排版。' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'reply'))
  const steer = h.runner.view().blocks.find((one) => one.kind === 'steer')
  assert.equal(steer.status, '', '模型已经回了话，不再说在等')
  await h.settle()
})

test('插不进去：排队等这一轮干完就发（不停下这一步重发）', async () => {
  const h = harness({ steer: () => Promise.resolve({ ok: false, mode: 'queue' }) })
  h.runner.act({ type: 'send', text: '照范本，用这些材料写一份本周周报。' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'steer', text: '只写销售和库存两块就行' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'queue'))
  assert.equal(h.runner.view().labels.steer, '已发送，正在等待模型响应')
  assert.equal(h.seen.runs.length, 1, '这一轮没被停下重发')
  // 这一轮干完了，那句就发出去（接着同一个会话说）
  await h.settle()
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].prompt, '只写销售和库存两块就行')
  assert.equal(h.seen.runs[1].sessionId, 's1', '接着同一个会话')
})

test('插的话进对话历史：重新打开还看得到，顺序在原来那句后面', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '照范本，用这些材料写一份本周周报。' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'steer', text: '只写销售和库存两块就行' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer'))
  const list = h.history.list({})
  assert.equal(list.length, 1)
  const record = h.history.get(list[0].id)
  const mine = record.messages.filter((one) => one.role === 'me').map((one) => one.text)
  assert.deepEqual(mine, ['照范本，用这些材料写一份本周周报。', '只写销售和库存两块就行'])
  await h.settle()
})

test('干活中输入框不锁：能打字能发，占位字还是那一句', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '照范本，用这些材料写一份本周周报。' })
  await until(() => h.seen.runs.length === 1)
  const view = h.runner.view()
  assert.equal(view.phase, 'working')
  assert.equal(view.input.canSend, true)
  assert.equal(view.input.hint, t('input.hint'))
  // 插的那句下面的灰字：插进去、排队都是 St502 这一句
  assert.equal(view.labels.steer, '已发送，正在等待模型响应')
  // 页面在干活中发出去的是插话，不是新开一轮
  assert.match(page, /view\.phase === 'working' \? 'steer' : 'send'/)
  // 干活中直接走 send：不另起一轮（页面上干活中发的是插话；拖进来的文件见 attach.test.mjs）
  h.runner.act({ type: 'send', text: '再开一轮' })
  await delay(30)
  assert.equal(h.seen.runs.length, 1, '干活中不该起第二轮')
  await h.settle()
})
