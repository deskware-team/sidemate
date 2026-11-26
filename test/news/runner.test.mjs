// 新闻生成的流水线：模型自己找、链接不再核对、排版、报过的、历史、排队。
// 跑的是假模型和假事件：不起 dsh、不联网、不碰真的桌伴目录。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createNewsRunner } from '../../app/news/runner.mjs'
import { onStatusChange, resetStatus, statusOf } from '../../app/news/status.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { restoreTask } from '../../app/task/history-open.mjs'

// 2026 年 11 月 12 日早上 8 点整
const BASE = new Date(2026, 10, 12, 8, 0, 0).getTime()
const DATE = '2026-11-12'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-newsrun-'))
}

// 一个标准主题
function topic(patch = {}) {
  // nameOf 跟 want 一致：名字是照这句话起好的（不然读的时候会按本地规则重起）
  const one = {
    id: 't-ai',
    name: 'AI 行业',
    want: '只关心模型发布和融资',
    at: '08:00',
    days: 'daily',
    enabled: true,
    ...patch,
  }
  return { nameOf: one.want, ...one }
}

// 主题和整页设置写进 新闻.json
function setup(root, { topics = [topic()], prefs = { catchUp: true, notify: true }, version = 2 } = {}) {
  writeFileSync(join(root, '新闻.json'), JSON.stringify({ version, topics, prefs }), 'utf8')
}

// 算得通的模型选项
const goodModel = () => ({
  ok: true,
  apiKey: 'test-key',
  env: {},
  patchTexts: [],
  model: { value: '["deepseek","chat"]', effort: null },
  vendor: '测试通道',
  free: false,
})

// 模型交的选题：每条带 url / site / headline / note
const SELECTION = {
  summary: '一件模型发布值得看，其余是融资。',
  today: [
    { url: 'https://a.example/news/new-model', site: '甲站', headline: '甲厂发了新模型', note: '能耗降三成。' },
    { url: 'https://b.example/news/funding', site: '乙站', headline: '乙厂融到钱', note: 'B 轮。' },
  ],
  progress: [],
}

// 假 runTask：按剧本交选题。
// 剧本里可以给 json（回话里交）、reply（原话）。
function fakeRunTask({ rounds = [{ json: SELECTION }] } = {}) {
  const calls = []
  const factory = (options) => {
    calls.push(options)
    const plan = rounds[Math.min(calls.length - 1, rounds.length - 1)] ?? {}
    const handle = {
      sessionId: 'news-session-1',
      cancel() {},
      done: (async () => {
        if (plan.json !== undefined) {
          options.onEvent?.({ type: 'reply', text: '```json\n' + JSON.stringify(plan.json, null, 2) + '\n```' })
        } else if (plan.reply !== undefined) {
          options.onEvent?.({ type: 'reply', text: plan.reply })
        }
        return { type: 'end', taskId: options.taskId, at: Date.now(), status: 'done' }
      })(),
    }
    return handle
  }
  factory.calls = calls
  return factory
}

function makeRunner(root, overrides = {}) {
  const history = createHistory({ tasksDir: join(root, 'tasks'), newsDir: root, now: () => BASE })
  const logs = overrides.logs ?? []
  const runner = createNewsRunner({
    root,
    // 接着问产出的文件交到这里下面：测试里拿临时目录演 ~/桌伴
    outputRoot: join(root, '桌伴'),
    topicsFile: join(root, '新闻.json'),
    now: () => BASE,
    model: overrides.model ?? goodModel,
    runTask: overrides.runTask ?? fakeRunTask(),
    history,
    log: (name, data) => logs.push({ name, data }),
    ...(overrides.onDone ? { onDone: overrides.onDone } : {}),
    ...(overrides.runsFile ? { runsFile: overrides.runsFile } : {}),
  })
  return { runner, history, logs }
}

// 那一期生成的文件都在这里：<low>/新闻/<主题id>/<日期>
const issueDirOf = (root) => join(root, 't-ai', DATE)
const paperPath = (root) => join(issueDirOf(root), '新闻.md')
// 报过的记在主题那一层：<low>/新闻/<主题id>/reported.md
const reportedPath = (root) => join(root, 't-ai', 'reported.md')

