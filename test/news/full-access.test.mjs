// 主题的自动配置权限选「允许」时：新闻那个会话开好后，桌伴把会话切成完全访问（_sidemate/mode），
// 那时不来权限申请。别的任务不发这条。
// 这里的 dsh 是假的：一个说 ACP 协议的小程序，把收到的每个方法记进 calls.jsonl。

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'

const KEY = 'test-key-not-a-real-key'
const roots = []
const scratch = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `sidemate-mode-${name}-`))
  roots.push(dir)
  return dir
}

test.after(() => {
  // 假 dsh 也许还占着目录：删不掉就算了，别把这一份测试拖成失败
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch { /* 目录还被占着 */ }
  }
})

// 假的 dsh：记下收到的每个方法（带参数），别的请求都回一个空结果
const PEER = `
const { appendFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ method: msg.method || 'reply', params: msg.params || null }) + '\\n')
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    } else if (msg.method === 'session/new') {
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'peer-1' } })
    } else if (msg.method === 'session/prompt') {
      setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }), 30)
    } else if (msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
  }
})
`

// 假 dsh 只做一份：node 拷一次，两条用例共用
let peerRoot = null
function fakePeer() {
  if (peerRoot) return peerRoot
  peerRoot = scratch('peer-')
  mkdirSync(join(peerRoot, 'node'), { recursive: true })
  const node = join(peerRoot, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(process.execPath, node)
  const lib = join(peerRoot, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER)
  return peerRoot
}

function taskOptions(over = {}) {
  return {
    taskId: 'news-mode',
    payloadRoot: over.payloadRoot ?? fakePeer(),
    workspace: scratch('ws-'),
    lowRoot: scratch('low-'),
    prompt: '替桌伴找今天这个主题的新闻',
    apiKey: KEY,
    title: false,
    ...over,
  }
}

const callsOf = (payloadRoot) => readFileSync(join(payloadRoot, 'calls.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

test('自动配置权限选允许的主题：会话开好后切成完全访问', async () => {
  const opts = taskOptions({ fullAccess: true })
  const handle = runTask(opts)
  const end = await handle.done
  assert.equal(end.status, 'done', JSON.stringify(callsOf(opts.payloadRoot)).slice(0, 800))
  const mode = callsOf(opts.payloadRoot).find((one) => one.method === '_sidemate/mode')
  assert.ok(mode, '该发 _sidemate/mode')
  assert.equal(mode.params.mode, 'danger-full-access')
  assert.equal(mode.params.sessionId, 'peer-1')
})

test('别的任务：不发 _sidemate/mode', async () => {
  const opts = taskOptions({ title: 'news' })
  const before = callsOf(opts.payloadRoot).filter((one) => one.method === '_sidemate/mode').length
  const handle = runTask(opts)
  await handle.done
  const after = callsOf(opts.payloadRoot).filter((one) => one.method === '_sidemate/mode').length
  assert.equal(after, before, '没多发 _sidemate/mode')
})
