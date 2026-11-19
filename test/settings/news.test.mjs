// 「新闻」页的纯逻辑：行显示什么、表单跟主题对象怎么换、能不能订、哪些按钮灰。
// 存取走临时目录里的 news.json（程序数据根目录下），跟 test/settings/models.test.mjs 那一套。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { issueDir, loadTopics, todayString } from '../../app/news/topics.mjs'
import { markMissed } from '../../app/news/missed.mjs'
import {
  EMPTY_TEXT,
  STATUS_MISSED,
  STATUS_NOT_TODAY,
  STATUS_NOT_YET,
  atText,
  clockText,
  daysText,
  failedRows,
  loadNews,
  loadNewsPrefs,
  newsFile,
  newsForm,
  newsRows,
  newsView,
  removeNewsTopic,
  saveNewsPrefs,
  saveNewsTopic,
  setNewsEnabled,
  statusFacts,
  todayStatus,
  topicFromForm,
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

// 一个能存下的主题：只有名字、想看什么、时间和频率
const GOOD = {
  name: 'AI 行业',
  want: '大模型、智能体的新产品和政策，国内为主',
  at: '08:30',
  days: 'daily',
  enabled: true,
}

// 不能订的时候，界面上写的那一句（跟 app/news/ready.mjs 里那一句一样）
const NOT_READY_TEXT = '仅支持 DeepSeek 原生搜索'

test('主题清单放在程序数据根目录下的 news.json', () => {
  const s = stage()
  try {
    assert.equal(s.file, join(s.root, 'news.json'))
    assert.equal(loadNews(s.file).length, 0)
  } finally {
    s.done()
  }
})

test('时间点写成一句话：8:30 → 每天 8:30', () => {
  assert.equal(atText('08:30'), '每天 8:30')
  assert.equal(atText('8:30'), '每天 8:30')
  assert.equal(atText('18:05'), '每天 18:05')
  assert.equal(atText(''), '每天 08:00')
  assert.equal(atText('乱写'), '每天 08:00')
})

test('频率写成一句话：每天、工作日、每周一', () => {
  assert.equal(daysText('daily'), '每天')
  assert.equal(daysText('weekdays'), '工作日')
  assert.equal(daysText('monday'), '每周一')
  assert.equal(daysText('乱写'), '每天')
  assert.equal(atText('09:00', 'weekdays'), '工作日 9:00')
  assert.equal(atText('09:00', 'monday'), '每周一 9:00')
})

test('每行显示：名字、想看什么、隔几天几点、开关和两个按钮', () => {
  const rows = newsRows([
    {
      id: 't-ai',
      name: 'AI 行业',
      want: '大模型、智能体的新产品和政策',
      at: '08:30',
      days: 'weekdays',
      enabled: true,
    },
  ], { ready: true })
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.name, 'AI 行业')
  assert.equal(row.want, '大模型、智能体的新产品和政策')
  assert.equal(row.atText, '工作日 8:30')
  assert.equal(row.summary, '工作日 8:30，大模型、智能体的新产品和政策')
  assert.equal(row.enabled, true)
  assert.deepEqual(row.buttons, [
    { id: 'now', label: '立即生成', disabled: false, title: '' },
    { id: 'edit', label: '修改' },
  ])
})

test('模型不能联网搜时，「现在生成」灰着，主题照样列着', () => {
  const rows = newsRows([{ id: 't-ai', name: 'AI 行业', want: '新东西', at: '08:30' }], {
    ready: false,
    readyHint: NOT_READY_TEXT,
  })
  assert.equal(rows.length, 1, '主题照样列着')
  assert.equal(rows[0].buttons[0].disabled, true, '「现在生成」灰着')
  assert.equal(rows[0].buttons[0].title, NOT_READY_TEXT, '鼠标停上去写着为什么')
  assert.equal(rows[0].buttons[1].disabled, undefined, '「改」不灰')
})

test('整页：不能订的时候写清楚为什么，能订的时候「加一个主题」能用', () => {
  const s = stage()
  try {
    const none = newsView(s.file, { hasKey: false })
    assert.equal(none.ready, false, '没有 DeepSeek 密钥，不能订')
    assert.equal(none.readyHint, NOT_READY_TEXT, '写清楚为什么')
    const withKey = newsView(s.file, { hasKey: true })
    assert.equal(withKey.ready, true, '配了 DeepSeek 密钥就能订')
    assert.equal(withKey.readyHint, '', '能订的时候不写那一句')
    const withTool = newsView(s.file, { hasKey: false, mcpCount: 2 })
    assert.equal(withTool.ready, false, '「能力」里开着工具也不算：只认 DeepSeek 自带的搜索')
  } finally {
    s.done()
  }
})

