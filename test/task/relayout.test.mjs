// 任务窗跟着小岛重摆（改小岛大小）+ Esc 收起任务窗：真起一个桌伴（隔离的 USERPROFILE
// 和 userData），量小条底边到面板顶边的缝、任务窗跟小岛的横向中心，
// 再把小岛大小改成「大」那档，看任务窗有没有跟着重摆；最后往任务窗里发一个 Esc，
// 任务窗要收起来。做法照 test/task/gap.test.mjs；没设 SIDEMATE_TASKWIN 就跳过，
// 平时 node --test 不拉起 Electron。

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

test('改小岛大小：任务窗跟着重摆（缝 0、中心对着小岛）；Esc 收起任务窗', { skip: process.env.SIDEMATE_TASKWIN ? false : 'set SIDEMATE_TASKWIN=1', timeout: 240_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-relayout-'))
  const resultFile = path.join(lab, 'relayout.json')
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const env = {
    ...process.env,
    // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
    USERPROFILE: path.join(lab, 'home'),
    LOCALAPPDATA: path.join(lab, 'local'),
    SIDEMATE_PET_LOG: path.join(lab, 'pet.log'),
    SIDEMATE_TASKWIN_RESULT: resultFile,
    SIDEMATE_TASKWIN_USER_DATA: path.join(lab, 'user'),
    // Electron 的 profile 指到隔离目录（主进程认这个变量，不覆盖测试指的地方）
    SIDEMATE_USER_DATA: path.join(lab, 'user'),
  }
  delete env.SIDEMATE_PET
  delete env.SIDEMATE_PET_STILL
  const child = spawn(electron, [path.join(here, 'relayout-main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    // 等主进程把量出来的数写出来（它干完自己 app.quit）
    let text = ''
    for (let i = 0; i < 600 && !text; i += 1) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, stderr || '主进程没量出结果')
    const state = JSON.parse(text)

    // 没有未捕获异常
    assert.deepEqual(state.uncaught, [], `主进程里有未捕获异常：${state.uncaught.join('；')}`)

    // 改之前：缝是 0±1（DIP），任务窗摆在规则算出来的位置上
    assert.ok(state.beforeVisible, '任务窗没露脸')
    assert.ok(Math.abs(state.before.gap) <= 1, `改之前小条底边到面板顶边 ${state.before.gap}，不是 0±1（DIP）`)
    assert.ok(Math.abs(state.before.placeDiff) <= 1, `改之前任务窗不在小岛正下方（差 ${state.before.placeDiff} DIP）`)

    // 改小岛大小之后：任务窗跟着重摆，缝还是 0，位置还是对着小岛
    assert.ok(state.afterVisible, '改完小岛大小，任务窗不见了')
    assert.ok(state.moved, `改完小岛大小，任务窗没跟着重摆（还在 ${JSON.stringify(state.after.taskBox)}）`)
    assert.ok(Math.abs(state.after.gap) <= 1, `改完小岛大小，小条底边到面板顶边 ${state.after.gap}，不是 0±1（DIP）`)
    assert.ok(Math.abs(state.after.placeDiff) <= 1, `改完小岛大小，任务窗不在小岛正下方（差 ${state.after.placeDiff} DIP）`)

    // 拖走小岛之后：小岛挪了，任务窗要跟着挪（还是缝 0、还在正下方）
    assert.ok(state.islandMoved, '小岛没拖动，这一段没测上')
    assert.ok(state.draggedVisible, '拖完小岛，任务窗不见了')
    assert.ok(Math.abs(state.dragged.gap) <= 1, `拖完小岛，小条底边到面板顶边 ${state.dragged.gap}，不是 0±1（DIP）`)
    assert.ok(Math.abs(state.dragged.placeDiff) <= 1, `拖完小岛，任务窗没跟着小岛挪（差 ${state.dragged.placeDiff} DIP）`)

    // Esc：任务窗收起来
    assert.equal(state.escHidden, true, '按 Esc 任务窗没收起来')
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(300)
    rmSync(lab, { recursive: true, force: true })
  }
})
