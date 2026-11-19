// 五个状态各是什么眼神（A 套）：
// 形状照 1:1 的图：收着时两只眼睛中心在 x=46、x=66、y=15。
// 干活读稿：一小跳一小跳往右读，读到行尾扫回来；3–5 秒眨一次；
// 0.3：东张西望、看你、期待、想一想、跳一下、摇头、拖着走、犯困的时长幅度都在 eyes.mjs。
// 纯函数，不碰 electron，好测。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as eyesModule from '../../app/pet/eyes.mjs'
import { A_SET, BLINK, DRAG, EXPECT, EYE_MODES, GLANCE, HOP, NEAR, SCAN, SHAKE, SHAPE_CENTER, SHAPE_OF, SLEEPY, THINK, eyeOf, glancePlan, readPlan, sameShape, swapFrom } from '../../app/pet/eyes.mjs'
import { layoutFor } from '../../app/pet/layout.mjs'
import { theme } from '../../app/pet/theme.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(here, '../../app/pet/pet.html'), 'utf8')
const page = readFileSync(join(here, '../../app/pet/pet.js'), 'utf8')

// 固定的一串随机数（循环取）
function seq(...values) {
  let i = 0
  return () => values[i++ % values.length]
}

test('几个状态各是什么眼神', () => {
  assert.equal(eyeOf('idle'), 'open')
  assert.equal(eyeOf('work'), 'down')
  assert.equal(eyeOf('look'), 'wide')
  // 等确认：跟「要你看一眼」一样的眼睛
  assert.equal(eyeOf('confirm'), 'wide')
  assert.equal(eyeOf('done'), 'smile')
  assert.equal(eyeOf('fail'), 'flat')
  assert.deepEqual(Object.keys(EYE_MODES), ['idle', 'work', 'look', 'confirm', 'done', 'fail'])
})

test('不认的状态当睁眼', () => {
  assert.equal(eyeOf(''), 'open')
  assert.equal(eyeOf('nope'), 'open')
})

test('A 套：待命是圆眼 r=5.3，眼睛中心在 x=46、x=66、y=15', () => {
  assert.equal(A_SET.radius, 5.3)
  assert.deepEqual(A_SET.xs, [46, 66])
  assert.equal(A_SET.y, 15)
  assert.match(html, /class="sh sh-round" cx="46" cy="15" r="5\.3"/)
  assert.match(html, /class="sh sh-round" cx="66" cy="15" r="5\.3"/)
})

test('A 套：干活中是 10×6 的扁圆角条，中心 y=19（往下 4）', () => {
  assert.equal(A_SET.down.w, 10)
  assert.equal(A_SET.down.h, 6)
  assert.equal(A_SET.down.y, 19)
  assert.equal(A_SET.down.y - A_SET.y, 4)
  assert.match(html, /class="sh sh-down" x="41" y="16" width="10" height="6" rx="3"/)
  assert.match(html, /class="sh sh-down" x="61" y="16" width="10" height="6" rx="3"/)
})

test('A 套：要你看一眼是 r=7 的圆眼加右上角红点（x=96, y=8.7, r=3）', () => {
  assert.equal(A_SET.wideRadius, 7)
  assert.deepEqual(A_SET.dot, { x: 96, y: 8.7, r: 3 })
  assert.match(html, /class="sh sh-wide" cx="46" cy="15" r="7"/)
  assert.match(html, /class="sh sh-wide" cx="66" cy="15" r="7"/)
})

test('A 套：做完了是向上拱的弧，不是填充的半圆', () => {
  assert.equal(A_SET.arc.width, 2.3)
  // 线：不填充、圆头、2.3 宽
  assert.match(html, /\.sh-arc, \.sh-line \{[^}]*fill: none[^}]*stroke-width: 2\.3[^}]*stroke-linecap: round/)
  assert.match(html, /class="sh sh-arc" d="M 41\.3 17 Q 46 10\.3 50\.7 17"/)
  assert.match(html, /class="sh sh-arc" d="M 61\.3 17 Q 66 10\.3 70\.7 17"/)
})