test('表单跟主题对象互相换：只有名字、想看什么、时间和频率', () => {
  const topic = topicFromForm(GOOD)
  assert.equal(topic.name, 'AI 行业')
  assert.equal(topic.want, GOOD.want)
  assert.equal(topic.at, '08:30')
  assert.equal(topic.days, 'daily')
  // 自动配置权限没写就是拒绝
  assert.equal(topic.permission, 'deny')
  // 主题里不记来源
  assert.equal('sources' in topic, false)

  const form = newsForm({ ...topic, id: 't-ai', enabled: false, days: 'monday' })
  assert.equal(form.id, 't-ai')
  assert.equal(form.name, 'AI 行业')
  assert.equal(form.days, 'monday')
  assert.equal(form.enabled, false)
  assert.equal('rss' in form, false, '表单里没有来源')
  assert.equal('search' in form, false, '表单里没有来源')
})

test('自动配置权限：默认拒绝，选了「允许」就存成 allow；旧的 ask 读成拒绝', () => {
  assert.equal(topicFromForm({ ...GOOD, permission: 'allow' }).permission, 'allow')
  assert.equal(topicFromForm({ ...GOOD, permission: '乱写' }).permission, 'deny')
  assert.equal(topicFromForm({ ...GOOD, permission: 'ask' }).permission, 'deny')
  assert.equal(newsForm({ permission: 'allow' }).permission, 'allow')
  assert.equal(newsForm({}).permission, 'deny')
  const s = stage()
  try {
    const back = saveNewsTopic(s.file, { ...GOOD, permission: 'allow' })
    assert.equal(back.ok, true)
    assert.equal(loadNews(s.file)[0].permission, 'allow')
    // 存下的「允许」读回来还是允许
    assert.equal(loadNews(s.file)[0].permission, 'allow')
  } finally {
    s.done()
  }
})

test('加一个主题：只填名字、想看什么和时间就能存下', () => {
  const s = stage()
  try {
    const back = saveNewsTopic(s.file, GOOD)
    assert.equal(back.ok, true, `存上了：${back.message}`)
    const onDisk = loadTopics(s.file)
    assert.equal(onDisk.length, 1)
    assert.equal(onDisk[0].name, 'AI 行业')
    assert.equal(onDisk[0].at, '08:30')
    assert.equal('sources' in onDisk[0], false, '主题里不再记来源')
    const view = newsView(s.file, { hasKey: true, low: s.root })
    assert.equal(view.count, 1)
    assert.equal(view.empty, false)
    assert.equal(view.rows[0].name, 'AI 行业')
  } finally {
    s.done()
  }
})

test('老清单里带着来源：照常读、照常改，多余的丢掉不报错', () => {
  const s = stage()
  try {
    mkdirSync(s.root, { recursive: true })
    writeFileSync(s.file, JSON.stringify({
      topics: [{
        id: 't-old',
        name: '汽车',
        want: '新车',
        autoFind: true,
        more: ['x'],
        sources: { search: true, rss: [{ url: 'https://feed.example.test/car.xml', siteName: '某站' }], mcp: ['x'], autoFind: true },
        at: '08:30',
        days: 'daily',
        enabled: true,
      }],
    }), 'utf8')
    const list = loadNews(s.file)
    assert.equal(list.length, 1, '读得出来')
    assert.equal('autoFind' in list[0], false, '主题上的多余字段丢掉了')
    const form = newsForm(list[0])
    assert.equal(form.name, '汽车', '老主题照样能打开')
    assert.equal(form.want, '新车')
    assert.equal('rss' in form, false, '表单里没有来源')
    const back = saveNewsTopic(s.file, { ...form, want: '新车和电池' })
    assert.equal(back.ok, true, `改得动：${back.message}`)
    assert.equal(loadNews(s.file)[0].want, '新车和电池')
    assert.equal('sources' in loadNews(s.file)[0], false, '改过以后来源清空了')
  } finally {
    s.done()
  }
})

