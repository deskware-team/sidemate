// 对话记录：每个任务（每一期新闻）的记录放在它自己那个文件夹的 .sidemate\conversation.json 里；
// 历史列表是扫 tasks\ 和 news\ 扫出来的。开对话、记消息、搜、按天分组、删。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { MAX_MESSAGE_CHARS, conversationFile, createHistory } from '../../app/task/history.mjs'
import { groupByDay, timeLabel } from '../../app/task/history-view.mjs'
import { countPaperItems } from '../../app/news/entry.mjs'
import { PAPER_FILE } from '../../app/news/topics.mjs'

// 每次测试一个自己的临时目录，测完删掉
function tempDir() {
  return mkdtempSync(join(tmpdir(), 'history-test-'))
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true })
}

// 任务文件夹：tasks\ 下 14 位数字的一个文件夹
function taskDir(tasksRoot, name) {
  const dir = join(tasksRoot, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

// 新闻那一期：news\<主题id>\<日期>\
function issueDir(newsRoot, topic, date) {
  const dir = join(newsRoot, topic, date)
  mkdirSync(dir, { recursive: true })
  return dir
}

// 假时钟：想让它走哪就走哪
function fakeClock(startAt) {
  let current = startAt
  const now = () => current
  now.advance = (ms) => {
    current += ms
    return current
  }
  now.set = (at) => {
    current = at
    return current
  }
  return now
}

// 2026 年 11 月 11 日下午 3 点 4 分 5 秒
const BASE = new Date(2026, 10, 11, 15, 4, 5).getTime()

test('start 出来的编号是那个任务文件夹，标题也合适', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const newsDir = join(dir, 'news')
    const history = createHistory({ tasksDir, newsDir, now })
    const workspace = taskDir(tasksDir, '20261111150405')
    const id = history.start({ workspace, prompt: '帮我看下这个表', folder: '工作', folderName: '工作文件夹' })
    assert.equal(id, workspace, '编号就是那个任务文件夹')
    assert.match(basename(id), /^\d{14}$/, '任务文件夹名该是 14 位数字')

    const record = history.get(id)
    assert.equal(record.title, '帮我看下这个表')
    assert.equal(record.folder, '工作')
    assert.equal(record.folderName, '工作文件夹')
    assert.equal(record.kind, 'task')
    assert.equal(record.messages.length, 1)
    assert.equal(record.messages[0].role, 'me')
    assert.equal(record.messages[0].text, '帮我看下这个表')
    assert.equal(record.startedAt, BASE)
    assert.equal(record.updatedAt, BASE)
    // 记录就写在这个任务文件夹的 .sidemate\conversation.json 里
    assert.equal(conversationFile(id), join(id, '.sidemate', 'conversation.json'))
    assert.equal(readFileSync(conversationFile(id), 'utf8').includes('帮我看下这个表'), true)
  } finally {
    cleanup(dir)
  }
})

test('任务名先用第一句话的前 16 个字占位，换行换成空格；dsh 起好名字再换上', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const long = '照这三份材料写一份本周的销售周报，重点写华东区的回款情况'
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: long })
    assert.equal(history.get(id).title, '照这三份材料写一份本周的销售周报')
    assert.equal(Array.from(history.get(id).title).length, 16)

    const multi = history.start({ workspace: taskDir(tasksDir, '20261111150406'), prompt: '第一行\n第二行' })
    assert.equal(history.get(multi).title, '第一行 第二行', '换行应该变成空格')

    // dsh 起好了名字：换掉占位的；一样的、空的不动，也不挪它在列表里的位置
    now.advance(60_000)
    history.setTitle(id, '华东区销售周报')
    assert.equal(history.get(id).title, '华东区销售周报')
    assert.equal(history.get(id).updatedAt, BASE)
    history.setTitle(id, '  ')
    assert.equal(history.get(id).title, '华东区销售周报')
    // 新闻自己给名字：不截
    const news = history.start({
      workspace: issueDir(join(dir, 'news'), 'zhongyi', '11-15'),
      prompt: '国家和各省的中医药政策 · 11-15',
      title: '国家和各省的中医药政策 · 11-15',
      kind: 'news',
    })
    assert.equal(history.get(news).title, '国家和各省的中医药政策 · 11-15')
  } finally {
    cleanup(dir)
  }
})

