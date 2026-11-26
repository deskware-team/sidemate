// 新闻主题的名字：本地规则立刻给一个，模型回来的那个收拾干净。
import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanName, localName, nameFromReply } from '../../app/news/name.mjs'

test('本地规则：取第一个逗号前那段，去掉开头结尾的套话和「的」，最多 8 个字', () => {
  assert.equal(localName('网络安全的新产品'), '网络安全新产品')
  assert.equal(localName('我想看新能源车和动力电池的消息，挑五条要紧的'), '新能源车动力电池')
  assert.equal(localName('关注中医药政策的新闻'), '中医药政策')
  assert.equal(localName('AI 行业：大模型'), 'AI行业：大模型', '超过 8 个字先去空格')
  assert.equal(localName('AI 行业'), 'AI 行业', '不超过就不动')
  assert.equal(localName('一二三四五六七八九十'), '一二三四五六七八')
  assert.equal(localName(''), '')
  // 名字里不能当路径的字符去掉
  assert.equal(localName('a/b:c'), 'abc')
})

test('模型回来的名字：标点、引号、空格都去掉；超过 8 个字先去连接的字，还超就当没给（不硬截）；少于 2 个字当没给', () => {
  assert.equal(cleanName('「网络安全新产品」。'), '网络安全新产品')
  assert.equal(cleanName('  安全 新品\n'), '安全新品')
  assert.equal(cleanName('新能源车和动力电池'), '新能源车动力电池', '9 个字：去掉「和」正好 8 个')
  assert.equal(cleanName('一二三四五六七八九十'), '', '去不掉还超：当没给，不截成半个词')
  assert.equal(cleanName('好'), '')
  assert.equal(cleanName(''), '')
})

test('整段回话里取名字：先客套一句再给名字的，只认最后一行', () => {
  assert.equal(nameFromReply('好的，我直接给你提炼一个 4 到 8 个字的主题名。\n\n网络安全新产品'), '网络安全新产品')
  assert.equal(nameFromReply('新能源车电池要闻'), '新能源车电池要闻')
  assert.equal(nameFromReply('\n\n'), '')
})