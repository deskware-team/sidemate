import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, patchFiles, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { failText, progressText } from '../../app/dsh/progress.mjs'
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

function denyRead(file) {
  if (process.platform !== 'win32') return chmodSync(file, 0)
  const run = spawnSync('icacls', [file, '/deny', '*S-1-1-0:(RD)'], { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
}

function allowRead(file) {
  if (process.platform !== 'win32') return chmodSync(file, 0o644)
  spawnSync('icacls', [file, '/remove:d', '*S-1-1-0'], { windowsHide: true })
}

function treeHas(dir, needle) {
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()
    let names
    try {
      names = readdirSync(current)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(current, name)
      let st
      try {
        st = statSync(path)
      } catch {
        continue
      }
      if (st.isDirectory()) pending.push(path)
      else if (st.isFile() && st.size < 2_000_000) {
        try {
          if (readFileSync(path).includes(Buffer.from(needle))) return true
        } catch {
          // unreadable files are not our log
        }
      }
    }
  }
  return false
}

function taskOptions(extra) {
  const workspace = scratch('sidemate-ws-')
  const lowRoot = scratch('sidemate-low-')
  return { workspace, lowRoot, ...extra }
}

function replyTexts(events) {
  return events.filter(event => event.type === 'reply').map(event => event.text)
}

async function runScript(taskId, respond) {
  const events = []
  const logs = []
  const trace = []
  const fake = await startFake({ expectKey: KEY, respond })
  try {
    const handle = runTask(taskOptions({
      taskId,
      apiKey: KEY,
      prompt: '说',
      baseUrl: fake.url,
      searchBaseUrl: fake.url,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'reply' || event.type === 'progress') trace.push(`${event.type}:${event.text}`)
      },
      onLog: (line) => {
        logs.push(line)
        if (line.startsWith('usage_update')) trace.push('usage_update')
      },
    }))
    return { events, logs, trace, end: await handle.done, handle }
  } finally {
    await fake.close()
  }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('progress text stays a sentence', () => {
  assert.equal(progressText({ sessionUpdate: 'tool_call', title: 'web_search' }), 'search')
  assert.equal(progressText({
    sessionUpdate: 'tool_call',
    title: 'write',
    rawInput: { file_path: '/tmp/桌伴/hello.docx' },
  }), 'write hello.docx')
  assert.equal(progressText({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: '  写好了 \n' },
  }), '')
  assert.equal(progressText({ sessionUpdate: 'usage_update', used: 1, size: 2 }), '')
})

test('patches keep the R3 files; PowerShell 用 dsh 自己的默认查找顺序', () => {
  const files = patchFiles()
  assert.equal(files.some(file => file.endsWith('office.patch.yml')), true)
  // 审批用 dsh 原生的 ask：桌伴把申请转到任务窗
  assert.equal(files.some(file => file.endsWith('ask.patch.yml')), true)
  // 不再强制指向系统自带的 PowerShell 5.1
  assert.equal(files.some(file => file.endsWith('ps51.patch.yml')), false)
  const office = readFileSync(new URL('../../app/dsh/office.patch.yml', import.meta.url), 'utf8')
  const ask = readFileSync(new URL('../../app/dsh/ask.patch.yml', import.meta.url), 'utf8')
  assert.match(office, /load_workspace_dependencies|dsh-tool-workspace-dependencies/)
  assert.match(office, /DSH_PRIMARY_RUNTIME/)
  assert.match(ask, /policy: ask/)
  assert.match(ask, /sandbox: workspace-write/)
})

test('a missing runtime reports an error and stays up', async () => {
  const events = []
  const handle = runTask({
    taskId: 'missing',
    workspace: scratch('sidemate-ws-'),
    prompt: 'hi',
    apiKey: KEY,
    payloadRoot: scratch('sidemate-empty-'),
    lowRoot: scratch('sidemate-low-'),
    onEvent: (event) => events.push(event),
  })
  const end = await handle.done
  assert.equal(end.status, 'error')
  assert.equal(events.some(event => event.type === 'error'), true)
  assert.equal(events.every(event => event.taskId === 'missing' && Number.isInteger(event.at)), true)
})

