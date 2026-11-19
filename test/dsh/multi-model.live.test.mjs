import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { dshLaunch } from '../../app/dsh/index.mjs'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { choiceValue, noDeepseekYaml, routesYaml } from '../../app/dsh/models.mjs'
import { envName } from '../../app/models/keys.mjs'
import { addCustom, defaults } from '../../app/models/catalog.mjs'

const payloadRoot = 'C:/deskware/work/rel-final3/payload'
// Kilo 那条线路的路线配置是代码生成的（地址和模型都是常量），写进临时补丁文件挂给 dsh
function kiloPatchFile() {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-kilo-patch-'))
  const path = join(dir, 'kilo.patch.yml')
  writeFileSync(path, routesYaml(defaults(), { consented: true }), 'utf8')
  return path
}

test('Kilo can join the ACP catalog and answer after a model switch', {
  skip: process.env.SIDEMATE_LIVE_KILO !== '1',
  timeout: 180_000,
}, async (t) => {
  const lowRoot = mkdtempSync(join(tmpdir(), 'sidemate-kilo-low-'))
  const workspace = mkdtempSync(join(tmpdir(), 'sidemate-kilo-ws-'))
  const launch = dshLaunch({
    payloadRoot,
    lowRoot,
    workspace,
    taskId: 'kilo-live',
    apiKey: 'dummy-key-for-live',
  })
  mkdirSync(launch.dshHome, { recursive: true })
  mkdirSync(launch.temp, { recursive: true })
  mkdirSync(dirname(launch.logPath), { recursive: true })

  const child = spawn(launch.command, [...launch.args, '--patch', kiloPatchFile()], {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pending = new Map()
  const replyParts = []
  let seq = 0
  let buffer = ''
  let stderr = ''
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const watchdog = setTimeout(() => child.kill(), 150_000)

  const rejectPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  child.on('error', rejectPending)
  child.on('exit', () => rejectPending(new Error(`dsh exited: ${stderr}`)))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const request = (method, params) => {
    const id = ++seq
    const message = { jsonrpc: '2.0', id, method, params }
    t.diagnostic(`REQUEST ${JSON.stringify(message)}`)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send(message)
    })
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.method === 'session/request_permission') {
        if (message.id !== undefined) {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: 'reject-once' } },
          })
        }
        continue
      }
      if (message.method === 'session/update') {
        const update = message.params?.update
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          replyParts.push(update.content.text || '')
        }
        continue
      }
      if (message.method && message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
        continue
      }
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      t.diagnostic(`RESPONSE ${JSON.stringify(message)}`)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  })

  t.after(() => {
    clearTimeout(watchdog)
    child.kill()
    rmSync(lowRoot, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  try {
    await request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'sidemate-live-probe', version: '0.1.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    const created = await request('session/new', { cwd: workspace, mcpServers: [] })
    const modelOption = created.configOptions?.find(option => option.id === 'model')
    const kiloValue = JSON.stringify(['kilo', 'kilo-auto/free'])
    const kiloChoice = modelOption?.options?.find(group => group.group === 'kilo')?.options
      .find(option => option.value === kiloValue)
    assert.ok(kiloChoice, 'session/new should advertise kilo/kilo-auto/free')

    const switched = await request('session/set_config_option', {
      sessionId: created.sessionId,
      configId: 'model',
      value: kiloValue,
    })
    assert.equal(switched.configOptions.find(option => option.id === 'model')?.currentValue, kiloValue)

    const reasoning = switched.configOptions.find(option => option.id === 'reasoning_effort')
    const nextEffort = reasoning?.options.find(option => option.value !== reasoning.currentValue)
    if (reasoning && nextEffort) {
      const effort = await request('session/set_config_option', {
        sessionId: created.sessionId,
        configId: 'reasoning_effort',
        value: nextEffort.value,
      })
      assert.equal(effort.configOptions.find(option => option.id === 'reasoning_effort')?.currentValue, nextEffort.value)
    } else {
      t.diagnostic('REASONING_EFFORT none')
    }

    const started = Date.now()
    const prompted = await request('session/prompt', {
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: '只回一个字：好' }],
    })
    const reply = replyParts.join('')
    t.diagnostic(`KILO_REPLY ${JSON.stringify({ reply, elapsedMs: Date.now() - started, result: prompted })}`)
    assert.ok(reply.trim(), 'Kilo should return non-empty assistant text')
    await request('session/close', { sessionId: created.sessionId })
    child.stdin.end()
    await exited
  } finally {
    t.diagnostic(`DSH_LOG ${launch.logPath}`)
    t.diagnostic(`STDERR ${JSON.stringify(stderr)}`)
  }
})

