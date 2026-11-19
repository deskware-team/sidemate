// 等待行按错的种类分开：忙、服务出错、模型一直不回、连接断了，各说各的那一句。

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

// 一个够用的假环境：模型、runTask 都是假的，只看重试事件怎么变成界面上的等待行。
function harness(kind) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-waitkind-'))
  const seen = { run: [], pet: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({
      ok: true,
      apiKey: 'test-key',
      env: {},
      patchTexts: ['routes'],
      model: { value: 'zhipu/chat', effort: null },
      vendor: '智谱',
      free: false,
      route: 'zhipu',
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
    prepareTask: () => ({
      kind: 'files',
      workspace: join(root, 'ws'),
      copied: [],
      skipped: [],
      snapshot: [],
    }),
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: () => ({ to: '', name: '', locked: false }),
    clearWorkspace: () => {},
    snapshotWorkspace: () => [],
    runTask: (options) => {
      const handle = { options, sessionId: 's1', cancelled: false, cancel() { this.cancelled = true } }
      handle.done = new Promise((done) => { handle.finish = done })
      options.onEvent({
        type: 'retry',
        taskId: options.taskId,
        at: 1,
        kind,
        retry: 3,
        maxRetries: 10,
        delayMs: 20_000,
      })
      return handle
    },
  })
  return { runner, seen, root }
}

async function waitRow(kind) {
  const h = harness(kind)
  h.runner.act({ type: 'send', text: '写' })
  for (let i = 0; i < 400 && !h.runner.view().blocks.some((one) => one.kind === 'wait'); i += 1) await delay(5)
  const row = h.runner.view().blocks.find((one) => one.kind === 'wait')
  assert.ok(row, kind)
  return row
}

test('等待行按错的种类分：忙、服务出错、超时、连接断了', async () => {
  const busy = await waitRow('busy')
  assert.equal(busy.text, '模型忙，20 秒后自动重试（第 3 次，最多 10 次）')
  assert.equal(busy.head, '模型忙，')
  assert.equal(busy.tail, '（第 3 次，最多 10 次）')
  assert.equal(busy.until > Date.now(), true)

  const server = await waitRow('server')
  assert.equal(server.text, '模型服务出错，20 秒后自动重试（第 3 次，最多 10 次）')
  assert.equal(server.head, '模型服务出错，')
  assert.equal(server.tail, '（第 3 次，最多 10 次）')

  const timeout = await waitRow('noreply')
  assert.equal(timeout.text, '模型响应超时，正在重新连接（第 3 次，最多 10 次）')
  // 这一行没有倒数那截
  assert.equal(timeout.tail, '')
  assert.equal(timeout.until, 0)

  const broken = await waitRow('network')
  assert.equal(broken.text, '模型连接中断，20 秒后自动重试（第 3 次，最多 10 次）')
  assert.equal(broken.head, '模型连接中断，')
  assert.equal(broken.tail, '（第 3 次，最多 10 次）')
})

test('小岛那头也知道是哪一种：等重试时喂过去的进度带着种类（断网就不说「模型忙」）', async () => {
  for (const kind of ['network', 'server', 'busy']) {
    const h = harness(kind)
    h.runner.act({ type: 'send', text: '写' })
    for (let i = 0; i < 400 && !h.seen.pet.some((one) => one.type === 'progress' && one.wait); i += 1) await delay(5)
    const one = h.seen.pet.find((event) => event.type === 'progress' && event.wait)
    assert.ok(one, kind)
    assert.equal(one.waitKind, kind)
  }
})
