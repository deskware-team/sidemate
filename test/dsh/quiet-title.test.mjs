// 新闻那一轮不起名：桌伴把名字钉住，dsh 就不会为它多发那一次起名的请求。
// 用真 dsh + 本机假模型服务验：假服务分得出「起名的那次请求」和「干活的那次请求」，
// 所以同一批请求里没有起名那一条，就说明钉住了。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { payloadLayout, runTask } from '../../app/dsh/index.mjs'
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

describe('新闻那一轮不起名', { concurrency: 1 }, () => {
  test('新闻那一轮：假服务只收到干活那一次请求，没有起名那一次', { timeout: 120_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, title: '不该出现的名字' })
    try {
      // 先跑新闻那一轮（title: false）：名字钉住了
      const news = runTask({
        taskId: 'news-quiet',
        apiKey: KEY,
        prompt: '替桌伴找今天这个主题的新闻',
        baseUrl: fake.url,
        title: false,
        workspace: scratch('sidemate-quiet-ws-'),
        lowRoot: scratch('sidemate-quiet-low-'),
      })
      assert.equal((await news.done).status, 'done', JSON.stringify(fake.calls).slice(0, 800))
      await new Promise((done) => setTimeout(done, 500))
      assert.ok(fake.calls.length >= 1, '新闻那一轮没跟模型说话')
      assert.equal(fake.titles.length, 0, '新闻那一轮不该起名字')
      // 再跑一个普通任务：照旧起名（说明上面那一次是真的钉住了，不是本来就不起）
      const normal = runTask({
        taskId: 'normal-titled',
        apiKey: KEY,
        prompt: '照这三份材料写一份本周的销售周报',
        baseUrl: fake.url,
        workspace: scratch('sidemate-quiet-ws-'),
        lowRoot: scratch('sidemate-quiet-low-'),
      })
      assert.equal((await normal.done).status, 'done', JSON.stringify(fake.calls).slice(0, 800))
      await new Promise((done) => setTimeout(done, 500))
      assert.ok(fake.titles.length >= 1, '普通任务该起名字')
    } finally {
      await fake.close()
    }
  })
})
