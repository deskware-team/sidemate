// 重试播报的两件东西：dsh 小插件（把 llm/retry 事件一行一行写给桌伴）
// 和桌伴这边的读法（一行一行读，读到哪儿记到哪儿，次数不漏号）。

import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createRetryTail, createRetryWatcher } from '../../app/dsh/retry-log.mjs'
import { RETRY_FILE_ENV, failureStatus, retryPatchYaml, retryPluginSource } from '../../app/dsh/retry-plugin.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('插件源码：听 llm/retry 事件，把种类、第几次、等几秒写成一 JSON', () => {
  const source = retryPluginSource()
  assert.match(source, /event\.type === 'llm\/retry'/)
  assert.match(source, /RATE_LIMIT: 'busy'/)
  assert.match(source, /SERVER: 'server'/)
  assert.match(source, /TIMEOUT: 'noreply'/)
  assert.match(source, /TRANSPORT: 'network'/)
  assert.match(source, /maxRetries/)
  assert.match(source, /delayMs/)
  // 写进哪个文件从环境变量拿，源码里不写死路径
  assert.match(source, new RegExp(RETRY_FILE_ENV))
  // 不许出现钥匙
  assert.equal(/api[_-]?key/i.test(source), false)
})

test('插件源码：turn/end 里最后那次失败也写一行（dsh 的码、HTTP 状态、原文）', () => {
  const source = retryPluginSource()
  assert.match(source, /event\.type === 'turn\/end'/)
  assert.match(source, /reason\.kind !== 'error'/)
  assert.match(source, /kind: 'failure'/)
  assert.match(source, /code: failure\.code \|\| ''/)
  assert.match(source, /status: failureStatus\(failure\)/)
  assert.match(source, /detail: failure\.message \|\| ''/)
})

test('插件算 HTTP 状态：dsh 明写的就用；没有就看原文开头那个（端口不当状态）', () => {
  // dsh 明写了状态：照它的
  assert.equal(failureStatus({ code: 'RATE_LIMIT', status: 429, message: 'Too Many Requests' }), 429)
  // dsh 没写：SDK 那条线路把 HTTP 错写成「429 {…}」这种开头，开头那个就是状态
  assert.equal(failureStatus({ code: 'RATE_LIMIT', message: '429 {"error":{"type":"rate_limit_error"}}' }), 429)
  assert.equal(failureStatus({ code: 'AUTH', message: '401: {"type":"authentication_error"}' }), 401)
  // 连接断了、超时了：本来就没有 HTTP 响应，原文中间的端口不当状态
  assert.equal(failureStatus({ code: 'TRANSPORT', message: 'connect ECONNREFUSED 1.2.3.4:443' }), 0)
  assert.equal(failureStatus({ code: 'TIMEOUT', message: 'timed out after 30000 ms' }), 0)
})

test('桌伴读到最后那次失败：dsh 的码、HTTP 状态、原文', async () => {
  const dir = scratch('sidemate-retry-')
  const path = join(dir, 'retry.log')
  const seen = []
  const watcher = createRetryWatcher({ path, onEvent: (info) => seen.push(info), intervalMs: 10 })
  try {
    appendFileSync(path, `${JSON.stringify({ kind: 'failure', code: 'RATE_LIMIT', status: 429, detail: 'Too Many Requests' })}\n`, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(seen.length, 1, JSON.stringify(seen))
    assert.equal(seen[0].kind, 'failure')
    assert.equal(seen[0].code, 'RATE_LIMIT')
    assert.equal(seen[0].status, 429)
    assert.equal(seen[0].detail, 'Too Many Requests')
  } finally {
    watcher.stop()
  }
})

test('补丁：插一行自己的插件，不动 acp 那一行', () => {
  const text = retryPatchYaml('C:/tmp/patches/retry-plugin.mjs')
  assert.match(text, /- insert:/)
  assert.match(text, /- id: sidemate-retry/)
  assert.match(text, /name: "C:\/tmp\/patches\/retry-plugin\.mjs"/)
  // 不许把 acp 关掉（那是插话插件的事）
  assert.equal(/disabled: true/.test(text), false)
})

test('桌伴读播报文件：一条一行，读到哪儿记到哪儿，不漏也不重', async () => {
  const dir = scratch('sidemate-retry-')
  const path = join(dir, 'retry.log')
  const seen = []
  const tail = createRetryTail(path, (line) => seen.push(JSON.parse(line)), 10)
  try {
    appendFileSync(path, `${JSON.stringify({ kind: 'busy', retry: 1 })}\n`, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 120))
    appendFileSync(path, `${JSON.stringify({ kind: 'server', retry: 2 })}\n`, 'utf8')
    // 半行：等下一轮才拼上
    appendFileSync(path, '{"kind":"noreply","retry":3', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.deepEqual(seen.map((one) => one.retry), [1, 2])
    appendFileSync(path, '}\n', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.deepEqual(seen.map((one) => one.retry), [1, 2, 3])
    assert.equal(seen[2].kind, 'noreply')
  } finally {
    tail.stop()
  }
})

test('播报文件还没有的时候不报错', async () => {
  const dir = scratch('sidemate-retry-')
  const seen = []
  const tail = createRetryTail(join(dir, 'nope.log'), (line) => seen.push(line), 10)
  try {
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.deepEqual(seen, [])
  } finally {
    tail.stop()
  }
})

test('插件写出来的行，桌伴读得懂', () => {
  const source = retryPluginSource()
  const dir = scratch('sidemate-retry-')
  const path = join(dir, 'retry.log')
  // 照插件的写法造一行：桌伴那边 JSON.parse 得动
  const line = JSON.stringify({
    kind: 'busy',
    code: 'RATE_LIMIT',
    retry: 1,
    maxRetries: 10,
    delayMs: 5000,
    detail: 'Rate limit reached for requests',
  })
  writeFileSync(path, `${line}\n`, 'utf8')
  const seen = []
  const tail = createRetryTail(path, (one) => seen.push(JSON.parse(one)), 10)
  return new Promise((resolve) => {
    setTimeout(() => {
      tail.stop()
      assert.equal(seen.length, 1)
      assert.equal(seen[0].kind, 'busy')
      assert.equal(seen[0].retry, 1)
      assert.equal(seen[0].maxRetries, 10)
      assert.equal(seen[0].delayMs, 5000)
      assert.equal(readFileSync(path, 'utf8').includes('RATE_LIMIT'), true)
      resolve()
    }, 120)
  })
})