test('没写要求的对话，标题就叫未命名任务', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '   ' })
    assert.equal(history.get(id).title, '未命名任务')

    const id2 = history.start({ workspace: taskDir(tasksDir, '20261111150406') })
    assert.equal(history.get(id2).title, '未命名任务')
  } finally {
    cleanup(dir)
  }
})

test('say 记下消息并更新时间，空文字不记', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '第一句' })

    now.advance(60000)
    history.say(id, 'it', '回了一句')
    const record = history.get(id)
    assert.equal(record.messages.length, 2)
    assert.equal(record.messages[1].role, 'it')
    assert.equal(record.messages[1].text, '回了一句')
    assert.equal(record.updatedAt, BASE + 60000, '更新时间没动')

    now.advance(1000)
    history.say(id, 'me', '   ')
    assert.equal(history.get(id).messages.length, 2, '空文字不该记')
    assert.equal(history.get(id).updatedAt, BASE + 60000, '空文字不该更新时间')
  } finally {
    cleanup(dir)
  }
})

test('会话、模型和材料文件都能记上，同一个路径不重复加', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '带材料' })

    history.setSession(id, 'sess-1')
    history.setModel(id, { entry: '快', model: 'gpt-x', effort: 'low' })
    history.addFile(id, { name: '表.csv', path: 'C:\\材料\\表.csv' })
    history.addFile(id, { name: '表.csv', path: 'C:\\材料\\表.csv' })
    history.addFile(id, { name: '图.png', path: 'C:\\材料\\图.png' })

    const record = history.get(id)
    assert.equal(record.sessionId, 'sess-1')
    assert.equal(record.model.entry, '快')
    assert.equal(record.model.model, 'gpt-x')
    assert.equal(record.files.length, 2, '同一个路径重复了')
    assert.deepEqual(record.files[0], { name: '表.csv', path: 'C:\\材料\\表.csv' })
  } finally {
    cleanup(dir)
  }
})

test('list 从新到旧，能搜标题、消息和文件名，能筛类型和文件夹', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const newsDir = join(dir, 'news')
    const history = createHistory({ tasksDir, newsDir, now })

    const a = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '写周报', folder: '工作', folderName: '工作文件夹' })
    now.advance(1000)
    const b = history.start({
      workspace: issueDir(newsDir, 'zashi', '11-15'),
      prompt: '看看行情',
      folder: '杂事',
      folderName: '杂事文件夹',
      kind: 'news',
    })
    now.advance(1000)
    history.say(b, 'it', '今天涨了')

    const items = history.list()
    assert.equal(items.length, 2)
    assert.equal(items[0].id, b, '新的应该在前面')
    assert.equal(items[1].id, a)
    assert.equal(items[0].fileCount, 0)

    assert.equal(history.list({ query: '周报' }).length, 1, '搜标题没搜到')
    assert.equal(history.list({ query: '涨了' }).length, 1, '搜消息没搜到')
    assert.equal(history.list({ query: '杂事文件夹' }).length, 1, '搜文件夹名没搜到')

    history.addFile(a, { name: '报表.csv', path: 'C:\\材料\\报表.csv' })
    assert.equal(history.list({ query: '报表' }).length, 1, '搜文件名没搜到')

    assert.equal(history.list({ kind: 'news' }).length, 1)
    assert.equal(history.list({ kind: 'news' })[0].id, b)
    assert.equal(history.list({ kind: 'task' }).length, 1)
    assert.equal(history.list({ folder: '工作' }).length, 1)
    assert.equal(history.list({ folder: '没有的' }).length, 0)
  } finally {
    cleanup(dir)
  }
})

test('用户把任务文件夹删了，历史里就没了这条', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const workspace = taskDir(tasksDir, '20261111150405')
    const id = history.start({ workspace, prompt: '写周报' })
    assert.equal(history.list().length, 1)

    rmSync(workspace, { recursive: true, force: true })
    assert.equal(history.list().length, 0, '文件夹没了，这条历史也没了')
    assert.equal(history.get(id), null)
  } finally {
    cleanup(dir)
  }
})

