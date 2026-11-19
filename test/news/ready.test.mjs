// 能不能生成新闻：只认 DeepSeek 自带的联网搜索。

import assert from 'node:assert/strict'
import test from 'node:test'
import { NOT_READY_TEXT, newsReady } from '../../app/news/ready.mjs'

test('有 DeepSeek 钥匙：能生成', () => {
  const ready = newsReady({ hasSearchKey: true })
  assert.equal(ready.ok, true)
})

test('没配 DeepSeek 钥匙：不能生成，给出该怎么做', () => {
  const ready = newsReady({ hasSearchKey: false })
  assert.equal(ready.ok, false)
  assert.equal(ready.code, 'Si104')
  assert.equal(ready.text, '仅支持 DeepSeek 原生搜索')
  assert.equal(ready.text, NOT_READY_TEXT)
})

test('「能力」里开着外部工具服务也不算数：新闻只认 DeepSeek 自带的搜索', () => {
  assert.equal(newsReady({ hasSearchKey: false, mcpCount: 1 }).ok, false)
  assert.equal(newsReady({ hasSearchKey: false, mcpCount: 3 }).ok, false)
})

test('缺参数也算没有', () => {
  assert.equal(newsReady().ok, false)
  assert.equal(newsReady({}).ok, false)
  assert.equal(newsReady({ hasSearchKey: 'yes' }).ok, false)
})