test('A 套：没干成是一条平线', () => {
  assert.equal(A_SET.line.width, 2.3)
  assert.match(html, /class="sh sh-line" d="M 41\.3 15 L 50\.7 15"/)
  assert.match(html, /class="sh sh-line" d="M 61\.3 15 L 70\.7 15"/)
})

test('干活读稿：±5 里一小跳一小跳往右读（每跳 2–3、90ms），停 250–550ms，读到行尾 220ms 扫回', () => {
  assert.equal(SCAN.px, 5)
  assert.equal(SCAN.stepMinPx, 2)
  assert.equal(SCAN.stepMaxPx, 3)
  assert.equal(SCAN.stepMs, 90)
  assert.equal(SCAN.holdMinMs, 250)
  assert.equal(SCAN.holdMaxMs, 550)
  assert.equal(SCAN.returnMs, 220)
  // 从行首读：每一步往右 2–3，带过冲的那条曲线，停多久每回不一样
  let x = -SCAN.px
  const xs = []
  const holds = new Set()
  const rand = seq(0.1, 0.7, 0.4, 0.95, 0.2)
  for (let i = 0; i < 12; i++) {
    const plan = readPlan(x, rand)
    assert.ok(plan.hold >= SCAN.holdMinMs && plan.hold <= SCAN.holdMaxMs)
    holds.add(Math.round(plan.hold))
    if (plan.x < x) {
      // 扫回行首：到过行尾才扫，220ms、慢起慢停
      assert.ok(x >= SCAN.px - 0.5)
      assert.equal(plan.x, -SCAN.px)
      assert.equal(plan.ms, SCAN.returnMs)
      assert.equal(plan.curve, 'settle')
    } else {
      assert.ok(plan.x - x >= SCAN.stepMinPx - 0.05 || plan.x === SCAN.px)
      assert.ok(plan.x - x <= SCAN.stepMaxPx + 0.05)
      assert.equal(plan.ms, SCAN.stepMs)
      assert.equal(plan.curve, 'saccade')
      assert.equal(plan.blink, false)
    }
    assert.ok(plan.x >= -SCAN.px && plan.x <= SCAN.px)
    x = plan.x
    xs.push(x)
  }
  assert.ok(xs.includes(-SCAN.px), '读到行尾会扫回行首')
  assert.ok(holds.size > 1, '停顿不是一个固定的节拍')
  // 读到行尾扫回来时偶尔顺带眨一下
  assert.equal(readPlan(SCAN.px, () => 0).blink, true)
  assert.equal(readPlan(SCAN.px, () => 0.99).blink, false)
  // 不是一直跑的关键帧动画：读稿是页面里排的，停着的时候不出帧
  assert.doesNotMatch(html, /@keyframes eyes-scan/)
  assert.doesNotMatch(html, /animation:[^;]*infinite/)
  assert.match(page, /function scheduleRead\(\) \{[\s\S]*?still\(\)/)
})

test('眨眼：压到 1/10，80ms 闭 + 140ms 睁；干活中 3–5 秒一次；待命偶尔连眨两下', () => {
  assert.equal(BLINK.closeMs, 80)
  assert.equal(BLINK.openMs, 140)
  assert.equal(BLINK.minMs, 3000)
  assert.equal(BLINK.maxMs, 5000)
  assert.equal(BLINK.twiceChance, 0.2) // 约 1/5 的几率
  assert.match(html, /#eyes\.blink [\s\S]*?scaleY\(0\.1\)/)
})

test('眨眼绕每个形状自己的中心：闭和睁都是，睁开时眼睛不从顶上掉下来', () => {
  // transform-box / transform-origin 要写在每个形状上：只写在 .blink 上，
  // 睁开那 140ms 绕的是整块 SVG 的左上角，眼睛像从小岛顶上掉下来
  const sh = html.match(/\n  \.sh \{([^}]*)\}/)
  assert.ok(sh, '样式里没有 .sh 的基础规则')
  assert.match(sh[1], /transform-box: fill-box/)
  assert.match(sh[1], /transform-origin: center/)
  // 不透明度不过渡：换形状是闭着眼一下换掉，不两个形状叠着淡入淡出
  assert.doesNotMatch(sh[1], /opacity \d+ms/)
})

test('呼吸去掉了；位移都是顺滑过渡，不再量化成阶梯', () => {
  assert.equal(eyesModule.BREATH, undefined)
  assert.doesNotMatch(html, /breath-in|breath-out/)
  assert.doesNotMatch(page, /breathe\(|scheduleBreath/)
  assert.doesNotMatch(html, /steps\(/)
  // 每只眼睛绕自己的中心缩放（左 46、右 66，y 15）：期待放大 1.2 用
  assert.match(html, /#eyes \.eye-l \{ transform-origin: calc\(var\(--island-w\) \* 46 \/ 112\) calc\(var\(--island-h\) \* 15 \/ 30\); \}/)
  assert.match(html, /#eyes \.eye-r \{ transform-origin: calc\(var\(--island-w\) \* 66 \/ 112\) calc\(var\(--island-h\) \* 15 \/ 30\); \}/)
  assert.match(html, /#eyes \.eye \{ display: block; overflow: visible; will-change: transform;/)
})

test('待命·东张西望：每 10–20 秒一跳 3（150ms 带过冲），停 450–900ms，偶尔再瞟另一边，260ms 回正', () => {
  assert.equal(GLANCE.minMs, 10000)
  assert.equal(GLANCE.maxMs, 20000)
  assert.equal(GLANCE.px, 3)
  assert.equal(GLANCE.moveMs, 150)
  assert.equal(GLANCE.holdMinMs, 450)
  assert.equal(GLANCE.holdMaxMs, 900)
  assert.equal(GLANCE.backMs, 260)
  // 一趟：一跳过去 → 停 → 回正（最后一步一定回到 0，慢起慢停）
  const once = glancePlan(seq(0.1, 0.5, 0.9, 0.9))
  assert.equal(once.steps.length, 2)
  assert.equal(once.steps[0].dx, -GLANCE.px)
  assert.equal(once.steps[0].ms, GLANCE.moveMs)
  assert.equal(once.steps[0].curve, 'saccade')
  assert.equal(once.steps.at(-1).dx, 0)
  assert.equal(once.steps.at(-1).ms, GLANCE.backMs)
  assert.equal(once.steps.at(-1).curve, 'settle')
  // 偶尔再瞟另一边（幅度 2/3），起步偶尔顺带眨一下
  const twice = glancePlan(seq(0.9, 0.1, 0.1, 0.1, 0.3))
  assert.equal(twice.steps.length, 3)
  assert.equal(twice.steps[0].dx, GLANCE.px)
  assert.equal(twice.steps[1].dx, -2)
  assert.equal(twice.blink, true)
  // 两只眼睛一起平移，SVG 单位乘这一档小岛的比例；顺滑过渡，时长和曲线每回给
  assert.match(html, /#eye-move \{[\s\S]*?translate\(calc\(var\(--eye-dx, 0\) \* var\(--eye-u\) \* 1px\), calc\(var\(--eye-dy, 0\) \* var\(--eye-u\) \* 1px\)\)/)
  assert.match(html, /#eye-move \{[\s\S]*?transition: transform var\(--move-ms, 200ms\) var\(--move-curve/)
})

test('看你：120px 内最多挪 ±3，抬起 1；刚进来 160ms 一跳，之后 280ms 追新目标，离开 360ms 回正；轮询 120ms', () => {
  assert.equal(NEAR.rangePx, 120)
  assert.equal(NEAR.reachPx, 60)
  assert.equal(NEAR.maxPx, 3)
  assert.equal(NEAR.liftPx, -1)
  assert.equal(NEAR.noticeMs, 160)
  assert.equal(NEAR.moveMs, 280)
  assert.equal(NEAR.backMs, 360)
  assert.equal(NEAR.pollMs, 120)
  // 追新目标的时长比轮询间隔长：前一段没走完下一段就接上，一路跟着走
  assert.ok(NEAR.moveMs > NEAR.pollMs * 2)
  assert.match(page, /setEyeMove\(dx, dy, NEAR\.moveMs, 'var\(--curve-follow\)'\)/)
})

test('换表情藏在一次眨眼里：新形状从旧形状的中心滑过来', () => {
  // 五个状态 + 想一想 + 拖着走都有形状，睁眼和往上看是同一个
  for (const look of ['open', 'up', 'wide', 'down', 'smile', 'flat', 'think', 'drag']) assert.ok(SHAPE_CENTER[SHAPE_OF[look]], look)
  assert.equal(sameShape('open', 'up'), true)
  assert.equal(sameShape('open', 'down'), false)
  // 往下看的扁条中心 y=19（往下 4）；想一想的小圆眼在 (49.05, 12)（右 3.05、上 3）
  assert.deepEqual(SHAPE_CENTER.down, [0, A_SET.down.y - A_SET.y])
  assert.deepEqual(SHAPE_CENTER.think, [Math.round((A_SET.think.xs[0] - A_SET.xs[0]) * 100) / 100, A_SET.think.y - A_SET.y])
  // 待命 → 干活：扁条先摆在圆眼的位置（上 4），睁眼时滑下去
  assert.deepEqual(swapFrom('open', 'down'), [0, -4])
  // 干活 → 想一想：小圆眼从扁条那儿滑到右上
  assert.deepEqual(swapFrom('down', 'think'), [-3.05, 7])
  assert.deepEqual(swapFrom('think', 'down'), [3.05, -7])
  assert.deepEqual(swapFrom('open', 'smile'), [0, 0])
  // 样式：换的那一刻不过渡，之后睁眼的同时滑回
  assert.match(html, /#eye-swap \{[\s\S]*?translate\(calc\(var\(--swap-dx, 0\) \* var\(--eye-u\) \* 1px\), calc\(var\(--swap-dy, 0\) \* var\(--eye-u\) \* 1px\)\)/)
  assert.match(html, /#eyes\.swap-jump #eye-swap \{ transition: none; \}/)
  // 页面：闭着眼的那一刻换形状
  assert.match(page, /function openLid\(\) \{\s*if \(wanted !== shown\) swapWhileClosed\(wanted\)/)
})

test('张开收起：眼睛跟窗口同一个时长、同一条曲线；挪多少按这一档小岛算', () => {
  assert.equal(theme.expandMs, 240)
  assert.equal(theme.collapseMs, 200)
  // 冒一行和接文件都是这样往两边长开：眼睛跟着挪到左边
  assert.match(html, /body\[data-scene="expanded"\] #eye-shift,\s*body\[data-scene="tray"\] #eye-shift \{[^}]*transition: transform var\(--expand-ms\) var\(--curve-out\)/)
  assert.match(html, /\n  #eye-shift \{ transition: transform var\(--collapse-ms\) var\(--curve-in\); \}/)
  assert.match(page, /'--eye-shift', `\$\{box\.island \/ 2 - box\.eyeZone \/ 2\}`/)
  // 三档小岛：挪完眼睛都在表情区正中（标准档是 28）
  for (const scale of [0.85, 1, 1.25]) {
    const box = layoutFor(13 * scale)
    const shift = box.island / 2 - box.eyeZone / 2
    assert.equal(box.island / 2 - shift, box.eyeZone / 2)
  }
  assert.equal(layoutFor(13).island / 2 - layoutFor(13).eyeZone / 2, 28)
})

test('期待：眼睛放大到 1.2，岛弹一下 1→1.06→1 共 250ms，等 250ms 再张托', () => {
  assert.equal(EXPECT.scale, 1.2)
  assert.equal(EXPECT.bounce, 1.06)
  assert.equal(EXPECT.bounceMs, 250)
  assert.equal(EXPECT.waitMs, 250)
  assert.equal(A_SET.expect.radius, 6.6) // expect-1-1.svg 的圆眼 r=6.6
  assert.match(html, /#eyes\.expect \.eye,\s*body\[data-scene="tray"\] #eyes \.eye \{ transform: scale\(1\.2\)/)
  const bounce = html.match(/@keyframes island-bounce \{([\s\S]*?)\n  \}/)
  assert.ok(bounce, '样式里没有 island-bounce')
  assert.match(bounce[1], /0% \{ transform: scale\(1\); \}/)
  assert.match(bounce[1], /50% \{ transform: scale\(1\.06\); \}/)
  assert.match(bounce[1], /100% \{ transform: scale\(1\); \}/)
})

test('做完了·跳一下：往上跳 2px 再落下，300ms，只跳一次', () => {
  assert.equal(HOP.px, 2)
  assert.equal(HOP.ms, 300)
  const hop = html.match(/@keyframes island-hop \{([\s\S]*?)\n  \}/)
  assert.ok(hop, '样式里没有 island-hop')
  assert.match(hop[1], /50% \{ transform: translateY\(-2px\); \}/)
  assert.match(html, /#strip\.hop \{ animation: island-hop 300ms var\(--curve-bounce\); \}/)
})

test('没干成·摇头：左右晃 2px 两次，共 240ms（0→−2→+2→−2→+2→0）', () => {
  assert.equal(SHAKE.px, 2)
  assert.equal(SHAKE.ms, 240)
  const shake = html.match(/@keyframes island-shake \{([\s\S]*?)\n  \}/)
  assert.ok(shake, '样式里没有 island-shake')
  assert.match(shake[1], /0%, 100% \{ transform: translateX\(0\); \}/)
  assert.match(shake[1], /20%, 60% \{ transform: translateX\(-2px\); \}/)
  assert.match(shake[1], /40%, 80% \{ transform: translateX\(2px\); \}/)
})

test('拖着走 · > <：两条折线跟设计稿 drag-1-1.svg 一致，松手 150ms 恢复', () => {
  assert.equal(DRAG.backMs, 150)
  assert.equal(A_SET.drag.width, 2.2)
  assert.equal(A_SET.drag.left, 'M42.5 11 L49.5 15 L42.5 19')
  assert.equal(A_SET.drag.right, 'M69.5 11 L62.5 15 L69.5 19')
  // pet.html 里的 path 和常量一字不差
  assert.ok(html.includes(`d="${A_SET.drag.left}"`))
  assert.ok(html.includes(`d="${A_SET.drag.right}"`))
  // 线：不填充、2.2 宽、圆头圆角
  assert.match(html, /\.sh-drag \{[^}]*fill: none[^}]*stroke-width: 2\.2[^}]*stroke-linecap: round[^}]*stroke-linejoin: round/)
})

test('犯困：10 分钟没动静，1.2 秒半闭；一碰就睁开（250ms）', () => {
  assert.equal(SLEEPY.idleMs, 10 * 60 * 1000)
  assert.equal(SLEEPY.closeMs, 1200)
  assert.equal(SLEEPY.wakeMs, 250)
  // pet.html 里的下半圆 path 和常量 sleepy-1-1.svg 一字不差
  assert.ok(html.includes(`d="${A_SET.sleepy.left}"`), '左眼下半圆和设计稿不一致')
  assert.ok(html.includes(`d="${A_SET.sleepy.right}"`), '右眼下半圆和设计稿不一致')
  assert.match(html, /#eyes\.sleepy \.sh-round \{ opacity: 0; transition: opacity 1200ms linear; \}/)
})

test('想一想：6–10 秒一次，往右上看 800ms（小圆眼 r=4.6，右 +3、上 −3）', () => {
  assert.equal(THINK.minMs, 6000)
  assert.equal(THINK.maxMs, 10000)
  assert.equal(THINK.holdMs, 800)
  assert.equal(THINK.dx, 3)
  assert.equal(THINK.dy, -3)
  // think-1-1.svg：中心在 (49.05, 12) 和 (69.05, 12)，r=4.6
  assert.deepEqual(A_SET.think, { radius: 4.6, xs: [49.05, 69.05], y: 12 })
  assert.match(html, /class="sh sh-think" cx="49\.05" cy="12" r="4\.6"/)
  assert.match(html, /class="sh sh-think" cx="69\.05" cy="12" r="4\.6"/)
  // 想的时候换小圆眼（眨一下换），不是把待命的圆眼抬上去
  assert.match(html, /#eyes\.mode-think \.sh-think,/)
  assert.match(page, /function think\(\) \{[\s\S]*?setEyes\('think'\)/)
  assert.doesNotMatch(html, /body\[data-thinking="1"\] #eyes \.eye \{ transform: translateY\(-2px\); \}/)
})
