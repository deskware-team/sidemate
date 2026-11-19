// 新闻主题存取：校验、默认、存读、路径、报过的记录。全程只碰临时目录。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_AT,
  DEFAULT_DAYS,
  appendReported,
  issueDates,
  issueDir,
  loadNewsPrefs,
  loadTopics,
  makeTopicId,
  normalizeTopic,
  readReported,
  removeTopic,
  saveNewsPrefs,
  saveTopics,
  topicDir,
  validateTopic,
} from '../../app/news/topics.mjs'
import { dueRuns } from '../../app/news/schedule.mjs'

// 临时目录，用完删掉。
function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-news-topics-'))
}

// 一个能用的主题。
function baseInput(overrides = {}) {
  return {
    name: '科技早报',
    want: 'AI 和硬件的新消息',
    ...overrides,
  }
}

// 造一个主题：产品里加主题走设置页的 saveNewsTopic（test/settings/news.test.mjs 测那条），
// 这里只造数据用。
function mkTopic(overrides = {}) {
  const src = baseInput(overrides)
  return normalizeTopic({ ...src, id: makeTopicId(src.name) })
}

test('主题校验：名字、想看什么、时间', () => {
  const errors = validateTopic({
    name: 'a/b',
    want: '',
    at: '25:00',
  })
  assert.ok(errors.includes('名称含非法字符'))
  assert.ok(errors.includes('内容不合规'))
  assert.ok(errors.includes('时间格式错误'))

  assert.ok(validateTopic({ ...baseInput(), name: '' }).includes('名称不合规'))
  assert.ok(validateTopic({ ...baseInput(), name: '一'.repeat(17) }).includes('名称不合规'))
  assert.ok(validateTopic({ ...baseInput(), want: 'x'.repeat(201) }).includes('内容不合规'))

  // 名字长度按字算，十六个中文字没问题。
  assert.deepEqual(validateTopic(baseInput({ name: '中'.repeat(16) })), [])
  assert.deepEqual(validateTopic(baseInput({ at: '07:30' })), [])
})

test('主题校验：不再要求配来源（新闻是模型自己找的）', () => {
  // 没有来源、没有搜索、没有外部工具，都不算错
  assert.deepEqual(validateTopic(baseInput({ sources: { search: false, rss: [], mcp: [] } })), [])
  assert.deepEqual(validateTopic(baseInput({ sources: undefined })), [])
  // 老主题带过的 rss / search / mcp 读得进来，也不报错
  assert.deepEqual(
    validateTopic(baseInput({ sources: { search: true, rss: [{ url: 'https://a.example.com/rss', siteName: 'a' }], mcp: ['mcp-1'] } })),
    [],
  )
  // 读进来以后不再带着来源：主题里只留名字、想看什么、时间和频率
  const loaded = normalizeTopic({ id: 't-old', name: '老主题', want: 'x', sources: { search: true, rss: [{ url: 'https://a.example.com/rss' }], mcp: [] } })
  assert.equal(loaded.sources, undefined)
})

test('同名主题不能有两个', () => {
  const errors = validateTopic(baseInput(), [baseInput()])
  assert.ok(errors.includes('主题已存在'))
})

test('新主题的默认值', () => {
  const topic = mkTopic({ name: '财经', want: '市场动态' })
  assert.equal(topic.at, DEFAULT_AT)
  assert.equal(topic.at, '08:00')
  assert.equal(topic.enabled, true)
  assert.match(topic.id, /^t-[a-z0-9-]{1,40}$/)
  assert.ok(topic.createdAt)
})

test('主题 id 不重样', () => {
  const first = makeTopicId('科技早报')
  const second = makeTopicId('科技早报', [first])
  assert.notEqual(first, second)
  assert.match(second, /^t-[a-z0-9-]{1,40}$/)
})

test('删主题', () => {
  const added = mkTopic()
  const removed = removeTopic([added], added.id)
  assert.equal(removed.ok, true)
  assert.equal(removed.list.length, 0)
  assert.equal(removeTopic([added], 't-nope').ok, false)
})