// 把目录下所有文本文件读出来，用来检查 dsh 自己落盘的日志里没没官方地址。
function collectText(dir, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    const path = join(dir, name)
    let st
    try { st = statSync(path) } catch { continue }
    if (st.isDirectory()) collectText(path, out)
    else {
      try { out.push(readFileSync(path, 'utf8')) } catch { /* 不是文本就跳过 */ }
    }
  }
  return out
}

test('no DeepSeek key: kilo and custom routes run without touching api.deepseek.com', {
  skip: process.env.SIDEMATE_LIVE_KILO !== '1',
  timeout: 180_000,
}, async (t) => {
  const lowRoot = mkdtempSync(join(tmpdir(), 'sidemate-routes-low-'))
  const workspace = mkdtempSync(join(tmpdir(), 'sidemate-routes-ws-'))
  const patchDir = mkdtempSync(join(tmpdir(), 'sidemate-routes-patch-'))
  const added = addCustom(defaults(), {
    name: '样例通道',
    protocol: 'openai',
    baseUrl: 'https://no-such-host.invalid/v1',
    models: [{ id: 'fake-model', name: '样例模型' }],
  })
  assert.ok(added.ok, `样例清单要能生成：${JSON.stringify(added.errors)}`)
  const routesPath = join(patchDir, 'models.patch.yml')
  writeFileSync(routesPath, routesYaml(added.catalog, { consented: true }), 'utf8')
  const noDeepseekPath = join(patchDir, 'no-deepseek.patch.yml')
  writeFileSync(noDeepseekPath, noDeepseekYaml(), 'utf8')

  const launch = dshLaunch({
    payloadRoot,
    lowRoot,
    workspace,
    taskId: 'routes-live',
    apiKey: 'dummy-key-not-real',
  })
  // 接线后自定义条目的钥匙会从钥匙环进环境变量；测试里放个假值，让这条路线能列进选项。
  launch.env[envName(added.id)] = 'dummy-key-not-real'
  mkdirSync(launch.dshHome, { recursive: true })
  mkdirSync(launch.temp, { recursive: true })
  mkdirSync(dirname(launch.logPath), { recursive: true })

  const child = spawn(launch.command, [...launch.args, '--patch', routesPath, '--patch', noDeepseekPath], {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const pending = new Map()
  const replyParts = []
  const transcript = []
  let seq = 0
  let buffer = ''
  let stderr = ''
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const watchdog = setTimeout(() => child.kill(), 150_000)

  const rejectPending = (error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  child.on('error', rejectPending)
  child.on('exit', () => rejectPending(new Error(`dsh exited: ${stderr}`)))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    stderr += chunk
    for (const line of chunk.split(/\r?\n/)) if (line.trim()) transcript.push(line.trim())
  })

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
  const request = (method, params) => {
    const id = ++seq
    const message = { jsonrpc: '2.0', id, method, params }
    t.diagnostic(`REQUEST ${JSON.stringify(message)}`)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send(message)
    })
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      transcript.push(line)
      const message = JSON.parse(line)
      if (message.method === 'session/request_permission') {
        if (message.id !== undefined) {
          send({
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: { outcome: 'selected', optionId: 'reject-once' } },
          })
        }
        continue
      }
      if (message.method === 'session/update') {
        const update = message.params?.update
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          replyParts.push(update.content.text || '')
        }
        continue
      }
      if (message.method && message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
        continue
      }
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      t.diagnostic(`RESPONSE ${JSON.stringify(message)}`)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  })

  t.after(() => {
    clearTimeout(watchdog)
    child.kill()
    rmSync(lowRoot, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    rmSync(patchDir, { recursive: true, force: true })
  })

  try {
    await request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'sidemate-live-probe', version: '0.1.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    const created = await request('session/new', { cwd: workspace, mcpServers: [] })
    const modelOption = created.configOptions?.find(option => option.id === 'model')
    const groups = new Set((modelOption?.options ?? []).map(group => group.group))
    assert.ok(groups.has('kilo'), 'session/new 要有免费通道分组')
    assert.ok(groups.has(added.id), 'session/new 要有自定义条目分组')
    const kiloValue = choiceValue('free', 'kilo-auto/free')
    const kiloGroup = (modelOption?.options ?? []).find(group => group.group === 'kilo')
    assert.ok(
      kiloGroup?.options.some(option => option.value === kiloValue),
      '免费通道的模型值要能用 choiceValue 算出来',
    )

    const switched = await request('session/set_config_option', {
      sessionId: created.sessionId,
      configId: 'model',
      value: kiloValue,
    })
    assert.equal(switched.configOptions.find(option => option.id === 'model')?.currentValue, kiloValue)

    const started = Date.now()
    const prompted = await request('session/prompt', {
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: '只回一个字：好' }],
    })
    const reply = replyParts.join('')
    t.diagnostic(`KILO_REPLY ${JSON.stringify({ reply, elapsedMs: Date.now() - started, result: prompted })}`)
    assert.ok(reply.trim(), '切到免费通道后要能正常回复')
    await request('session/close', { sessionId: created.sessionId })
    child.stdin.end()
    await exited
  } finally {
    t.diagnostic(`DSH_LOG ${launch.logPath}`)
    t.diagnostic(`STDERR ${JSON.stringify(stderr)}`)
    const onDisk = collectText(lowRoot).join('\n')
    const everything = `${transcript.join('\n')}\n${onDisk}`
    assert.ok(
      !everything.includes('api.deepseek.com'),
      `全程不能出现 DeepSeek 官方地址：${JSON.stringify(everything.slice(0, 400))}`,
    )
  }
})

