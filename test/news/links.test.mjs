// 链接归一化和域名：新闻那边按它去重、排来源。

import assert from 'node:assert/strict'
import test from 'node:test'
import { hostOf, normalizeNewsLink } from '../../app/news/links.mjs'

test('归一化：去片段、去末尾斜杠、域名小写', () => {
  assert.equal(normalizeNewsLink('https://A.Example/news/1#正文'), 'https://a.example/news/1')
  assert.equal(normalizeNewsLink('https://a.example/news/1/'), 'https://a.example/news/1')
  assert.equal(normalizeNewsLink('https://a.example/'), 'https://a.example')
  assert.equal(normalizeNewsLink('https://a.example/news/1?utm_source=rss'), 'https://a.example/news/1?utm_source=rss')
})

test('归一化：不是链接的给空串', () => {
  assert.equal(normalizeNewsLink(''), '')
  assert.equal(normalizeNewsLink('不是链接'), '')
  assert.equal(normalizeNewsLink('ftp://a.example/x'), '')
  assert.equal(normalizeNewsLink(null), '')
})

test('域名取不到给空串', () => {
  assert.equal(hostOf('https://a.example/x'), 'a.example')
  assert.equal(hostOf('不是链接'), '')
})
