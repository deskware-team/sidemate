// 每把密钥排队接进任务窗：同一把钥匙同时只能跑一个请求，第二个任务显示「排队中」，
// 前面那个做完了它自动开始；停下、收场都放掉位子。

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSession } from '../../app/task/session.mjs'
import { createKeyQueue } from '../../app/task/key-queue.mjs'
import { t } from '../../app/copy/copy.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

// 两条对话、一个排队器：runTask 是假的，只看谁先拿到位子
function harness(limit = 1) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-queue-'))
  const ws = join(root, 'ws')
  const seen = { started: [], handles: [] }
  const queue = createKeyQueue({ limitOf: () => limit })
  const deps = {
    model: () => ({
      ok: true,
      apiKey: 'k',
      env: {},
      patchTexts: [],
      model: { value: '["k1","m"]', effort: null },
      entry: 'k1',
      modelId: 'm',
      vendor: '测试通道',
    }),
    keyQueue: queue,
    prepareTask: () => ({ kind: 'files', workspace: ws, copied: [], skipped: [], snapshot: [] }),
    clearWorkspace: () => {},
    log: () => {},
    runTask: (options) => {
      seen.started.push(options.taskId)
      let done
      const promise = new Promise((resolve) => { done = resolve })
      const handle = {
        sessionId: `s-${options.taskId}`,
        done: promise,
        finish: (status) => done({ type: 'end', taskId: options.taskId, status }),
        cancel: () => done({ type: 'end', taskId: options.taskId, status: 'cancelled' }),
        steer: () => Promise.resolve({ ok: false, mode: 'none' }),
        answerPermission: () => Promise.resolve({ ok: false }),
      }
      seen.handles.push(handle)
      return handle
    },
  }
  const make = () => createSession({ deps, log: () => {}, newRunId: (() => { let n = 0; return () => `r${(n += 1)}` })() })
  return { queue, seen, make }
}

test('同一把密钥只能跑一个：第二个任务排着，界面上写「排队中」', async () => {
  const { queue, seen, make } = harness(1)
  const a = make()
  const b = make()
  a.feed({ type: 'send', text: '一', runId: 'r1' })
  await delay(30)
  assert.equal(seen.started.length, 1, '第一个任务已经开工了')
  assert.equal(queue.running('k1'), 1)

  b.feed({ type: 'send', text: '二', runId: 'r2' })
  await delay(30)
  assert.equal(seen.started.length, 1, '第二个任务还在排队')
  assert.equal(queue.size('k1'), 1, '第二个任务排在队里')
  const notes = b.state().flow.filter((one) => one.kind === 'note')
  assert.equal(notes.length, 1, '排队的那个任务有一行提示')
  assert.equal(notes[0].text, t('St410'), '那行写的是「排队中」')

  // 第一个做完了：第二个自动开始
  seen.handles[0].finish('done')
  await delay(60)
  assert.equal(seen.started.length, 2, '前面那个做完了，第二个接着上')
  assert.equal(queue.running('k1'), 1)
  seen.handles[1].finish('done')
  await delay(30)
  assert.equal(queue.running('k1'), 0, '都做完了，位子放掉了')
  queue.close()
})

test('停下：位子放掉，排着的那个接着上', async () => {
  const { queue, seen, make } = harness(1)
  const a = make()
  const b = make()
  a.feed({ type: 'send', text: '一', runId: 'r1' })
  await delay(30)
  b.feed({ type: 'send', text: '二', runId: 'r2' })
  await delay(30)
  assert.equal(queue.size('k1'), 1)

  a.stop()
  await delay(60)
  assert.equal(seen.started.length, 2, '第一个停了，第二个接上')
  assert.equal(queue.running('k1'), 1)
  seen.handles[1].finish('done')
  await delay(30)
  assert.equal(queue.running('k1'), 0)
  queue.close()
})

test('排队的时候被停下：这一轮不跑了，位子也没占着', async () => {
  const { queue, seen, make } = harness(1)
  const a = make()
  const b = make()
  a.feed({ type: 'send', text: '一', runId: 'r1' })
  await delay(30)
  b.feed({ type: 'send', text: '二', runId: 'r2' })
  await delay(30)
  assert.equal(queue.size('k1'), 1)

  b.stop()
  await delay(60)
  assert.equal(queue.size('k1'), 0, '排队的那个被停了，就不排了')
  assert.equal(seen.started.length, 1, '它没开工')
  seen.handles[0].finish('done')
  await delay(30)
  assert.equal(queue.running('k1'), 0)
  queue.close()
})
