// 模型写的脚本里直接敲 python：跑的要是随包那份（带 python-docx、openpyxl 这些），
// 不是用户机器上自己装的 Python，也不是 Windows 应用商店那个空壳。
// dsh 自己的 load_workspace_dependencies 给的是绝对路径，不看 PATH；模型在 PowerShell 里敲的 python
// 只看桌伴交给 dsh 的 PATH（dsh 起子进程时 PATH 原样往下传）。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test, { after, describe } from 'node:test'
import { dshLaunch, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-script-python-key'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function taskOptions(extra) {
  return { workspace: scratch('sidemate-pyws-'), lowRoot: scratch('sidemate-pylow-'), node: process.execPath, ...extra }
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

// Windows 上路径不分大小写；junction 也要解开再比
function real(path) {
  const out = realpathSync.native(path)
  return process.platform === 'win32' ? out.toLowerCase() : out
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('模型脚本里的 python 是随包那份', { concurrency: 1 }, () => {
  test('交给 dsh 的 PATH：随包 Python 排最前，原来的 PATH 原样接在后面', () => {
    const launch = dshLaunch(taskOptions({ taskId: 'pypath', apiKey: KEY, prompt: 'hi' }))
    const parts = launch.env.PATH.split(delimiter)
    if (process.platform === 'win32') {
      assert.deepEqual(parts.slice(0, 2), [layout.python, join(layout.python, 'Scripts')])
    } else {
      assert.equal(parts[0], join(layout.python, 'bin'))
    }
    if (process.env.PATH) assert.ok(launch.env.PATH.endsWith(`${delimiter}${process.env.PATH}`), launch.env.PATH)
  })

  test('py 启动器 PATH 管不了：干活规矩里让模型用 python、别用 py、别 pip 装包', () => {
    const text = readFileSync(new URL('../../app/dsh/rules.patch.yml', import.meta.url), 'utf8')
    assert.ok(text.includes('跑 Python 直接用 python 命令'), text)
    assert.ok(text.includes('不要用 py 启动器'), text)
    assert.ok(text.includes('不要 pip install'), text)
  })

  test('模型在 PowerShell 里敲 python -c：sys.executable 在随包 Python 里，python-docx 也导得进来', { timeout: 120_000 }, async (t) => {
    if (process.platform !== 'win32') {
      t.skip('pwsh 工具只在 Windows 上测')
      return
    }
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    if (!existsSync(join(layout.python, 'runtime.json'))) {
      t.skip('bundled python is not installed')
      return
    }
    let output = ''
    const fake = await startFake({
      expectKey: KEY,
      respond: (body, nth) => {
        if (nth === 1) {
          return {
            kind: 'tool',
            name: 'pwsh',
            input: {
              description: '看 python 是哪一份',
              command: `python -c "import sys, docx; print('EXE:' + sys.executable)"`,
            },
          }
        }
        if (nth === 2) output = toolResultText(body)
        return { kind: 'text', text: '好了' }
      },
    })
    try {
      const events = []
      const end = await runTask(taskOptions({
        taskId: 'script-python',
        apiKey: KEY,
        prompt: '看一下',
        baseUrl: fake.url,
        onEvent: (event) => events.push(event.type),
      })).done
      assert.equal(end.status, 'done', events.join(' '))
      const line = output.split(/\r?\n/).find((one) => one.startsWith('EXE:'))
      assert.ok(line, `脚本没跑出 EXE 那一行：${output.slice(0, 1500)}`)
      const exe = line.slice('EXE:'.length).trim()
      assert.ok(real(exe).startsWith(real(layout.python)), `python 指到了 ${exe}，不在随包的 ${layout.python} 里`)
    } finally {
      await fake.close()
    }
  })
})
