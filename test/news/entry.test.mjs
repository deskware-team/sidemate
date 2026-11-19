// 新闻入口的纯逻辑：日子标签、条数、已读、未读、「新闻订阅」菜单模板。全程只碰临时目录。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MENU_DAYS,
  countPaperItems,
  dayLabel,
  markNewsRead,
  newsMenuTemplate,
  readNewsRead,
  unreadDate,
  unreadTopics,
} from '../../app/news/entry.mjs'

// 临时目录，用完删掉
function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sidemate-news-entry-'))
}

// 一份排好的新闻 .md（runner 那边 layoutPaper 的样子）
const PAPER = `# AI 行业 · 2026-11-11 新闻

今天的事不少。

## 今天

**新模型发布**

来源：站点 [原标题](https://a.example/1)

**价格降了一半**

来源：站点 [原标题](https://a.example/2)
来源：站点 [原标题](https://a.example/3)

## 进展

**征求意见有了新进展**

来源：站点 [原标题](https://a.example/4)

共参考 4 个来源
`

test('日子标签：今天、昨天、更早的只写月日', () => {
  assert.equal(dayLabel('2026-11-11', '2026-11-11'), '今天 11-11')
  assert.equal(dayLabel('2026-11-10', '2026-11-11'), '昨天 11-10')
  assert.equal(dayLabel('2026-11-09', '2026-11-11'), '11-09')
  // 跨月：10-31 是 11-01 的昨天
  assert.equal(dayLabel('2026-10-31', '2026-11-01'), '昨天 10-31')
  assert.equal(dayLabel('2026-11-25', '2026-11-11'), '11-25')
  // 今天没给：都当更早的写
  assert.equal(dayLabel('2026-11-11', ''), '11-11')
})

test('数条数：只数「今天」「进展」两节里整行粗体的标题', () => {
  assert.equal(countPaperItems(PAPER), 3)
  // 只有「进展」一节
  assert.equal(countPaperItems('# x\n\n## 进展\n\n**一条**\n'), 1)
  // 节里一条都没有
  assert.equal(countPaperItems('## 今天\n\n（空）\n'), 0)
})

test('数不出来：两节都没有就不给数（菜单里不写条数）', () => {
  // 「今日无新内容」那份长这样
  assert.equal(countPaperItems('# AI · 2026-11-11 新闻\n\n今日无新内容\n'), null)
  assert.equal(countPaperItems(''), null)
  assert.equal(countPaperItems(null), null)
  // 粗体不是整行（比如正文里带的）不算一条
  assert.equal(countPaperItems('## 今天\n\n一句里带 **粗体** 的话\n'), 0)
})

test('已读文件：读出来只留 合法id: 合法日期', () => {
  const dir = tempDir()
  const file = join(dir, '新闻-已读.json')
  writeFileSync(file, JSON.stringify({ 't-ai': '2026-11-10', bad: '不是日期', 't-x': 123, '': '2026-11-10' }), 'utf8')
  assert.deepEqual(readNewsRead(file), { 't-ai': '2026-11-10' })
  // 坏了的文件当什么都没看过
  writeFileSync(file, '{oops', 'utf8')
  assert.deepEqual(readNewsRead(file), {})
  assert.deepEqual(readNewsRead(join(dir, '没有.json')), {})
  rmSync(dir, { recursive: true, force: true })
})

test('已读文件：看过一份就把那个主题推到那一天', () => {
  const dir = tempDir()
  const file = join(dir, '新闻-已读.json')
  markNewsRead(file, 't-ai', '2026-11-11')
  markNewsRead(file, 't-med', '2026-11-10')
  assert.deepEqual(readNewsRead(file), { 't-ai': '2026-11-11', 't-med': '2026-11-10' })
  // 再看旧的一份：日期不往回退由调用方管，这里只按写的来
  markNewsRead(file, 't-ai', '2026-11-09')
  assert.equal(readNewsRead(file)['t-ai'], '2026-11-09')
  // 日期不合法就不动
  markNewsRead(file, 't-ai', '11-11')
  assert.equal(readNewsRead(file)['t-ai'], '2026-11-09')
  rmSync(dir, { recursive: true, force: true })
})

test('未读：有比「最后看过」新的期就有未读', () => {
  assert.equal(unreadDate(['2026-11-11', '2026-11-10'], '2026-11-10'), '2026-11-11')
  assert.equal(unreadDate(['2026-11-11', '2026-11-10'], '2026-11-11'), null)
  // 没记过已读：最早那份也算没看过，红点给最新那份
  assert.equal(unreadDate(['2026-11-11', '2026-11-10'], undefined), '2026-11-11')
  // 乱序给进来也能找
  assert.equal(unreadDate(['2026-11-10', '2026-11-12'], '2026-11-11'), '2026-11-12')
})

test('有未读的主题：按没看到的日期从新到旧排', () => {
  const topics = [
    { id: 't-old', name: '旧主题' },
    { id: 't-ai', name: 'AI 行业' },
    { id: 't-med', name: '中医药政策' },
    { id: '', name: '坏的' },
  ]
  const datesOf = (topic) => ({
    't-old': ['2026-11-08'],
    't-ai': ['2026-11-11', '2026-11-10'],
    't-med': ['2026-11-11'],
  }[topic.id] ?? [])
  const read = { 't-ai': '2026-11-10', 't-med': '2026-11-11' }
  assert.deepEqual(unreadTopics({ topics, datesOf, read }), [
    { topicId: 't-ai', name: 'AI 行业', date: '2026-11-11' },
    { topicId: 't-old', name: '旧主题', date: '2026-11-08' },
  ])
  // 都看过了：空
  assert.deepEqual(unreadTopics({ topics, datesOf, read: { 't-old': '2026-11-08', 't-ai': '2026-11-11', 't-med': '2026-11-11' } }), [])
})

