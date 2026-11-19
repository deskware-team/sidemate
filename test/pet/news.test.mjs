// 新闻入口在壳这头的接线：红点亮不亮的判断、「新闻订阅」菜单现读现算、
// 未读和已读、生成时记下的对话编号。全程只碰临时目录。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createNewsEntry, newsDotOf } from '../../app/pet/news.mjs'

// 临时目录，用完删掉
function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-pet-news-'))
}

// 造一个主题 + 它的几期新闻（照内部目录的样子摆：<low>/新闻/<主题id>/<日期>/新闻.md，条数从里面数）
function makeTopic(root, topicsFile, topic, dates, counts = {}) {
  const topics = JSON.parse(readFileSync(topicsFile, 'utf8').trim() || '{"topics":[]}').topics || []
  writeFileSync(topicsFile, JSON.stringify({ version: 1, topics: [...topics, topic] }, null, 2), 'utf8')
  for (const date of dates) {
    const dir = join(root, topic.id, date)
    mkdirSync(dir, { recursive: true })
    const count = counts[date] ?? 2
    const items = Array.from({ length: count }, (_, i) => `**第 ${i + 1} 条**\n\n来源：站 [题](https://e.example/${i})\n`)
    writeFileSync(join(dir, '新闻.md'), `# ${topic.name} · ${date} 新闻\n\n## 今天\n\n${items.join('')}\n`, 'utf8')
  }
}

function entry() {
  const root = tempRoot()
  const topicsFile = join(root, 'news.json')
  writeFileSync(topicsFile, JSON.stringify({ version: 1, topics: [] }), 'utf8')
  return { root, topicsFile, news: createNewsEntry({ root, low: root, topicsFile }) }
}

test('红点：有没看的新闻才亮；正在干活的先等，活干完再亮', () => {
  assert.deepEqual(newsDotOf({ pending: true, busy: false }), { dot: true, hold: false })
  assert.deepEqual(newsDotOf({ pending: true, busy: true }), { dot: false, hold: true })
  assert.deepEqual(newsDotOf({ pending: false, busy: false }), { dot: false, hold: false })
  assert.deepEqual(newsDotOf({ pending: false, busy: true }), { dot: false, hold: false })
})

test('未读：出过一期没看过就算有；看过最新那期就没有了', () => {
  const { root, topicsFile, news } = entry()
  makeTopic(root, topicsFile, { id: 't-ai', name: 'AI 行业' }, ['2026-11-11', '2026-11-10'])
  assert.equal(news.hasUnread(), true)
  assert.deepEqual(news.latest(), { topicId: 't-ai', name: 'AI 行业', date: '2026-11-11', historyId: '' })
  news.markRead('t-ai', '2026-11-11')
  assert.equal(news.hasUnread(), false)
  assert.equal(news.latest(), null)
  // 已读写进了 data/news-read.json（就在程序数据根下）
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'news-read.json'), 'utf8')), { 't-ai': '2026-11-11' })
  rmSync(root, { recursive: true, force: true })
})

test('菜单：日子、「● 新」都从内部目录里现算；只写日子，不写条数', () => {
  const { root, topicsFile, news } = entry()
  makeTopic(root, topicsFile, { id: 't-ai', name: 'AI 行业' }, ['2026-11-11', '2026-11-10'], { '2026-11-11': 3, '2026-11-10': 0 })
  const items = news.menu({ today: '2026-11-11' })
  assert.equal(items.length, 1)
  assert.equal(items[0].label, 'AI 行业 ● 新')
  const days = items[0].submenu
  assert.equal(days[0].label, '今天 11-11')
  assert.equal(days[1].label, '昨天 11-10')
  // 看过最新一期再算：不标「● 新」
  news.markRead('t-ai', '2026-11-11')
  assert.equal(news.menu({ today: '2026-11-11' })[0].label, 'AI 行业')
  rmSync(root, { recursive: true, force: true })
})

test('生成时给的对话编号记下来：点开不用再翻对话记录', () => {
  const { root, topicsFile, news } = entry()
  makeTopic(root, topicsFile, { id: 't-ai', name: 'AI 行业' }, ['2026-11-11'])
  news.onGenerated({ topicId: 't-ai', date: '2026-11-11', historyId: '20261111-080000-123' })
  assert.equal(news.latest().historyId, '20261111-080000-123')
  assert.equal(news.issueOf('t-ai', '2026-11-11').historyId, '20261111-080000-123')
  // 没给编号的（比如重跑盖过一次）：空串，壳那边自己去对话记录里找
  news.onGenerated({ topicId: 't-ai', date: '2026-11-12' })
  makeTopic(root, topicsFile, { id: 't-ai', name: 'AI 行业' }, ['2026-11-12'])
  assert.equal(news.latest().historyId, '')
  rmSync(root, { recursive: true, force: true })
})

test('要打开的那一天：给足主题名和日期', () => {
  const { root, topicsFile, news } = entry()
  makeTopic(root, topicsFile, { id: 't-med', name: '中医药政策' }, ['2026-11-10'])
  assert.deepEqual(news.issueOf('t-med', '2026-11-10'), {
    topicId: 't-med', name: '中医药政策', date: '2026-11-10', historyId: '',
  })
  // 没这个主题或日期不合法：不给
  assert.equal(news.issueOf('t-没', '2026-11-10'), null)
  assert.equal(news.issueOf('t-med', ''), null)
  rmSync(root, { recursive: true, force: true })
})

test('好几个主题都有没看的：最新那份排在最前', () => {
  const { root, topicsFile, news } = entry()
  makeTopic(root, topicsFile, { id: 't-med', name: '中医药政策' }, ['2026-11-10'])
  makeTopic(root, topicsFile, { id: 't-ai', name: 'AI 行业' }, ['2026-11-11'])
  assert.deepEqual(news.unread().map((one) => one.topicId), ['t-ai', 't-med'])
  rmSync(root, { recursive: true, force: true })
})
