// 读链接默认不碰本机和局域网：用新 payload 起 dsh，假模型让模型去读一个本机起的服务。
// 关着「允许访问本地网络」时：那个服务一次请求都收不到，模型拿到的是桌伴给的那句话。
// 开着时：模型读得到那个页面。

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { after, describe } from 'node:test'
import { abilityFiles, abilitiesForTask } from '../../app/abilities/launch.mjs'
import { payloadLayout } from '../../app/dsh/index.mjs'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { t } from '../../app/copy/copy.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const layout = payloadLayout()
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 本机起的一个网页服务：数它收到几次请求
async function startSite() {
  let hits = 0
  const server = createServer((req, res) => {
    hits += 1
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><body><p>本机页面里的那句话</p></body></html>')
  })
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const { port } = server.address()
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    hits: () => hits,
    close: () => new Promise((done) => server.close(() => done())),
  }
}

// 程序数据目录下的 ability.json：只放 tools 里的那个开关
function deskWith(localNet) {
  const desk = scratch('sidemate-localnet-desk-')
  writeFileSync(join(desk, 'ability.json'), JSON.stringify({ tools: { localNet } }), 'utf8')
  return desk
}

// 这一轮要挂的补丁：跟真跑起来时算的一样（app/abilities/launch.mjs）
function patchTextsFor(desk) {
  const files = abilityFiles({ repo, deskRoot: desk })
  return abilitiesForTask({
    files,
    keyring: { read: () => null, has: () => false },
    log: () => {},
  }).patchTexts
}

// 让假模型去读那个网址，然后收场
async function runFetch(desk, url) {
  let step = 0
  const fake = await startFake({
    expectKey: KEY,
    respond: () => {
      step += 1
      if (step === 1) return { kind: 'tool', name: 'web_fetch', input: { url } }
      return { kind: 'text', text: '好了' }
    },
  })
  try {
    const handle = runTask({
      taskId: 'local-net',
      workspace: scratch('sidemate-localnet-ws-'),
      lowRoot: scratch('sidemate-localnet-low-'),
      prompt: '读一下那个页面',
      apiKey: KEY,
      baseUrl: fake.url,
      searchBaseUrl: fake.url,
      patchTexts: patchTextsFor(desk),
    })
    const end = await handle.done
    return { end, calls: fake.calls }
  } finally {
    await fake.close()
  }
}

describe('读链接默认不访问本机和局域网', { concurrency: 1 }, () => {
  test('开关关着：本机服务一次请求都没收到，模型拿到桌伴给的那句话', { timeout: 120_000 }, async () => {
    ensureNode()
    const site = await startSite()
    try {
      const { end, calls } = await runFetch(deskWith(false), site.url)
      assert.equal(end.status, 'done', JSON.stringify(calls).slice(0, 800))
      assert.equal(site.hits(), 0, '本机那个服务一次请求都没收到')
      const seen = JSON.stringify(calls)
      assert.ok(seen.includes(t('web.localNetDenied')), '模型拿到了桌伴给的那句话')
    } finally {
      await site.close()
    }
  })

  test('开关关着：写成本机名字、十进制写法的地址，一样拦下来', { timeout: 180_000 }, async () => {
    ensureNode()
    const site = await startSite()
    const urls = [`http://localhost:${site.port}/`, `http://2130706433:${site.port}/`]
    try {
      for (const url of urls) {
        const { end, calls } = await runFetch(deskWith(false), url)
        assert.equal(end.status, 'done', `${url}：${JSON.stringify(calls).slice(0, 400)}`)
        assert.equal(site.hits(), 0, `${url}：本机那个服务一次请求都没收到`)
        assert.ok(JSON.stringify(calls).includes(t('web.localNetDenied')), `${url}：模型拿到了桌伴给的那句话`)
      }
    } finally {
      await site.close()
    }
  })

  test('开关开着：模型读得到本机那个页面', { timeout: 120_000 }, async () => {
    ensureNode()
    const site = await startSite()
    try {
      const { end, calls } = await runFetch(deskWith(true), site.url)
      assert.equal(end.status, 'done', JSON.stringify(calls).slice(0, 800))
      assert.equal(site.hits(), 1, '本机那个服务收到了一次请求')
      assert.ok(JSON.stringify(calls).includes('本机页面里的那句话'), '模型读到了页面内容')
    } finally {
      await site.close()
    }
  })
})
