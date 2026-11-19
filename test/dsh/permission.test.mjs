// 权限申请：dsh 原生的 ask，桌伴把申请转到任务窗，用户点了才回。
// 真 dsh（rc.3）+ 假模型：模型要写任务文件夹外面的文件，桌伴收到申请；
// 回「拒绝」写不成；回「允许一次」写成、下一次写外面又来申请；回「本任务都允许」写成、
// 同一会话再写外面不再申请，另一个会话仍要申请。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function taskOptions(extra) {
  const workspace = scratch('sidemate-permission-ws-')
  mkdirSync(workspace, { recursive: true })
  const base = {
    workspace,
    lowRoot: scratch('sidemate-permission-low-'),
    node: process.execPath,
  }
  // 传进来的值优先（没传的就不写，免得把默认值盖成 undefined）
  for (const [name, value] of Object.entries(extra || {})) {
    if (value === undefined) continue
    base[name] = value
  }
  return base
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

// 跑一轮：模型要写几次任务文件夹外面的文件；每来一个申请就按 answers 里的答案回
// workspace / lowRoot 可以传进来：同一个 lowRoot 才是同一个 dsh 家目录（重启后接回同一个会话靠它）
async function runRound({ taskId, writes = 2, answers = [], outside, workspace, lowRoot, sessionId }) {
  const events = []
  const permissions = []
  let step = 0
  const fake = await startFake({
    expectKey: KEY,
    respond: () => {
      step += 1
      if (step <= writes) {
        return {
          kind: 'tool',
          name: 'write',
          input: {
            file_path: outside,
            content: `第 ${step} 次`,
            sandbox_permissions: 'danger-full-access',
            justification: '要写到任务文件夹外面',
          },
        }
      }
      return { kind: 'text', text: '好了' }
    },
  })
  const handle = runTask(taskOptions({
    taskId,
    apiKey: KEY,
    prompt: '写到外面去',
    baseUrl: fake.url,
    workspace,
    lowRoot,
    sessionId,
    onEvent: (event) => {
      events.push(event)
      if (event.type === 'permission') permissions.push(event)
    },
  }))
  // 每来一个申请就回一个答案（answers 用完了就拒绝，别把 dsh 吊在那儿）
  let answered = 0
  const watcher = setInterval(() => {
    if (answered >= permissions.length) return
    const one = permissions[answered]
    answered += 1
    const decision = answers[answered - 1] || 'reject'
    void handle.answerPermission(one.id, decision)
  }, 20)
  const end = await handle.done
  clearInterval(watcher)
  await fake.close()
  return { end, events, permissions, calls: fake.calls, handle }
}

