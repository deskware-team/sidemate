// 悬停只算看得见的那一截：
// 小岛的底色只画主题那么高，窗里下面那一截（Windows 垫出来的）是透明的。
// 鼠标停在那截透明的地方，不该算「停在小岛上」：不该冒那一行字，
// 细线状态下也不该把小岛叫回来。只有指针在 #strip 上（接文件时在接收托上）才算。
//
// 这个测试真起一个小岛窗（electron），在页面里派发 mouseover / mouseout，
// 数主进程收到几次 pet:hover / pet:leave：
// - 停在小条下面那截透明的地方：没有 pet:hover
// - 停在小条上：有 pet:hover
// - 从小条挪到透明那截：有 pet:leave
// - 接文件时停在接收托上：有 pet:hover
// 没设 SIDEMATE_PET 就跳过（平时 node --test 不拉起 Electron）。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const electron = createRequire(path.join(root, 'package.json'))('electron')

test('悬停只算看得见的那一截（透明那截不算，小条上才算）', { skip: process.env.SIDEMATE_PET ? false : 'set SIDEMATE_PET=1', timeout: 180_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-hover-'))
  const resultFile = path.join(lab, 'result.json')
  const child = spawn(electron, [path.join(here, 'hover-visible-main.mjs'), '--no-sandbox'], {
    cwd: root,
    env: { ...process.env, SIDEMATE_PET_RESULT: resultFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    let text = ''
    for (let i = 0; i < 100 && !text; i++) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, `没量出来：${stderr}`)
    const data = JSON.parse(text)
    assert.equal(data.hoverOnTransparent, 0, '停在小条下面那截透明的地方，不该算停在岛上')
    assert.equal(data.hoverOnStrip, 1, '停在小条上，该算停在岛上')
    assert.equal(data.leaveAfterOut, 1, '从小条挪到透明那截，该算离开')
    assert.equal(data.hoverOnTray, 1, '接文件时停在接收托上，该算停在岛上')
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(200)
    rmSync(lab, { recursive: true, force: true })
  }
})
