// 关了「显示动画」（prefers-reduced-motion 或 SIDEMATE_PET_STILL=1）：
// 不读稿、不眨、不抬头、不东张西望、不看你、不跳、不摇、不弹，轮询也不开；
// 只换静止形状（拖着走 > <、犯困半闭直接换，没有过渡）。
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

test('页面认 prefers-reduced-motion：不安排扫、眨、抬头', () => {
  assert.match(page, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  // still() 一为真，眨眼和抬头都不排
  assert.match(page, /const still = \(\) => forcedStill \|\| media\.matches/)
  assert.match(page, /function scheduleBlink\(\) \{[\s\S]*?if \(still\(\)\) return/)
  assert.match(page, /function scheduleThink\(\) \{[\s\S]*?if \(mode !== 'work' \|\| still\(\)\) return/)
  // 眨眼本身也守着 still
  assert.match(page, /function blink\(\) \{[\s\S]*?if \(still\(\) \|\| sleepyOn\) return/)
})

test('页面认关了「显示动画」：不排东张西望、读稿、犯困检查；换形状直接换', () => {
  assert.match(page, /function scheduleGlance\(\) \{[\s\S]*?if \(!idleQuiet\(\) \|\| nearOn\) return/)
  assert.match(page, /function scheduleRead\(\) \{[\s\S]*?still\(\)[\s\S]*?return/)
  assert.match(page, /function readStep\(\) \{[\s\S]*?still\(\)[\s\S]*?return/)
  // 关了动画换眼神不眨眼、不滑：直接换成静止形状
  assert.match(page, /function setEyes\(look\) \{\s*if \(still\(\)\) \{ showNow\(look\); return \}/)
  assert.match(page, /function glance\(\) \{[\s\S]*?if \(!idleQuiet\(\) \|\| nearOn\) return/)
  // idleQuiet 里含 still()：still 时全都不排
  assert.match(page, /const idleQuiet = \(\) => mode === 'idle' && !still\(\) && !sleepyOn && !dragEyes/)
  assert.match(page, /function scheduleSleepy\(\) \{[\s\S]*?if \(mode !== 'idle' \|\| still\(\)\) return/)
})

test('壳里的看你轮询：still 时不轮询', () => {
  // 轮询的开关 nearActive 里会问 still（每 2 秒缓存一次）：still 时不起表，起了也自己停
  assert.match(shell, /const stillNow = \(\) =>[\s\S]*?stillChecked = stillMotion\(\)/, 'still 检查来自 stillMotion')
  assert.ok(shell.includes("&& (scene === 'strip' || scene === 'expanded') && !stillNow()"), '轮询条件里有 still')
  assert.match(shell, /pet\.isVisible\(\)/, '小岛显示着才轮询')
  assert.match(shell, /!dragging && !introBusy/, '拖动和出场时不轮询')
  assert.match(shell, /state\.mode === 'idle'/, '只在待命轮询')
})

test('小岛没有「收到托盘」：壳里不藏小岛，页面露脸时重排定时器', () => {
  assert.doesNotMatch(shell, /hideToTray|pet\.hide\(\)|shown: false/)
  assert.match(page, /pet\.onShown\(\(\) => \{[\s\S]*?scheduleIdleLife\(\)/)
})

test('still 时期待不弹不等：expectOf 里 still 立刻张托', () => {
  assert.match(expectSrc, /if \(options\.still === true\) return \{ bounce: false, waitMs: 0 \}/)
  assert.match(shell, /still: stillMotion,\s*\n\s*openTray:/, '期待那一摊用的还是 stillMotion')
})

test('不动的时候就是往下看的静止帧', () => {
  // 干活中的形状是扁圆角条（往下看），不靠动画撑着
  assert.match(html, /class="sh sh-down" x="41" y="16" width="10" height="6" rx="3"/)
  // 读稿是页面里排的小跳（关了动画就不排），样式里没有一直跑的扫视动画
  assert.doesNotMatch(html, /#eye-\w+ \{ animation:/)
  // 拖着走 > < 和犯困半闭是静止形状：换了就换，没有过渡也成立
  assert.match(html, /#eyes\.mode-drag \.sh-drag \{ opacity: 1; \}/)
  assert.match(html, /#eyes\.sleepy \.sh-round \{ opacity: 0/, '犯困半闭是静止形状，不靠过渡')
})

test('跳、摇、弹都是一次性动画，still 的总开关能停', () => {
  assert.match(html, /body\.still \* \{ transition: none !important; animation: none !important; \}/)
  for (const name of ['island-bounce', 'island-hop', 'island-shake']) {
    const rule = html.match(new RegExp(`#strip\\.[a-z]+ \\{ animation: ${name} [^}]*\\}`))
    assert.ok(rule, `样式里没有放 ${name} 的规则`)
    assert.doesNotMatch(rule[0], /infinite/, `${name} 只放一次`)
  }
})