test('新闻那行的条数：数 新闻.md 里的条目（跟小岛右键菜单同一个数），数不出来给 null', () => {
  const dir = tempDir()
  const tasksDir = join(dir, 'tasks')
  const newsDir = join(dir, 'news')
  try {
    const now = fakeClock(BASE)
    const history = createHistory({ tasksDir, newsDir, now })

    // 一份 新闻.md：两节、三条
    const paper = ['# 新闻', '', '## 今天', '', '**第一条**', '**第二条**', '', '## 进展', '', '**第三条**', ''].join('\n')
    const issue = issueDir(newsDir, 'keji', '11-13')
    const empty = issueDir(newsDir, 'quewenjian', '11-13')
    const bare = issueDir(newsDir, 'meiandongxi', '11-13')
    writeFileSync(join(issue, PAPER_FILE), paper, 'utf8')
    writeFileSync(join(bare, PAPER_FILE), '# 新闻\n\n今日无新内容\n', 'utf8')

    const withPaper = history.start({ workspace: issue, prompt: '国内科技 · 11-13', folder: issue, folderName: '国内科技', kind: 'news' })
    history.say(withPaper, 'it', '今天的新闻正文')
    const noPaper = history.start({ workspace: empty, prompt: '缺文件 · 11-13', folder: empty, folderName: '缺文件', kind: 'news' })
    const noSection = history.start({ workspace: bare, prompt: '没动静 · 11-13', folder: bare, folderName: '没动静', kind: 'news' })
    const task = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '写周报', folder: '工作', folderName: '工作文件夹' })

    const items = history.list({ kind: 'news' })
    const byId = new Map(items.map((one) => [one.id, one]))
    assert.equal(byId.get(withPaper).count, 3, '数的是 新闻.md 里的条目，不是消息条数')
    assert.equal(countPaperItems(paper), 3, '跟菜单那边是同一个数')
    assert.equal(byId.get(noPaper).count, null, '没有 新闻.md 就数不出来')
    assert.equal(byId.get(noSection).count, null, '没有「今天」「进展」两节就数不出来')
    assert.equal(history.get(withPaper).messages.length, 2, '这条对话只有两条消息')
    assert.equal(history.list({ kind: 'task' })[0].count, null, '任务那行不用条数')
    assert.equal(history.get(task).messages.length, 1)
  } finally {
    cleanup(dir)
  }
})

test('groupByDay 分成今天、昨天、MM-DD，跨年写完整日期', () => {
  const now = new Date(2026, 10, 11, 12, 0, 0).getTime()
  const items = [
    { id: 'a', title: '今天第二件', updatedAt: new Date(2026, 10, 11, 9, 0, 0).getTime() },
    { id: 'b', title: '今天第一件', updatedAt: new Date(2026, 10, 11, 10, 0, 0).getTime() },
    { id: 'c', title: '昨天那件', updatedAt: new Date(2026, 10, 10, 10, 0, 0).getTime() },
    { id: 'd', title: '前天那件', updatedAt: new Date(2026, 10, 9, 10, 0, 0).getTime() },
    { id: 'e', title: '去年的', updatedAt: new Date(2025, 9, 20, 10, 0, 0).getTime() },
  ]

  const groups = groupByDay(items, now)
  assert.deepEqual(groups.map((g) => g.label), ['今天', '昨天', '11-09', '2025-10-20'])
  assert.deepEqual(groups[0].items.map((i) => i.id), ['b', 'a'], '组内也要从新到旧')
  assert.deepEqual(groups[1].items.map((i) => i.id), ['c'])
})

test('timeLabel：今天的只写时分，别的写日期和时间', () => {
  const now = new Date(2026, 10, 11, 12, 0, 0).getTime()
  assert.equal(timeLabel(new Date(2026, 10, 11, 9, 5, 0).getTime(), now), '09:05')
  assert.equal(timeLabel(new Date(2026, 10, 10, 9, 5, 0).getTime(), now), '11-10 09:05')
  assert.equal(timeLabel(new Date(2025, 9, 20, 9, 5, 0).getTime(), now), '10-20 09:05')
})

