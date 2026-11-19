// 每把密钥的并发排队：到上限就排队、前面做完自动开始、上限 0 不限、调大上限后 refresh 放行、取消、release 重复无害。

import assert from 'node:assert/strict'
import test from 'node:test'
import { createKeyQueue } from '../../app/task/key-queue.mjs'

// 等一小会儿（毫秒）
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('同一把密钥到上限就排队：先来先得，前面做完自动开始', async () => {
  const queue = createKeyQueue({ limitOf: () => 1 })
  const started = []
  const release1 = await queue.acquire('k1')
  assert.equal(queue.running('k1'), 1)
  assert.equal(queue.size('k1'), 0)

  let queued = false
  const pending = queue.acquire('k1', { onQueued: () => { queued = true } }).then((release) => {
    started.push('second')
    return release
  })
  assert.equal(queued, true, '真的要等的时候要调一次 onQueued')
  assert.equal(queue.size('k1'), 1)
  assert.equal(queue.running('k1'), 1)

  release1()
  const release2 = await pending
  assert.deepEqual(started, ['second'])
  assert.equal(queue.running('k1'), 1)
  assert.equal(queue.size('k1'), 0)
  release2()
  queue.close()
})

test('上限 0 = 不限：多少个都能同时在跑', async () => {
  const queue = createKeyQueue({ limitOf: () => 0 })
  const releases = []
  for (let i = 0; i < 5; i += 1) releases.push(await queue.acquire('k1'))
  assert.equal(queue.running('k1'), 5)
  assert.equal(queue.size('k1'), 0)
  for (const release of releases) release()
  assert.equal(queue.running('k1'), 0)
  queue.close()
})

test('中途把上限调大后调 refresh：排着的立刻放行', async () => {
  let limit = 1
  const queue = createKeyQueue({ limitOf: () => limit })
  const release1 = await queue.acquire('k1')
  assert.equal(queue.running('k1'), 1)
  const pending = queue.acquire('k1')
  assert.equal(queue.size('k1'), 1)

  limit = 2 // 用户把上限调大了
  queue.refresh() // 设置保存后接线那边调它
  assert.equal(queue.running('k1'), 2, '调 refresh 后排着的应该立刻上')
  assert.equal(queue.size('k1'), 0)
  const release2 = await pending
  release1()
  release2()
  queue.close()
})

test('上限调大了但没调 refresh：排着的先不动', async () => {
  let limit = 1
  const queue = createKeyQueue({ limitOf: () => limit })
  const release1 = await queue.acquire('k1')
  const pending = queue.acquire('k1')
  assert.equal(queue.size('k1'), 1)

  limit = 2 // 用户把上限调大了，但还没调 refresh
  await wait(60)
  assert.equal(queue.running('k1'), 1, '没调 refresh 时不会自己放行')
  assert.equal(queue.size('k1'), 1, '没调 refresh 时还排着')

  queue.refresh()
  assert.equal(queue.running('k1'), 2)
  const release2 = await pending
  release1()
  release2()
  queue.close()
})

test('取消：排着的被拿掉，Promise 以 AbortError 结束', async () => {
  const queue = createKeyQueue({ limitOf: () => 1 })
  const release1 = await queue.acquire('k1')
  const controller = new AbortController()
  const pending = queue.acquire('k1', { signal: controller.signal })
  assert.equal(queue.size('k1'), 1)
  controller.abort()
  await assert.rejects(pending, (err) => err.name === 'AbortError')
  assert.equal(queue.size('k1'), 0)

  // 已经拿到的位子不受影响
  assert.equal(queue.running('k1'), 1)
  release1()
  queue.close()
})

test('一上来就取消：不进队，直接 AbortError', async () => {
  const queue = createKeyQueue({ limitOf: () => 1 })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(queue.acquire('k1', { signal: controller.signal }), (err) => err.name === 'AbortError')
  assert.equal(queue.size('k1'), 0)
  assert.equal(queue.running('k1'), 0)
  queue.close()
})

test('release 重复调无害', async () => {
  const queue = createKeyQueue({ limitOf: () => 1 })
  const release = await queue.acquire('k1')
  release()
  release()
  release()
  assert.equal(queue.running('k1'), 0)
  queue.close()
})

test('不同的密钥互不影响', async () => {
  const queue = createKeyQueue({ limitOf: () => 1 })
  const a = await queue.acquire('k1')
  const b = await queue.acquire('k2')
  assert.equal(queue.running('k1'), 1)
  assert.equal(queue.running('k2'), 1)
  const pending = queue.acquire('k2')
  assert.equal(queue.size('k1'), 0)
  assert.equal(queue.size('k2'), 1)
  b()
  const b2 = await pending
  a()
  b2()
  queue.close()
})

test('没给的密钥：上限按不限算', async () => {
  const queue = createKeyQueue({})
  const release = await queue.acquire('k1')
  assert.equal(queue.running('k1'), 1)
  release()
  queue.close()
})
