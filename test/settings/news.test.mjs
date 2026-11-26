// 「新闻」页的纯逻辑：每张卡怎么存、名字怎么来、页面显示什么、能不能订、哪些按钮灰。
// 存取走临时目录里的 news.json（程序数据根目录下），跟 test/settings/models.test.mjs 那一套。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { issueDir, loadTopics, todayString } from '../../app/news/topics.mjs'
import { markMissed } from '../../app/news/missed.mjs'
import {
  MAX_TOPICS,
  STATUS_MISSED,
  STATUS_NOT_TODAY,
  STATUS_NOT_YET,
  clockText,
  elapsedText,
  loadNews,
  loadNewsPrefs,
  needsName,
  newsFile,
  newsView,
  removeNewsTopic,
  renameTopic,
  saveNewsForm,
  saveNewsPrefs,
  setNewsEnabled,
  setNewsPermission,
  statusFacts,
  todayStatus,
} from '../../app/settings/news.mjs'

// 搭一个临时桌伴根：主题清单落在里面
function stage() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-settings-news-'))
  return {
    root,
    file: newsFile(root),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

// 两句能存的「想看什么」
const WANT = '网络安全的新产品'
const WANT2 = '新能源车和动力电池的消息，挑五条要紧的'
// 不能订的时候，界面上写的那一句（跟 app/news/ready.mjs 里那一句一样）
const NOT_READY_TEXT = '仅支持 DeepSeek 原生搜索'
// 2026-11-12 是周四
const THURSDAY = new Date('2026-11-12T10:00:00')
// 不在生成
const idle = () => null

test('清单放在程序数据根目录下的 news.json', () => {
  const s = stage()
  try {
    assert.equal(s.file, join(s.root, 'news.json'))
    assert.equal(loadNews(s.file).length, 0)
  } finally {
    s.done()
  }
})

test('新建：没有 id 就建一项，名字从那句话总结；能建好几个，最多 5 个', () => {
  const s = stage()
  try {
    const first = saveNewsForm(s.file, { want: WANT, at: '08:30', days: 'daily' })
    assert.equal(first.ok, true, first.message)
    assert.equal(first.topic.name, '网络安全新产品')
    assert.equal(first.topic.enabled, true)
    assert.match(first.topic.id, /^t-/)
    const second = saveNewsForm(s.file, { want: WANT2, at: '07:30', days: 'weekdays' })
    assert.equal(second.ok, true)
    assert.notEqual(second.topic.id, first.topic.id)
    const onDisk = loadTopics(s.file)
    assert.deepEqual(onDisk.map((one) => one.want), [WANT, WANT2], '按建立的先后')
    assert.equal(onDisk[1].at, '07:30')
    assert.equal(onDisk[1].days, 'weekdays')
    // 订满了：第 6 个存不上
    for (let i = 3; i <= MAX_TOPICS; i += 1) assert.equal(saveNewsForm(s.file, { want: `第 ${i} 个主题的消息` }).ok, true)
    const over = saveNewsForm(s.file, { want: '再来一个' })
    assert.equal(over.ok, false)
    assert.equal(over.message, '最多订 5 个主题')
    assert.equal(loadTopics(s.file).length, MAX_TOPICS)
  } finally {
    s.done()
  }
})

test('新建：那句话空着不建（页面上那张空卡只在页面里）', () => {
  const s = stage()
  try {
    const back = saveNewsForm(s.file, { want: '  ' })
    assert.equal(back.ok, false)
    assert.equal(back.message, '先写一句想看什么')
    assert.equal(loadTopics(s.file).length, 0)
  } finally {
    s.done()
  }
})

test('改一项：按 id 改；改了那句话名字跟着换，id 不变；清空了存成关着的', () => {
  const s = stage()
  try {
    const { topic } = saveNewsForm(s.file, { want: '大模型的新产品' })
    saveNewsForm(s.file, { want: WANT2 })
    const back = saveNewsForm(s.file, { id: topic.id, want: WANT, at: '09:15', days: 'monday' })
    assert.equal(back.ok, true)
    const after = loadTopics(s.file)
    assert.equal(after.length, 2)
    assert.equal(after[0].id, topic.id)
    assert.equal(after[0].want, WANT)
    assert.equal(after[0].name, '网络安全新产品')
    assert.equal(after[0].at, '09:15')
    assert.equal(after[1].want, WANT2, '别的那项不动')
    // 清空：存得下，关着
    const cleared = saveNewsForm(s.file, { id: topic.id, want: '' })
    assert.equal(cleared.ok, true)
    assert.equal(loadTopics(s.file)[0].enabled, false)
    // 没有这一项
    assert.equal(saveNewsForm(s.file, { id: 't-nope', want: WANT }).ok, false)
  } finally {
    s.done()
  }
})

test('改一项：超过 500 字存不上，也不写盘；频率和时间写错了照原来的存', () => {
  const s = stage()
  try {
    const { topic } = saveNewsForm(s.file, { want: WANT, at: '08:30', days: 'weekdays' })
    const long = saveNewsForm(s.file, { id: topic.id, want: '字'.repeat(501) })
    assert.equal(long.ok, false)
    assert.equal(loadTopics(s.file)[0].want, WANT)
    saveNewsForm(s.file, { id: topic.id, want: WANT, at: '25:99', days: '乱写' })
    assert.equal(loadTopics(s.file)[0].at, '08:30')
    assert.equal(loadTopics(s.file)[0].days, 'weekdays')
  } finally {
    s.done()
  }
})

test('起名字：模型给的名字只在那句话没变时换上，换上以后不用再问', () => {
  const s = stage()
  try {
    const { topic } = saveNewsForm(s.file, { want: WANT })
    assert.equal(needsName(loadTopics(s.file)[0]), true, '本地规则那个名字还要问模型')
    // 问的路上用户又改了：不换
    assert.equal(renameTopic(s.file, topic.id, '安全新品', '旧的那句').ok, false)
    assert.equal(loadTopics(s.file)[0].name, '网络安全新产品')
    // 那句话还是问的那句：换上，nameOf 记住
    assert.equal(renameTopic(s.file, topic.id, '安全新品', WANT).ok, true)
    const named = loadTopics(s.file)[0]
    assert.equal(named.name, '安全新品')
    assert.equal(needsName(named), false)
    // 再改那句话：名字先按本地规则顶上，又要问了
    saveNewsForm(s.file, { id: topic.id, want: WANT2 })
    const again = loadTopics(s.file)[0]
    assert.equal(again.name, '新能源车动力电池')
    assert.equal(needsName(again), true)
  } finally {
    s.done()
  }
})

test('名字：用户改了就归用户管；清空回到自动；模型的名字不覆盖；多了的字截掉；不能用的字符去掉', () => {
  const s = stage()
  try {
    const { topic } = saveNewsForm(s.file, { want: WANT })
    // 用户改名：名字归用户管，id 不变
    assert.equal(saveNewsForm(s.file, { id: topic.id, name: '安全新品' }).ok, true)
    const renamed = loadTopics(s.file)[0]
    assert.equal(renamed.name, '安全新品')
    assert.equal(renamed.nameBy, 'user')
    assert.equal(renamed.id, topic.id, 'id 不变')
    assert.equal(needsName(renamed), false, '不用再问模型')
    // 改了名字以后，那句话再改：名字不动
    saveNewsForm(s.file, { id: topic.id, want: WANT2 })
    const again = loadTopics(s.file)[0]
    assert.equal(again.name, '安全新品')
    assert.equal(needsName(again), false)
    // 模型回来的名字不覆盖
    assert.equal(renameTopic(s.file, topic.id, '模型的名字', WANT2).ok, false)
    assert.equal(loadTopics(s.file)[0].name, '安全新品')
    // 超过 8 个字截掉；不能当路径用的字符去掉
    saveNewsForm(s.file, { id: topic.id, name: '一二三四五六七八九十' })
    assert.equal(loadTopics(s.file)[0].name, '一二三四五六七八')
    saveNewsForm(s.file, { id: topic.id, name: 'a/b:c*d' })
    assert.equal(loadTopics(s.file)[0].name, 'abcd')
    // 清空：回到自动，名字按那句话本地起一个，又要问模型
    assert.equal(saveNewsForm(s.file, { id: topic.id, name: '  ' }).ok, true)
    const auto = loadTopics(s.file)[0]
    assert.equal(auto.nameBy, 'auto')
    assert.equal(auto.name, '新能源车动力电池')
    assert.equal(needsName(auto), true)
    // 名字没带（这次没动名字）：名字和归属都不动
    saveNewsForm(s.file, { id: topic.id, want: WANT2 })
    const kept = loadTopics(s.file)[0]
    assert.equal(kept.name, '新能源车动力电池')
    assert.equal(kept.nameBy, 'auto')
    // 新建的时候写了名字：就用它，那句话空着还是不建
    const made = saveNewsForm(s.file, { want: '大模型的新产品', name: '大模型' })
    assert.equal(made.topic.name, '大模型')
    assert.equal(made.topic.nameBy, 'user')
    assert.equal(saveNewsForm(s.file, { name: '没写想看什么' }).ok, false, '那句话空着不建')
  } finally {
    s.done()
  }
})

test('删一项：只删订阅，已经生成的那几期不动', () => {
  const s = stage()
  try {
    const { topic } = saveNewsForm(s.file, { want: WANT })
    saveNewsForm(s.file, { want: WANT2 })
    const dir = issueDir(s.root, topic, '2026-11-12')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '新闻.md'), '# x\n', 'utf8')
    assert.equal(removeNewsTopic(s.file, topic.id).ok, true)
    assert.deepEqual(loadTopics(s.file).map((one) => one.want), [WANT2])
    assert.equal(statusFacts(s.root, topic, { now: new Date('2026-11-12T10:00:00') }).hasFile, true, '那一期还在')
    assert.equal(removeNewsTopic(s.file, 't-nope').ok, false)
  } finally {
    s.done()
  }
})

