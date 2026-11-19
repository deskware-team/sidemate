// 任务窗这头：模型忙的时候出一行等待，试够了停在这儿，点「接着干」在同一个会话里接着干。

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { t } from '../../app/copy/copy.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

// 一个够用的假环境：模型、runTask、产出这些全是假的，只看事件怎么变成界面上的东西。
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-busy-'))
  const seen = { run: [], notes: [], pet: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => (over.model || {
      ok: true,
      apiKey: 'test-key',
      env: {},
      patchTexts: ['routes'],
      model: { value: 'zhipu/chat', effort: null },
      vendor: over.vendor || '智谱',
    }),
    extensions: [],
    copyMaterials: () => ({ copied: [], skipped: [] }),
    recent: [],
    log: () => {},
    onPet: (event) => seen.pet.push(event),
    onRecent: () => {},
    onView: () => {},
    openSettings: () => {},
    openPath: () => {},
    history: createHistory({ tasksDir: root, newsDir: join(root, 'news') }),
    pickFiles: () => {},
    prepareTask: over.prepareTask || (() => ({
      kind: 'files',
      workspace: join(root, 'ws'),
      copied: [],
      skipped: [],
      snapshot: [],
    })),
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: () => ({ to: '', name: '', locked: false }),
    clearWorkspace: () => {},
    snapshotWorkspace: () => [],
    runTask: (options) => {
      seen.run.push(options)
      if (over.runTask) return over.runTask(options, seen)
      options.onEvent({ type: 'reply', taskId: options.taskId, at: 2, text: '做好了' })
      return { sessionId: 's1', cancel() { this.cancelled = true }, done: Promise.resolve({ type: 'end', taskId: options.taskId, at: 3, status: 'done' }) }
    },
  })
  return { runner, seen, root }
}

async function until(runner, phase) {
  for (let i = 0; i < 400 && runner.view().phase !== phase; i += 1) await delay(5)
  assert.equal(runner.view().phase, phase)
}

// 等到界面上出现某一块（等待行是跑起来以后才有的）
async function untilBlock(runner, kind) {
  for (let i = 0; i < 400 && !runner.view().blocks.some((one) => one.kind === kind); i += 1) await delay(5)
  assert.ok(runner.view().blocks.some((one) => one.kind === kind), JSON.stringify(runner.view().blocks))
}

test('模型忙：出一行等待，底下倒数', async () => {
  let handle = null
  const h = harness({
    runTask: (options) => {
      handle = { options, sessionId: 's1', cancelled: false, cancel() { this.cancelled = true } }
      handle.done = new Promise((done) => { handle.finish = done })
      options.onEvent({ type: 'retry', taskId: options.taskId, at: 1, retry: 3, maxRetries: 10, delayMs: 20_000 })
      return handle
    },
  })
  h.runner.act({ type: 'send', text: '写' })
  await untilBlock(h.runner, 'wait')
  const view = h.runner.view()
  const row = view.blocks.find((one) => one.kind === 'wait')
  assert.ok(row, JSON.stringify(view.blocks))
  assert.match(row.text, /模型忙，20 秒后自动重试（第 3 次，最多 10 次）/)
  assert.equal(row.until > Date.now(), true)
  // 等待的时候小岛还是干活中；小岛那头拿得到倒数到头的时刻（冒的那行说「模型忙，N 秒后重试」）
  assert.equal(view.phase, 'working')
  assert.equal(h.seen.pet.at(-1).wait, row.until)
  // 停下：这一轮就停了
  h.runner.act({ type: 'stop' })
  handle.finish({ type: 'end', taskId: handle.options.taskId, at: 4, status: 'cancelled' })
  await until(h.runner, 'stopped')
})

