// 小岛右键菜单：真起一个桌伴（隔离的 USERPROFILE 和 userData），在 Electron 主进程里
// 把 Menu.prototype.popup 换成只记菜单项、不真弹（做法在 test/pet/menu-main.mjs），
// 从小岛页面发一次右键、一次左键，对着菜单记录、未捕获异常和 pet.log 断言；
// 托盘的 contextMenu 也从 setContextMenu 记下来过一遍。
// 没设 SIDEMATE_PET 就跳过，平时 node --test 不拉起 Electron。

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

test('右键小岛：菜单弹得出、项也齐；左键还点得动；托盘菜单建得出来', { skip: process.env.SIDEMATE_PET ? false : 'set SIDEMATE_PET=1', timeout: 120_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-menu-'))
  const logFile = path.join(lab, 'pet.log')
  const resultFile = path.join(lab, 'menu.json')
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const env = {
    ...process.env,
    // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
    USERPROFILE: path.join(lab, 'home'),
    LOCALAPPDATA: path.join(lab, 'local'),
    SIDEMATE_PET_AT: 'center',
    SIDEMATE_PET_LOG: logFile,
    SIDEMATE_MENU_RESULT: resultFile,
    SIDEMATE_MENU_USER_DATA: path.join(lab, 'user'),
    // Electron 的 profile 指到隔离目录（主进程认这个变量，不覆盖测试指的地方）
    SIDEMATE_USER_DATA: path.join(lab, 'user'),
  }
  delete env.SIDEMATE_PET
  delete env.SIDEMATE_PET_STILL
  const child = spawn(electron, [path.join(here, 'menu-main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    // 等主进程把菜单和异常写出来（它干完自己 app.quit）
    let text = ''
    for (let i = 0; i < 200 && !text; i++) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, stderr || '主进程没写出菜单记录')
    const { popups, tray, uncaught } = JSON.parse(text)

    // 没有未捕获异常：showMenu 里少 import 一个函数，这里会记到 ReferenceError
    assert.deepEqual(uncaught, [])

    // 右键弹过一次菜单，五样都在（label 以 petMenuTemplate 实际的为准）
    assert.equal(popups.length, 1, `popup 叫了 ${popups.length} 次`)
    const labels = popups[0].map((item) => item.label || item.type)
    for (const want of ['新闻订阅', '新任务', '最近', '设置', '退出']) {
      assert.ok(labels.includes(want), `菜单里没有「${want}」：${labels.join('、')}`)
    }

    // 托盘菜单建得出来：只有设置、退出
    assert.ok(tray.length >= 1, '托盘的 contextMenu 没建出来')
    const trayLabels = tray[tray.length - 1].map((item) => item.label || item.type)
    assert.deepEqual(trayLabels, ['设置', '退出'])

    // pet.log：右键开了菜单、左键点了小岛（右键崩过的话左键就没下文了）
    const events = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(events.some((one) => one.event === 'menu-open'), 'pet.log 没有 menu-open：右键没走到 showMenu')
    assert.ok(events.some((one) => one.event === 'click'), 'pet.log 没有 click：左键点小岛没反应')
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(300)
    rmSync(lab, { recursive: true, force: true })
  }
})
