// 常驻的 dsh 进程：任务和新闻都在同一个 dsh 上跑。
// 这里只说 ACP 的假对端（照 switch.test.mjs 的做法顶替随包 dsh，不联网）：
// 一个进程上跑好几个会话，事件按会话号分家。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask, restartDaemon, setAcpRouteProvider } from '../../app/dsh/index.mjs'
import { daemonOf, stopAllDaemons, writeGlobalPatch } from '../../app/dsh/daemon.mjs'
import { writeGlobal } from './global.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 假对端：会话一个一个开，事件都带着自己的会话号。
const PEER_SCRIPT = `
const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
const cfg = JSON.parse(readFileSync(join(root, 'peer.json'), 'utf8'))
const mark = (item) => appendFileSync(join(root, 'trace.jsonl'), JSON.stringify(item) + '\\n')
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
// 起进程时带了哪些补丁（全局补丁：进程活着就一直有）
appendFileSync(join(root, 'argv.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n')
// 补丁里 acp 那一行写的模型：dsh-acp 按它算这条连接能不能收图
const patchFiles = []
for (let i = 2; i < process.argv.length; i += 1) if (process.argv[i] === '--patch') patchFiles.push(process.argv[i + 1])
let acpModel = ''
for (const file of patchFiles) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { continue }
  if (!text.includes('sidemate-acp')) continue
  const found = text.match(/model:\\s*"([^"]*)"/)
  if (found) acpModel = found[1]
}
const images = /vision/.test(acpModel)
let buf = ''
let seq = 0
let setCount = 0
const active = new Set()
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
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: images } } } })
    }
    else if (method === 'session/new') {
      seq += 1
      const sessionId = 'peer-' + seq
      active.add(sessionId)
      mark({ kind: 'new', sessionId })
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId, configOptions: cfg.configOptions ?? [] } })
    }
    else if (method === 'session/resume') {
      mark({ kind: 'resume', sessionId: msg.params.sessionId })
      // 跟真 dsh 一样：这个进程里已经开着的会话再 resume 就拒
      if (active.has(msg.params.sessionId)) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Invalid params: session is already active: ' + msg.params.sessionId } })
        return
      }
      active.add(msg.params.sessionId)
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: msg.params.sessionId, configOptions: cfg.configOptions ?? [] } })
    }
    else if (method === 'session/set_config_option') {
      setCount += 1
      mark({ kind: 'set', sessionId: msg.params.sessionId, configId: msg.params.configId })
      // 刚保存的设置还没热加载完：dsh 先报一次「不认这个模型选项」
      if (cfg.unknownModelFirst === true && setCount === 1) {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'config_option_update', configOptions: cfg.configOptions ?? [] } },
        })
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown model option' } })
        return
      }
      send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: cfg.configOptions ?? [] } })
    }
    else if (method === 'session/cancel') {
      mark({ kind: 'cancel', sessionId: msg.params.sessionId })
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
    else if (method === '_sidemate/steer') {
      mark({ kind: 'steer', sessionId: msg.params.sessionId, files: msg.params.files ?? [] })
      send({ jsonrpc: '2.0', id: msg.id, result: { accepted: true } })
    }
    else if (method === 'session/prompt') {
      const sessionId = msg.params.sessionId
      const blocks = msg.params.prompt || []
      const text = blocks.map((one) => one.text || '').join('')
      mark({ kind: 'prompt', sessionId, text, blocks })
      setTimeout(() => {
        if (cfg.configOptionUpdate === true) {
          send({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { sessionId, update: { sessionUpdate: 'config_option_update', configOptions: cfg.updatedOptions ?? [] } },
          })
        }
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'm-' + sessionId, content: { type: 'text', text: 'reply-' + sessionId } } },
        })
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      }, cfg.delayMs ?? 0)
    }
    else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

let sharedNode

function fakeNode() {
  if (!sharedNode) {
    const dir = scratch('sidemate-daemon-node-')
    mkdirSync(dir, { recursive: true })
    sharedNode = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
    copyFileSync(process.execPath, sharedNode)
    chmodSync(sharedNode, 0o755)
  }
  return sharedNode
}

function fakePeer(config = {}) {
  const root = scratch('sidemate-daemon-peer-')
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
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

// 会话号要等一会儿才有（起进程、握手、开会话）
async function untilSession(handle) {
  for (let i = 0; i < 1_000 && !handle.sessionId; i += 1) await new Promise((done) => setTimeout(done, 10))
  assert.ok(handle.sessionId, '会话没起来')
}

function taskOf(peer, options = {}) {
  const events = []
  const handle = runTask({
    taskId: options.taskId ?? 'daemon',
    payloadRoot: peer.root,
    node: fakeNode(),
    workspace: options.workspace ?? scratch('sidemate-daemon-ws-'),
    lowRoot: options.lowRoot,
    prompt: options.prompt ?? '说一声好了',
    sessionId: options.sessionId,
    apiKey: options.apiKey ?? 'sidemate-test-key',
    model: options.model,
    // 用户给的文件：看图的会话再带上图片本身
    files: options.files,
    vision: options.vision === true,
    onEvent: (event) => events.push(event),
  })
  return { handle, events }
}

// 桌伴自己那个 dsh 家（程序数据目录下的 dsh\）：换 LOCALAPPDATA 就是换那个家
function ownHome() {
  return join(process.env.LOCALAPPDATA || '', 'sidemate')
}

function ownDshHome() {
  return join(ownHome(), 'dsh')
}

// 假对端起过几回（每回写一行 argv）
function spawnCount(peer) {
  try {
    return readFileSync(peer.argvPath, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

// 等一个条件成立：成立时把它算出来的值带回来
async function until(check, limitMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < limitMs) {
    const value = await check()
    if (value) return value
    await new Promise((done) => setTimeout(done, 50))
  }
  return null
}

after(() => {
  stopAllDaemons()
  // Windows 上刚收掉的进程可能还占着临时目录里的文件：多试几次，还删不掉就留给系统清，不算测试失败
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {
      // 删不掉的临时目录不影响结果
    }
  }
})

test('两个活共用一个 dsh 进程：事件各回各家，不串', { timeout: 60_000 }, async () => {
  const peer = fakePeer({ delayMs: 300 })
  const lowRoot = scratch('sidemate-daemon-low-')
  const one = taskOf(peer, { taskId: 'one', lowRoot, prompt: '第一个活' })
  const two = taskOf(peer, { taskId: 'two', lowRoot, prompt: '第二个活' })
  const ends = await Promise.all([one.handle.done, two.handle.done])
  assert.equal(ends[0].status, 'done', JSON.stringify(one.events.map((event) => event.type)))
  assert.equal(ends[1].status, 'done', JSON.stringify(two.events.map((event) => event.type)))
  // 一个 dsh 进程：两个活的进程号一样
  assert.equal(one.handle.pid, two.handle.pid)
  assert.ok(one.handle.pid, 'dsh 进程没起来')
  // 会话不是一个
  assert.notEqual(one.handle.sessionId, two.handle.sessionId)
  // 事件不串：各人只看见自己那场的话
  const repliesOf = (events) => events.filter((event) => event.type === 'reply').map((event) => event.text)
  assert.deepEqual(repliesOf(one.events), [`reply-${one.handle.sessionId}`])
  assert.deepEqual(repliesOf(two.events), [`reply-${two.handle.sessionId}`])
  // 假对端那边：两个会话各开各的
  const trace = readTrace(peer.tracePath)
  const news = trace.filter((one) => one.kind === 'new')
  assert.equal(news.length, 2, JSON.stringify(trace))
})

test('停一个活不影响另一个：停下是 session/cancel，不是杀进程', { timeout: 60_000 }, async () => {
  const peer = fakePeer({ delayMs: 1500 })
  const lowRoot = scratch('sidemate-daemon-low-')
  const one = taskOf(peer, { taskId: 'stop-one', lowRoot, prompt: '停我' })
  const two = taskOf(peer, { taskId: 'keep-two', lowRoot, prompt: '别停我' })
  // 两个会话都开好了再停：不然会话还没开，停下就没有 session/cancel 可发
  await untilSession(one.handle)
  await untilSession(two.handle)
  one.handle.cancel()
  const first = await one.handle.done
  assert.equal(first.status, 'cancelled')
  const second = await two.handle.done
  assert.equal(second.status, 'done', JSON.stringify(two.events.map((event) => event.type)))
  // 假对端收到的是取消那一句，不是进程被杀
  const trace = readTrace(peer.tracePath)
  assert.equal(trace.filter((one) => one.kind === 'cancel').length, 1, JSON.stringify(trace))
  // 另一个会话照样答完了
  assert.ok(two.events.some((event) => event.type === 'reply'))
})

test('全局配置整份写进 dsh 的家：热加载开着，改了整份换掉', { timeout: 60_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-daemon-low-')
  // 设置那边写的全局配置（模型路线那些）：起活之前就在那儿
  writeGlobal(lowRoot, ['- id: llm-pi-ai\n  config:\n    provider: fake\n'])
  const path = join(lowRoot, 'dsh', 'cordis.patch.yml')
  assert.ok(existsSync(path), '全局配置没写出来')
  const first = readFileSync(path, 'utf8')
  // 热加载那行必须在（dsh 起来时就得有）
  assert.match(first, /- id: hmr/)
  assert.match(first, /disabled: false/)
  assert.match(first, /root: \[\]/)
  assert.match(first, /llm-pi-ai/)
  const one = taskOf(peer, { taskId: 'global-config', lowRoot })
  await one.handle.done
  // 设置那边改了：整份重写（旧的没了，新的在）
  writeGlobalPatch(join(lowRoot, 'dsh'), ['- id: llm-pi-ai\n  config:\n    provider: other\n'])
  const second = readFileSync(path, 'utf8')
  assert.match(second, /provider: other/)
  assert.equal(second.includes('provider: fake'), false, '整份换掉：旧的不该留着')
  assert.match(second, /- id: hmr/)
})

test('两个用不同模型的任务同时跑：全局配置的内容一个字节都不动', { timeout: 60_000 }, async () => {
  const models = ['["c-one","m1"]', '["c-two","m2"]']
  const peer = fakePeer({ configOptions: [{ id: 'model', options: models.map((value) => ({ value })) }] })
  const lowRoot = scratch('sidemate-daemon-low-')
  writeGlobal(lowRoot, ['- id: llm-pi-ai\n  config:\n    provider: fake\n'])
  const path = join(lowRoot, 'dsh', 'cordis.patch.yml')
  const before = readFileSync(path, 'utf8')
  const one = taskOf(peer, { taskId: 'cfg-one', lowRoot, model: { value: models[0] } })
  const two = taskOf(peer, { taskId: 'cfg-two', lowRoot, model: { value: models[1] } })
  const ends = await Promise.all([one.handle.done, two.handle.done])
  assert.equal(ends[0].status, 'done', JSON.stringify(one.events.map((event) => event.type)))
  assert.equal(ends[1].status, 'done', JSON.stringify(two.events.map((event) => event.type)))
  // 全局配置只有设置那边写：两个任务跑完它还是一个样
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('acp 那一行是能看图的模型：看图的会话带图片块，只认字的会话只给链接', { timeout: 60_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-daemon-low-')
  // 桌伴自己那条规则算出来的 acp 那一行：已配好的模型里第一个能看图的
  setAcpRouteProvider(() => ({ provider: 'c-vision', model: 'vision-model' }))
  const visionWs = scratch('sidemate-daemon-ws-')
  const textWs = scratch('sidemate-daemon-ws-')
  const visionImage = join(visionWs, '图.png')
  const textImage = join(textWs, '图.png')
  writeFileSync(visionImage, 'png-bytes')
  writeFileSync(textImage, 'png-bytes')
  const vision = taskOf(peer, { taskId: 'vision', lowRoot, workspace: visionWs, vision: true, files: [{ path: visionImage }] })
  const text = taskOf(peer, { taskId: 'text-only', lowRoot, workspace: textWs, vision: false, files: [{ path: textImage }] })
  const ends = await Promise.all([vision.handle.done, text.handle.done])
  assert.equal(ends[0].status, 'done', JSON.stringify(vision.events.map((event) => event.type)))
  assert.equal(ends[1].status, 'done', JSON.stringify(text.events.map((event) => event.type)))
  const trace = readTrace(peer.tracePath)
  const prompts = trace.filter((one) => one.kind === 'prompt')
  const blocksOf = (sessionId) => prompts.find((one) => one.sessionId === sessionId)?.blocks ?? []
  const visionBlocks = blocksOf(vision.handle.sessionId)
  const textBlocks = blocksOf(text.handle.sessionId)
  // 这条连接能收图（dsh-acp 按 acp 那一行算的）
  assert.equal(visionBlocks.some((one) => one.type === 'image'), true, JSON.stringify(visionBlocks))
  assert.equal(visionBlocks.some((one) => one.type === 'resource_link'), true, JSON.stringify(visionBlocks))
  // 只认字的模型：不发图片块，只给资源链接
  assert.equal(textBlocks.some((one) => one.type === 'image'), false, JSON.stringify(textBlocks))
  assert.equal(textBlocks.some((one) => one.type === 'resource_link'), true, JSON.stringify(textBlocks))
  setAcpRouteProvider(null)
})

test('刚保存的设置还没热加载完：切模型报不认时等它刷新再试一次', { timeout: 60_000 }, async () => {
  const value = '["c-one","m1"]'
  const peer = fakePeer({ unknownModelFirst: true, configOptions: [{ id: 'model', options: [{ value }] }] })
  const lowRoot = scratch('sidemate-daemon-low-')
  const one = taskOf(peer, { taskId: 'reload', lowRoot, model: { value } })
  const end = await one.handle.done
  assert.equal(end.status, 'done', JSON.stringify(one.events.map((event) => event.type)))
  const trace = readTrace(peer.tracePath)
  const sets = trace.filter((one) => one.kind === 'set')
  assert.equal(sets.length, 2, JSON.stringify(trace))
  assert.equal(sets[0].configId, 'model')
})

test('dsh 报模型选项变了：桌伴报一个 config-options 事件', { timeout: 60_000 }, async () => {
  const peer = fakePeer({ configOptionUpdate: true, updatedOptions: [{ id: 'model', value: 'x' }] })
  const lowRoot = scratch('sidemate-daemon-low-')
  const one = taskOf(peer, { taskId: 'config-options', lowRoot })
  await one.handle.done
  const events = one.events.filter((event) => event.type === 'config-options')
  assert.equal(events.length, 1, JSON.stringify(one.events.map((event) => event.type)))
  assert.deepEqual(events[0].options, [{ id: 'model', value: 'x' }])
})

test('交稿那份补丁是常驻进程的全局补丁：进程起一次就带着，所有会话都有', { timeout: 60_000 }, async () => {
  const peer = fakePeer({})
  const lowRoot = scratch('sidemate-daemon-low-')
  const one = taskOf(peer, { taskId: 'present-patch', lowRoot })
  await one.handle.done
  const runs = readFileSync(peer.argvPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(runs.length, 1, `常驻进程起了 ${runs.length} 次`)
  const patches = []
  for (let i = 0; i < runs[0].length; i += 1) {
    if (runs[0][i] === '--patch') patches.push(runs[0][i + 1])
  }
  assert.ok(patches.some((one) => one.endsWith('present.patch.yml')), JSON.stringify(patches))
})

test('插话带的那几份文件：常驻进程里照样当资源链接发过去', { timeout: 60_000 }, async () => {
  const peer = fakePeer({ delayMs: 1500 })
  const lowRoot = scratch('sidemate-daemon-low-')
  const workspace = scratch('sidemate-daemon-ws-')
  const file = join(workspace, 'received', '范本.docx')
  mkdirSync(join(workspace, 'received'), { recursive: true })
  writeFileSync(file, 'x')
  const one = taskOf(peer, { taskId: 'steer-files', lowRoot, workspace })
  await untilSession(one.handle)
  const result = await one.handle.steer('照这份改', [{ path: file }])
  assert.equal(result.ok, true, JSON.stringify(result))
  const trace = readTrace(peer.tracePath)
  const steer = trace.find((one) => one.kind === 'steer')
  assert.ok(steer, JSON.stringify(trace))
  assert.equal(steer.files.length, 1)
  assert.equal(steer.files[0].name, 'received/范本.docx')
  assert.match(steer.files[0].uri, /^file:\/\//)
  one.handle.cancel()
  await one.handle.done
})

// 换一个自己的 dsh 家（程序数据目录）：跑完就还原
async function withOwnHome(fn) {
  const saved = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = scratch('sidemate-daemon-app-')
  try {
    await fn()
  } finally {
    if (saved === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = saved
  }
}

test('桌伴自己那个 dsh 家：跑完任务进程还在，重起以后马上补一个新的', { timeout: 120_000 }, async () => {
  const peer = fakePeer({})
  await withOwnHome(async () => {
    const one = taskOf(peer, { taskId: 'own-one' })
    await one.handle.done
    // 任务跑完了：常驻进程还在（不是每个任务重起一个 dsh）
    const resident = daemonOf(ownDshHome())
    assert.ok(resident, '常驻进程没了')
    assert.equal(resident.stopped, false, '常驻进程被收掉了')
    assert.equal(resident.dead, false, '常驻进程死了')
    const firstPid = resident.pid
    // 重起：旧的收掉，新的马上补上（不等下一个任务）
    restartDaemon()
    const next = await until(() => {
      const now = daemonOf(ownDshHome())
      if (!now || now.stopped || !now.pid || now.pid === firstPid) return null
      if (spawnCount(peer) < 2) return null
      return now
    })
    assert.ok(next, '重起以后没有新的常驻进程')
    assert.equal(resident.stopped, true, '旧的进程没收掉')
    // 只有一个 dsh 进程：旧的收掉了，只多起了一个新的
    assert.equal(spawnCount(peer), 2, `dsh 起了 ${spawnCount(peer)} 次`)
    // 再跑一个任务：还是那个常驻进程，跑完它还在
    const two = taskOf(peer, { taskId: 'own-two' })
    await two.handle.done
    assert.equal(two.handle.pid, next.pid, '任务另起了一个进程')
    const after = daemonOf(ownDshHome())
    assert.equal(after.stopped, false, '跑完任务常驻进程被收掉了')
    assert.equal(after.dead, false, '跑完任务常驻进程死了')
    assert.equal(spawnCount(peer), 2, `dsh 起了 ${spawnCount(peer)} 次`)
  })
})

test('常驻进程里接着说第二句：开着的会话不再 resume（dsh 会回 already active）；重起以后才 resume', { timeout: 120_000 }, async () => {
  const peer = fakePeer({})
  await withOwnHome(async () => {
    const workspace = scratch('sidemate-daemon-ws-')
    const first = taskOf(peer, { taskId: 'turn-one', workspace, prompt: '第一句' })
    assert.equal((await first.handle.done).status, 'done')
    const sessionId = first.handle.sessionId
    const second = taskOf(peer, { taskId: 'turn-two', workspace, prompt: '第二句', sessionId })
    assert.equal((await second.handle.done).status, 'done', JSON.stringify(second.events))
    assert.equal(second.handle.pid, first.handle.pid, '第二句另起了进程')
    assert.equal(second.handle.sessionId, sessionId)
    assert.deepEqual(second.events.filter((event) => event.type === 'reply').map((event) => event.text), [`reply-${sessionId}`])
    let trace = readTrace(peer.tracePath)
    assert.equal(trace.filter((one) => one.kind === 'resume').length, 0, JSON.stringify(trace))
    // 重起以后是新进程：那个会话得 resume 回来
    const firstPid = first.handle.pid
    restartDaemon()
    const next = await until(() => {
      const now = daemonOf(ownDshHome())
      return now && !now.stopped && now.pid && now.pid !== firstPid ? now : null
    })
    assert.ok(next, '重起以后没有新的常驻进程')
    const third = taskOf(peer, { taskId: 'turn-three', workspace, prompt: '第三句', sessionId })
    assert.equal((await third.handle.done).status, 'done', JSON.stringify(third.events))
    trace = readTrace(peer.tracePath)
    assert.equal(trace.filter((one) => one.kind === 'resume' && one.sessionId === sessionId).length, 1, JSON.stringify(trace))
  })
})

test('两个任务在跑的时候重起：那两场按设置变化中断收场（不是报错）', { timeout: 120_000 }, async () => {
  const peer = fakePeer({ delayMs: 30_000 })
  await withOwnHome(async () => {
    const one = taskOf(peer, { taskId: 'own-two-a' })
    const two = taskOf(peer, { taskId: 'own-two-b' })
    await untilSession(one.handle)
    await untilSession(two.handle)
    restartDaemon()
    const ends = await Promise.all([one.handle.done, two.handle.done])
    for (const end of ends) {
      assert.equal(end.status, 'cancelled', JSON.stringify(end))
      assert.equal(end.note, 'settings', JSON.stringify(end))
    }
    assert.equal(one.events.some((event) => event.type === 'error'), false, JSON.stringify(one.events))
    assert.equal(two.events.some((event) => event.type === 'error'), false, JSON.stringify(two.events))
  })
})

test('第三个任务带着新钥匙来：前两个按设置变化中断收场（不是报错）', { timeout: 120_000 }, async () => {
  const peer = fakePeer({ delayMs: 30_000 })
  await withOwnHome(async () => {
    const one = taskOf(peer, { taskId: 'own-key-a' })
    const two = taskOf(peer, { taskId: 'own-key-b' })
    await untilSession(one.handle)
    await untilSession(two.handle)
    // 第三个任务带着新钥匙来：这个进程的环境跟它不一样，收掉重起
    const three = taskOf(peer, { taskId: 'own-key-c', apiKey: 'sidemate-new-key' })
    await untilSession(three.handle)
    const ends = await Promise.all([one.handle.done, two.handle.done])
    for (const end of ends) {
      assert.equal(end.status, 'cancelled', JSON.stringify(end))
      assert.equal(end.note, 'settings', JSON.stringify(end))
    }
    assert.equal(one.events.some((event) => event.type === 'error'), false, JSON.stringify(one.events))
    assert.equal(two.events.some((event) => event.type === 'error'), false, JSON.stringify(two.events))
    three.handle.cancel()
    await three.handle.done
  })
})
