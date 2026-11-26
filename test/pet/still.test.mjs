// 关了「显示动画」（prefers-reduced-motion 或 SIDEMATE_PET_STILL=1）：
// 引擎不走帧（animator.still），换神情 / 换视线时 snap 一帧静止画面；
// 样式里 transition 和 animation 全停；壳里的看你轮询也不开。
// 纯函数和样式检查，不拉起 Electron。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '../../app/pet/pet.html'), 'utf8')
const page = readFileSync(join(here, '../../app/pet/pet.js'), 'utf8')
const shell = readFileSync(join(here, '../../app/pet/shell.mjs'), 'utf8')
const expectSrc = readFileSync(join(here, '../../app/pet/expect.mjs'), 'utf8')

test('样式里认 prefers-reduced-motion：动画和过渡都不动', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important/)
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition-duration: 0s !important/)
})

test('页面认 prefers-reduced-motion：still 时交给 animator.still，不走帧', () => {
  assert.match(page, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(page, /const still = \(\) => forcedStill \|\| media\.matches/)
  // 每次翻神情前先对表：still 变了才调 animator.still（snap 一帧就停）
  assert.match(page, /if \(quiet !== stillGiven\) \{[\s\S]*?animator\.still\(quiet\)/)
  // 老的那套排程没了：眨眼、东张西望、读稿、想一想都归引擎
  for (const gone of ['scheduleBlink', 'scheduleGlance', 'scheduleRead', 'scheduleThink', 'blinkTwice']) {
    assert.ok(!page.includes(gone), `pet.js 里还有 ${gone}`)
  }
  // 被点那一下的缩放还是不走（关了动画就别弹）
  assert.match(page, /function playPress\(payload\) \{\s*if \(still\(\)\) return/)
  // 出场也认：still 时不往上看、不眨
  assert.match(page, /if \(phase === 'slide'\) \{\s*if \(!still\(\)\) animator\.setGaze/)
  assert.match(page, /if \(phase === 'land'\) \{\s*if \(!still\(\)\) animator\.blink\(\)/)
})

test('犯困的检查也认 still：关了动画就不排那两个坑', () => {
  assert.match(page, /function scheduleSleepy\(\) \{[\s\S]*?if \(mode !== 'idle' \|\| still\(\)\) return/)
  // 10 分钟（犯困）和打完盹（睡着）两个坎上都重算
  assert.match(page, /if \(idle < SLEEPY\.idleMs\) next = SLEEPY\.idleMs - idle/)
  assert.match(page, /else if \(idle < SLEEPY\.asleepMs\) next = SLEEPY\.asleepMs - idle/)
})

test('壳里的看你轮询：still 时不轮询', () => {
  // 轮询的开关 nearActive 里会问 still（每 2 秒缓存一次）：still 时不起表，起了也自己停
  assert.match(shell, /const stillNow = \(\) =>[\s\S]*?stillChecked = stillMotion\(\)/, 'still 检查来自 stillMotion')
  assert.ok(shell.includes("&& (scene === 'strip' || scene === 'expanded') && !stillNow()"), '轮询条件里有 still')
  assert.match(shell, /pet\.isVisible\(\)/, '小岛显示着才轮询')
  assert.match(shell, /!dragging && !introBusy/, '拖动和出场时不轮询')
  assert.match(shell, /state\.mode === 'idle'/, '只在待命轮询')
})

test('小岛没有「收到托盘」：壳里不藏小岛，页面露脸时重新算动静', () => {
  assert.doesNotMatch(shell, /hideToTray|pet\.hide\(\)|shown: false/)
  assert.match(page, /pet\.onShown\(\(\) => \{[\s\S]*?touchActivity\(\)/)
})

test('still 时期待不弹不等：expectOf 里 still 立刻张托', () => {
  assert.match(expectSrc, /if \(options\.still === true\) return \{ bounce: false, waitMs: 0 \}/)
  assert.match(shell, /still: stillMotion,\s*\n\s*openTray:/, '期待那一摊用的还是 stillMotion')
})

test('页面里没有一直跑的 CSS 动画；still 的总开关能停', () => {
  assert.match(html, /body\.still \* \{ transition: none !important; animation: none !important; \}/)
  // 睡着的呼吸改成 breath.mjs 低频写 transform（省电）：样式里不再有任何无限循环的动画
  const loops = html.match(/animation:[^;]*infinite/g) || []
  assert.deepEqual(loops, [])
  assert.ok(!page.includes('island-breathe'))
  // 跳、晃、弹不再是 CSS keyframes，归引擎（帧也归 animator，still 时一帧不走）
  for (const gone of ['island-bounce', 'island-hop', 'island-shake']) {
    assert.ok(!html.includes(gone), `样式里还有 ${gone}`)
  }
})

test('窗口藏起来、收成细线：引擎停帧，回来接着走', () => {
  assert.match(page, /animator\.pause\(hiddenPause \|\| scene === 'line'\)/)
  assert.match(page, /document\.addEventListener\('visibilitychange'/)
})

test('犯困计时：主进程重复推同一个模式不算有动静，模式真的变了才重新计时', () => {
  const body = page.slice(page.indexOf('pet.onState('), page.indexOf('pet.onBubble('))
  assert.match(body, /const next = payload\.mode \|\| 'idle'/)
  assert.match(body, /if \(next !== mode\) touchActivity\(\)/)
  assert.doesNotMatch(body, /^\s*touchActivity\(\)\s*$/m)
})