describe('权限申请交给用户', { concurrency: 1 }, () => {
  test('配置里：审批策略是 ask，默认还是工作区可写', { timeout: 60_000 }, (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const launch = dshLaunch(taskOptions({ taskId: 'permission-dump', apiKey: KEY, prompt: 'hi' }))
    const dumped = spawnSync(launch.command, [...launch.args, '--dump-config'], {
      cwd: launch.cwd,
      env: launch.env,
      encoding: 'utf8',
      timeout: 40_000,
      windowsHide: true,
    })
    const text = `${dumped.stdout}\n${dumped.stderr}`
    assert.equal(dumped.status, 0, text)
    assert.doesNotMatch(text, /did not activate|match no preset/)
    assert.match(text, /id: approval[\s\S]*?policy: ask/)
    assert.match(text, /sidemate-workspace:\s*sandbox: workspace-write\s*approval: ask/)
    assert.match(text, /defaultPreset: sidemate-workspace/)
    // PowerShell 用 dsh 自己的默认：不再强制指向系统自带的 5.1
    assert.doesNotMatch(text, /pwshPath/)
    assert.equal(text.includes(KEY), false)
  })

  test('新闻那一轮：桌伴直接回拒绝，不弹权限卡', { timeout: 90_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const outside = join(scratch('sidemate-permission-news-out-'), 'secret.txt')
    const events = []
    const fake = await startFake({
      expectKey: KEY,
      respond: (body) => {
        const raw = JSON.stringify(body)
        if (raw.includes('tool_result')) return { kind: 'text', text: '好了' }
        return {
          kind: 'tool',
          name: 'write',
          input: { file_path: outside, content: 'nope', sandbox_permissions: 'danger-full-access' },
        }
      },
    })
    try {
      const handle = runTask(taskOptions({
        taskId: 'permission-news',
        apiKey: KEY,
        prompt: '写到外面去',
        baseUrl: fake.url,
        title: false,
        onEvent: (event) => events.push(event),
      }))
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(events).slice(0, 800))
      // 不弹权限卡：新闻那一轮的申请桌伴自己拒了
      assert.equal(events.some((event) => event.type === 'permission'), false, JSON.stringify(events.map((event) => event.type)))
      assert.equal(existsSync(outside), false, '拒绝了就写不成')
    } finally {
      await fake.close()
    }
  })

  test('模型要写任务文件夹外的文件：桌伴收到申请，回「拒绝」就写不成', { timeout: 90_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const outside = join(scratch('sidemate-permission-out-'), 'secret.txt')
    const { end, permissions, calls } = await runRound({ taskId: 'permission-reject', outside, writes: 1, answers: ['reject'] })
    assert.equal(end.status, 'done', JSON.stringify(calls).slice(0, 800))
    assert.equal(permissions.length, 1, '没有收到权限申请')
    // 卡上那句话要说清是哪个文件、在任务文件夹外
    assert.equal(permissions[0].tool, 'write')
    assert.equal(permissions[0].target, outside)
    assert.equal(permissions[0].outside, true)
    // 拒绝了就写不成
    assert.equal(existsSync(outside), false)
    // 模型看见的是拒绝
    const last = JSON.stringify(calls[calls.length - 1])
    assert.match(last, /rejected escalating/)
  })

  test('回「允许一次」：写成了；下一次写外面又来申请', { timeout: 90_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const outside = join(scratch('sidemate-permission-out-'), 'once.txt')
    const { end, permissions } = await runRound({ taskId: 'permission-once', outside, writes: 2, answers: ['once', 'reject'] })
    assert.equal(end.status, 'done')
    assert.equal(permissions.length, 2, '第二次写外面没有再来申请')
    // 第一次放行：写成了
    assert.equal(existsSync(outside), true)
  })

  test('回「本任务都允许」：写成，同一会话再写外面不再申请', { timeout: 90_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const outside = join(scratch('sidemate-permission-out-'), 'always.txt')
    const { end, permissions } = await runRound({ taskId: 'permission-always', outside, writes: 2, answers: ['always'] })
    assert.equal(end.status, 'done')
    // 只问了一次：切了完全访问以后，这个会话再写外面不用问
    assert.equal(permissions.length, 1, `又问了 ${permissions.length} 次`)
    assert.equal(existsSync(outside), true)
  })

  test('完全访问只对那个会话：另一个会话照样要申请', { timeout: 120_000 }, async (t) => {    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const first = join(scratch('sidemate-permission-out-'), 'first.txt')
    const one = await runRound({ taskId: 'permission-always-1', outside: first, writes: 2, answers: ['always'] })
    assert.equal(one.end.status, 'done')
    assert.equal(one.permissions.length, 1)
    const second = join(scratch('sidemate-permission-out-'), 'second.txt')
    const two = await runRound({ taskId: 'permission-always-2', outside: second, writes: 1, answers: ['reject'] })
    assert.equal(two.end.status, 'done')
    assert.equal(two.permissions.length, 1, '另一个会话没有再申请')
  })

  test('「本任务都允许」以后重启 dsh：接回同一个会话，再写外面不再问', { timeout: 180_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const workspace = scratch('sidemate-permission-ws-')
    mkdirSync(workspace, { recursive: true })
    // 同一个 lowRoot：dsh 的家目录（会话日志在那儿），重启后接回同一个会话靠它
    const lowRoot = scratch('sidemate-permission-low-')
    const outside = join(scratch('sidemate-permission-out-'), 'restart.txt')
    // 第一轮：回「本任务都允许」
    const first = await runRound({ taskId: 'permission-restart-1', workspace, lowRoot, outside, writes: 1, answers: ['always'] })
    assert.equal(first.end.status, 'done', JSON.stringify(first.calls).slice(0, 800))
    assert.equal(first.permissions.length, 1)
    assert.equal(existsSync(outside), true)
    const sessionId = first.handle.sessionId
    assert.equal(typeof sessionId, 'string')
    // 第二轮：dsh 重新起（新的进程），接回同一个会话，再写外面
    const secondOutside = join(scratch('sidemate-permission-out-'), 'restart2.txt')
    const second = await runRound({
      taskId: 'permission-restart-2',
      workspace,
      lowRoot,
      sessionId,
      outside: secondOutside,
      writes: 1,
      answers: [],
    })
    assert.equal(second.end.status, 'done', JSON.stringify(second.calls).slice(0, 800))
    assert.equal(second.handle.sessionId, sessionId)
    // 完全访问是 dsh 自己按会话记的（sandbox/mode 事件），重启后还在：不用再问
    assert.equal(second.permissions.length, 0, `重启后又问了 ${second.permissions.length} 次`)
    assert.equal(existsSync(secondOutside), true, '重启后没写出去')
  })
})
