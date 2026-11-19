// Windows 上验原件动不了：只靠 dsh 的沙箱（ask.patch.yml 的预设只许写工作区）。
// 不是 Windows 就跳过。本机先 `npm run payload`，再 `node --test test/workspace/escape.test.mjs`。
// 沙盒矩阵脚本（matrix.mjs）不在这个仓里，剧本按三条写入路子写：
// write / edit、PowerShell、再用随包 python.exe 写。
// dsh 直接用随包的 node.exe 起，跟产品里一样。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { prepareTask } from '../../app/workspace/index.mjs'
import { startFake } from '../dsh/fake-messages.mjs'

const KEY = 'sidemate-test-key'
const layout = payloadLayout()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ps(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

after(() => {
  // 收尾时 dsh 可能还没完全放开工作区的文件：删不动就多试几次（别把整轮测判成失败）
  for (const dir of roots) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('scripted writes outside the workspace leave originals alone', { skip: process.platform !== 'win32', timeout: 180_000 }, async () => {
  if (!existsSync(layout.node)) {
    mkdirSync(join(layout.root, 'node'), { recursive: true })
    copyFileSync(process.execPath, layout.node)
    chmodSync(layout.node, 0o755)
  }
  assert.equal(existsSync(layout.dsh), true, '先跑 npm run payload，再跑 node --test test/workspace/escape.test.mjs')

  const root = scratch('sidemate-escape-')
  const folder = join(root, '用户 的文件夹')
  const original = join(folder, '原件.docx')
  const beside = join(folder, '隔壁.txt')
  mkdirSync(folder, { recursive: true })
  writeFileSync(original, '原文-不要动')
  writeFileSync(beside, '隔壁-不要动')
  const outside = join(root, '外面.txt')
  const task = prepareTask({ paths: [folder], prompt: '别动原件', root, now: new Date(2026, 10, 4) })
  let fake
  try {
    const junction = join(task.workspace, '联接')
    const through = join(junction, '原件.docx')
    const inside = join(task.workspace, '结果.txt')
    // 命令和脚本真跑起来了的记号：写在工作区里，写得进去；扩展名不算产出
    const pwshRan = join(task.workspace, 'pwsh-ran.log')
    const pyRan = join(task.workspace, 'py-ran.log')
    // 脚本先写进工作区再跑：PowerShell 5.1 传给 python -c 的双引号会被吃掉，那样脚本根本跑不起来
    const script = join(task.workspace, '写原件.py')
    const pyCode = [
      `open(${JSON.stringify(pyRan)}, 'w', encoding='utf-8').write('ran')`,
      `open(${JSON.stringify(original)}, 'w', encoding='utf-8').write('py')`,
      '',
    ].join('\n')
    const plan = [
      () => ({ kind: 'tool', name: 'write', input: { file_path: inside, content: '可以' } }),
      () => ({ kind: 'tool', name: 'write', input: { file_path: outside, content: '不行' } }),
      () => ({ kind: 'tool', name: 'write', input: { file_path: original, content: '被写了' } }),
      // 先读一遍：dsh 要求改之前读过，不然 edit 还没走到沙箱就被挡了
      () => ({ kind: 'tool', name: 'read', input: { file_path: original } }),
      () => ({ kind: 'tool', name: 'edit', input: { file_path: original, old_string: '原文-不要动', new_string: '被改了' } }),
      () => ({ kind: 'tool', name: 'pwsh', input: { command: `Set-Content -LiteralPath ${ps(pwshRan)} -Value 'ran' -Encoding utf8`, description: '工作区里写' } }),
      () => ({ kind: 'tool', name: 'pwsh', input: { command: `Remove-Item -LiteralPath ${ps(original)} -Force`, description: '删原件' } }),
      () => ({
        kind: 'tool',
        name: 'pwsh',
        input: {
          command: `New-Item -ItemType Junction -Path ${ps(junction)} -Target ${ps(folder)} | Out-Null; Set-Content -LiteralPath ${ps(through)} -Value 'junction' -Encoding utf8`,
          description: '经联接写',
        },
      }),
      () => ({ kind: 'tool', name: 'pwsh', input: { command: `Set-Content -LiteralPath ${ps(original)} -Value 'pwsh' -Encoding utf8`, description: '用命令写原件' } }),
      () => ({ kind: 'tool', name: 'load_workspace_dependencies', input: {} }),
      () => ({ kind: 'tool', name: 'write', input: { file_path: script, content: pyCode } }),
      (raw) => {
        const found = String(raw).match(/[A-Za-z]:\\[^"'\\\s]+python\.exe/i)
        const exe = found?.[0] || join(layout.python, 'python.exe')
        return { kind: 'tool', name: 'pwsh', input: { command: `& ${ps(exe)} ${ps(script)}`, description: '用 Python 写原件' } }
      },
    ]
    let index = 0
    fake = await startFake({
      expectKey: KEY,
      respond(body) {
        const raw = JSON.stringify(body)
        const hasResult = raw.includes('tool_result')
        if (!hasResult && index === 0) {
          index = 1
          return plan[0](raw)
        }
        if (hasResult && index < plan.length) {
          const step = plan[index]
          index += 1
          return step(raw)
        }
        return { kind: 'text', text: '停了' }
      },
    })
    const events = []
    const handle = runTask({
      taskId: 'escape',
      apiKey: KEY,
      prompt: '按剧本试',
      workspace: task.workspace,
      baseUrl: fake.url,
      lowRoot: scratch('sidemate-escape-home-'),
      onEvent: (event) => events.push(event),
    })
    const end = await handle.done
    assert.equal(end.status, 'done', JSON.stringify(events.map(event => event.type)))
    assert.ok(fake.calls.length >= plan.length, String(fake.calls.length))
    assert.equal(existsSync(outside), false)
    assert.equal(readFileSync(original, 'utf8'), '原文-不要动')
    assert.equal(readFileSync(beside, 'utf8'), '隔壁-不要动')
    // PowerShell 和 Python 真跑起来了（工作区里写得进去），原件没动是被拦的，不是命令没跑
    assert.equal(existsSync(pwshRan), true, 'PowerShell 没跑起来')
    assert.equal(existsSync(pyRan), true, 'Python 没跑起来')
    // 成品就留在任务文件夹里：桌伴不再往别处拷一份
    const made = readFileSync(inside, 'utf8')
    assert.match(made, /可以/)
    assert.equal(existsSync(join(folder, '结果.txt')), false)
    const log = readFileSync(handle.logPath, 'utf8')
    assert.equal(log.includes(KEY), false)
  } finally {
    if (fake) await fake.close()
  }
})

test('the escape script is not run off Windows', { skip: process.platform === 'win32' }, () => {
  assert.equal(spawnSync('icacls', ['/?'], { windowsHide: true }).error?.code, 'ENOENT')
})