test('一份的开关：只改那一项；空着的存不进「开」', () => {
  const s = stage()
  try {
    const a = saveNewsForm(s.file, { want: WANT }).topic
    const b = saveNewsForm(s.file, { want: WANT2 }).topic
    assert.equal(setNewsEnabled(s.file, a.id, false).ok, true)
    assert.deepEqual(loadTopics(s.file).map((one) => one.enabled), [false, true])
    saveNewsForm(s.file, { id: b.id, want: '' })
    setNewsEnabled(s.file, b.id, true)
    assert.equal(loadTopics(s.file)[1].enabled, false)
    assert.equal(setNewsEnabled(s.file, 't-nope', true).ok, false)
  } finally {
    s.done()
  }
})

test('权限开关：整页一个，写到每一个主题上；新加的主题跟它一致；页面上的开关看主题上的', () => {
  const s = stage()
  try {
    saveNewsForm(s.file, { want: WANT })
    saveNewsForm(s.file, { want: WANT2 })
    assert.equal(newsView(s.file, { status: idle }).prefs.permission, 'deny', '默认关')
    assert.equal(setNewsPermission(s.file, true).ok, true)
    assert.deepEqual(loadTopics(s.file).map((one) => one.permission), ['allow', 'allow'])
    saveNewsForm(s.file, { want: '第三个主题的消息' })
    assert.equal(loadTopics(s.file)[2].permission, 'allow', '新加的跟着开')
    assert.equal(newsView(s.file, { status: idle }).prefs.permission, 'allow')
    setNewsPermission(s.file, false)
    assert.deepEqual(loadTopics(s.file).map((one) => one.permission), ['deny', 'deny', 'deny'])
    // 0.4 测试版只写在主题上的「允许」：页面上的开关也显示开着
    const t = stage()
    writeFileSync(t.file, JSON.stringify({ version: 1, topics: [{ id: 't-ai', name: 'AI 行业', want: WANT, permission: 'allow' }] }), 'utf8')
    assert.equal(newsView(t.file, { status: idle }).prefs.permission, 'allow')
    t.done()
  } finally {
    s.done()
  }
})

