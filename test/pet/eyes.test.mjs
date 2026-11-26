// 小岛页面的眼睛结构（换上弹簧引擎以后）：
// 每只眼睛一个 <g>（每帧写 translate + scale），里面一个椭圆（上下眼皮用 clip-path）
// 和一条笑眼细线；拖着走的 > < 还是两条折线；整岛动写在 #bob 上；
// 旧的那套形状（sh-round / sh-wide / …）、#eye-swap / #eye-move 和它们的 CSS 都删干净了。
// 纯文本检查，不拉起 Electron。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as eyesModule from '../../app/pet/eyes.mjs'
import { DRAG, EXPECT, NEAR, SLEEPY } from '../../app/pet/eyes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '../../app/pet/pet.html'), 'utf8')
const page = readFileSync(join(here, '../../app/pet/pet.js'), 'utf8')

test('eyes.mjs 只剩壳和页面共用的那几个数', () => {
  assert.deepEqual(Object.keys(eyesModule).sort(), ['DRAG', 'EXPECT', 'NEAR', 'SLEEPY'])
  // 看你：near.mjs 拿它算偏移
  assert.equal(NEAR.rangePx, 120)
  assert.equal(NEAR.maxPx, 3)
  assert.equal(NEAR.liftPx, -1)
  // 接文件：张托前等这么久（弹和睁大都归引擎演）
  assert.equal(EXPECT.waitMs, 250)
  // 拖着走：松手 150ms 恢复
  assert.equal(DRAG.backMs, 150)
  // 犯困的坎
  assert.equal(SLEEPY.idleMs, 10 * 60 * 1000)
  assert.equal(SLEEPY.asleepMs, 10 * 60 * 1000 + SLEEPY.dozeMs) // 统一 10 分钟：打完盹就睡着
})

test('每只眼睛一个 g：椭圆加笑眼细线，中心在 (46,15) 和 (66,15)', () => {
  // 初始 transform 摆在待命的位置（JS 还没跑第一帧之前眼睛别飞到左上角）
  assert.match(html, /<g id="eye-l" transform="translate\(46 15\)">/)
  assert.match(html, /<g id="eye-r" transform="translate\(66 15\)">/)
  // 椭圆：待命圆眼 r=5.3
  for (const id of ['eye-l', 'eye-r']) {
    const eye = html.match(new RegExp(`<g id="${id}"[\\s\\S]*?</g>`))
    assert.ok(eye, `没有 ${id}`)
    assert.match(eye[0], /<ellipse class="pupil" cx="0" cy="0" rx="5\.3" ry="5\.3"/)
    assert.match(eye[0], /<path class="lid" opacity="0" d="M-5\.1 1\.05 Q 0 -1\.75 5\.1 1\.05"/)
  }
  // 两只眼睛外面包一个 g，绕岛中心 (56,15) 转（frame.eyesRot）
  assert.match(html, /<g id="eye-spin">/)
})

test('笑眼细线：不填色、1.4 宽、圆头（v4 的做法，不交叉淡化）', () => {
  assert.match(html, /\.lid \{ fill: none; stroke: var\(--eye\); stroke-width: 1\.4; stroke-linecap: round; \}/)
  // 椭圆填色
  assert.match(html, /\.pupil \{ fill: var\(--eye\); \}/)
})

test('拖着走的 > <：两条折线跟设计稿 drag-1-1.svg 一致，2.2 宽、圆头圆角、不填充', () => {
  assert.equal(DRAG.backMs, 150)
  assert.ok(html.includes('d="M42.5 11 L49.5 15 L42.5 19"'))
  assert.ok(html.includes('d="M69.5 11 L62.5 15 L69.5 19"'))
  assert.match(html, /\.sh-drag \{ fill: none; stroke: var\(--eye\); stroke-width: 2\.2; stroke-linecap: round; stroke-linejoin: round; \}/)
})

