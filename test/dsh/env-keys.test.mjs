// 模型写的脚本看不见钥匙：dsh 起 PowerShell / Python 时只按名字剥钥匙变量，
// 名字带 KEY / TOKEN / SECRET / PASSWORD 的才剥（payload 里 dsh-subprocess 的 SENSITIVE_ENV_PATTERN）。
// 这里先查桌伴交给 dsh 的每个钥匙变量名都长这样，再用真 dsh + 假模型让脚本列一遍环境变量名。
// 只打印、只比较名字；值只拿来查「输出里有没有」，不打印。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { envName as modelEnvName } from '../../app/models/keys.mjs'
import { startFake } from './fake-messages.mjs'

// 跟 dsh 那边剥钥匙的规则一样（payload dsh-subprocess/lib/index.js）
const DSH_SCRUB = /KEY|PASSWORD|SECRET|TOKEN/i
const DEEPSEEK = 'sidemate-envkeys-deepseek'
// 外部工具服务的钥匙不进环境变量（它随建会话的参数走），所以这里只有模型的钥匙
const EXTRA = {
  [modelEnvName('c-dummy')]: 'sidemate-envkeys-custom',
}
const SECRETS = [DEEPSEEK, ...Object.values(EXTRA)]
// 脚本只列名字：名字像钥匙的、桌伴自己的、DeepSeek 的都列出来
const LIST = 'KEY|TOKEN|SECRET|PASSWORD|AUTH|SIDEMATE|DEEPSEEK'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function taskOptions(extra) {
  const workspace = scratch('sidemate-envkeys-ws-')
  mkdirSync(workspace, { recursive: true })
  return { workspace, lowRoot: scratch('sidemate-envkeys-low-'), node: process.execPath, ...extra }
}

function toolResultText(body) {
  const parts = []
  for (const message of body?.messages || []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'tool_result') continue
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) {
        for (const piece of block.content) if (typeof piece?.text === 'string') parts.push(piece.text)
      }
    }
  }
  return parts.join('\n')
}

// 最后一次工具结果里 NAMES: 那一行的名字
function namesIn(text) {
  const line = String(text).split(/\r?\n/).reverse().find((one) => one.startsWith('NAMES:'))
  if (line === undefined) return null
  return line.slice('NAMES:'.length).split(',').map((name) => name.trim()).filter(Boolean)
}

function pythonPathFrom(text) {
  const found = String(text).match(/[A-Za-z]:[\\/][^\s"'<>|]*?python\.exe/i)
  return found ? found[0] : ''
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('钥匙变量不进脚本', { concurrency: 1 }, () => {
  test('交给 dsh 的每个钥匙变量，名字都会被 dsh 剥掉', () => {
    const launch = dshLaunch(taskOptions({ taskId: 'envkeys-names', apiKey: DEEPSEEK, env: EXTRA, prompt: 'hi' }))
    const carried = Object.entries(launch.env).filter(([, value]) => SECRETS.includes(value)).map(([name]) => name)
    // 都进了 dsh（dsh 自己要用），一把不少
    assert.equal(carried.length, SECRETS.length, carried.join(' '))
    for (const name of carried) assert.match(name, DSH_SCRUB, `${name} 名字里不带 KEY，dsh 不会替脚本剥掉它`)
    // 名字不带 KEY 的旧写法根本进不了 dsh
    const old = dshLaunch(taskOptions({ taskId: 'envkeys-old', env: { SIDEMATE_MCP_GITHUB: 'sidemate-envkeys-old' }, prompt: 'hi' }))
    assert.equal('SIDEMATE_MCP_GITHUB' in old.env, false)
    // 外部工具服务的钥匙不进环境变量
    const mcp = dshLaunch(taskOptions({ taskId: 'envkeys-mcp', env: { SIDEMATE_MCP_KEY_GITHUB: 'sidemate-envkeys-mcp' }, prompt: 'hi' }))
    assert.equal('SIDEMATE_MCP_KEY_GITHUB' in mcp.env, false, '外部工具的钥匙随建会话的参数走，不进环境变量')
  })

  test('模型让 PowerShell 和 Python 列环境变量：一个钥匙变量名都没有', { timeout: 120_000 }, async (t) => {
    if (process.platform !== 'win32') {
      t.skip('pwsh 工具只在 Windows 上测')
      return
    }
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const hasPython = existsSync(join(layout.python, 'runtime.json'))
    const outputs = {}
    const fake = await startFake({
      expectKey: DEEPSEEK,
      respond: (body, nth) => {
        const text = toolResultText(body)
        if (nth === 1) {
          return {
            kind: 'tool',
            name: 'pwsh',
            input: {
              description: '列环境变量名',
              command: `'PATH_SEEN:' + [bool]$env:PATH; 'NAMES:' + ((Get-ChildItem env: | ForEach-Object Name | Where-Object { $_ -match '${LIST}' } | Sort-Object) -join ',')`,
            },
          }
        }
        if (nth === 2) {
          outputs.pwsh = text
          if (!hasPython) return { kind: 'text', text: '好了' }
          return { kind: 'tool', name: 'load_workspace_dependencies', input: {} }
        }
        if (nth === 3) {
          const python = pythonPathFrom(text)
          if (!python) return { kind: 'text', text: '没找到 python' }
          const code = `import os,re;print('PATH_SEEN:'+str('PATH' in os.environ));print('NAMES:'+','.join(sorted(n for n in os.environ if re.search('${LIST}',n,re.I))))`
          return { kind: 'tool', name: 'pwsh', input: { description: 'Python 列环境变量名', command: `& '${python}' -c "${code}"` } }
        }
        if (nth === 4) outputs.python = text
        return { kind: 'text', text: '好了' }
      },
    })
    try {
      const events = []
      const end = await runTask(taskOptions({
        taskId: 'envkeys-live',
        apiKey: DEEPSEEK,
        env: EXTRA,
        prompt: '列一下',
        baseUrl: fake.url,
        onEvent: (event) => events.push(event.type),
      })).done
      assert.equal(end.status, 'done', events.join(' '))
      const kinds = hasPython ? ['pwsh', 'python'] : ['pwsh']
      for (const kind of kinds) {
        const text = outputs[kind] || ''
        // 脚本真跑了：PATH 看得见，名字那一行也在
        assert.match(text, /PATH_SEEN:(True|true)/, `${kind} 没跑起来`)
        const names = namesIn(text)
        assert.ok(names, `${kind} 没列出名字`)
        const leaked = names.filter((name) => DSH_SCRUB.test(name) || /^SIDEMATE_/i.test(name))
        assert.deepEqual(leaked, [], `${kind} 看得见这些钥匙变量：${leaked.join(' ')}`)
        assert.equal(SECRETS.some((secret) => text.includes(secret)), false, `${kind} 的输出里出现了钥匙`)
      }
    } finally {
      await fake.close()
    }
  })
})