test('存和读主题清单', () => {
  const root = tempRoot()
  try {
    const file = join(root, 'topics.json')
    const topic = mkTopic()
    saveTopics(file, [topic])
    const loaded = loadTopics(file)
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0].name, '科技早报')
    assert.equal(loaded[0].id, topic.id)
    assert.equal(loaded[0].sources, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('坏文件当空清单', () => {
  const root = tempRoot()
  try {
    const file = join(root, 'topics.json')
    writeFileSync(file, '{ 这不是 json', 'utf8')
    assert.deepEqual(loadTopics(file), [])
    assert.deepEqual(loadTopics(join(root, '没有这个文件.json')), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('主题目录和每期的目录：都在桌伴数据目录下，按主题 id 分文件夹', () => {
  const root = tempRoot()
  try {
    const topic = mkTopic()
    assert.equal(topicDir(root, topic), join(root, topic.id))
    assert.equal(issueDir(root, topic, '2026-11-12'), join(root, topic.id, '2026-11-12'))

    mkdirSync(issueDir(root, topic, '2026-11-10'), { recursive: true })
    mkdirSync(issueDir(root, topic, '2026-11-12'), { recursive: true })
    mkdirSync(join(topicDir(root, topic), '2026-13-99'), { recursive: true })
    mkdirSync(join(topicDir(root, topic), '随便一个'), { recursive: true })

    const dates = issueDates(root, topic)
    assert.deepEqual(dates, ['2026-11-12', '2026-11-10'])
    // 没有目录的时候给空数组。
    assert.deepEqual(issueDates(root, { id: 't-没有的' }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的：追加、按链接去重、按日期分节', () => {
  const root = tempRoot()
  try {
    const topic = mkTopic()
    appendReported(
      root,
      topic,
      [
        { title: '第一条', url: 'https://a.example.com/1' },
        { title: '重复的', url: 'https://a.example.com/1?utm_source=rss' },
      ],
      '2026-11-12',
    )
    appendReported(root, topic, [{ title: '第二条', url: 'https://b.example.com/2' }], '2026-11-13')

    const items = readReported(root, topic)
    assert.equal(items.length, 2)
    const urls = items.map((item) => item.url)
    assert.ok(urls.includes('https://a.example.com/1'))
    assert.ok(urls.includes('https://b.example.com/2'))

    const raw = readFileSync(join(topicDir(root, topic), 'reported.md'), 'utf8')
    assert.ok(raw.includes('## 2026-11-13'))
    assert.ok(raw.includes('## 2026-11-12'))
    assert.ok(raw.includes('- [第一条](https://a.example.com/1)'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的：只留最近 90 天', () => {
  const root = tempRoot()
  try {
    const topic = mkTopic()
    appendReported(root, topic, [{ title: '很早的', url: 'https://a.example.com/old' }], '2026-01-01')
    appendReported(root, topic, [{ title: '近的', url: 'https://a.example.com/new' }], '2026-11-12')

    const items = readReported(root, topic)
    const titles = items.map((item) => item.title)
    assert.ok(titles.includes('近的'))
    assert.ok(!titles.includes('很早的'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的：没有文件就是空的', () => {
  const root = tempRoot()
  try {
    const topic = mkTopic()
    assert.deepEqual(readReported(root, topic), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('主题能直接交给排期', () => {
  const topic = mkTopic({ at: '08:00' })
  const now = new Date(2026, 10, 12, 9, 0, 0, 0).getTime()
  const due = dueRuns([topic], {}, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].topicId, topic.id)
  assert.equal(due[0].late, true)

  // 关掉的主题不跑。
  const off = { ...topic, enabled: false }
  assert.equal(dueRuns([off], {}, now).length, 0)
})

test('频率：缺省是每天，旧文件里没有这一项也当每天', () => {
  assert.equal(normalizeTopic(baseInput()).days, DEFAULT_DAYS)
  assert.equal(normalizeTopic(baseInput({ days: 'weekdays' })).days, 'weekdays')
  assert.equal(normalizeTopic(baseInput({ days: 'monday' })).days, 'monday')

  const root = tempRoot()
  try {
    const file = join(root, '新闻.json')
    writeFileSync(file, JSON.stringify({ version: 1, topics: [{ id: 't-old', name: '老主题', want: 'x', sources: { search: true }, at: '08:00' }] }), 'utf8')
    const list = loadTopics(file)
    assert.equal(list.length, 1)
    assert.equal(list[0].days, 'daily')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('频率写错了要拦下来', () => {
  const errors = validateTopic(baseInput({ days: '每天' }))
  assert.equal(errors.includes('频率无效'), true)
  assert.deepEqual(validateTopic(baseInput({ days: 'weekdays' })), [])
})

test('老主题里带过的 output（交成什么）读到就丢掉，不报错', () => {
  assert.equal(normalizeTopic(baseInput({ output: 'docx' })).output, undefined)
  assert.equal(normalizeTopic(baseInput({ output: '乱写' })).output, undefined)

  const root = tempRoot()
  try {
    const file = join(root, '新闻.json')
    writeFileSync(file, JSON.stringify({ version: 1, topics: [{ id: 't-old', name: '老主题', want: 'x', sources: { search: true }, at: '08:00', output: 'docx' }] }), 'utf8')
    const list = loadTopics(file)
    assert.equal(list.length, 1)
    assert.equal(list[0].output, undefined)
    assert.deepEqual(validateTopic(list[0]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('整页的设置：缺省是错过补一份、好了说一声；老文件里带过的 output 读到就忽略', () => {
  const root = tempRoot()
  try {
    const file = join(root, '新闻.json')
    assert.deepEqual(loadNewsPrefs(file), { catchUp: true, notify: true })

    // 老文件里带过的 output（交成什么）不再用，读进来不报错也不带出去
    writeFileSync(file, JSON.stringify({ version: 1, topics: [], prefs: { output: 'docx', catchUp: true, notify: true } }), 'utf8')
    assert.deepEqual(loadNewsPrefs(file), { catchUp: true, notify: true })

    const back = saveNewsPrefs(file, { catchUp: false })
    assert.equal(back.ok, true)
    assert.deepEqual(loadNewsPrefs(file), { catchUp: false, notify: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('设置和主题放在同一个文件里：存一边不弄丢另一边', () => {
  const root = tempRoot()
  try {
    const file = join(root, '新闻.json')
    saveNewsPrefs(file, { catchUp: false, notify: false })
    const added = mkTopic()
    saveTopics(file, [added])

    // 存主题以后设置还在。
    assert.deepEqual(loadNewsPrefs(file), { catchUp: false, notify: false })
    // 存设置以后主题还在。
    saveNewsPrefs(file, { catchUp: true, notify: true })
    const list = loadTopics(file)
    assert.equal(list.length, 1)
    assert.equal(list[0].name, added.name)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
