import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, payloadLayout } from '../../app/dsh/index.mjs'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { startFake } from './fake-messages.mjs'

// dsh 升到 0.2.2-rc.3 之后要验的几件事：
// Office 原生工具挂上了、先读后写开着、AgentTeam 和子智能体关了、两个上传关了。

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

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 一次配置导出：dsh 把最后生效的配置打出来
function dumpConfig() {
  const launch = dshLaunch({
    workspace: scratch('sidemate-rc3-ws-'),
    lowRoot: scratch('sidemate-rc3-low-'),
    taskId: 'dump',
    apiKey: '',
    prompt: 'hi',
  })
  const dumped = spawnSync(launch.command, [...launch.args, '--dump-config'], {
    cwd: launch.cwd,
    env: launch.env,
    encoding: 'utf8',
    timeout: 60_000,
  })
  const text = `${dumped.stdout}\n${dumped.stderr}`
  assert.equal(dumped.status, 0, text.slice(-2000))
  return text
}

// 配置里某一行连着的那几行（同一行可能被补丁改过，取最后一次）
function row(text, id) {
  const lines = text.split(/\r?\n/)
  let at = -1
  for (let i = 0; i < lines.length; i += 1) if (lines[i] === `- id: ${id}`) at = i
  if (at < 0) return ''
  const out = [lines[at]]
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('- id: '); i += 1) out.push(lines[i])
  return out.join('\n')
}

function toolNames(body) {
  return (Array.isArray(body?.tools) ? body.tools : [])
    .map((tool) => tool?.name ?? tool?.function?.name)
    .filter((name) => typeof name === 'string')
}

describe('dsh 0.2.2-rc.3 的配置', { concurrency: 1 }, () => {
  test('配置导出里：先读后写开着，AgentTeam 和子智能体关了，两个上传关了', { timeout: 90_000 }, () => {
    ensureNode()
    const text = dumpConfig()
    assert.ok(text.includes('@deepseek-ai/dsh-office-kit'), 'Office 引擎挂上了')
    assert.ok(text.includes('@deepseek-ai/dsh-tool-office'), 'Office 工具挂上了')
    assert.ok(text.includes('@deepseek-ai/dsh-skill-office'), 'Office 技能挂上了')
    assert.ok(row(text, 'fs-observation-policy').includes('disabled: false'), '先读后写开着')
    for (const id of ['agent-team', 'tool-agent-team', 'tool-subagent', 'tool-subagent-fork']) {
      assert.ok(row(text, id).includes('disabled: true'), `${id} 关掉了`)
    }
    assert.ok(row(text, 'session-log-deepseek').includes('enabled: false'), '会话日志不上传')
    assert.ok(row(text, 'plugin-package-inventory-deepseek').includes('enabled: false'), '插件清单不上传')
    assert.ok(row(text, 'web').includes('searchProvider: deepseek-search-api'), '搜索走 Search API')
  })

  test('Office 技能加载后，模型看见三件 Office 工具', { timeout: 90_000 }, async () => {
    ensureNode()
    let step = 0
    const fake = await startFake({
      expectKey: KEY,
      respond: () => {
        step += 1
        if (step === 1) return { kind: 'tool', name: 'skill', input: { name: 'office' } }
        return { kind: 'text', text: '好了' }
      },
    })
    try {
      const handle = runTask({
        taskId: 'office',
        workspace: scratch('sidemate-rc3-ws-'),
        lowRoot: scratch('sidemate-rc3-low-'),
        prompt: '看看',
        apiKey: KEY,
        baseUrl: fake.url,
        searchBaseUrl: fake.url,
      })
      const end = await handle.done
      assert.equal(end.status, 'done', JSON.stringify(fake.calls).slice(0, 800))
      const names = toolNames(fake.calls[fake.calls.length - 1])
      for (const tool of ['office_convert', 'office_render', 'office_recalculate']) {
        assert.equal(names.includes(tool), true, `${tool} 在工具列表里`)
      }
    } finally {
      await fake.close()
    }
  })
})
