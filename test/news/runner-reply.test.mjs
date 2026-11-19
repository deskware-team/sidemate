// 回话里交 JSON 的那一路：模型不读不写文件，把选题 JSON 放在回话的 ```json 代码块
// （或裸 { … }）里交回来；占位照抄的当没给；工作区里不再写「reported.md」。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createNewsRunner } from '../../app/news/runner.mjs'

// 2026 年 11 月 12 日早上 8 点整
const BASE = new Date(2026, 10, 12, 8, 0, 0).getTime()
const DATE = '2026-11-12'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-newsreply-'))
}

function topic(patch = {}) {
  return {
    id: 't-ai',
    name: 'AI 行业',
    want: '只关心模型发布和融资',
    at: '08:00',
    days: 'daily',
    enabled: true,
    ...patch,
  }
}

function setup(root, { topics = [topic()], prefs = { catchUp: true, notify: true } } = {}) {
  writeFileSync(join(root, '新闻.json'), JSON.stringify({ version: 1, topics, prefs }), 'utf8')
}

const goodModel = () => ({
  ok: true,
  apiKey: 'test-key',
  env: {},
  patchTexts: [],
  model: { value: '["deepseek","chat"]', effort: null },
  vendor: '测试通道',
  free: false,
})

// 一份像样的选题
const SELECTION = {
  summary: '一件模型发布值得看。',
  today: [
    { url: 'https://a.example/news/new-model', site: '甲站', headline: '甲厂发了新模型', note: '能耗降三成。' },
    { url: 'https://b.example/news/funding', site: '乙站', headline: '乙厂融到钱', note: 'B 轮。' },
  ],
  progress: [],
}

// 假 runTask：每一轮的剧本 rounds[n] 是——
//   { json: 值 } —— 通过 onEvent reply 回一个 ```json 代码块
//   { reply: '话' } —— 原样回话
function fakeRunTask({ rounds, say = '' } = {}) {
  const calls = []
  const factory = (options) => {
    calls.push(options)
    const plan = rounds[Math.min(calls.length - 1, rounds.length - 1)]
    const handle = {
      sessionId: 'news-session-1',
      cancel() {},
      done: (async () => {
        if (typeof plan.check === 'function') plan.check(options)
        if (plan.json !== undefined) {
          if (options.onEvent && say) options.onEvent({ type: 'reply', text: say })
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
  const logs = overrides.logs ?? []
  const runner = createNewsRunner({
    root,
    topicsFile: join(root, '新闻.json'),
    now: () => BASE,
    model: goodModel,
    runTask: overrides.runTask,
    hasSearchKey: () => true,
    log: (name, data) => logs.push({ name, data }),
  })
  return { runner, logs }
}

const paperPath = (root) => join(root, 't-ai', DATE, '新闻.md')

test('回话里回一个 ```json 代码块：不用写文件也能成', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask({ rounds: [{ json: SELECTION }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(runTask.calls.length, 1)
    // 模型一个字都没写进工作区，照样排出了页
    assert.equal(existsSync(join(root, 't-ai', DATE, 'reported.md')), false)
    assert.equal(result.items, 2)
    assert.equal(result.message, '新闻已生成，共 2 条')
    const reported = readFileSync(join(root, 't-ai', 'reported.md'), 'utf8')
    assert.equal((reported.match(/https?:\/\//g) || []).length, 2)
    const paper = readFileSync(paperPath(root), 'utf8')
    assert.match(paper, /\*\*甲厂发了新模型\*\*/)
    assert.match(paper, /一件模型发布值得看。/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('回话里只给裸 { … } 片段也能读：夹在两句话中间都行', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask({
      rounds: [{
        reply: `好的，我挑好了，json 在下面：\n${JSON.stringify(SELECTION)}\n有问题随时说。`,
      }],
    })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(runTask.calls.length, 1)
    assert.match(readFileSync(paperPath(root), 'utf8'), /\*\*乙厂融到钱\*\*/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('回话里有好几个代码块时取最后一个', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const bad = '{ "summary": "先试一版", "today": []'
    const runTask = fakeRunTask({
      rounds: [{ reply: `先想了一半：\n\`\`\`json\n${bad}\n\`\`\`\n改好了，用这份：\n\`\`\`json\n${JSON.stringify(SELECTION)}\n\`\`\`` }],
    })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    assert.equal(runTask.calls.length, 1)
    assert.match(readFileSync(paperPath(root), 'utf8'), /\*\*甲厂发了新模型\*\*/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('占位当没给：summary 和「…」的 note 不印，记 placeholder-dropped', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const selection = {
      summary: '…',
      today: [
        { url: 'https://a.example/news/new-model', site: '甲站', headline: '甲厂发了新模型', note: '…' },
        { url: 'https://b.example/news/funding', site: '乙站', headline: '…', note: '用一两句话说清这条为什么跟「只关心模型发布和融资」有关' },
      ],
      progress: [],
    }
    const logs = []
    const runTask = fakeRunTask({ rounds: [{ json: selection }] })
    const { runner } = makeRunner(root, { runTask, logs })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const paper = readFileSync(paperPath(root), 'utf8')
    // summary 是「…」：不印
    assert.doesNotMatch(paper, /…/)
    // headline 是占位：不印标题；note 是「…」或照抄骨架说明：不印
    assert.doesNotMatch(paper, /用一两句话说清这条为什么跟/)
    // news.log 记了条数
    const dropped = logs.find((one) => one.name === 'placeholder-dropped')
    assert.ok(dropped, '该记一条 placeholder-dropped')
    assert.equal(dropped.data.count, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('第一轮回话里回 []：不补一轮，整份失败', async () => {
  const root = tempRoot()
  try {
    setup(root)
    const runTask = fakeRunTask({ rounds: [{ json: [] }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, false)
    assert.equal(result.message, '选题为空 · Si806 错误')
    // 不补一轮：只跑了一次
    assert.equal(runTask.calls.length, 1)
    assert.equal(existsSync(paperPath(root)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('报过的有 40 条长标题时，给模型的话仍在 12KB 以内', async () => {
  const root = tempRoot()
  try {
    setup(root)
    // 报过的先记 40 条：两天各 20 条，标题里带日期好分辨
    const reportedLines = ['# Reported', '']
    for (const day of ['2026-11-11', '2026-11-10']) {
      reportedLines.push(`## ${day}`, '')
      for (let index = 1; index <= 20; index += 1) {
        reportedLines.push(`- [${day} 报过的第 ${index} 件事，标题也挺长的，占位占位](https://a.example/old/${day}/${index})`)
      }
      reportedLines.push('')
    }
    mkdirSync(join(root, 't-ai'), { recursive: true })
    writeFileSync(join(root, 't-ai', 'reported.md'), reportedLines.join('\n'), 'utf8')
    const runTask = fakeRunTask({ rounds: [{ json: SELECTION }] })
    const { runner } = makeRunner(root, { runTask })
    const result = await runner.generate('t-ai')
    assert.equal(result.ok, true)
    const prompt = runTask.calls[0].prompt
    const size = Buffer.byteLength(prompt, 'utf8')
    assert.ok(size <= 12 * 1024, `给模型的话有 ${size} 字节`)
    // 报过的贴了最近 30 行标题（11-11 那 20 条 + 11-10 的前 10 条）
    assert.match(prompt, /## 报过的/)
    assert.doesNotMatch(prompt, /2026-11-10 报过的第 1[1-9] 件事/)
    assert.match(prompt, /2026-11-11 报过的第 20 件事/)
    assert.match(prompt, /2026-11-10 报过的第 10 件事/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