describe('fake messages', { concurrency: 1 }, () => {
  test('patches attach on the acp profile', { timeout: 60_000 }, () => {
    ensureNode()
    assert.equal(existsSync(layout.dsh), true)
    const options = taskOptions({ taskId: 'dump', apiKey: KEY, prompt: 'hi', workspace: scratch('sidemate-ws-') })
    const launch = dshLaunch(options)
    const dumped = spawnSync(launch.command, [...launch.args, '--dump-config'], {
      cwd: launch.cwd,
      env: launch.env,
      encoding: 'utf8',
      timeout: 40_000,
    })
    const text = `${dumped.stdout}\n${dumped.stderr}`
    assert.equal(dumped.status, 0, text)
    assert.match(text, /workspace-dependencies/)
    assert.match(text, /skill-office/)
    assert.match(text, /policy: ask/)
    // 起会话名那次调用打开了：任务名先用第一句话占位，dsh 起好再换上
    assert.match(text, /session-title-llm[\s\S]{0,200}disabled: false/)
    assert.equal(text.includes(KEY), false)
  })

  test('ten scripted runs finish without a crash', { timeout: 180_000 }, async () => {
    ensureNode()
    const fake = await startFake({
      expectKey: KEY,
      respond: () => ({ kind: 'text', text: '好了', usage: { input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } }),
    })
    try {
      for (let i = 0; i < 10; i++) {
        const events = []
        const options = taskOptions({
          taskId: `run-${i}`,
          apiKey: KEY,
          prompt: '说一声好了',
          baseUrl: fake.url,
          onEvent: (event) => events.push(event),
        })
        const handle = runTask(options)
        const end = await handle.done
        assert.equal(end.status, 'done', JSON.stringify(events))
        const usage = events.find(event => event.type === 'usage')
        assert.equal(usage?.inputTokens, 11)
        assert.equal(usage?.outputTokens, 4)
        assert.equal(usage?.cacheReadTokens, 2)
        assert.equal(usage?.cacheWriteTokens, 1)
        assert.equal(usage?.searches, 0)
        assert.equal(events.some(event => event.type === 'reply' && event.text.includes('好了')), true)
        assert.equal(events.some(event => event.type === 'progress' && event.text.includes('好了')), false)
        const closing = events.filter(event => ['reply', 'artifact', 'usage', 'end'].includes(event.type)).map(event => event.type)
        assert.deepEqual(closing, ['reply', 'usage', 'end'])
        const log = readFileSync(handle.logPath, 'utf8')
        assert.equal(log.includes(KEY), false)
        assert.match(log, /usage_update/)
        assert.equal(treeHas(options.lowRoot, KEY), false)
      }
    } finally {
      await fake.close()
    }
  })

  // 一个只说 ACP 的假对端：启动快、静默时长写在 peer.json 里，用来按毫秒验提示和停的节拍
  const PEER_SCRIPT = `
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const cfg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'peer.json'), 'utf8'))
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
const say = (text) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'peer-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text } } } })
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
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'peer-1' } })
    else if (msg.method === 'session/prompt') {
      say('开头')
      if (cfg.hang) return
      setTimeout(() => {
        say('好了')
        send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      }, cfg.waitMs)
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
})
`

  function fakePeer(config) {
    const root = scratch('sidemate-peer-')
    mkdirSync(join(root, 'node'), { recursive: true })
    const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
    copyFileSync(process.execPath, node)
    chmodSync(node, 0o755)
    const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'bin.js'), PEER_SCRIPT)
    writeFileSync(join(root, 'peer.json'), JSON.stringify(config))
    return root
  }

  // 静了好一会儿不再冒「还在等它回话」那一句：界面上的状态行自己说（pulse），这里只看不停、不报错
  test('a quiet stretch finishes without a hint line', { timeout: 60_000 }, async () => {
    const events = []
    const handle = runTask(taskOptions({
      taskId: 'quiet',
      apiKey: KEY,
      prompt: '写长一点',
      payloadRoot: fakePeer({ waitMs: 2_000 }),
      onEvent: (event) => events.push(event),
    }))
    const end = await handle.done
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.equal(events.some(event => event.type === 'progress' && event.hint === true), false, JSON.stringify(events.map(event => [event.type, event.text || event.message || ''])))
    assert.equal(events.some(event => event.type === 'reply' && event.text.includes('好了')), true)
    assert.equal(events.some(event => event.type === 'error'), false)
    assert.throws(() => process.kill(handle.pid, 0))
  })

  test('bundled python is what the workspace tool returns', { timeout: 60_000 }, async (t) => {
    ensureNode()
    if (!existsSync(join(layout.python, 'runtime.json'))) {
      t.skip('bundled python is not installed')
      return
    }
    let result = ''
    const fake = await startFake({
      expectKey: KEY,
      respond: (body) => {
        const raw = JSON.stringify(body)
        if (raw.includes('tool_result')) {
          result = raw
          return { kind: 'text', text: '好了' }
        }
        return { kind: 'tool', name: 'load_workspace_dependencies', input: {} }
      },
    })
    const events = []
    try {
      const end = await runTask({
        ...taskOptions({ taskId: 'py', apiKey: KEY, prompt: '准备', baseUrl: fake.url }),
        onEvent: (event) => events.push(event),
      }).done
      assert.equal(end.status, 'done', JSON.stringify(events))
      assert.match(result, process.platform === 'win32' ? /python\.exe/i : /python3/)
      assert.equal(/primary runtime|is_error":true/.test(result), false, result.slice(0, 1500))
    } finally {
      await fake.close()
    }
  })

  test('a scripted write shows up as an artifact', { timeout: 60_000 }, async () => {
    ensureNode()
    const options = taskOptions({ taskId: 'file', apiKey: KEY, prompt: '写' })
    const target = join(options.workspace, 'hello.txt')
    const fake = await startFake({
      expectKey: KEY,
      respond: (body) => {
        const raw = JSON.stringify(body)
        if (raw.includes('tool_result')) return { kind: 'text', text: '写好了' }
        return { kind: 'tool', name: 'write', input: { file_path: target, content: 'hello' } }
      },
    })
    const events = []
    try {
      options.baseUrl = fake.url
      options.onEvent = (event) => events.push(event)
      const end = await runTask(options).done
      assert.equal(end.status, 'done', JSON.stringify(events))
      assert.equal(readFileSync(target, 'utf8'), 'hello')
      assert.equal(events.some(event => event.type === 'artifact' && event.name === 'hello.txt' && event.path === target), true)
      assert.equal(events.some(event => event.type === 'progress' && event.text === 'write hello.txt'), true)
    } finally {
      await fake.close()
    }
  })

  test('cancel stops the round within two seconds', { timeout: 60_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'hang' }) })
    try {
      const handle = runTask(taskOptions({
        taskId: 'cancel',
        apiKey: KEY,
        prompt: '停',
        baseUrl: fake.url,
      }))
      await new Promise(resolve => setTimeout(resolve, 500))
      const started = Date.now()
      handle.cancel()
      const end = await handle.done
      assert.equal(end.status, 'cancelled')
      assert.ok(Date.now() - started < 2_000)
      // 停下是 session/cancel：那个常驻的 dsh 进程不一定马上没（别的会话还要用），
      // 收进程是桌伴退出时的事。
      assert.ok(handle.pid > 0)
    } finally {
      await fake.close()
    }
  })

  test('danger-full-access asks the user; a refusal writes nothing and the key stays out of the log', { timeout: 60_000 }, async () => {
    ensureNode()
    const outside = join(scratch('sidemate-out-'), 'secret.txt')
    let sawRejection = false
    const fake = await startFake({
      expectKey: KEY,
      respond: (body) => {
        const raw = JSON.stringify(body)
        if (raw.includes('tool_result')) {
          sawRejection = /rejected|denied|拒绝/i.test(raw)
          return { kind: 'text', text: '停了' }
        }
        return {
          kind: 'tool',
          name: 'write',
          input: {
            file_path: outside,
            content: 'nope',
            sandbox_permissions: 'danger-full-access',
            justification: 'need full access',
          },
        }
      },
    })
    const events = []
    const logs = []
    try {
      let handle = null
      handle = runTask(taskOptions({
        taskId: 'deny',
        apiKey: KEY,
        prompt: '写到外面',
        baseUrl: fake.url,
        onEvent: (event) => {
          events.push(event)
          // 用户说不行
          if (event.type === 'permission') void handle.answerPermission(event.id, 'reject')
        },
        onLog: (line) => logs.push(line),
      }))
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify({ events, calls: fake.calls.length }))
      assert.equal(existsSync(outside), false)
      assert.equal(sawRejection, true, JSON.stringify(fake.calls).slice(0, 2000))
      // 越权先问用户，用户不点头就不写
      assert.equal(events.some(event => event.type === 'permission' && event.outside === true), true)
      const log = readFileSync(handle.logPath, 'utf8')
      assert.equal(log.includes(KEY), false)
      assert.equal(logs.some(line => line.includes(KEY)), false)
      assert.equal(JSON.stringify(events).includes(KEY), false)
    } finally {
      await fake.close()
    }
  })

  test('a dead process becomes an error without taking the caller down', { timeout: 60_000 }, async () => {
    ensureNode()
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'hang' }) })
    const events = []
    try {
      const handle = runTask(taskOptions({
        taskId: 'crash',
        apiKey: KEY,
        prompt: '崩',
        baseUrl: fake.url,
        onEvent: (event) => events.push(event),
      }))
      await new Promise(resolve => setTimeout(resolve, 400))
      process.kill(handle.pid, 'SIGKILL')
      const end = await handle.done
      assert.equal(end.status, 'error')
      // 中途退出：跟起不来一样算程序崩溃（Si301）
      assert.equal(events.some(event => event.type === 'error' && event.reason === 'crash'), true)
    } finally {
      await fake.close()
    }
  })

  test('an echoed key is scrubbed from progress and the log', { timeout: 60_000 }, async () => {
    ensureNode()
    const fake = await startFake({
      expectKey: KEY,
      respond: () => ({ kind: 'text', text: `泄漏 ${KEY} 结束` }),
    })
    const events = []
    try {
      const handle = runTask(taskOptions({
        taskId: 'redact',
        apiKey: KEY,
        prompt: '重复',
        baseUrl: fake.url,
        onEvent: (event) => events.push(event),
      }))
      const end = await handle.done
      assert.equal(end.status, 'done')
      const blob = `${JSON.stringify(events)}\n${readFileSync(handle.logPath, 'utf8')}`
      assert.equal(blob.includes(KEY), false)
      assert.match(blob, /泄漏/)
    } finally {
      await fake.close()
    }
  })

  test('a second round resumes the same session and only counts its own usage', { timeout: 60_000 }, async () => {
    ensureNode()
    const shared = taskOptions({ apiKey: KEY, prompt: '第一轮' })
    let step = 0
    const fake = await startFake({
      expectKey: KEY,
      respond: () => {
        step += 1
        if (step === 1) {
          return { kind: 'text', text: '回复一\n下一行', usage: { input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } }
        }
        return { kind: 'text', text: '回复二', usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } }
      },
    })
    try {
      const firstEvents = []
      const first = runTask({ ...shared, taskId: 'round-1', baseUrl: fake.url, onEvent: (event) => firstEvents.push(event) })
      assert.equal((await first.done).status, 'done', JSON.stringify(firstEvents))
      assert.equal(firstEvents.find(event => event.type === 'reply')?.text, '回复一\n下一行')
      assert.equal(firstEvents.find(event => event.type === 'usage')?.inputTokens, 11)
      const secondEvents = []
      const second = runTask({
        ...shared,
        taskId: 'round-2',
        sessionId: first.sessionId,
        prompt: '第二轮',
        baseUrl: fake.url,
        onEvent: (event) => secondEvents.push(event),
      })
      assert.equal((await second.done).status, 'done', JSON.stringify(secondEvents))
      assert.equal(second.sessionId, first.sessionId)
      const later = fake.calls.slice(1).map(call => JSON.stringify(call)).join('\n')
      assert.match(later, /第一轮/)
      assert.match(later, /回复一/)
      const usage = secondEvents.find(event => event.type === 'usage')
      assert.equal(usage?.inputTokens, 7)
      assert.equal(usage?.outputTokens, 3)
      assert.equal(usage?.cacheReadTokens, 1)
      assert.equal(usage?.cacheWriteTokens, 0)
    } finally {
      await fake.close()
    }
  })

  test('editing a file emits another artifact', { timeout: 60_000 }, async () => {
    ensureNode()
    const shared = taskOptions({ apiKey: KEY, prompt: '写' })
    const target = join(shared.workspace, 'hello.txt')
    let step = 0
    const fake = await startFake({
      expectKey: KEY,
      respond: () => {
        step += 1
        if (step === 1) return { kind: 'tool', name: 'write', input: { file_path: target, content: '第一份' } }
        if (step === 3) return { kind: 'tool', name: 'read', input: { file_path: target } }
        if (step === 4) return { kind: 'tool', name: 'write', input: { file_path: target, content: '第二份' } }
        return { kind: 'text', text: '好了' }
      },
    })
    try {
      const firstEvents = []
      const first = runTask({ ...shared, taskId: 'edit-1', baseUrl: fake.url, onEvent: (event) => firstEvents.push(event) })
      assert.equal((await first.done).status, 'done', JSON.stringify(firstEvents))
      assert.equal(readFileSync(target, 'utf8'), '第一份')
      assert.equal(firstEvents.filter(event => event.type === 'artifact' && event.name === 'hello.txt').length, 1)
      const secondEvents = []
      const second = runTask({
        ...shared,
        taskId: 'edit-2',
        sessionId: first.sessionId,
        prompt: '改',
        baseUrl: fake.url,
        onEvent: (event) => secondEvents.push(event),
      })
      assert.equal((await second.done).status, 'done', JSON.stringify(secondEvents))
      assert.equal(readFileSync(target, 'utf8'), '第二份')
      assert.equal(secondEvents.filter(event => event.type === 'artifact' && event.name === 'hello.txt').length, 1)
    } finally {
      await fake.close()
    }
  })

  test('http failures keep their reason', { timeout: 300_000 }, async () => {
    ensureNode()
    const cases = [
      { status: 401, body: { error: { type: 'authentication_error', message: 'Authentication Fails, Your api key is invalid' } }, reason: 'key', code: 'AUTH' },
      { status: 403, body: { error: { type: 'permission_error', message: '403 Forbidden' } }, reason: 'key', code: 'AUTH' },
      { status: 402, body: { error: { type: 'invalid_request_error', message: 'Insufficient Balance' } }, reason: 'quota', code: 'QUOTA' },
      { status: 429, body: { error: { type: 'rate_limit_error', message: 'Rate limit reached for requests' } }, reason: 'busy', code: 'RATE_LIMIT' },
      { status: 500, body: { error: { type: 'api_error', message: 'Internal server error' } }, reason: 'server', code: 'SERVER' },
    ]
    for (const item of cases) {
      const events = []
      const logs = []
      const fake = await startFake({
        expectKey: KEY,
        respond: () => ({ kind: 'status', status: item.status, body: JSON.stringify(item.body) }),
      })
      try {
        const handle = runTask(taskOptions({
          taskId: `http-${item.status}`,
          apiKey: KEY,
          prompt: '试',
          baseUrl: fake.url,
          // 这几条要重试（429、500）：测试里等不起，把退避调短、只试一次
          retryPolicy: { initialDelayMs: 10, maxDelayMs: 20, maxRetries: 1 },
          onEvent: (event) => events.push(event),
          onLog: (line) => logs.push(line),
        }))
        const end = await handle.done
        assert.equal(end.status, 'error', `${item.status} ${JSON.stringify(events)}`)
        const error = events.find(event => event.type === 'error')
        assert.equal(error?.reason, item.reason, `${item.status} ${error?.raw} ${logs.join('\n').slice(-500)}`)
        // dsh 的码和 HTTP 状态也带出来（壳照这个说停下那句、显示那一行）
        assert.equal(error?.dshCode, item.code, `${item.status} ${JSON.stringify(error)}`)
        assert.equal(error?.status, item.status, `${item.status} ${JSON.stringify(error)}`)
        // 原文带出去（壳截到 80 个字显示），钥匙不在里面
        assert.ok(error.raw.length > 0, `${item.status} 没带原文`)
        assert.equal(error.raw.includes(KEY), false)
        assert.equal(logs.join('\n').includes(KEY), false)
        assert.match(logs.join('\n'), /turn failed|Authentication|Balance|Rate limit|server error|403/)
      } finally {
        await fake.close()
      }
    }
    const events = []
    const handle = runTask(taskOptions({
      taskId: 'offline',
      apiKey: KEY,
      prompt: '试',
      baseUrl: 'http://127.0.0.1:1',
      // 连不上也要重试：测试里等不起，只试一次
      retryPolicy: { initialDelayMs: 10, maxDelayMs: 20, maxRetries: 1 },
      onEvent: (event) => events.push(event),
    }))
    const end = await handle.done
    assert.equal(end.status, 'error')
    assert.equal(events.find(event => event.type === 'error')?.reason, 'network')
  })

  test('chunks that share a message id join into one reply', { timeout: 60_000 }, async () => {
    ensureNode()
    const { end, events } = await runScript('join', () => ({ kind: 'text', id: 'same', chunks: ['你', '好'] }))
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.deepEqual(replyTexts(events), ['你好'])
  })

  // 工具调用之前的那段是动手前的过程话：不算回答，不进回话
  // 开工时动手前的头一句（「好的，我先…」）先当回话冒出来；收场时再出最后那段
  test('the first message before a tool call shows up as the opening line', { timeout: 60_000 }, async () => {
    ensureNode()
    const { end, events } = await runScript('ids', (body) => {
      if (JSON.stringify(body).includes('tool_result')) return { kind: 'text', id: 'm2', chunks: ['乙', '方'] }
      return {
        kind: 'script',
        id: 'm1',
        blocks: [
          { type: 'text', text: '甲' },
          { type: 'text', text: '方' },
          { type: 'tool', name: 'web_search', input: { query: 'q' } },
        ],
      }
    })
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.deepEqual(replyTexts(events), ['甲方', '乙方'])
  })

  // 话 → 工具 → 话：开工那句先冒，再出最后那段
  test('a tool call between text keeps the opening line and the last reply', { timeout: 60_000 }, async () => {
    ensureNode()
    const { end, events, trace } = await runScript('tool-split', (body) => {
      if (JSON.stringify(body).includes('tool_result')) return { kind: 'text', id: 'after', chunks: ['后', '面'] }
      return {
        kind: 'script',
        id: 'before',
        blocks: [
          { type: 'text', text: '前' },
          { type: 'text', text: '面' },
          { type: 'tool', name: 'web_search', input: { query: 'q' } },
        ],
      }
    })
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.deepEqual(replyTexts(events), ['前面', '后面'])
    assert.deepEqual(trace.filter(item => item.startsWith('reply:') || item.startsWith('progress:')), [
      'reply:前面',
      'progress:search',
      'reply:后面',
    ])
  })

  // usage_update 只是模型请求完了：这段话后面可能还有工具调用，不能当回答发出去
  test('a usage update does not make the text a reply yet', { timeout: 60_000 }, async () => {
    ensureNode()
    const { end, events, trace } = await runScript('usage-split', (body) => {
      if (JSON.stringify(body).includes('tool_result')) return { kind: 'text', id: 'u2', chunks: ['下', '半'] }
      return {
        kind: 'script',
        id: 'u1',
        blocks: [
          { type: 'text', text: '上' },
          { type: 'text', text: '半' },
          { type: 'tool', name: 'web_search', input: { query: 'q' } },
        ],
      }
    })
    assert.equal(end.status, 'done', JSON.stringify(events))
    // 开工那句（上半）在动手时才冒，不是在 usage_update 那一下
    assert.deepEqual(replyTexts(events), ['上半', '下半'])
    assert.equal(trace[0], 'usage_update')
    assert.ok(trace.indexOf('reply:上半') > 0, trace.join('|'))
    assert.ok(trace.indexOf('reply:下半') > 1, trace.join('|'))
  })

  test('a blank reply is not emitted', { timeout: 60_000 }, async () => {
    ensureNode()
    const only = await runScript('blank', () => ({ kind: 'text', id: 'blank', chunks: ['  \n', ' \t'] }))
    assert.equal(only.end.status, 'done', JSON.stringify(only.events))
    assert.deepEqual(replyTexts(only.events), [])
    const split = await runScript('blank-split', (body) => {
      if (JSON.stringify(body).includes('tool_result')) return { kind: 'text', id: 'real', text: '好了' }
      return {
        kind: 'script',
        id: 'gap',
        blocks: [
          { type: 'text', text: '  \n' },
          { type: 'tool', name: 'web_search', input: { query: 'q' } },
        ],
      }
    })
    assert.equal(split.end.status, 'done', JSON.stringify(split.events))
    assert.deepEqual(replyTexts(split.events), ['好了'])
  })

  test('two web searches count as two', { timeout: 60_000 }, async () => {
    ensureNode()
    let step = 0
    const { end, events } = await runScript('searches', () => {
      step += 1
      if (step === 1) return { kind: 'tool', name: 'web_search', messageId: 's1', input: { query: '第一次' } }
      if (step === 2) return { kind: 'tool', name: 'web_search', messageId: 's2', input: { query: '第二次' } }
      return { kind: 'text', id: 's3', text: '查完了' }
    })
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.equal(events.find(event => event.type === 'usage')?.searches, 2)
    assert.equal(events.filter(event => event.type === 'progress' && event.text === 'search').length, 2)
  })

  test('a continued session with no usage baseline does not emit usage', { timeout: 120_000 }, async () => {
    ensureNode()
    let n = 0
    const fake = await startFake({
      expectKey: KEY,
      respond: () => {
        n += 1
        return { kind: 'text', text: `第${n}轮`, usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      },
    })
    try {
      for (const mode of ['missing', 'unreadable', 'unparsed']) {
        const options = taskOptions({ apiKey: KEY, prompt: '接着', baseUrl: fake.url })
        const firstEvents = []
        const first = runTask({ ...options, taskId: `base-${mode}-1`, onEvent: (event) => firstEvents.push(event) })
        assert.equal((await first.done).status, 'done', `${mode} ${JSON.stringify(firstEvents)}`)
        assert.equal(firstEvents.some(event => event.type === 'usage'), true, mode)
        const file = join(options.lowRoot, 'dsh', 'storages', 'session_projcache', 'sessions', `${first.sessionId}.json`)
        assert.equal(existsSync(file), true, mode)
        if (mode === 'missing') rmSync(file)
        else if (mode === 'unreadable') {
          denyRead(file)
          assert.throws(() => readFileSync(file), mode)
        }
        else writeFileSync(file, '{')
        const events = []
        const logs = []
        const second = runTask({
          ...options,
          taskId: `base-${mode}-2`,
          sessionId: first.sessionId,
          prompt: '继续',
          onEvent: (event) => events.push(event),
          onLog: (line) => logs.push(line),
        })
        const end = await second.done
        if (mode === 'unreadable' && existsSync(file)) allowRead(file)
        assert.equal(end.status, 'done', `${mode} ${JSON.stringify(events)}\n${logs.join('\n').slice(-800)}`)
        assert.equal(events.some(event => event.type === 'reply'), true, mode)
        assert.equal(events.some(event => event.type === 'usage'), false, mode)
        assert.equal(logs.some(line => line === 'usage baseline unread'), true, logs.join('\n'))
      }
    } finally {
      await fake.close()
    }
  })
})

test('a private node copy can stand in for the payload node', () => {
  const options = taskOptions({ taskId: 'node', apiKey: KEY, prompt: 'hi', workspace: scratch('sidemate-ws-') })
  const copy = join(options.lowRoot, 'node-copy.exe')
  assert.equal(dshLaunch(options).command, payloadLayout(options.payloadRoot).node)
  assert.equal(dshLaunch({ ...options, node: copy }).command, copy)
})

test('工具失败时 dsh 回的那句错：从 tool_call_update 的 content 里取字', () => {
  assert.equal(failText({ content: [{ type: 'content', content: { type: 'text', text: 'Error: old_string\n matched 2 times' } }] }), 'Error: old_string matched 2 times')
  assert.equal(failText({ content: [{ type: 'text', text: 'boom' }] }), 'boom')
  assert.equal(failText({}), '')
  assert.equal(failText(null), '')
})
