import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { dshLaunch, patchFiles, runTask } from '../../app/dsh/index.mjs'
import { codeOf, stopText } from '../../app/task/codes.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 只说 ACP 的假对端：照 driver.test.mjs 的做法顶替随包 dsh，不联网。
// 它把收到的每条请求记进 trace.jsonl，回什么读 peer.json。
const PEER_SCRIPT = `
const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
const cfg = JSON.parse(readFileSync(join(root, 'peer.json'), 'utf8'))
const mark = (item) => appendFileSync(join(root, 'trace.jsonl'), JSON.stringify(item) + '\\n')
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const options = () => (cfg.configOptions ?? [])
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    else if (msg.method === 'session/new') {
      mark({
        kind: 'new',
        deepseekKey: process.env.DEEPSEEK_API_KEY !== undefined,
        keyVars: Object.keys(process.env).filter((name) => name.startsWith('SIDEMATE_KEY_')).sort(),
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'peer-1', configOptions: options() } })
    } else if (msg.method === 'session/resume') {
      mark({ kind: 'resume' })
      const result = { sessionId: msg.params.sessionId }
      if (cfg.resumeOptions !== undefined) result.configOptions = cfg.resumeOptions
      send({ jsonrpc: '2.0', id: msg.id, result })
    } else if (msg.method === 'session/set_config_option') {
      mark({ kind: 'set', configId: msg.params.configId, value: msg.params.value })
      const after = msg.params.configId === 'model' ? (cfg.afterModel ?? options()) : options()
      send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: after } })
    } else if (msg.method === 'session/prompt') {
      mark({ kind: 'prompt' })
      for (let i = 0; i < (cfg.usageTimes ?? 1); i += 1) {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: { sessionUpdate: 'usage_update', used: 3, size: 2 } } })
      }
      if (cfg.error) {
        send({ jsonrpc: '2.0', id: msg.id, error: cfg.error })
        return
      }
      const text = cfg.echoEnv ? String(process.env[cfg.echoEnv] ?? '') : (cfg.text ?? '好了')
      process.stderr.write('echo ' + text + '\\n')
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text } } } })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

// 假对端的 payload 目录：dsh 的位置要跟 payloadLayout 对上，node 复制一份共用。
let sharedNode

function fakeNode() {
  if (!sharedNode) {
    const dir = scratch('sidemate-sw-node-')
    mkdirSync(dir, { recursive: true })
    sharedNode = join(dir, process.platform === 'win32' ? 'node.exe' : 'node')
    copyFileSync(process.execPath, sharedNode)
    chmodSync(sharedNode, 0o755)
  }
  return sharedNode
}

function fakePeer(config) {
  const root = scratch('sidemate-sw-peer-')
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
  writeFileSync(join(root, 'peer.json'), JSON.stringify(config))
  writeFileSync(join(root, 'trace.jsonl'), '')
  return { root, tracePath: join(root, 'trace.jsonl') }
}

function readTrace(path) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

// 用假对端跑一轮 runTask，把事件、日志和对方收到的请求都收回来。
async function drive(config, extra = {}) {
  const peer = fakePeer(config)
  const events = []
  const logs = []
  const handle = runTask({
    taskId: extra.taskId ?? 'switch',
    payloadRoot: peer.root,
    node: fakeNode(),
    workspace: scratch('sidemate-sw-ws-'),
    lowRoot: scratch('sidemate-sw-low-'),
    prompt: extra.prompt ?? '说一声好了',
    sessionId: extra.sessionId,
    apiKey: extra.apiKey,
    model: extra.model,
    env: extra.env,
    vendor: extra.vendor,
    free: extra.free,
    // 服务出错、连接断了都要重试：测试里等不起，把退避调短、只试一次
    retryPolicy: { initialDelayMs: 10, maxDelayMs: 20, maxRetries: 1 },
    onEvent: (event) => events.push(event),
    onLog: (line) => logs.push(line),
  })
  const end = await handle.done
  return { events, logs, end, handle, trace: () => readTrace(peer.tracePath) }
}

const DEEPSEEK = '["deepseek-official","deepseek-flash"]'
const KILO = '["kilo","kilo-auto/free"]'
const MODEL_OPTIONS = [
  {
    id: 'model',
    options: [
      { group: 'deepseek-official', options: [{ value: DEEPSEEK }] },
      { group: 'kilo', options: [{ value: KILO }] },
    ],
  },
]
const EFFORT_OPTIONS = [{ id: 'reasoning_effort', options: [{ value: 'off' }, { value: 'low' }, { value: 'high' }] }]

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('dshLaunch：没有 apiKey 就不设 DEEPSEEK_API_KEY，env 只留钥匙变量', () => {
  const base = { taskId: 'env-check', workspace: scratch('sidemate-sw-ws-'), lowRoot: scratch('sidemate-sw-low-'), prompt: 'hi' }
  const none = dshLaunch(base)
  assert.equal('DEEPSEEK_API_KEY' in none.env, false, '不给钥匙时环境里不能有这个变量')
  // 除了桌伴自己的插话补丁和重试播报那份，没有别的补丁（模式那份并进插话那份了）
  assert.equal(none.patches.length, 2)
  assert.match(readFileSync(none.patches[0], 'utf8'), /_sidemate\/steer/)
  assert.match(readFileSync(join(none.home, 'patches', 'steer-plugin.mjs'), 'utf8'), /_sidemate\/mode/)
  assert.match(readFileSync(none.patches[1], 'utf8'), /sidemate-retry/)
  assert.equal('DEEPSEEK_API_KEY' in dshLaunch({ ...base, apiKey: '' }).env, false, '空钥匙也不设')
  assert.equal(dshLaunch({ ...base, apiKey: 'abc' }).env.DEEPSEEK_API_KEY, 'abc')
  const mixed = dshLaunch({
    ...base,
    env: {
      SIDEMATE_KEY_A: 'v1',
      SIDEMATE_KEY_2_B: 'v2',
      SIDEMATE_KEY_lower: 'no',
      SIDEMATE_KEY_EMPTY: '',
      SIDEMATE_MCP_KEY_GITHUB: 'v3',
      SIDEMATE_MCP_KEY_lower: 'no',
      SIDEMATE_MCP_GITHUB: 'old',
      PATH: 'C:\\evil',
      DEEPSEEK_API_KEY: 'evil',
      OTHER: 'x',
    },
  })
  assert.equal(mixed.env.SIDEMATE_KEY_A, 'v1')
  assert.equal(mixed.env.SIDEMATE_KEY_2_B, 'v2')
  assert.equal('SIDEMATE_MCP_KEY_GITHUB' in mixed.env, false, '外部工具的钥匙变量不进环境变量：它随建会话的参数走')
  assert.equal('SIDEMATE_KEY_lower' in mixed.env, false, '小写名字不合规')
  assert.equal('SIDEMATE_MCP_KEY_lower' in mixed.env, false, '外部工具钥匙的小写名字也不合规')
  assert.equal('SIDEMATE_MCP_GITHUB' in mixed.env, false, '名字里不带 KEY 的旧写法不收：dsh 不会替脚本剥掉它')
  assert.equal('SIDEMATE_KEY_EMPTY' in mixed.env, false, '空值不进环境')
  assert.equal('OTHER' in mixed.env, false, '别的名字一律丢掉')
  assert.notEqual(mixed.env.PATH, 'C:\\evil', 'env 不能顺手改掉保留变量')
  assert.equal('DEEPSEEK_API_KEY' in mixed.env, false, 'env 不能顺手塞 DeepSeek 钥匙')
})

test('dshLaunch：全局配置不在这儿写，插件补丁排在内置补丁后面', () => {
  const lowRoot = scratch('sidemate-sw-low-')
  const texts = ['- id: one\n  config: {}\n', '- id: two\n  config: {}\n']
  const launch = dshLaunch({
    taskId: 'a/b 中文',
    workspace: scratch('sidemate-sw-ws-'),
    lowRoot,
    prompt: 'hi',
    patchTexts: texts,
  })
  // 全局配置（模型路线、联网、技能开关）只有设置那边写：起进程不碰那份文件
  // （两个任务同时跑的时候各写各的会互相覆盖）
  assert.equal(existsSync(join(lowRoot, 'dsh', 'cordis.patch.yml')), false)
  // 插话那份（含模式）和重试播报那份是插件：起进程时只装一次
  assert.equal(launch.patches.length, 2)
  const steerPath = launch.patches[0]
  assert.equal(steerPath, join(lowRoot, 'patches', 'sidemate-steer.patch.yml'))
  assert.match(readFileSync(steerPath, 'utf8'), /_sidemate\/steer/)
  assert.match(readFileSync(join(lowRoot, 'patches', 'steer-plugin.mjs'), 'utf8'), /_sidemate\/mode/)
  assert.ok(launch.args.indexOf(steerPath) > 0, '插话补丁要出现在启动参数里')
  // 重试播报那份：插一行自己的插件
  const retryPath = launch.patches[1]
  assert.equal(retryPath, join(lowRoot, 'patches', 'sidemate-retry.patch.yml'))
  assert.match(readFileSync(retryPath, 'utf8'), /sidemate-retry/)
  assert.ok(launch.args.indexOf(retryPath) > 0, '重试播报补丁要出现在启动参数里')
  // 播报文件的位置从环境变量给桌伴，插件照那个写
  assert.equal(launch.env.DSH_SIDEMATE_RETRY_FILE, launch.retryFile)
  assert.ok(launch.retryFile.startsWith(join(lowRoot, 'temp')), launch.retryFile)
  const builtins = patchFiles()
  const lastBuiltin = launch.args.lastIndexOf(builtins[builtins.length - 1])
  for (const path of launch.patches) {
    assert.ok(launch.args.indexOf(path) > lastBuiltin, '会话补丁要排在内置补丁后面')
  }
})

test('钥匙和模型都没有时按 key 报错，不起进程', async () => {
  const events = []
  const handle = runTask({
    taskId: 'no-key',
    payloadRoot: scratch('sidemate-sw-peer-'),
    workspace: scratch('sidemate-sw-ws-'),
    lowRoot: scratch('sidemate-sw-low-'),
    prompt: 'hi',
    onEvent: (event) => events.push(event),
  })
  const end = await handle.done
  assert.equal(end.status, 'error', JSON.stringify(events))
  const error = events.find((event) => event.type === 'error')
  assert.equal(error?.reason, 'key')
  // 没配密钥（Si101），停工那句要的厂商名带出去
  assert.equal(error?.code, 'Si101')
  assert.deepEqual(error?.vars, { vendor: 'DeepSeek' })
  assert.equal(handle.pid, undefined)
})

test('传了 model：先 set_config_option(model) 再 prompt，全程不带 DeepSeek 钥匙', async () => {
  const { end, events, trace } = await drive(
    { configOptions: MODEL_OPTIONS, afterModel: [MODEL_OPTIONS[0]] },
    { model: { value: KILO } },
  )
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(trace().map((item) => item.kind), ['new', 'set', 'prompt'])
  assert.deepEqual(trace()[1], { kind: 'set', configId: 'model', value: KILO })
  assert.equal(trace()[0].deepseekKey, false, '没给 apiKey 时子进程环境里没有 DEEPSEEK_API_KEY')
  assert.deepEqual(trace()[0].keyVars, [], '没传 env 时没有钥匙变量')
  assert.ok(events.some((event) => event.type === 'reply' && event.text.includes('好了')))
})

test('effort 只在切完后的回包还提供时才发', async () => {
  const withEffort = await drive(
    { configOptions: [...MODEL_OPTIONS, ...EFFORT_OPTIONS], afterModel: [MODEL_OPTIONS[0], ...EFFORT_OPTIONS] },
    { model: { value: KILO, effort: 'low' } },
  )
  assert.equal(withEffort.end.status, 'done', JSON.stringify(withEffort.events))
  assert.deepEqual(withEffort.trace().map((item) => item.kind), ['new', 'set', 'set', 'prompt'])
  assert.deepEqual(withEffort.trace()[2], { kind: 'set', configId: 'reasoning_effort', value: 'low' })

  // 切到免费通道后只剩 model，没有思考档位，就不能再发 reasoning_effort。
  const withoutEffort = await drive(
    { configOptions: [...MODEL_OPTIONS, ...EFFORT_OPTIONS], afterModel: [MODEL_OPTIONS[0]] },
    { model: { value: KILO, effort: 'high' } },
  )
  assert.equal(withoutEffort.end.status, 'done', JSON.stringify(withoutEffort.events))
  assert.deepEqual(withoutEffort.trace().filter((item) => item.kind === 'set').map((item) => item.configId), ['model'])
})

test('模型不在选项里：reason 是 model，且没发 prompt', async () => {
  const { end, events, trace } = await drive(
    { configOptions: [{ id: 'model', options: [{ value: DEEPSEEK }] }] },
    { model: { value: KILO } },
  )
  assert.equal(end.status, 'error', JSON.stringify(events))
  const error = events.find((event) => event.type === 'error')
  assert.equal(error?.reason, 'model')
  assert.equal(codeOf(error), 'Si103')
  assert.equal(stopText(error), '模型不可用')
  assert.deepEqual(trace().map((item) => item.kind), ['new'], '不该再发 set 和 prompt')
})

test('续会话没带回选项：跳过核对仍切模型；带回了就照常核对', async () => {
  const skipped = await drive(
    { configOptions: MODEL_OPTIONS, afterModel: [MODEL_OPTIONS[0]] },
    { sessionId: 'peer-old', model: { value: KILO } },
  )
  assert.equal(skipped.end.status, 'done', JSON.stringify(skipped.events))
  assert.deepEqual(skipped.trace().map((item) => item.kind), ['resume', 'set', 'prompt'])

  const refused = await drive(
    { configOptions: MODEL_OPTIONS, resumeOptions: [{ id: 'model', options: [{ value: DEEPSEEK }] }] },
    { sessionId: 'peer-old', model: { value: KILO } },
  )
  assert.equal(refused.end.status, 'error', JSON.stringify(refused.events))
  assert.deepEqual(refused.trace().map((item) => item.kind), ['resume'])
})

test('usage_update 不再往上发 model-call；没传 model 时一笔 set 都不发', async () => {
  const once = await drive({ configOptions: MODEL_OPTIONS }, { apiKey: 'sidemate-switch-key' })
  assert.equal(once.end.status, 'done', JSON.stringify(once.events))
  assert.deepEqual(once.trace().map((item) => item.kind), ['new', 'prompt'])
  assert.equal(once.events.filter((event) => event.type === 'model-call').length, 0)

  const twice = await drive({ configOptions: MODEL_OPTIONS, usageTimes: 2 }, { apiKey: 'sidemate-switch-key' })
  assert.equal(twice.end.status, 'done', JSON.stringify(twice.events))
  assert.equal(twice.events.filter((event) => event.type === 'model-call').length, 0)
})

test('env 里的钥匙在日志和回复里都打成 ***', async () => {
  const secret = 'sidemate-env-key-value'
  const { end, events, logs, handle, trace } = await drive(
    { configOptions: MODEL_OPTIONS, echoEnv: 'SIDEMATE_KEY_SWITCH' },
    { env: { SIDEMATE_KEY_SWITCH: secret, SIDEMATE_NOT_KEY: 'sidemate-not-key-value' }, apiKey: 'sidemate-switch-key' },
  )
  assert.equal(end.status, 'done', JSON.stringify(events))
  assert.deepEqual(trace()[0].keyVars, ['SIDEMATE_KEY_SWITCH'], '名字不合规的变量不进子进程')
  const reply = events.find((event) => event.type === 'reply')
  assert.equal(reply?.text, '***', '回复里的钥匙要被打码')
  assert.equal(existsSync(handle.logPath), true)
  const log = readFileSync(handle.logPath, 'utf8')
  for (const blob of [log, logs.join('\n'), JSON.stringify(events)]) {
    assert.ok(!blob.includes(secret), '日志和事件里不能出现钥匙')
  }
  assert.ok(log.includes('echo ***'), '对方 stderr 回显的钥匙也要被打码')
})

test('模型那边的报错：没有 dsh 的码时不猜，原文带出去，码是桌伴自己的 Si 码', async () => {
  // 这个假 ACP 服务不发会话事件，所以没有 dsh 的码（真 dsh 那条路在 test/dsh/retry-kinds.test.mjs 里）。
  // 桌伴不拿英文原文猜错的种类：只报原文，码是 Si 码。
  const cases = [
    {
      config: { configOptions: MODEL_OPTIONS, error: { code: -32603, message: 'Internal error: turn failed: llm-pi-ai: no credential for provider route "kimi"' } },
      vendor: 'Kimi',
    },
    {
      config: { configOptions: MODEL_OPTIONS, error: { code: -32603, message: 'Internal error: turn failed: Insufficient Balance' } },
      vendor: 'Kimi',
    },
    {
      config: { configOptions: MODEL_OPTIONS, error: { code: -32603, message: 'Internal error: turn failed: DeepSeek Messages transport failed' } },
      vendor: 'Kimi',
    },
    {
      // 免费通道大家一起忙：也是「模型忙」
      config: { configOptions: MODEL_OPTIONS, error: { code: -32603, message: 'Internal error: turn failed: Rate limit reached for requests' } },
      free: true,
    },
    {
      config: { configOptions: MODEL_OPTIONS, error: { code: -32603, message: 'Internal error: turn failed: Rate limit reached for requests' } },
    },
  ]
  for (const item of cases) {
    const { end, events } = await drive(item.config, { vendor: item.vendor, free: item.free, apiKey: 'sidemate-switch-key' })
    assert.equal(end.status, 'error', JSON.stringify(events))
    const error = events.find((event) => event.type === 'error')
    // 没有 dsh 的码：桌伴不猜，只说「模型请求失败」，码是 Si 码
    assert.equal(error?.dshCode, '', JSON.stringify(error))
    assert.match(codeOf(error), /^Si\d{3}$/, JSON.stringify(error))
    assert.equal(stopText(error, codeOf(error)), '模型请求失败，已保存执行进度', JSON.stringify(error))
    assert.match(error.raw, /turn failed/)
  }
})