test('试够了停在这儿：点「接着干」在同一个会话里只说一句短话，原话不再发一遍', async () => {
  let handle = null
  const h = harness({
    runTask: (options) => {
      handle = { options, sessionId: 's1', cancelled: false, cancel() { this.cancelled = true } }
      handle.done = new Promise((done) => { handle.finish = done })
      options.onEvent({ type: 'error', taskId: options.taskId, at: 1, reason: 'busy', message: '没干成：模型那边太忙' })
      handle.done = new Promise((done) => {
        handle.finish = done
        done({ type: 'end', taskId: options.taskId, at: 2, status: 'error' })
      })
      return handle
    },
  })
  h.runner.act({ type: 'send', text: '照范本写一份周报' })
  await until(h.runner, 'paused')
  const paused = h.runner.view()
  const buttons = paused.banner.buttons
  assert.deepEqual(buttons.map((one) => one.action), ['continue', 'models'])
  // 停在这儿以后点「接着干」：同一个会话，只发那一句短话（原话 dsh 那边记着）
  h.runner.act({ type: 'continue' })
  for (let i = 0; i < 400 && h.seen.run.length < 2; i += 1) await delay(5)
  assert.equal(h.seen.run.length, 2)
  const second = h.seen.run.at(-1)
  assert.equal(second.sessionId, 's1')
  assert.equal(second.prompt, t('continue'))
  assert.doesNotMatch(second.prompt, /照范本写一份周报/)
})

test('按要求停下以后也给「接着干」：同一个会话，接着原来那件事', async () => {
  let handle = null
  const h = harness({
    runTask: (options) => {
      handle = { options, sessionId: 's1', cancelled: false, cancel() { this.cancelled = true } }
      handle.done = new Promise((done) => { handle.finish = done })
      return handle
    },
  })
  h.runner.act({ type: 'send', text: '照范本写一份周报' })
  await until(h.runner, 'working')
  for (let i = 0; i < 400 && !handle; i += 1) await delay(5)
  assert.ok(handle, '这一轮已经开跑了')
  h.runner.act({ type: 'stop' })
  handle.finish({ type: 'end', taskId: handle.options.taskId, at: 4, status: 'cancelled' })
  await until(h.runner, 'stopped')
  const buttons = h.runner.view().blocks.at(-1).buttons
  assert.deepEqual(buttons.map((one) => one.action), ['continue', 'retry'])
  // 点「接着干」：同一个会话，只发那一句短话
  h.runner.act({ type: 'continue' })
  for (let i = 0; i < 400 && h.seen.run.length < 2; i += 1) await delay(5)
  assert.equal(h.seen.run.length, 2)
  const second = h.seen.run.at(-1)
  assert.equal(second.sessionId, 's1')
  assert.equal(second.prompt, t('continue'))
})

test('换个模型：选中的模型管下一轮，接着干的时候用新模型', async () => {
  const h = harness()
  h.runner.act({ type: 'model', entry: 'free', model: 'kilo-auto/free', effort: null })
  assert.equal(h.runner.model().entry, 'free')
  assert.equal(h.runner.model().model, 'kilo-auto/free')
})

test('接着干：材料不再喂一遍——同一个会话里模型已经拿到过', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-busy2-'))
  const material = join(root, '范本.docx')
  writeFileSync(material, '范本')
  const fed = []
  const h = harness({
    prepareTask: () => ({
      kind: 'files',
      workspace: join(root, 'ws'),
      copied: [{ from: material, to: join(root, 'ws', '范本.docx') }],
      skipped: [],
      snapshot: [],
    }),
    runTask: (options) => {
      const handle = { options, sessionId: 's1', cancelled: false, cancel() { this.cancelled = true } }
      handle.done = new Promise((done) => {
        options.onEvent({ type: 'error', taskId: options.taskId, at: 1, reason: 'busy', message: '没干成：模型那边太忙' })
        done({ type: 'end', taskId: options.taskId, at: 2, status: 'error' })
      })
      return handle
    },
  })
  h.runner.drop([material])
  h.runner.act({ type: 'send', text: '照范本写一份周报' })
  await until(h.runner, 'paused')
  assert.deepEqual((h.seen.run[0].files || []).map((one) => one.name), ['范本.docx'], '第一轮把材料当资源链接给模型')
  h.runner.act({ type: 'continue' })
  for (let i = 0; i < 400 && h.seen.run.length < 2; i += 1) await delay(5)
  assert.equal(h.seen.run.length, 2)
  // 第一轮说过了就够了：接着干这一轮不再贴材料，只说那一句
  assert.equal(h.seen.run.at(-1).prompt, t('continue'))
  assert.equal(h.seen.run.at(-1).sessionId, 's1')
})
