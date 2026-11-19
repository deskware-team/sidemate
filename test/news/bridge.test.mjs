// 新闻后台那座桥：后台把生成的办法交进来，谁要生成就走 generate()。
// 这里不碰 electron，也不碰 runner：拿假的生成函数摆出几种样子。
import assert from 'node:assert/strict'
import test from 'node:test'

import { generate, setGenerator } from '../../app/news/bridge.mjs'

// 每个用例都从后台还没起来开始
function reset() {
  setGenerator(null)
}

test('后台还没起来：generate 立刻回一句失败的话', async () => {
  reset()
  const back = await generate('t-1')
  assert.equal(back.ok, false)
  assert.equal(back.message, '生成失败')
  assert.equal(back.topicId, 't-1')
})

test('后台起来了：generate 把主题 id 交给它，把结果原样带回来', async () => {
  reset()
  const seen = []
  setGenerator(async (id) => {
    seen.push(id)
    return { ok: true, topicId: id, date: '2026-11-12', files: [], items: 3, message: '今天的新闻整理好了' }
  })
  const back = await generate('t-1')
  assert.equal(back.ok, true)
  assert.equal(back.topicId, 't-1')
  assert.equal(back.date, '2026-11-12')
  assert.deepEqual(back.files, [])
  assert.equal(back.items, 3)
  assert.equal(back.message, '今天的新闻整理好了')
  assert.deepEqual(seen, ['t-1'])
  reset()
})

test('生成不出来：ok 是 false，那句话带回来，不抛出去', async () => {
  reset()
  setGenerator(async () => {
    throw new Error('模型没交出选题')
  })
  const back = await generate('t-1')
  assert.equal(back.ok, false)
  assert.equal(back.message, '模型没交出选题')
  reset()
})
