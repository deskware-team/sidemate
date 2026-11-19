// 任务窗和小岛之间的缝（缝改成 0：看得见的面板顶边紧贴看得见的小条底边）：
// 真起一个桌伴（隔离的 USERPROFILE 和 userData），真实鼠标点小岛打开任务窗，
// 等动画走完，用两个窗口的内容区原点和页面里小条 / 面板的 getBoundingClientRect()
// 算「小条底边到面板顶边」的屏幕距离，断言 0±1（DIP）；再查两个窗在 Windows 的
// z 序里谁在前（任务窗要在小岛上面：小岛垫出来的那一截透明但还是小岛的窗，
// 小岛在前的话点任务窗顶边会打到小岛、把任务窗收了）；点任务窗顶边往下 2 DIP，
// 这一下要落在任务窗里（任务窗不能收）；再点看得见的小条底边往上 2 DIP，
// 这一下落在小岛上，任务窗收得回去；整屏截一张小岛 + 展开的任务窗存 SIDEMATE_SHOTS。
// 做法照 test/pet/menu.test.mjs；没设 SIDEMATE_PET 就跳过，平时 node --test 不拉起 Electron。
// 缝是 0 之前跑，量出来是 8、断言会失败，才算这条用例真在看这道缝。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

test('点开任务窗：小条底边到面板顶边 0±1（DIP）；任务窗在小岛上面，点任务窗顶边不收，点小条收得回去', { skip: process.env.SIDEMATE_PET ? false : 'set SIDEMATE_PET=1', timeout: 180_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-gap-'))
  const resultFile = path.join(lab, 'gap.json')
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const env = {
    ...process.env,
    // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
    USERPROFILE: path.join(lab, 'home'),
    LOCALAPPDATA: path.join(lab, 'local'),
    SIDEMATE_PET_AT: 'center',
    SIDEMATE_PET_LOG: path.join(lab, 'pet.log'),
    SIDEMATE_GAP_RESULT: resultFile,
    SIDEMATE_GAP_USER_DATA: path.join(lab, 'user'),
    // Electron 的 profile 指到隔离目录（主进程认这个变量，不覆盖测试指的地方）
    SIDEMATE_USER_DATA: path.join(lab, 'user'),
    // 截图存哪儿：外面设了就用外面的（工作区外），没设就存这次的临时目录
    SIDEMATE_SHOTS: process.env.SIDEMATE_SHOTS || path.join(lab, 'shots'),
  }
  delete env.SIDEMATE_PET
  delete env.SIDEMATE_PET_STILL
  const child = spawn(electron, [path.join(here, 'gap-main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    // 等主进程把量出来的数写出来（它干完自己 app.quit）
    let text = ''
    for (let i = 0; i < 250 && !text; i++) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, stderr || '主进程没量出结果')
    const state = JSON.parse(text)

    // 没有未捕获异常
    assert.deepEqual(state.uncaught, [], `主进程里有未捕获异常：${state.uncaught.join('；')}`)

    // 真实鼠标那一下点得到小岛
    assert.ok(state.open?.ok, `真实鼠标点小岛没点着：${state.open?.error || ''}`)

    // 缝是 0±1（DIP）：面板顶边紧贴看得见的小条底边，不是 8 也不是别的
    assert.ok(Number.isFinite(state.gap), `没量出缝：${JSON.stringify(state)}`)
    assert.ok(Math.abs(state.gap) <= 1, `小条底边到面板顶边 ${state.gap}，不是 0±1（DIP）`)

    // 层级：任务窗在小岛上面（小岛抢了层级以后任务窗要抢回来）
    assert.equal(state.taskAbove, true,
      `任务窗不在小岛上面：z 序里任务窗第 ${state.zAfter?.task}，小岛第 ${state.zAfter?.pet}（${state.zAfter?.error || ''}）`)

    // 点任务窗顶边往下 2 DIP：这一下落在任务窗里，任务窗不能收
    assert.equal(state.openAfterTopClick, true, '点任务窗顶边，任务窗被收走了（那一下打到了小岛）')

    // 点看得见的小条底边往上 2 DIP：这一下落在小岛上，任务窗收得回去
    assert.equal(state.closed, true, '点看得见的小条，任务窗没收回去')

    // 整屏截图存下来了（小岛 + 展开的任务窗）
    assert.ok(state.shot && existsSync(state.shot) && statSync(state.shot).size > 0, `整屏截图没存下来：${state.shotError || state.shot || ''}`)
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(300)
    rmSync(lab, { recursive: true, force: true })
  }
})
