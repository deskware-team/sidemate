// 字号「特大」+ 小岛「大」两档一起开：真起一个桌伴（隔离的 LOCALAPPDATA 和 userData，
// 两档先写进隔离目录的 sidemate\data\settings.json），左键点小岛打开任务窗，断言：
// 任务窗 zoomFactor 1.3、窗宽 629、正文字号 14 CSS 像素（放大成 14×1.3 的效果）；
// 小岛窗口 140×38（标准 ×1.25）；小岛底边到面板顶边看得见的缝还是 0±1（DIP）；
// 任务窗里 Ctrl+0 / Ctrl+减号 换到 1 / 0.9，档位写回 设置.json；再点一下小岛收得回去。
// 整屏截一张存 SIDEMATE_SHOTS。做法照 test/task/gap.test.mjs；没设 SIDEMATE_TASKWIN
// 就跳过，平时 node --test 不拉起 Electron。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

test('特大 + 小岛大：字号 1.3、小岛 ×1.25，缝还是 0±1；Ctrl 加减真的换档', { skip: process.env.SIDEMATE_TASKWIN ? false : 'set SIDEMATE_TASKWIN=1', timeout: 180_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-zoom-'))
  const resultFile = path.join(lab, 'zoom.json')
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const env = {
    ...process.env,
    // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
    USERPROFILE: path.join(lab, 'home'),
    LOCALAPPDATA: path.join(lab, 'local'),
    SIDEMATE_PET_LOG: path.join(lab, 'pet.log'),
    SIDEMATE_ZOOM_RESULT: resultFile,
    SIDEMATE_ZOOM_USER_DATA: path.join(lab, 'user'),
    // Electron 的 profile 指到隔离目录（主进程认这个变量，不覆盖测试指的地方）
    SIDEMATE_USER_DATA: path.join(lab, 'user'),
    SIDEMATE_SHOTS: process.env.SIDEMATE_SHOTS || path.join(lab, 'shots'),
  }
  delete env.SIDEMATE_PET
  delete env.SIDEMATE_PET_STILL
  // 开跑前就把两档写进 sidemate\data\settings.json：特大 + 小岛大；introPlayed 免得首次运行那扇窗弹出来描乱画面
  mkdirSync(path.join(lab, 'local', 'sidemate', 'data'), { recursive: true })
  writeFileSync(path.join(lab, 'local', 'sidemate', 'data', 'settings.json'), `${JSON.stringify({ introPlayed: true, fontScale: 1.3, islandScale: 1.25 }, null, 2)}\n`)
  const child = spawn(electron, [path.join(here, 'zoom-main.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    // 等主进程把量出来的数写出来（它干完自己 app.quit）
    let text = ''
    for (let i = 0; i < 300 && !text; i++) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, stderr || '主进程没量出结果')
    const state = JSON.parse(text)

    // 没有未捕获异常（stderr 一并带上来，好定位）
    assert.deepEqual(state.uncaught, [], `主进程里有未捕获异常：${state.uncaught.join('；')}\n${stderr}`)

    // 字号那档：页面 zoom 1.3，窗宽 629（484×1.3），正文 14 CSS 像素放大成 14×1.3
    assert.ok(Math.abs(state.big.zoom - 1.3) < 0.001, `任务窗 zoom 是 ${state.big.zoom}，不是 1.3`)
    assert.equal(state.big.fontCss, '14px', '正文字号还是 14 CSS 像素，放大交给 zoom')
    assert.equal(state.big.measure.taskBox.width, 629, `任务窗宽 ${state.big.measure.taskBox.width}，不是 629（484×1.3）`)
    assert.ok(Math.abs(state.big.measure.taskBox.width / state.big.frameCss - 1.3) < 0.01,
      `窗宽 ${state.big.measure.taskBox.width} 对页面 ${state.big.frameCss} CSS 像素，不是 1.3 倍`)

    // 小岛那档：窗口 140×38（112×30 ×1.25，高度四舍五入 37.5→38）
    assert.equal(state.island.bounds.width, 140, `小岛宽 ${state.island.bounds.width}，不是 140`)
    assert.ok(Math.abs(state.island.bounds.height - 38) <= 2, `小岛高 ${state.island.bounds.height}，不是 38 左右`)

    // 设置页改小岛大小：开着的窗立刻变（不用重开桌伴）
    // 宽按 1.25 放大（112 → 140）；高在 Windows 上有最小窗高 36，标准档量到 36，大档 38
    assert.ok(state.islandLive, '没量到设置页改小岛大小的效果')
    assert.equal(state.islandLive.standard.width, 112, `改成标准以后小岛宽 ${state.islandLive.standard.width}，不是 112`)
    assert.ok(state.islandLive.standard.height >= 30, `改成标准以后小岛高 ${state.islandLive.standard.height}，不该比 30 还小`)
    assert.equal(state.islandLive.big.width, 140, `改成大以后小岛宽 ${state.islandLive.big.width}，不是 140`)
    assert.ok(Math.abs(state.islandLive.big.height - 38) <= 2, `改成大以后小岛高 ${state.islandLive.big.height}，不是 38`)

    // 看得见的缝：小条底边到面板顶边 0±1（DIP，三档都量）
    for (const [name, one] of [['特大', state.big], ['标准', state.zero], ['小', state.small]]) {
      assert.ok(Math.abs(one.measure.gap) <= 1, `${name}那档缝是 ${one.measure.gap}，不是 0±1（DIP）`)
    }

    // Ctrl+0 回标准、Ctrl+减号到小：只认这几档
    assert.ok(Math.abs(state.zero.zoom - 1) < 0.001, `Ctrl+0 以后 zoom 是 ${state.zero.zoom}，不是 1`)
    assert.equal(state.zero.measure.taskBox.width, 484)
    assert.ok(Math.abs(state.small.zoom - 0.9) < 0.001, `Ctrl+减号以后 zoom 是 ${state.small.zoom}，不是 0.9`)
    assert.equal(state.small.measure.taskBox.width, 436, `小那档窗宽 ${state.small.measure.taskBox.width}，不是 436（484×0.9）`)
    // Ctrl + 加号：从 0.9 往大走一档，回到标准（不是 Electron 自带那路连续缩放）
    assert.ok(Math.abs(state.up.zoom - 1) < 0.001, `Ctrl+加号以后 zoom 是 ${state.up.zoom}，不是 1`)

    // 换过档写回 设置.json：字号到了小，小岛还是大
    assert.deepEqual(
      { fontScale: state.saved?.fontScale, islandScale: state.saved?.islandScale },
      { fontScale: 0.9, islandScale: 1.25 },
      `设置.json 里写的档位不对：${state.savedError || JSON.stringify(state.saved)}`,
    )

    // 再点一下小岛，任务窗收得回去
    assert.equal(state.closed, true, '再点一下小岛，任务窗没收回去')

    // 整屏截图存下来了（小岛 + 展开的任务窗）
    assert.ok(state.shot && existsSync(state.shot) && statSync(state.shot).size > 0, `整屏截图没存下来：${state.shotError || state.shot || ''}`)
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(300)
    rmSync(lab, { recursive: true, force: true })
  }
})