test('整页：不能订的时候写清楚为什么，能订的时候就能用；没密钥没搜索工具时提醒一句', () => {
  const s = stage()
  try {
    const none = newsView(s.file, { hasKey: false, status: idle })
    assert.equal(none.ready, false)
    assert.equal(none.readyHint, NOT_READY_TEXT)
    assert.equal(none.notice, '没配置 DeepSeek 密钥和搜索工具，可能搜不到新闻')
    const withKey = newsView(s.file, { hasKey: true, status: idle })
    assert.equal(withKey.ready, true)
    assert.equal(withKey.readyHint, '')
    assert.equal(withKey.notice, '')
    assert.equal(newsView(s.file, { hasKey: false, hasSearchTool: true, status: idle }).notice, '')
  } finally {
    s.done()
  }
})

test('整页的数据：每张卡的名字、那句话、频率、时间、开关和状态行；能不能再加', () => {
  const s = stage()
  try {
    saveNewsForm(s.file, { want: WANT, at: '18:05', days: 'monday' })
    saveNewsForm(s.file, { want: WANT2, at: '18:00' })
    const view = newsView(s.file, { hasKey: true, low: s.root, now: THURSDAY, status: idle, runs: { lastRuns: {}, delivered: {} } })
    assert.equal(view.topics.length, 2)
    const [a, b] = view.topics
    assert.equal(a.name, '网络安全新产品')
    assert.equal(a.want, WANT)
    assert.equal(a.at, '18:05')
    assert.equal(a.days, 'monday')
    assert.equal(a.enabled, true)
    assert.equal(a.wantEmpty, false)
    assert.equal(a.status.text, STATUS_NOT_TODAY, '周四：每周一的那份今天不生成')
    assert.equal(b.status.text, STATUS_NOT_YET)
    assert.equal(a.running, false)
    assert.equal(a.look, false)
    assert.equal(view.canAdd, true)
    // 一个都没有
    const fresh = newsView(join(s.root, '没有.json'), { hasKey: true, status: idle })
    assert.deepEqual(fresh.topics, [])
    assert.equal(fresh.canAdd, true)
  } finally {
    s.done()
  }
})