test('改一个主题：id 不变，改过的存回来', () => {
  const s = stage()
  try {
    const added = saveNewsTopic(s.file, GOOD)
    const id = added.topic.id
    const back = saveNewsTopic(s.file, { ...GOOD, id, name: 'AI 行业新', at: '09:15' })
    assert.equal(back.ok, true)
    const onDisk = loadTopics(s.file)
    assert.equal(onDisk.length, 1)
    assert.equal(onDisk[0].id, id)
    assert.equal(onDisk[0].name, 'AI 行业新')
    assert.equal(onDisk[0].at, '09:15')
  } finally {
    s.done()
  }
})

test('名字重了存不上，也不写盘', () => {
  const s = stage()
  try {
    saveNewsTopic(s.file, GOOD)
    const back = saveNewsTopic(s.file, { ...GOOD, name: 'AI 行业' })
    assert.equal(back.ok, false)
    assert.equal(back.errors.includes('主题已存在'), true)
    assert.equal(loadTopics(s.file).length, 1)
  } finally {
    s.done()
  }
})

test('开关：关掉以后 enabled 变成 false，其它不动', () => {
  const s = stage()
  try {
    const added = saveNewsTopic(s.file, GOOD)
    const back = setNewsEnabled(s.file, added.topic.id, false)
    assert.equal(back.ok, true)
    const onDisk = loadTopics(s.file)
    assert.equal(onDisk[0].enabled, false)
    assert.equal(onDisk[0].name, 'AI 行业')
  } finally {
    s.done()
  }
})

test('删一个主题：清单里没有了，报过的文件不动', () => {
  const s = stage()
  try {
    const added = saveNewsTopic(s.file, GOOD)
    const back = removeNewsTopic(s.file, added.topic.id)
    assert.equal(back.ok, true)
    assert.equal(loadNews(s.file).length, 0)
    const again = removeNewsTopic(s.file, added.topic.id)
    assert.equal(again.ok, false)
  } finally {
    s.done()
  }
})

test('没有主题时页面显示空状态那句话', () => {
  const s = stage()
  try {
    const view = newsView(s.file, { hasKey: false })
    assert.equal(view.empty, true)
    assert.equal(view.count, 0)
    assert.equal(view.emptyText, EMPTY_TEXT)
  } finally {
    s.done()
  }
})

test('第二行末尾的状态：交了、还没到点、今天不生成、今天没交出来', () => {
  // 2026-11-12 是周四
  const now = new Date('2026-11-12T10:00:00')
  const topic = { id: 't-ai', at: '08:30', days: 'daily' }
  // 今天有新闻那份：写上文件的时刻
  const done = todayStatus(topic, { now, hasFile: true, fileTime: new Date('2026-11-12T08:31:00').getTime() })
  assert.equal(done.text, '今天 08:31 已生成')
  assert.equal(done.tone, 'ok')
  // 时间点还没到
  const early = todayStatus({ ...topic, at: '18:00' }, { now })
  assert.equal(early.text, STATUS_NOT_YET)
  // 今天不是它的日子：每周一的主题在周四不生成
  const monday = todayStatus({ ...topic, days: 'monday' }, { now })
  assert.equal(monday.text, STATUS_NOT_TODAY)
  // 到点了，文件却没有
  const missed = todayStatus(topic, { now })
  assert.equal(missed.text, STATUS_MISSED)
  // 到点时桌伴没开着：那一次没生成
  const notRun = todayStatus(topic, { now, missed: true })
  assert.equal(notRun.text, '未生成：桌伴未运行')
  // 错过了、后来点「立即生成」补上了：说已生成，不再说未生成
  const madeUp = todayStatus(topic, { now, missed: true, hasFile: true, fileTime: now.getTime() })
  assert.equal(madeUp.tone, 'ok')
  assert.notEqual(madeUp.text, '未生成：桌伴未运行')
  // 时间点写坏了就没什么可说的
  assert.equal(todayStatus({ ...topic, at: '乱写' }, { now }).text, '')
})

test('时刻写成 HH:mm', () => {
  assert.equal(clockText(new Date('2026-11-12T08:31:00').getTime()), '08:31')
  assert.equal(clockText(new Date('2026-11-12T23:05:00').getTime()), '23:05')
  assert.equal(clockText('乱写'), '')
})