test('runTask 接线：不给 DeepSeek 钥匙，免费通道跑完一轮', {
  skip: process.env.SIDEMATE_LIVE_KILO !== '1',
  timeout: 180_000,
}, async (t) => {
  const lowRoot = mkdtempSync(join(tmpdir(), 'sidemate-drive-low-'))
  const workspace = mkdtempSync(join(tmpdir(), 'sidemate-drive-ws-'))
  const events = []
  const logs = []
  t.after(() => {
    rmSync(lowRoot, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })
  // 直接用 runTask，不自己发 JSON-RPC：钥匙不给，路线补丁用 patchTexts 传文字。
  const handle = runTask({
    taskId: 'drive-live',
    payloadRoot,
    lowRoot,
    workspace,
    prompt: '只回一个字：好',
    patchTexts: [routesYaml(defaults(), { consented: true }), noDeepseekYaml()],
    model: { value: choiceValue('free', 'kilo-auto/free') },
    vendor: '免费通道',
    free: true,
    onEvent: (event) => events.push(event),
    onLog: (line) => logs.push(line),
  })
  const end = await handle.done
  const replies = events.filter((event) => event.type === 'reply').map((event) => event.text).join('')
  const modelCalls = events.filter((event) => event.type === 'model-call').length
  const kinds = events.map((event) => event.type).join(',')
  t.diagnostic(`MODEL_CALLS ${modelCalls}`)
  t.diagnostic(`REPLY ${JSON.stringify(replies)}`)
  t.diagnostic(`EVENTS ${kinds}`)
  t.diagnostic(`SESSION ${handle.sessionId}`)
  assert.equal(end.status, 'done', JSON.stringify({ end, tail: logs.slice(-15) }))
  assert.ok(replies.trim(), '要有回复')
  assert.ok(modelCalls >= 1, '至少一条 model-call')
  const logText = existsSync(handle.logPath) ? readFileSync(handle.logPath, 'utf8') : ''
  const onDisk = collectText(lowRoot).join('\n')
  for (const blob of [logText, logs.join('\n'), onDisk]) {
    assert.ok(!blob.includes('api.deepseek.com'), `全程不能出现 DeepSeek 官方地址：${JSON.stringify(blob.slice(0, 400))}`)
  }
})