test('整页的数据：正在生成写「正在生成… 已用 …」带开始的时刻，排队的写「排队中」，「看看」先不出', () => {
  const s = stage()
  try {
    const a = saveNewsForm(s.file, { want: WANT }).topic
    const b = saveNewsForm(s.file, { want: WANT2 }).topic
    const started = THURSDAY.getTime() - 80_000
    const status = (id) => (id === a.id ? { state: 'running', at: started, reason: 'now' } : id === b.id ? { state: 'queued', at: started, reason: 'now' } : null)
    const view = newsView(s.file, { hasKey: true, low: s.root, now: THURSDAY, status, runs: { lastRuns: {}, delivered: {} } })
    assert.equal(view.topics[0].running, true)
    assert.equal(view.topics[0].since, started)
    assert.equal(view.topics[0].status.text, '正在生成… 已用 1 分 20 秒')
    assert.equal(view.topics[1].queued, true)
    assert.equal(view.topics[1].status.text, '排队中，等前一个生成完')
  } finally {
    s.done()
  }
})

test('用了多久：一分钟以内只写秒', () => {
  assert.equal(elapsedText(40_000), '40 秒')
  assert.equal(elapsedText(80_000), '1 分 20 秒')
  assert.equal(elapsedText(-5), '0 秒')
})