test('菜单：一个主题都没有时只有「添加主题…」', () => {
  const calls = []
  const items = newsMenuTemplate({ topics: [], datesOf: () => [], onManage: () => calls.push('manage') })
  assert.equal(items.length, 1)
  assert.equal(items[0].label, '添加主题…')
  items[0].click()
  assert.deepEqual(calls, ['manage'])
})

test('菜单：每个主题一项，有未读的标「● 新」，子菜单按天（只写日子，不写条数）', () => {
  const opened = []
  const items = newsMenuTemplate({
    topics: [
      { id: 't-ai', name: 'AI 行业' },
      { id: 't-med', name: '中医药政策' },
    ],
    datesOf: (topic) => (topic.id === 't-ai' ? ['2026-11-11', '2026-11-10', '2026-11-09'] : ['2026-11-11']),
    read: { 't-ai': '2026-11-10', 't-med': '2026-11-11' },
    today: '2026-11-11',
    onOpenIssue: (topicId, date) => opened.push([topicId, date]),
  })
  assert.deepEqual(items.map((one) => one.label), ['AI 行业 ● 新', '中医药政策'])
  const days = items[0].submenu
  assert.deepEqual(days.slice(0, 3).map((one) => one.label), ['今天 11-11', '昨天 11-10', '11-09'])
  // 子菜单最后：分隔 + 管理订阅…
  assert.equal(days[days.length - 2].type, 'separator')
  assert.equal(days[days.length - 1].label, '管理订阅…')
  // 点一天：打开那一天的新闻对话
  days[0].click()
  assert.deepEqual(opened, [['t-ai', '2026-11-11']])
})

test('菜单：一份都没有的主题子菜单里一项灰的「无新闻」，后面照旧能管订阅', () => {
  const items = newsMenuTemplate({
    topics: [{ id: 't-new', name: '新主题' }],
    datesOf: () => [],
    read: {},
    today: '2026-11-11',
  })
  const submenu = items[0].submenu
  assert.equal(submenu[0].label, '无新闻')
  assert.equal(submenu[0].enabled, false)
  assert.equal(submenu[2].label, '管理订阅…')
  assert.equal(submenu[1].type, 'separator')
})

test('菜单：日子最多列最近 7 天', () => {
  const dates = Array.from({ length: 9 }, (_, i) => `2026-11-${String(11 - i).padStart(2, '0')}`)
  const items = newsMenuTemplate({
    topics: [{ id: 't-ai', name: 'AI 行业' }],
    datesOf: () => dates,
    read: {},
    today: '2026-11-11',
  })
  const days = items[0].submenu.slice(0, MENU_DAYS)
  assert.equal(days.length, MENU_DAYS)
  assert.equal(days[0].label, '今天 11-11')
  assert.equal(days[1].label, '昨天 11-10')
  assert.equal(days[6].label, '11-05')
})

test('菜单：错过的那几天也在列表里，写明「未生成：桌伴未运行」', () => {
  const items = newsMenuTemplate({
    topics: [{ id: 't-ai', name: 'AI 行业' }],
    datesOf: () => ['2026-11-11'],
    missedOf: () => ['2026-11-10', '2026-11-09'],
    read: {},
    today: '2026-11-11',
  })
  const days = items[0].submenu
  assert.equal(days[0].label, '今天 11-11')
  assert.equal(days[1].label, '昨天 11-10 未生成：桌伴未运行')
  assert.equal(days[2].label, '11-09 未生成：桌伴未运行')
})

test('菜单：只是错过、没生成的那天是灰的、点了没反应', () => {
  const opened = []
  const items = newsMenuTemplate({
    topics: [{ id: 't-ai', name: 'AI 行业' }],
    datesOf: () => ['2026-11-11'],
    missedOf: () => ['2026-11-10'],
    read: {},
    today: '2026-11-11',
    onOpenIssue: (topicId, date) => opened.push([topicId, date]),
  })
  const days = items[0].submenu
  const missedDay = days[1]
  assert.equal(missedDay.enabled, false)
  assert.equal(typeof missedDay.click, 'undefined')
  // 正常出的那天照旧能点
  assert.equal(days[0].enabled, undefined)
  days[0].click()
  assert.deepEqual(opened, [['t-ai', '2026-11-11']])
})

test('菜单：既出过又记着错过的那天照旧能点', () => {
  const opened = []
  const items = newsMenuTemplate({
    topics: [{ id: 't-ai', name: 'AI 行业' }],
    datesOf: () => ['2026-11-10'],
    missedOf: () => ['2026-11-10'],
    read: {},
    today: '2026-11-11',
    onOpenIssue: (topicId, date) => opened.push([topicId, date]),
  })
  const days = items[0].submenu
  assert.equal(days[0].label, '昨天 11-10')
  assert.notEqual(days[0].enabled, false)
  days[0].click()
  assert.deepEqual(opened, [['t-ai', '2026-11-10']])
})