test('坏文件跳过，取也取不到，不报错', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '好的那个' })

    const broken = taskDir(tasksDir, '20260101000000')
    mkdirSync(join(broken, '.sidemate'), { recursive: true })
    writeFileSync(conversationFile(broken), '这不是 JSON', 'utf8')

    const items = history.list()
    assert.equal(items.length, 1, '坏文件不该出现在列表里')
    assert.equal(items[0].id, id)
    assert.equal(history.get(broken), null, '坏文件取出来应该是空')
    assert.equal(history.get(taskDir(tasksDir, '20991231235959')), null, '没有的对话应该是空')
  } finally {
    cleanup(dir)
  }
})

test('编号不对的一律报错，防止拼出目录外的路径', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const history = createHistory({ tasksDir: join(dir, 'tasks'), newsDir: join(dir, 'news'), now })
    assert.throws(() => history.get('../别的'), TypeError)
    assert.throws(() => history.say('../别的', 'me', '你好'), TypeError)
    assert.throws(() => history.remove('../别的'), TypeError)
  } finally {
    cleanup(dir)
  }
})

test('太长的一条消息只留前面', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '开头' })
    const long = '字'.repeat(MAX_MESSAGE_CHARS + 500)
    history.say(id, 'it', long)

    const text = history.get(id).messages[1].text
    assert.equal(text.startsWith('字'.repeat(MAX_MESSAGE_CHARS)), true, '前面的字被截掉了')
    assert.equal(text.endsWith('…（已截断）'), true)
    assert.equal(text.length, MAX_MESSAGE_CHARS + '…（已截断）'.length)
  } finally {
    cleanup(dir)
  }
})

test('remove 删掉对话，文件也没了', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '待删的' })
    assert.equal(history.get(id) !== null, true)

    history.remove(id)
    assert.equal(history.get(id), null)
    assert.equal(history.list().length, 0)
  } finally {
    cleanup(dir)
  }
})

test('setResume 记下接着聊要用的东西，取的时候原样在；乱写的当没有', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const id = history.start({ workspace: taskDir(tasksDir, '20261111150405'), prompt: '写周报' })
    assert.equal(history.get(id).resume, null, '刚开始还没记')

    now.advance(1000)
    const data = {
      place: { kind: 'files', dir: 'C:/任务/x' },
      template: null,
      materials: ['C:/材料/甲.docx'],
      workspace: 'C:/任务/x',
      outputDir: 'C:/任务/x',
      copied: [{ from: 'C:/材料/甲.docx', to: 'C:/任务/x/甲.docx' }],
    }
    history.setResume(id, data)
    let record = history.get(id)
    assert.deepEqual(record.resume, data)
    assert.equal(record.updatedAt, BASE + 1000, '更新时间没动')

    // 再记一遍就是最新的那套：重开时接着用的是最后的工作区
    now.advance(1000)
    history.setResume(id, { ...data, workspace: 'C:/任务/y' })
    record = history.get(id)
    assert.equal(record.resume.workspace, 'C:/任务/y')

    // 不是对象的一律当没有
    history.setResume(id, '乱的')
    assert.equal(history.get(id).resume, null)
    assert.equal(history.setResume(id, null).resume, null)

    // 找不到的对话照别的写法一样报错
    assert.throws(() => history.setResume(taskDir(tasksDir, '20991231235959'), data), Error)
  } finally {
    cleanup(dir)
  }
})

test('存下来的文件是 JSON，字段齐全', () => {
  const dir = tempDir()
  try {
    const now = fakeClock(BASE)
    const tasksDir = join(dir, 'tasks')
    const history = createHistory({ tasksDir, newsDir: join(dir, 'news'), now })
    const workspace = taskDir(tasksDir, '20261111150405')
    const id = history.start({ workspace, prompt: '存一下', folder: '工作', folderName: '工作文件夹' })
    const raw = JSON.parse(readFileSync(conversationFile(workspace), 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.id, id)
    assert.equal(raw.kind, 'task')
    assert.equal(raw.sessionId, null)
    assert.deepEqual(raw.files, [])
    assert.equal(Array.isArray(raw.messages), true)
  } finally {
    cleanup(dir)
  }
})