test('状态行那一句：交了（知道几条就带上）、还没到点、今天不生成、今天没交出来', () => {
  const now = THURSDAY
  const topic = { id: 't-ai', at: '08:30', days: 'daily' }
  const fileTime = new Date('2026-11-12T08:31:00').getTime()
  const done = todayStatus(topic, { now, hasFile: true, fileTime })
  assert.equal(done.text, '今天 08:31 已生成')
  assert.equal(done.tone, 'ok')
  assert.equal(todayStatus(topic, { now, hasFile: true, fileTime, count: 9 }).text, '今天 08:31 已生成 · 9 条')
  assert.equal(todayStatus({ ...topic, at: '18:00' }, { now }).text, STATUS_NOT_YET)
  assert.equal(todayStatus({ ...topic, days: 'monday' }, { now }).text, STATUS_NOT_TODAY)
  assert.equal(todayStatus(topic, { now }).text, STATUS_MISSED)
  assert.equal(todayStatus(topic, { now, missed: true }).text, '未生成：桌伴未运行')
  // 错过了、后来点「立即生成」补上了：说已生成
  assert.equal(todayStatus(topic, { now, missed: true, hasFile: true, fileTime: now.getTime() }).tone, 'ok')
  assert.equal(todayStatus({ ...topic, at: '乱写' }, { now }).text, '')
})

test('时刻写成 HH:mm', () => {
  assert.equal(clockText(new Date('2026-11-12T08:31:00').getTime()), '08:31')
  assert.equal(clockText(new Date('2026-11-12T23:05:00').getTime()), '23:05')
  assert.equal(clockText('乱写'), '')
})

test('今天有没有文件：从内部目录里的 新闻.md 看，文件时间是文件自己的；条数只认今天记的', () => {
  const s = stage()
  try {
    const topic = { id: 't-ai', name: '新闻' }
    const dir = issueDir(s.root, topic, todayString(THURSDAY))
    mkdirSync(dir, { recursive: true })
    const paper = join(dir, '新闻.md')
    writeFileSync(paper, '# 新闻\n', 'utf8')
    const stamp = new Date('2026-11-12T08:31:00').getTime() / 1000
    utimesSync(paper, stamp, stamp)
    const today = { 't-ai': { time: new Date('2026-11-12T08:31:00').getTime(), count: 9 } }
    const facts = statusFacts(s.root, topic, { now: THURSDAY, delivered: today })
    assert.equal(facts.hasFile, true)
    assert.equal(clockText(facts.fileTime), '08:31')
    assert.equal(facts.count, 9)
    const yesterday = { 't-ai': { time: new Date('2026-11-11T08:31:00').getTime(), count: 7 } }
    assert.equal(statusFacts(s.root, topic, { now: THURSDAY, delivered: yesterday }).count, 0)
    assert.equal(statusFacts(s.root, { id: 't-x', name: '别的' }, { now: THURSDAY }).hasFile, false)
  } finally {
    s.done()
  }
})

test('整页里：今天记着错过的那一天，写「未生成：桌伴未运行」；今天有那份就出「看看」', () => {
  const s = stage()
  try {
    const topic = saveNewsForm(s.file, { want: WANT, at: '08:30' }).topic
    markMissed(s.root, topic, '2026-11-12')
    const runs = { lastRuns: {}, delivered: {} }
    assert.equal(newsView(s.file, { low: s.root, now: THURSDAY, status: idle, runs }).topics[0].status.text, '未生成：桌伴未运行')
    const dir = issueDir(s.root, topic, '2026-11-12')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '新闻.md'), '# x\n', 'utf8')
    const view = newsView(s.file, { low: s.root, now: THURSDAY, status: idle, runs })
    assert.equal(view.topics[0].look, true)
    assert.equal(view.topics[0].date, '2026-11-12')
  } finally {
    s.done()
  }
})

test('整页的设置：存进去读得回来，主题不动', () => {
  const s = stage()
  try {
    saveNewsForm(s.file, { want: WANT })
    const back = saveNewsPrefs(s.file, { output: 'window', catchUp: false, notify: false })
    assert.equal(back.ok, true)
    assert.equal(loadNewsPrefs(s.file).notify, false)
    assert.equal(loadNewsPrefs(s.file).output, undefined, '老文件里带过的 output 读到就忽略')
    assert.equal(loadNews(s.file).length, 1)
    assert.equal(newsView(s.file, { status: idle }).prefs.notify, false)
  } finally {
    s.done()
  }
})