test('生成一份：模型自己找，文件都在内部目录', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const paper = readFileSync(paperPath(root), 'utf8')
    // 标题主题和日期之间空一格，不用「·」
    assert.match(paper, new RegExp(`^# AI 行业 ${DATE} 新闻\\n`))
    assert.match(paper, /\*\*甲厂发了新模型\*\*/)
    assert.match(paper, /\*\*乙厂融到钱\*\*/)
    // 来源行：网站名带链接
    assert.match(paper, /来源：甲站 \[甲厂发了新模型\]\(https:\/\/a\.example\/news\/new-model\)/)
    // 两个不同的网站 → 共参考 2 个来源
    assert.match(paper, /共参考 2 个来源/)
    // ~/桌伴（测试里的 outputRoot）下什么都不出
    assert.equal(existsSync(join(root, '桌伴')), false)
    assert.deepEqual(result.files, [])
    assert.equal(result.items, 2)
    assert.equal(result.message, '新闻已生成，共 2 条')
    // 新闻的名字是「主题 日期」：不让 dsh 多调一次模型起名字
    assert.equal(runTask.calls[0].title, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('用户自己按下停止：说「已停止」，不是错，不带错误码', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = (options) => ({
      sessionId: 'news-session-1',
      cancel() {},
      done: (async () => ({ type: 'end', taskId: options.taskId, at: Date.now(), status: 'cancelled' }))(),
    })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '已停止')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('今天的文件夹建不起来：说那一句，带 Si206', async () => {
  const root = tempRoot()
  try {
    setup(root)
    // 那一天的文件夹已经是个文件了：建不出来
    mkdirSync(join(root, 't-ai'), { recursive: true })
    writeFileSync(join(root, 't-ai', DATE), '占位', 'utf8')
    const { runner } = makeRunner(root)
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '路径不可用 · Si206 错误')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('新闻这一轮用默认模型：不传条目', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask()
    let asked = '没问过'
    const { runner } = makeRunner(root, {
      runTask,
      model: (choice) => {
        asked = choice
        return goodModel()
      },
    })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(asked, null, '不传条目，走默认模型')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('那一项的权限选「允许」：这一轮拿完全访问；默认（拒绝）不拿', async () => {
  const root = tempRoot()
  try {
    setup(root, { topics: [topic({ permission: 'allow' })] })
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    await runner.generate('t-ai')
    assert.equal(runTask.calls[0].fullAccess, true, '允许：完全访问')
    // 清单里永远只有一项：换成默认拒绝的那一项再跑一次
    setup(root, { topics: [topic({ id: 't-car', name: '汽车' })] })
    await runner.generate('t-car')
    assert.equal(runTask.calls[1].fullAccess, false, '默认的拒绝：不拿完全访问')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('老主题带 sources.rss 也能读：不抓 RSS，话里没有条目和编号', async () => {
  const root = tempRoot()
  try {
    setup(root, { topics: [topic({ sources: { search: true, rss: [{ url: 'https://a.example/feed' }] } })] })
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    // 没有 RSS 条目文件了
    assert.equal(existsSync(join(issueDirOf(root), 'RSS 条目.md')), false)
    const prompt = runTask.calls[0].prompt
    assert.doesNotMatch(prompt, /RSS/)
    assert.doesNotMatch(prompt, /\[1\]|\[编号\]/)
    // 话里也不提抓源
    assert.doesNotMatch(prompt, /抓|订阅源|feed/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('模型交的链接不再核对：没在工具里见过的也收', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '两件事。',
      today: [
        { url: 'https://a.example/news/new-model', site: '甲站', headline: '甲厂发了新模型', note: '能耗降三成。' },
        { url: 'https://made-up.example/news/never-seen', site: '丙站', headline: '编出来的一条', note: '这条没真见过。' },
      ],
      progress: [],
    }
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const paper = readFileSync(paperPath(root), 'utf8')
    assert.match(paper, /\*\*甲厂发了新模型\*\*/)
    // 不再核对：没在工具里见过的链接也收
    assert.match(paper, /\*\*编出来的一条\*\*/)
    assert.match(paper, /made-up\.example/)
    assert.equal(result.items, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('链接写法不一样算同一个：去片段、去末尾斜杠、域名小写', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '一条。',
      today: [
        { url: 'https://A.Example/news/new-model#正文', site: '甲站', headline: '甲厂发了新模型', note: '' },
      ],
      progress: [],
    }
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(result.items, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('交上来的链接一条都挑不出来：说没找到，不补一轮', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const fake = { summary: '', today: [{ url: '不是链接', site: '丙站', headline: '编的', note: '' }], progress: [] }
    const runTask = fakeRunTask({ rounds: [{ json: fake }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '新闻未找到 · Si805 错误')
    // 不补一轮：只跑了一次
    assert.equal(runTask.calls.length, 1)
    assert.equal(existsSync(paperPath(root)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('给模型的话：让它自己找，不说不用联网，话里没有具体网址', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(runTask.calls.length, 1)
    const prompt = runTask.calls[0].prompt
    // 主题名不单列进话里（名字是从那句话总结的，写两样模型会当成两个要求）
    assert.doesNotMatch(prompt, /AI 行业/)
    assert.match(prompt, /想看什么：只关心模型发布和融资/)
    assert.match(prompt, /只关心模型发布和融资/)
    assert.match(prompt, new RegExp(DATE))
    // 自己找、自己打开原文
    assert.match(prompt, /自己找/)
    assert.match(prompt, /联网搜/)
    assert.match(prompt, /打开/)
    // 不再说不许用工具、不许联网
    assert.doesNotMatch(prompt, /不用调任何工具/)
    assert.doesNotMatch(prompt, /联网搜索这次也?不用/)
    assert.doesNotMatch(prompt, /不允许/)
    // 话里不放任何网址，也不放具体网站名
    assert.doesNotMatch(prompt, /https?:\/\//)
    assert.doesNotMatch(prompt, /甲站|乙站|丙站/)
    // 交法说清了：每条带链接，链接得是自己搜到或打开过的
    assert.match(prompt, /url/)
    assert.match(prompt, /只能写这一轮你自己搜到或打开过的那个链接/)
    assert.match(prompt, /```json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的贴进话里：只给标题，不带链接', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const reported = ['# Reported', '', '## 2026-11-11', '', '- [上周报过的旧事](https://a.example/old/1)', '']
    mkdirSync(join(root, 't-ai'), { recursive: true })
    writeFileSync(join(root, 't-ai', 'reported.md'), reported.join('\n'), 'utf8')
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const prompt = runTask.calls[0].prompt
    assert.match(prompt, /## 报过的（这些以前报过，别再当新事报）/)
    assert.match(prompt, /- 上周报过的旧事/)
    assert.doesNotMatch(prompt, /a\.example\/old/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('共看了几个来源：留下的条目里不同的网站数', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '三件事。',
      today: [
        { url: 'https://a.example/1', site: '甲站', headline: '一条', note: '' },
        { url: 'https://a.example/2', site: '甲站', headline: '两条', note: '' },
        { url: 'https://b.example/3', site: '乙站', headline: '三条', note: '' },
      ],
      progress: [],
    }
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.match(readFileSync(paperPath(root), 'utf8'), /共参考 2 个来源/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的去重按归一化的 url：同一个链接只记一次', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '两件事，其实是同一个链接。',
      today: [
        { url: 'https://a.example/1', site: '甲站', headline: '一条', note: '' },
        { url: 'https://a.example/1/#正文', site: '甲站', headline: '同一条又来一遍', note: '' },
      ],
      progress: [],
    }
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(result.items, 1)
    const reported = readFileSync(reportedPath(root), 'utf8')
    assert.equal((reported.match(/https?:\/\//g) || []).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('进展那一节照旧：报过的出了新进展才写进去', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '一件新的，一件有进展。',
      today: [
        { url: 'https://a.example/news/new-model', site: '甲站', headline: '甲厂发了新模型', note: '能耗降三成。' },
      ],
      progress: [
        { url: 'https://b.example/news/funding', site: '乙站', headline: '乙厂融到钱', note: '换了领投。' },
      ],
    }
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(result.items, 2)
    const paper = readFileSync(paperPath(root), 'utf8')
    assert.match(paper, /## 今天/)
    assert.match(paper, /## 进展/)
    assert.match(paper, /\*\*乙厂融到钱\*\*/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('模型交了空的：只写「今日无新内容」，什么都不记', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask({ rounds: [{ json: { summary: '', today: [], progress: [] } }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(result.items, 0)
    assert.equal(result.message, '今日无新内容')
    // 没交过东西就不补一轮
    assert.equal(runTask.calls.length, 1)
    const paper = readFileSync(paperPath(root), 'utf8')
    assert.match(paper, /今日无新内容/)
    assert.doesNotMatch(paper, /共参考/)
    assert.equal(existsSync(reportedPath(root)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('模型没交出选题：整份失败，不交半成品', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask({ rounds: [{ reply: '我随便说两句' }] })
    const { runner, history } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '选题为空 · Si806 错误')
    assert.deepEqual(result.files, [])
    assert.equal(existsSync(paperPath(root)), false)
    assert.equal(existsSync(reportedPath(root)), false)
    const record = history.get(result.historyId)
    assert.equal(record.kind, 'news')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('没模型可用时失败，不抛异常，也不起任务', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, {
      runTask,
      model: () => ({ ok: false, reason: 'key', code: 'Si101', stop: 'noKey', message: '还没填 DeepSeek 的密钥' }),
    })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '还没填 DeepSeek 的密钥 · Si101 错误')
    assert.equal(runTask.calls.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('历史里多一条 kind news：它说的就是那页新闻全文，historyId 一致', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const dones = []
    const { runner, history } = makeRunner(root, { onDone: (result) => dones.push(result) })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const list = history.list({ kind: 'news' })
    assert.equal(list.length, 1)
    assert.equal(result.historyId, list[0].id)
    assert.equal(dones.length, 1)
    const record = history.get(list[0].id)
    assert.equal(record.title, 'AI 行业 11-12')
    assert.equal(record.folder, issueDirOf(root))
    assert.equal(record.sessionId, 'news-session-1')
    assert.equal(record.resume.outputDir, join(root, '桌伴', 'news', 't-ai'))
    const said = record.messages.filter((one) => one.role === 'it').map((one) => one.text).join('\n')
    assert.equal(said, readFileSync(paperPath(root), 'utf8'))
    // 接着问要的东西能拼回来
    const back = restoreTask(record)
    assert.equal(back.workspace, issueDirOf(root))
    assert.equal(back.news, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('写新闻.md 失败：前一句是「生成失败」，英文报错只在原文那一截', async () => {
  const root = tempRoot()
  try {
    setup(root)
    // 新闻.md 的位置上先放一个同名文件夹：写盘时报 EISDIR
    mkdirSync(paperPath(root), { recursive: true })
    const logs = []
    const { runner } = makeRunner(root, { logs })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.match(result.message, /^生成失败 · Si901 错误，E[A-Z]+: /)
    assert.ok(logs.some((one) => one.name === 'error-code' && /E[A-Z]+: /.test(JSON.stringify(one.data))), '原文进了日志')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('没有这个主题：失败，不进历史，historyId 为空', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const { runner, history } = makeRunner(root)
    const result = await runner.generate('t-none')
    assert.equal(result.ok, false)
    assert.equal(result.message, '主题不存在 · Si111 错误')
    assert.equal(result.historyId, null)
    assert.deepEqual(history.list({ kind: 'news' }), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// 第一个起来的那一轮卡在 gate 上，后面起来的直接跑完
function gatedRunTask(gate, order) {
  let first = true
  const calls = []
  const runTask = (options) => {
    const is = first
    first = false
    calls.push(options)
    return {
      sessionId: 'news-session-1',
      cancel() {},
      done: (async () => {
        if (is) {
          await gate
          order.push(`first done ${options.taskId}`)
        } else {
          order.push(`second ran ${options.taskId}`)
        }
        options.onEvent?.({ type: 'reply', text: '```json\n' + JSON.stringify(SELECTION) + '\n```' })
        return { type: 'end', taskId: options.taskId, at: Date.now(), status: 'done' }
      })(),
    }
  }
  runTask.calls = calls
  return runTask
}

test('0.3 的清单里两个主题：两个都留着，那句话写成「名字：想看什么」，各跑各的（0.4 无感升级）', async () => {
  const root = tempRoot()
  try {
    setup(root, { topics: [topic(), topic({ id: 't-car', name: '汽车', want: '新车和降价' })], version: 1 })
    const runTask = fakeRunTask()
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-car')
    assert.equal(result.ok, true)
    const raw = JSON.parse(readFileSync(join(root, '新闻.json'), 'utf8'))
    assert.equal(raw.topics.length, 2, '两个主题都在')
    assert.deepEqual(raw.topics.map((one) => one.want), ['AI 行业：只关心模型发布和融资', '汽车：新车和降价'])
    assert.deepEqual(raw.topics.map((one) => one.name), ['AI 行业', '汽车'], '名字还是用户原来起的')
    assert.ok(existsSync(join(root, '新闻.json.bak-0.4')), '原来的清单备份了')
    // 给模型的话里只有那句话，没有单列的主题名
    assert.match(runTask.calls[0].prompt, /想看什么：汽车：新车和降价/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('一次只跑一个主题：第二个排队，状态里写着谁在跑、谁在排；跑完记下出了几条', async () => {
  const root = tempRoot()
  resetStatus()
  try {
    setup(root, { topics: [topic(), topic({ id: 't-car', name: '汽车', want: '新车和降价' })] })
    let release = null
    const gate = new Promise((resolve) => { release = resolve })
    const runTask = gatedRunTask(gate, [])
    const runsFile = join(root, 'news-run.json')
    const { runner } = makeRunner(root, { runTask, runsFile })
    const seen = []
    onStatusChange((snap) => seen.push(snap))
    const first = runner.generate('t-ai', { reason: 'now' })
    const second = runner.generate('t-car', { reason: 'now' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(runTask.calls.length, 1, '第二个还没开始')
    assert.equal(statusOf('t-ai').state, 'running')
    assert.equal(statusOf('t-ai').reason, 'now')
    assert.equal(statusOf('t-car').state, 'queued')
    release()
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    assert.equal(runTask.calls.length, 2)
    assert.equal(statusOf('t-ai'), null)
    assert.equal(statusOf('t-car'), null)
    assert.ok(seen.some((snap) => snap.ended?.topicId === 't-ai' && snap.ended.ok === true), '跑完那次通知里带着结果')
    const runs = JSON.parse(readFileSync(runsFile, 'utf8'))
    assert.equal(runs.delivered['t-ai'].count, a.items)
  } finally {
    resetStatus()
    rmSync(root, { recursive: true, force: true })
  }
})

test('起名字：把那句话交给模型，回来的字收拾干净；没模型、超时都给空串', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const calls = []
    const runTask = (options) => {
      calls.push(options)
      queueMicrotask(() => options.onEvent?.({ type: 'reply', text: '「网络安全新产品」。' }))
      return { done: Promise.resolve({ status: 'done' }), cancel() {} }
    }
    const { runner } = makeRunner(root, { runTask })
    assert.equal(await runner.askName('网络安全的新产品'), '网络安全新产品')
    assert.match(calls[0].prompt, /4 到 8 个字的主题名/)
    assert.match(calls[0].prompt, /网络安全的新产品/)
    assert.equal(calls[0].title, false, '不让 dsh 另起会话名')
    assert.equal(calls[0].mcpServers, undefined, '不挂外部工具')
    // 没模型
    const none = makeRunner(root, { runTask, model: () => ({ ok: false }) }).runner
    assert.equal(await none.askName('网络安全的新产品'), '')
    // 超时：停掉那一轮，给空串
    let cancelled = false
    const slow = makeRunner(root, { runTask: () => ({ done: new Promise(() => {}), cancel() { cancelled = true } }) }).runner
    assert.equal(await slow.askName('网络安全的新产品', { timeoutMs: 20 }), '')
    assert.equal(cancelled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('同一个主题定时在跑，又点了「现在生成」：回那一次的结果，不在同一个文件夹里再跑一份', async () => {
  const root = tempRoot()
  try {
    setup(root)
    let release = null
    const gate = new Promise((resolve) => { release = resolve })
    const order = []
    const runTask = gatedRunTask(gate, order)
    const { runner } = makeRunner(root, { runTask })
    const scheduled = runner.generate('t-ai', { reason: 'schedule' })
    const now = runner.generate('t-ai', { reason: 'now' })
    assert.equal(now, scheduled, '回的是同一次')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(runTask.calls.length, 1, 'dsh 只起了一次')
    release()
    const [a, b] = await Promise.all([scheduled, now])
    assert.equal(a.ok, true)
    assert.equal(b, a)
    // 跑完了再点：照常再生成一份
    const again = await runner.generate('t-ai', { reason: 'now' })
    assert.equal(again.ok, true)
    assert.equal(runTask.calls.length, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
