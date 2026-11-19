import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { payloadLayout } from '../../app/dsh/index.mjs'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { startFake } from './fake-messages.mjs'

// 搜索改走 dsh 的 Search API 之后的两件事：
// 有凭据时请求里带着 web_search；没有凭据时 dsh 自己把它从那一次请求里撤掉。

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

// 请求里带的工具名
function toolNames(body) {
  return (Array.isArray(body?.tools) ? body.tools : [])
    .map((tool) => tool?.name ?? tool?.function?.name)
    .filter((name) => typeof name === 'string')
}

async function runOnce(taskId, extra = {}) {
  const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'text', text: '好了' }) })
  try {
    const handle = runTask({
      taskId,
      workspace: scratch('sidemate-search-ws-'),
      lowRoot: scratch('sidemate-search-low-'),
      prompt: '查一下',
      apiKey: KEY,
      baseUrl: fake.url,
      searchBaseUrl: fake.url,
      ...extra,
    })
    const end = await handle.done
    return { end, calls: fake.calls }
  } finally {
    await fake.close()
  }
}

describe('dsh 搜索走 Search API', { concurrency: 1 }, () => {
  test('有凭据时请求里带着 web_search', { timeout: 60_000 }, async () => {
    ensureNode()
    const { end, calls } = await runOnce('search-ready')
    assert.equal(end.status, 'done', JSON.stringify(calls).slice(0, 800))
    assert.ok(calls.length > 0, '模型请求发出去了')
    assert.equal(toolNames(calls[0]).includes('web_search'), true, '有凭据时 web_search 在工具列表里')
  })

  test('搜索那条线路没凭据时 dsh 自己撤掉 web_search', { timeout: 60_000 }, async () => {
    ensureNode()
    // 搜索那把钥匙指向一个没设的环境变量：对话那条线路还有钥匙，请求照发，搜索工具被撤掉
    const { end, calls } = await runOnce('search-nokey', { searchApiKeyEnv: 'SIDEMATE_SEARCH_KEY_NOT_SET' })
    assert.equal(end.status, 'done', JSON.stringify(calls).slice(0, 800))
    assert.ok(calls.length > 0, '模型请求发出去了')
    assert.equal(toolNames(calls[0]).includes('web_search'), false, '没凭据时 web_search 不在工具列表里')
  })
})