test('#bob 包着 #strip：整岛动写在 #bob 上，#strip 只留被点那一下的缩放', () => {
  // #bob 在 #strip 外面
  const bobAt = html.indexOf('<div id="bob">')
  const stripAt = html.indexOf('<div id="strip">')
  assert.ok(bobAt >= 0 && stripAt > bobAt, '#strip 没包在 #bob 里')
  assert.match(html, /#bob \{[^}]*transform-origin: center[^}]*will-change: transform[^}]*\}/)
  assert.match(html, /#strip\.press \{ transform: scale\(var\(--press-scale, \.96\)\)/)
  // 页面每帧把 island 的位移和缩放（乘这一档的比例）写在 #bob 上，不碰 #strip；
  // 格式化后的字符串没变就不重复写（styleWriter），但写的还是这几个数
  assert.match(page, /writeBob = styleWriter\(bob, 'transform'\)/)
  assert.match(page, /writeBob\(`translate\(\$\{\(frame\.island\.x \* eyeU\)/)
  assert.match(page, /scale\(\$\{frame\.island\.scale\.toFixed\(4\)\}\)`/)
  assert.doesNotMatch(page, /strip\.style\.transform/, '整岛动写到了 #strip 上（会把 .press 盖掉）')
  // island.rot 不用整岛转，只用 eyesRot 转眼睛那一层
  assert.match(page, /rotate\(\$\{frame\.eyesRot\.toFixed\(2\)\} 56 15\)/)
  assert.doesNotMatch(page, /frame\.island\.rot/)
})

test('页面照 v4 applyEye 画一帧：translate+scale、椭圆大小、眼皮 clip-path、smile 0.42 分界', () => {
  // 每只眼的写入器先接好，帧来了只写变了的字符串
  assert.match(page, /writeG = attrWriter\(eye\.g, 'transform'\)/)
  assert.match(page, /eye\.writeG\(`translate\(\$\{e\.cx\.toFixed\(2\)\} \$\{e\.cy\.toFixed\(2\)\}\) scale\(\$\{e\.sx\.toFixed\(3\)\} \$\{e\.sy\.toFixed\(3\)\}\)`\)/)
  assert.match(page, /writeRx = attrWriter\(eye\.pupil, 'rx'\)/)
  assert.match(page, /eye\.writeRx\(e\.rx\.toFixed\(2\)\)/)
  assert.match(page, /inset\(\$\{\(e\.clipTop \* 100\)/)
  // smile ≥ 0.42 只显示细线、小于只显示椭圆，不交叉淡化
  assert.match(page, /const smileOn = e\.smile >= 0\.42/)
  // frame.shape 为 'drag' 时只显示那两条折线
  assert.match(page, /const dragOn = frame\.shape === 'drag'/)
})

test('睡着：呼吸改成低频写，页面里没有任何 infinite 的 CSS 动画（省电）', () => {
  // 一直不停的动画在透明置顶小窗上让 GPU 每帧合成，睡着要烧一个核的 16–21%（docs/0.4/小岛-CPU-实测.md）
  assert.ok(!html.includes('infinite'), 'pet.html 里还有 infinite 的 animation')
  assert.ok(!html.includes('@keyframes'), 'pet.html 里还有 keyframes')
  // 起伏改成 pet.js 里 breath.mjs 的低频定时器写 #eyes 的 transform（一秒 4 次，0.22 × eye-u）
  assert.match(page, /import \{ createBreath \} from '\.\/breath\.mjs'/)
  assert.match(page, /const breath = createBreath\(\{/, '页面没建呼吸的定时器')
  assert.match(page, /frame\.breathing && !still\(\) && !busy && !\(hiddenPause \|\| scene === 'line'\)\) breath\.start\(\)/)
  assert.match(page, /else breath\.stop\(\)/)
  // data-breathing 还挂着（调试和测试用），但不再有 CSS 靠它做动画
  assert.match(page, /if \(frame\.breathing !== breathing\)/)
})

test('嵌套合法：svg 里没有 div', () => {
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)
  assert.ok(svg, '没有 svg')
  assert.doesNotMatch(svg[0], /<div/, 'svg 里嵌了 div')
})

test('旧的那套删干净了：形状、换形状的那一滑、mode-*、犯困的 class、跳 / 晃 / 弹的 keyframes', () => {
  for (const gone of [
    'sh-round', 'sh-wide', 'sh-down', 'sh-think', 'sh-arc', 'sh-line', 'sh-sleepy',
    '#eye-swap', '#eye-move', 'swap-jump', 'mode-open', 'mode-smile', 'mode-drag',
    '#eyes.blink', '#eyes.sleepy', '#eyes.waking', '#eyes.expect',
    'island-bounce', 'island-hop', 'island-shake', '#strip.hop', '#strip.shake', '#strip.bounce',
  ]) {
    assert.ok(!html.includes(gone), `pet.html 里还有 ${gone}`)
  }
  // 页面里那套定时器和函数也没了：帧和定时都归 animator
  for (const gone of [
    'blinkTimer', 'glanceTimer', 'readTimer', 'thinkTimer', 'lidTimer',
    'scheduleBlink', 'scheduleGlance', 'scheduleRead', 'scheduleThink',
    'playHop', 'playShake', 'blinkTwice', 'setEyeMove', 'swapWhileClosed', 'paintEyes',
  ]) {
    assert.ok(!page.includes(gone), `pet.js 里还有 ${gone}`)
  }
})
