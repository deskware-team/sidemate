// 干活中途插一句：插件、补丁、两条路（插进去 / 排队），插件坏了就是程序崩溃。
// 这里的 dsh 是假的：一个说 ACP 协议的小程序，按配置决定插话那条路走不走得通。

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'
import { steerPatchYaml, steerPluginSource, steerRoots, writeSteerPlugin } from '../../app/dsh/steer-plugin.mjs'

const KEY = 'test-key-not-a-real-key'
const roots = []
const scratch = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `sidemate-steer-${name}-`))
  roots.push(dir)
  return dir
}

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 假的 dsh：按 peer.json 的配置决定插话走不走得通；收到的每个方法记进 calls.jsonl
const PEER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
const cfg = JSON.parse(readFileSync(join(root, 'peer.json'), 'utf8'))
const argv = process.argv.slice(2)
// 带了哪些补丁：把 --patch 指的文件内容也记下来
const patches = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] !== '--patch') continue
  let text = ''
  try { text = readFileSync(argv[i + 1], 'utf8') } catch { text = '' }
  patches.push(text)
}
appendFileSync(join(root, 'argv.jsonl'), JSON.stringify({ argv, patches }) + '\\n')
// 配了 crashWithRetry：带着重试播报补丁就起不来（插件坏了，dsh 直接退）
if (cfg.crashWithRetry && patches.some((text) => text.includes('id: sidemate-retry'))) {
  process.stderr.write('dsh: failed to load plugin sidemate-retry (patches/retry-plugin.mjs): plugin crashed while loading\\n')
  process.exit(3)
}
let buf = ''
let pending = null
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
    appendFileSync(join(root, 'calls.jsonl'), JSON.stringify(msg.method || 'reply') + '\\n')
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    } else if (msg.method === 'session/new') {
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'peer-1' } })
    } else if (msg.method === 'session/cancel') {
      if (pending !== null) {
        const id = pending
        pending = null
        send({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } })
      }
    } else if (msg.method === 'session/prompt') {
      if (cfg.autoFinish) {
        setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }), 30)
        continue
      }
      pending = msg.id
    } else if (msg.method === '_sidemate/steer') {
      if (cfg.steer === 'ok') send({ jsonrpc: '2.0', id: msg.id, result: { accepted: true } })
      else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
    } else if (msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
  }
})
`

function fakePeer(config) {
  const root = scratch('peer-')
  mkdirSync(join(root, 'node'), { recursive: true })
  const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(process.execPath, node)
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER)
  writeFileSync(join(root, 'peer.json'), JSON.stringify(config))
  return root
}

function taskOptions(over = {}) {
  return {
    taskId: 'task-a',
    payloadRoot: over.payloadRoot ?? fakePeer(over.cfg ?? { steer: 'ok' }),
    workspace: scratch('ws-'),
    lowRoot: scratch('low-'),
    prompt: '写一份周报',
    apiKey: KEY,
    ...over,
  }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const callsOf = (payloadRoot) => readFileSync(join(payloadRoot, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))

async function untilSession(handle) {
  // 机器忙的时候起进程慢（这里还要复制一份 node），等久一点
  for (let i = 0; i < 1_000 && !handle.sessionId; i += 1) await wait(10)
  assert.ok(handle.sessionId, '会话没起来')
}

test('插件源码：路径按 payload 的实际位置填进去，不写死；里面没有钥匙', () => {
  const rootsOf = steerRoots('C:/桌伴/payload')
  assert.equal(rootsOf.modules, join('C:/桌伴/payload', 'dsh', 'node_modules'))
  assert.equal(rootsOf.packages, join('C:/桌伴/payload', 'dsh', 'node_modules', '@deepseek-ai'))
  const source = steerPluginSource(rootsOf)
  assert.match(source, /resolve\('C:\/桌伴\/payload\/dsh\/node_modules'\)/)
  assert.match(source, /_sidemate\/steer/)
  assert.match(source, /agent\.steer\(message\)/)
  assert.equal(source.includes(KEY), false, '插件里不许出现钥匙')
  assert.equal(/apiKey|sk-[A-Za-z0-9]/.test(source), false, '插件里不许出现钥匙字段')
})

test('补丁文字：关掉原来的 acp 行，插桌伴自己的插件行', () => {
  const text = steerPatchYaml('C:/桌伴/patches/steer-plugin.mjs')
  assert.match(text, /- id: acp/)
  assert.match(text, /disabled: true/)
  assert.match(text, /- insert:/)
  assert.match(text, /id: sidemate-acp/)
  assert.match(text, /name: "C:\/桌伴\/patches\/steer-plugin\.mjs"/)
  assert.match(text, /inject: \[acpAppStartup\]/)
})

test('起进程前把插件写到用户目录下的 patches 里，路径不写死；内容一样就不重写', () => {
  const home = scratch('home-')
  const made = writeSteerPlugin({ home, payloadRoot: 'C:/桌伴/payload' })
  assert.ok(made, '插件没写出来')
  assert.equal(made.pluginPath, join(home, 'patches', 'steer-plugin.mjs'))
  const source = readFileSync(made.pluginPath, 'utf8')
  assert.match(source, /C:\/桌伴\/payload\/dsh\/node_modules/)
  assert.equal(source.includes(KEY), false)
  // 几个任务同时起 dsh：第二回写同样的内容时文件不动（别的 dsh 正读着也不会读到半截）
  const before = readFileSync(made.pluginPath)
  writeSteerPlugin({ home, payloadRoot: 'C:/桌伴/payload' })
  assert.deepEqual(readFileSync(made.pluginPath), before)
})

test('插进去：这一轮不取消', async () => {
  const opts = taskOptions({ cfg: { steer: 'ok' } })
  const handle = runTask(opts)
  await untilSession(handle)
  const result = await handle.steer('只写销售和库存两块就行')
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'steer', JSON.stringify(result))
  assert.equal(callsOf(opts.payloadRoot).includes('session/cancel'), false)
  handle.cancel()
  await handle.done
})

test('插不进去：排队等这一轮干完再发，不停下这一步、不在同一轮里重发', async () => {
  const opts = taskOptions({ cfg: { steer: 'error' } })
  const handle = runTask(opts)
  await untilSession(handle)
  const result = await handle.steer('只写销售和库存两块就行')
  assert.equal(result.ok, false)
  assert.equal(result.mode, 'queue', JSON.stringify(result))
  await wait(100)
  const calls = callsOf(opts.payloadRoot)
  assert.equal(calls.includes('session/cancel'), false, '不停下这一步')
  assert.equal(calls.filter((one) => one === 'session/prompt').length, 1, '不在同一轮里重发')
  handle.cancel()
  const end = await handle.done
  assert.equal(end.status, 'cancelled')
})

test('自家插件坏了：dsh 起不来就是程序崩溃，不去掉插件偷偷重起', async () => {
  const payloadRoot = fakePeer({ crashWithRetry: true, autoFinish: true })
  const events = []
  const handle = runTask(taskOptions({ payloadRoot, onEvent: (event) => events.push(event) }))
  const end = await handle.done
  assert.equal(end.status, 'error')
  const error = events.find((event) => event.type === 'error')
  assert.equal(error?.reason, 'crash', JSON.stringify(events))
  const runs = readFileSync(join(payloadRoot, 'argv.jsonl'), 'utf8').trim().split('\n')
  assert.equal(runs.length, 1, `起了 ${runs.length} 次`)
})