test('今天有没有文件：从内部目录里的 新闻.md 看，文件时间是文件自己的', () => {
  const s = stage()
  try {
    const topic = { id: 't-ai', name: 'AI 行业' }
    const now = new Date('2026-11-12T10:00:00')
    const dir = issueDir(s.root, topic, todayString(now))
    mkdirSync(dir, { recursive: true })
    const paper = join(dir, '新闻.md')
    writeFileSync(paper, '# 新闻\n', 'utf8')
    const stamp = new Date('2026-11-12T08:31:00').getTime() / 1000
    utimesSync(paper, stamp, stamp)
    const facts = statusFacts(s.root, topic, { now })
    assert.equal(facts.hasFile, true)
    assert.equal(clockText(facts.fileTime), '08:31')
    // 没有文件的时候就是没交出来
    const empty = statusFacts(s.root, { id: 't-x', name: '别的' }, { now })
    assert.equal(empty.hasFile, false)
  } finally {
    s.done()
  }
})

test('整页里每行都带着今天那一句状态', () => {
  const s = stage()
  try {
    saveNewsTopic(s.file, { ...GOOD, at: '08:30' })
    const view = newsView(s.file, { hasKey: true, low: s.root, now: new Date('2026-11-12T10:00:00') })
    assert.equal(view.rows.length, 1)
    assert.equal(view.rows[0].status.text, STATUS_MISSED)
  } finally {
    s.done()
  }
})

test('整页里：今天记着错过的那一天，写「未生成：桌伴未运行」', () => {
  const s = stage()
  try {
    saveNewsTopic(s.file, { ...GOOD, at: '08:30' })
    const topic = loadTopics(s.file)[0]
    markMissed(s.root, topic, '2026-11-12')
    const view = newsView(s.file, { hasKey: true, low: s.root, now: new Date('2026-11-12T10:00:00') })
    assert.equal(view.rows[0].status.text, '未生成：桌伴未运行')
  } finally {
    s.done()
  }
})

test('整页：没配密钥、也没搜索工具时，写一句「可能搜不到新闻」', () => {
  const s = stage()
  try {
    saveNewsTopic(s.file, GOOD)
    const none = newsView(s.file, { hasKey: false, hasSearchTool: false, low: s.root })
    assert.equal(none.notice, '没配置 DeepSeek 密钥和搜索工具，可能搜不到新闻')
    // 配了密钥：不写那句
    const keyed = newsView(s.file, { hasKey: true, hasSearchTool: false, low: s.root })
    assert.equal(keyed.notice, '')
    // 开了搜索工具：也不写
    const tooled = newsView(s.file, { hasKey: false, hasSearchTool: true, low: s.root })
    assert.equal(tooled.notice, '')
  } finally {
    s.done()
  }
})

test('失败：这一行第二行末尾用红字写那句话', () => {
  const rows = newsRows([{ id: 't-1', name: 'AI 行业', want: '新东西', at: '08:30' }], { ready: true })
  const failed = failedRows(rows, 't-1', '模型没交出选题')
  assert.equal(failed[0].status.text, '模型没交出选题')
  assert.equal(failed[0].status.tone, 'bad')
})

test('整页的设置：存进去读得回来，主题不动', () => {
  const s = stage()
  try {
    const back = saveNewsPrefs(s.file, { output: 'window', catchUp: false, notify: true })
    assert.equal(back.ok, true)
    // 老文件里带过的 output 读到就忽略，不报错
    assert.deepEqual(loadNewsPrefs(s.file), { catchUp: false, notify: true })
    const added = saveNewsTopic(s.file, GOOD)
    assert.equal(added.ok, true)
    assert.deepEqual(loadNewsPrefs(s.file), { catchUp: false, notify: true })
    assert.equal(loadNews(s.file).length, 1)
  } finally {
    s.done()
  }
})

test('主题能选隔几天跑：工作日、每周一', () => {
  const s = stage()
  try {
    const added = saveNewsTopic(s.file, { ...GOOD, days: 'weekdays' })
    assert.equal(added.ok, true)
    assert.equal(added.topic.days, 'weekdays')
    const onDisk = loadTopics(s.file)
    assert.equal(onDisk[0].days, 'weekdays')
    const again = saveNewsTopic(s.file, { ...GOOD, id: added.topic.id, days: 'monday' })
    assert.equal(again.ok, true)
    assert.equal(loadTopics(s.file)[0].days, 'monday')
  } finally {
    s.done()
  }
})

test('整页的数据里带着那两项设置', () => {
  const s = stage()
  try {
    const view = newsView(s.file, { hasKey: false })
    assert.deepEqual(view.prefs, { catchUp: true, notify: true })
  } finally {
    s.done()
  }
})
