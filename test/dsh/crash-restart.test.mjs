// 常驻的 dsh 崩了以后：自动重起、正在跑的那一轮标成「已中断」（能接着做）、
// 每次崩记一份崩溃记录（钥匙打了码）、5 分钟内连崩 3 次就不再重起（报 Si301）。
// 这里拿一个假对端顶替随包 dsh（照 daemon.test.mjs 的做法，不联网）：
// 假对端收到问题就往 stderr 说一句话然后不回答，测试好把它杀掉。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { dshLaunch, runTask } from '../../app/dsh/index.mjs'
import { daemonFor, stopAllDaemons } from '../../app/dsh/daemon.mjs'
import { codeOf } from '../../app/task/codes.mjs'

const KEY = 'sidemate-test-key'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 假对端：会话开一个一个，收到问题就往 stderr 说一句话（带一个像钥匙的串）然后不回答
const PEER_SCRIPT = `
const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
const cfg = JSON.parse(readFileSync(join(root, 'peer.json'), 'utf8'))
const mark = (item) => appendFileSync(join(root, 'trace.jsonl'), JSON.stringify(item) + '\\n')
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
appendFileSync(join(root, 'argv.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n')
let buf = ''
let seq = 0
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    const method = msg.method
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: false } } } })
    }
    else if (method === 'session/new') {
      seq += 1
      const sessionId = 'peer-' + seq
      mark({ kind: 'new', sessionId })
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId, configOptions: [] } })
    }
    else if (method === 'session/resume') {
      mark({ kind: 'resume', sessionId: msg.params.sessionId })
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: msg.params.sessionId, configOptions: [] } })
    }
    else if (method === 'session/prompt') {
      mark({ kind: 'prompt', sessionId: msg.params.sessionId })
      process.stderr.write('boom sk-abcdef123456\\n')
      if (!cfg.answer) return
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    }
    else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

let sharedNode

function fakeNode() {
  if (!sharedNode) {
    const dir = scratch('sidemate-crash-node-')
    mkdirSync(dir, { recursive: true })
    sharedNode = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
    copyFileSync(process.execPath, sharedNode)
    chmodSync(sharedNode, 0o755)
  }
  return sharedNode
}

function fakePeer(config = {}) {
  const root = scratch('sidemate-crash-peer-')
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
  writeFileSync(join(lib, '..', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-peer' }))
  writeFileSync(join(root, 'peer.json'), JSON.stringify(config))
  writeFileSync(join(root, 'trace.jsonl'), '')
  writeFileSync(join(root, 'argv.jsonl'), '')
  return { root, tracePath: join(root, 'trace.jsonl'), argvPath: join(root, 'argv.jsonl') }
}

function readTrace(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

// 假对端起过几回（每回写一行 argv）
function spawnCount(peer) {
  try {
    return readFileSync(peer.argvPath, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

async function until(check, limitMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < limitMs) {
    if (await check()) return true
    await new Promise((done) => setTimeout(done, 50))
  }
  return false
}

// 会话号要等一会儿才有（起进程、握手、开会话）
async function untilSession(handle) {
  const got = await until(() => Boolean(handle.sessionId))
  assert.ok(got, '会话没起来')
  return handle.sessionId
}

function killPid(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 已经没了
  }
}

// 崩溃记录：程序数据目录下的 data\crash\
function crashFiles(lowRoot) {
  const dir = join(lowRoot, 'data', 'crash')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json'))
}

// 常驻进程（跟桌伴一样：一直留着，崩了自己重起）
function residentDaemon(peer, lowRoot) {
  const daemon = daemonFor(join(lowRoot, 'dsh'), () => dshLaunch({
    lowRoot,
    payloadRoot: peer.root,
    node: fakeNode(),
    taskId: 'daemon',
    apiKey: KEY,
  }), { keepAlive: true })
  daemon.hold()
  return daemon
}

function taskOf(peer, lowRoot, options = {}) {
  const events = []
  const handle = runTask({
    taskId: options.taskId ?? 'crash',
    payloadRoot: peer.root,
    node: fakeNode(),
    workspace: options.workspace ?? scratch('sidemate-crash-ws-'),
    lowRoot,
    prompt: options.prompt ?? '干活',
    sessionId: options.sessionId,
    apiKey: KEY,
    onEvent: (event) => events.push(event),
  })
  return { handle, events }
}

after(() => {
  stopAllDaemons()
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('dsh 崩了：自动重起、那一轮标已中断、崩了有记录（钥匙打了码）', { timeout: 90_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-crash-low-')
  residentDaemon(peer, lowRoot)
  const one = taskOf(peer, lowRoot, { taskId: 'crash-one' })
  const sessionId = await untilSession(one.handle)
  const pid = one.handle.pid
  assert.ok(pid, 'dsh 进程没起来')
  // 一半的时候把 dsh 杀掉
  killPid(pid)
  const end = await one.handle.done
  // 不报错：标成已中断，用户点「继续」能接着做
  assert.equal(end.status, 'interrupted', JSON.stringify(one.events.map((event) => event.type)))
  assert.equal(one.events.some((event) => event.type === 'error'), false, JSON.stringify(one.events))
  // 自动重起：不等下一个任务来，新的进程已经起来了
  const restarted = await until(() => spawnCount(peer) >= 2)
  assert.ok(restarted, `常驻进程起了 ${spawnCount(peer)} 次`)
  // 崩了有记录：退出码、stderr 尾巴、当时在跑几场
  const files = crashFiles(lowRoot)
  assert.equal(files.length, 1, JSON.stringify(files))
  const record = JSON.parse(readFileSync(join(lowRoot, 'data', 'crash', files[0]), 'utf8'))
  assert.equal(record.conversations.length, 1, JSON.stringify(record))
  assert.equal(record.conversations[0].id, sessionId)
  assert.ok(typeof record.exitCode === 'number', JSON.stringify(record))
  // 版本号：桌伴的照 package.json，dsh 的照它自己那个包
  assert.equal(record.appVersion, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version)
  assert.equal(record.dshVersion, '9.9.9-peer')
  assert.ok(record.output.join('\n').includes('boom'), JSON.stringify(record.output))
  // 钥匙打了码
  assert.equal(record.output.join('\n').includes('sk-abcdef123456'), false, JSON.stringify(record.output))
  assert.ok(record.output.join('\n').includes('***'), JSON.stringify(record.output))
})

test('点「继续」：在新起的那个进程上接回同一个会话', { timeout: 90_000 }, async () => {
  const peer = fakePeer({ answer: true })
  const lowRoot = scratch('sidemate-crash-low-')
  residentDaemon(peer, lowRoot)
  const one = taskOf(peer, lowRoot, { taskId: 'crash-resume' })
  const sessionId = await untilSession(one.handle)
  const pid = one.handle.pid
  killPid(pid)
  await one.handle.done
  assert.ok(await until(() => spawnCount(peer) >= 2), '常驻进程没自动重起')
  // 点「继续」：同一个会话在新进程上接着说
  const two = taskOf(peer, lowRoot, { taskId: 'crash-resume-2', sessionId })
  const end = await two.handle.done
  assert.equal(end.status, 'done', JSON.stringify(two.events.map((event) => event.type)))
  const trace = readTrace(peer.tracePath)
  const resumed = trace.filter((one) => one.kind === 'resume')
  assert.equal(resumed.length, 1, JSON.stringify(trace))
  assert.equal(resumed[0].sessionId, sessionId)
  // 接着做的是新起的那个进程
  assert.notEqual(two.handle.pid, pid)
})

test('5 分钟内连崩 3 次：不再重起，在跑的和新来的任务都报 Si301', { timeout: 120_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-crash-low-')
  residentDaemon(peer, lowRoot)
  const ends = []
  for (let i = 0; i < 3; i += 1) {
    const one = taskOf(peer, lowRoot, { taskId: `loop-${i}` })
    await untilSession(one.handle)
    killPid(one.handle.pid)
    ends.push(await one.handle.done)
  }
  // 前两回是中断，第三回算连崩：报 Si301
  assert.equal(ends[0].status, 'interrupted', JSON.stringify(ends[0]))
  assert.equal(ends[1].status, 'interrupted', JSON.stringify(ends[1]))
  assert.equal(ends[2].status, 'error', JSON.stringify(ends[2]))
  // 不再自动重起
  await new Promise((done) => setTimeout(done, 1_000))
  assert.equal(spawnCount(peer), 3, `常驻进程起了 ${spawnCount(peer)} 次`)
  // 这 5 分钟窗口里新来的任务：报 Si301
  const later = taskOf(peer, lowRoot, { taskId: 'loop-later' })
  const end = await later.handle.done
  assert.equal(end.status, 'error', JSON.stringify(later.events.map((event) => event.type)))
  const failure = later.events.find((event) => event.type === 'error')
  assert.ok(failure, JSON.stringify(later.events.map((event) => event.type)))
  assert.equal(codeOf(failure), 'Si301', JSON.stringify(failure))
  assert.equal(spawnCount(peer), 3, `常驻进程起了 ${spawnCount(peer)} 次`)
  // 就算那个进程被换掉了，这个 5 分钟窗口里的账也还在：新来的任务照样报 Si301
  stopAllDaemons()
  const again = taskOf(peer, lowRoot, { taskId: 'loop-again' })
  const end2 = await again.handle.done
  assert.equal(end2.status, 'error', JSON.stringify(again.events.map((event) => event.type)))
  const failure2 = again.events.find((event) => event.type === 'error')
  assert.ok(failure2, JSON.stringify(again.events.map((event) => event.type)))
  assert.equal(codeOf(failure2), 'Si301', JSON.stringify(failure2))
})

test('桌伴自己收进程：不算崩，也不记崩溃', { timeout: 90_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-crash-low-')
  residentDaemon(peer, lowRoot)
  const one = taskOf(peer, lowRoot, { taskId: 'stop-ok' })
  await untilSession(one.handle)
  const pid = one.handle.pid
  stopAllDaemons()
  killPid(pid)
  await one.handle.done
  await new Promise((done) => setTimeout(done, 1_000))
  assert.deepEqual(crashFiles(lowRoot), [], '自己收的进程不该记崩溃')
})
