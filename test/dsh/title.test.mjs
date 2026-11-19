// dsh 起的任务名、「接着干」只发一句：用真 dsh + 本机假模型服务跑。
// 任务名：dsh 起好了就报一个 title 事件；dsh 只是截了第一句开头的那个兜底名字不算。
// 接着干：同一个会话里只多一句短话，模型那头看到的原来那句要求只有一次。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, patchFiles, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { readTitle } from '../../app/dsh/title.mjs'
import { t } from '../../app/copy/copy.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
  copyFileSync(process.execPath, layout.node)
  chmodSync(layout.node, 0o755)
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 投影缓存那份文件：只放 title 和 titleInput 两行
function projcache(home, sessionId, title, first) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const rows = { title: { ver: 1, seq: 9, val: title }, titleInput: { ver: 3, seq: 9, val: { first: { seq: 8, text: first }, count: 1, lastSeq: 8 } } }
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({ version: 1, record: { rows } }), 'utf8')
}

test('读名字：起好了的照给；只是第一句话开头那几个字（dsh 的兜底）不算；没有就空', () => {
  const home = scratch('sidemate-title-')
  projcache(home, 's1', '华东区销售周报', '照这三份材料写一份本周的销售周报，重点写华东区')
  assert.equal(readTitle(home, 's1'), '华东区销售周报')
  projcache(home, 's2', '照这三份材料写一份本周的', '照这三份材料写一份本周的销售周报，重点写华东区')
  assert.equal(readTitle(home, 's2'), '')
  // 兜底名字把空白压过：照样认得出是开头
  projcache(home, 's3', 'Write a weekly', 'Write   a\nweekly report')
  assert.equal(readTitle(home, 's3'), '')
  assert.equal(readTitle(home, '没有这个'), '')
})

test('起名那份补丁是全局的：dsh 一直开着，新闻那一轮自己把名字钉住', () => {
  const base = { taskId: 'n', workspace: scratch('sidemate-ws-'), lowRoot: scratch('sidemate-low-'), prompt: 'x', apiKey: KEY }
  const launch = dshLaunch(base)
  // 起名那次调用是全局开的（一个 dsh 进程上跑好几个会话）
  assert.ok(patchFiles().some((file) => file.endsWith('title.patch.yml')))
  assert.equal(launch.patches.length, 2, '会话补丁只有插话（含模式）和重试播报两份')
})

describe('真 dsh', { concurrency: 1 }, () => {
  test('dsh 起好的名字报成 title 事件', { timeout: 120_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, title: '销售周报' })
    try {
      const events = []
      const handle = runTask({
        taskId: 'titled',
        apiKey: KEY,
        prompt: '照这三份材料写一份本周的销售周报',
        baseUrl: fake.url,
        workspace: scratch('sidemate-ws-'),
        lowRoot: scratch('sidemate-low-'),
        onEvent: (event) => events.push(event),
      })
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(events))
      assert.ok(fake.titles.length >= 1, '起名字那次调用没打开')
      const titles = events.filter((event) => event.type === 'title')
      assert.deepEqual(titles.map((event) => event.text), ['销售周报'], JSON.stringify(events.map((event) => event.type)))
      // 名字在收尾那几条里，在 end 前面
      assert.ok(events.indexOf(titles[0]) < events.findIndex((event) => event.type === 'end'))
    } finally {
      await fake.close()
    }
  })

  test('title: false：dsh 不发起名请求，也不报名字', { timeout: 120_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, title: '不该出现' })
    try {
      const events = []
      const handle = runTask({
        taskId: 'news-like',
        apiKey: KEY,
        prompt: '替桌伴找今天这个主题的新闻',
        baseUrl: fake.url,
        title: false,
        workspace: scratch('sidemate-ws-'),
        lowRoot: scratch('sidemate-low-'),
        onEvent: (event) => events.push(event),
      })
      assert.equal((await handle.done).status, 'done', JSON.stringify(events))
      await new Promise((done) => setTimeout(done, 300))
      // 新闻那一轮用不上名字：桌伴把名字钉住，dsh 不为它多发那一次请求
      assert.equal(fake.titles.length, 0, '新闻那一轮不该起名字')
      assert.equal(events.some((event) => event.type === 'title'), false)
    } finally {
      await fake.close()
    }
  })

  test('接着干：同一个会话里只多一句短话，原来那句要求在模型那头只出现一次', { timeout: 120_000 }, async () => {
    ensureNode()
    const ask = '照范本写一份本周销售周报'
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'text', text: '写了一半' }) })
    try {
      const workspace = scratch('sidemate-ws-')
      const lowRoot = scratch('sidemate-low-')
      const first = runTask({ taskId: 'c1', apiKey: KEY, prompt: ask, baseUrl: fake.url, workspace, lowRoot })
      assert.equal((await first.done).status, 'done')
      assert.ok(first.sessionId, '第一轮没拿到会话')
      const second = runTask({ taskId: 'c2', apiKey: KEY, prompt: t('continue'), sessionId: first.sessionId, baseUrl: fake.url, workspace, lowRoot })
      assert.equal((await second.done).status, 'done')
      const body = JSON.stringify(fake.calls.at(-1).messages)
      const count = (text) => body.split(text).length - 1
      assert.equal(count(ask), 1, '原来那句要求被重发了')
      assert.equal(count(t('continue')), 1)
    } finally {
      await fake.close()
    }
  })
})
