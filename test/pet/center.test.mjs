// 小岛竖直居中：真起一个桌伴小岛窗（electron），量眼睛和字是不是在小条正中。
//
// 背景：Windows 给透明无边框的窗垫了最小高（要 30 实得 36，100% 缩放时垫得更多），
// 小条的底色要是铺满整个窗，眼睛和字就都偏上（排版按主题的 30 算，落在更高的窗里）。
// 这个测试起真的小岛窗（3 档大小 × 3 种缩放），既量 DOM（getBoundingClientRect），
// 也截图标像素（看得见的墨色小条有多高、眼睛和字那一带像素带的中心），
// 断言「眼睛中心到小条中心」在 ±0.5 DIP 内、「字的中心」在 ±1 DIP 内。
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
import { visibleStripHeight } from '../../app/pet/layout.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const electron = createRequire(path.join(root, 'package.json'))('electron')

const SCALES = [0.85, 1, 1.25]
const DPRS = [1, 1.5, 2]

// 起一次 electron，量完把结果读回来
async function measure(scale, dpr, lab) {
  const resultFile = path.join(lab, `result-${scale}-${dpr}.json`)
  const env = {
    ...process.env,
    SIDEMATE_PET_SCALE: String(scale),
    SIDEMATE_PET_RESULT: resultFile,
    SIDEMATE_PET_SHOTS: path.join(root, '..', 'm03-shots'),
  }
  delete env.SIDEMATE_PET
  const child = spawn(electron, [path.join(here, 'center-main.mjs'), `--force-device-scale-factor=${dpr}`, '--no-sandbox'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    let text = ''
    for (let i = 0; i < 150 && !text; i++) {
      await sleep(200)
      try { text = readFileSync(resultFile, 'utf8') } catch { /* 还没写出来 */ }
    }
    assert.ok(text, `没量出来（scale=${scale} dpr=${dpr}）：${stderr}`)
    return JSON.parse(text)
  } finally {
    if (child.exitCode === null) child.kill()
    await sleep(200)
  }
}

test('看得见的小条：底色只画主题那么高，窗垫出来的那一截是透明的', () => {
  // 收着的小条和冒一行：只看主题高（Windows 垫高的那一截不算）
  assert.equal(visibleStripHeight(36, 30, 'strip'), 30)
  assert.equal(visibleStripHeight(71, 30, 'strip'), 30)
  assert.equal(visibleStripHeight(30, 30, 'strip'), 30)
  assert.equal(visibleStripHeight(38, 38, 'expanded'), 38)
  // 细线：墨色只画那根线那么高（下面透明），不是铺满整窗
  assert.equal(visibleStripHeight(36, 30, 'line', 4), 4)
  assert.equal(visibleStripHeight(72, 30, 'line', 4), 4)
  assert.equal(visibleStripHeight(36, 30, 'line', 8), 8)
  assert.equal(visibleStripHeight(2, 30, 'line', 4), 2)
  // 接文件：小岛只往两边长，看得见的还是主题那么高
  assert.equal(visibleStripHeight(72, 30, 'tray'), 30)
})

test('样式里：小条的底色只画主题高，细线只画那根线那么高', () => {
  const html = readFileSync(path.join(root, 'app/pet/pet.html'), 'utf8')
  assert.match(html, /#strip \{[^}]*height: var\(--island-h\)/)
  assert.match(html, /body\[data-scene="line"\] #strip \{ height: var\(--line-h\)/)
  // 细线的高是变量，页面那边按小岛大小那档算出来
  assert.match(html, /--line-h:/)
})

test('小岛的眼睛和字在小条正中（3 档大小 × 3 种缩放）', { skip: process.env.SIDEMATE_PET ? false : 'set SIDEMATE_PET=1', timeout: 600_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-center-'))
  try {
    for (const dpr of DPRS) {
      for (const scale of SCALES) {
        const data = await measure(scale, dpr, lab)
        const themeHeight = data.theme.height
        const where = `大小 ${scale}、缩放 ${dpr}`
        for (const one of data.results) {
          const { dom, pixels } = one
          // 看得见的小条：底色只画主题那么高（窗被 Windows 垫出来的那一截是透明的）
          // 细线状态：墨色只画那根线那么高（下面也是透明的）
          const want = dom.scene === 'line' ? data.theme.lineHeight : themeHeight
          assert.ok(
            Math.abs(dom.strip.h - want) <= 0.5,
            `${where}（${one.label}）：看得见的小条 ${dom.strip.h} DIP，该是 ${want} DIP`,
          )
          assert.ok(
            Math.abs(pixels.inkHeight - want) <= 1,
            `${where}（${one.label}）：墨色像素带 ${pixels.inkHeight} DIP，该是 ${want} DIP`,
          )
          // 细线状态：只有那根线，没有眼睛也没有字（下面那些断言不适用）
          if (dom.scene === 'line') continue
          // 眼睛：在小条正中（±0.5 DIP）
          // 干活中的那双是「往下看」的眼睛，本来就画在下面一截（不是居中），不拿来判
          if (dom.eye && dom.mode !== 'work') {
            assert.ok(
              Math.abs(dom.eye.cy - dom.strip.cy) <= 0.5,
              `${where}（${one.label}）：眼睛中心 ${dom.eye.cy}，小条中心 ${dom.strip.cy}，差 ${Math.abs(dom.eye.cy - dom.strip.cy).toFixed(2)} DIP`,
            )
          }
          if (pixels.eyeCenter !== null && dom.mode !== 'work') {
            assert.ok(
              Math.abs(pixels.eyeCenter - pixels.inkCenter) <= 0.5,
              `${where}（${one.label}）：眼睛像素带中心 ${pixels.eyeCenter}，墨色带中心 ${pixels.inkCenter}，差 ${Math.abs(pixels.eyeCenter - pixels.inkCenter).toFixed(2)} DIP`,
            )
          }
          // 字：在小条正中（±1 DIP）
          if (dom.text && dom.text.h > 0) {
            assert.ok(
              Math.abs(dom.text.cy - dom.strip.cy) <= 1,
              `${where}（${one.label}）：字中心 ${dom.text.cy}，小条中心 ${dom.strip.cy}，差 ${Math.abs(dom.text.cy - dom.strip.cy).toFixed(2)} DIP`,
            )
          }
          if (pixels.textCenter !== null) {
            assert.ok(
              Math.abs(pixels.textCenter - pixels.inkCenter) <= 1,
              `${where}（${one.label}）：字像素带中心 ${pixels.textCenter}，墨色带中心 ${pixels.inkCenter}，差 ${Math.abs(pixels.textCenter - pixels.inkCenter).toFixed(2)} DIP`,
            )
          }
        }
      }
    }
  } finally {
    rmSync(lab, { recursive: true, force: true })
  }
})
