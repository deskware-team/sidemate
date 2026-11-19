// 五个状态各是什么眼神。
// 待命睁眼 · 干活往下看 · 要你看一眼睁大 · 做完了笑眼 · 没干成平线。
// 表情（东张西望、看你、期待、想一想、拖着走、犯困）时长和幅度都在这一页。
// A 套的形状：1:1（小岛 112×30）时两只眼睛中心在 x=46、x=66、y=15。
// 平移的幅度都是 SVG 单位（1:1 时 1 单位 = 1px），样式里乘这一档小岛的比例，小档大档跟着缩放。
// 动作的讲究：位移一律顺滑过渡；眼珠一跳快、带一点过冲，回正慢；
// 换形状藏在一次眨眼里（闭上 → 换 → 睁开时从旧形状的位置滑到新位置），不两个形状叠着淡入淡出。
// 纯函数，不碰 electron，好测。

import { BASE } from './layout.mjs'

export const EYE_MODES = {
  idle: 'open',
  work: 'down',
  look: 'wide',
  confirm: 'wide',
  done: 'smile',
  fail: 'flat',
}

// A 套：五个状态的眼睛长什么样（数字都是 1:1 的）
export const A_SET = {
  y: BASE.eyeY, // 15
  xs: [46, 66], // 收着时两只眼睛的中心
  gap: BASE.eyeGap, // 20
  radius: BASE.eyeRadius, // 5.3：待命的圆眼
  wideRadius: 7, // 要你看一眼：圆眼大一号
  down: { w: 10, h: 6, y: 19 }, // 干活中：10×6 的扁圆角条，中心 y=19（往下 4）
  arc: { spread: 4.7, from: 17, control: 10.3, width: 2.3 }, // 做完了：向上拱的弧
  line: { spread: 4.7, y: 15, width: 2.3 }, // 没干成：一条平线
  dot: { x: 96, y: 8.7, r: 3 }, // 要你看一眼：右上角的红点
  // 想一想：「小一号的圆眼 r=4.6，中心在 (49.05, 12) 和 (69.05, 12)，即右 +3、上 −3」
  think: { radius: 4.6, xs: [49.05, 69.05], y: 12 },
  // 拖着走 · > <：两条折线，「stroke 2.2、圆头圆角、不填充」
  drag: {
    width: 2.2,
    left: 'M42.5 11 L49.5 15 L42.5 19',
    right: 'M69.5 11 L62.5 15 L69.5 19',
  },
  // 犯困：「眼睛 1.2 秒慢慢半闭成 sleepy-1-1.svg 的下半圆（M40.7 15.5 … H40.7Z，右眼同理）」
  sleepy: {
    left: 'M40.7 15.5C40.7 16.9189 41.2636 18.2797 42.2669 19.283C43.2702 20.2863 44.631 20.85 46.0499 20.85C47.4689 20.85 48.8297 20.2863 49.833 19.283C50.8363 18.2797 51.4 16.9189 51.4 15.5H40.7Z',
    right: 'M60.7 15.5C60.7 16.9189 61.2636 18.2797 62.2669 19.283C63.2702 20.2863 64.631 20.85 66.05 20.85C67.4689 20.85 68.8297 20.2863 69.833 19.283C70.8363 18.2797 71.4 16.9189 71.4 15.5H60.7Z',
  },
  // 接文件·期待：expect-1-1.svg 的圆眼 r=6.6（待命的圆眼放大到 1.2 的样子）
  expect: { radius: 6.6 },
}

export function eyeOf(mode) {
  return EYE_MODES[mode] || 'open'
}

// 干活中·读稿：像人读一行字，不是来回摆。
// 往右一小跳一小跳（每跳 2–3，90ms，带一点过冲），跳之间停 250–550ms（每回不一样长）；
// 读到行尾 220ms 扫回行首，约 1/3 的几率顺带眨一下。幅度 ±5。
// 每跳只动 90ms、停着的时候不出帧。
export const SCAN = {
  px: 5,
  stepMinPx: 2,
  stepMaxPx: 3,
  stepMs: 90,
  holdMinMs: 250,
  holdMaxMs: 550,
  returnMs: 220,
  returnBlinkChance: 0.33,
  firstMs: 350, // 刚进干活：先停一下再开始读
}

// 眨眼：压到 1/10，80ms 闭（先慢后快）+ 140ms 睁（先快后慢）；待命 4–8 秒一次，干活中 3–5 秒一次。
// 闭和睁都绕每个形状自己的中心（绕整块 SVG 的左上角的话，眼睛像从顶上掉下来）。
export const BLINK = { closeMs: 80, openMs: 140, minMs: 3000, maxMs: 5000 }
// 「偶尔连眨两下（约 1/5 的几率，用现有 blinkTwice）」
BLINK.twiceChance = 0.2
// 两次眨眼至少隔这么久（看你、东张西望顺带的眨眼不扎堆）
BLINK.gapMs = 1500

// 换表情（待命 ↔ 干活 ↔ 做完了 ↔ 要你看一眼 ↔ 没干成、想一想、拖着走）：
// 藏在一次眨眼里：80ms 闭上 → 闭着的时候换形状 → 140ms 睁开，同时从旧形状的中心滑到新形状的中心。
// 每个形状的中心（相对待命圆眼中心 (46,15) 的偏移，SVG 单位）：
export const SHAPE_CENTER = {
  round: [0, 0], // 待命圆眼 r=5.3（往上看也是它，只是整只眼抬 2）
  wide: [0, 0], // 要你看一眼 r=7
  down: [0, 4], // 干活：10×6 的扁条，中心 y=19
  arc: [0, 0], // 做完了：笑眼弧
  line: [0, 0], // 没干成：平线
  think: [3.05, -3], // 想一想：小圆眼 (49.05, 12)
  drag: [0, 0], // 拖着走 > <
}
// 眼神 → 画哪个形状（睁眼和往上看是同一个形状，不用眨眼换）
export const SHAPE_OF = { open: 'round', up: 'round', wide: 'wide', down: 'down', smile: 'arc', flat: 'line', think: 'think', drag: 'drag' }

// 待命·东张西望：每 10–20 秒往左或右看一眼（平移 3）。
// 眼珠一跳 150ms（快、带一点过冲）→ 停 450–900ms（每回不一样）→
// 约 1/3 的几率再往另一边瞟一眼（幅度 2/3）→ 260ms 慢慢回正；约 1/3 的几率起步顺带眨一下。
export const GLANCE = {
  minMs: 10000,
  maxMs: 20000,
  px: 3,
  moveMs: 150,
  holdMinMs: 450,
  holdMaxMs: 900,
  backMs: 260,
  twiceChance: 0.33,
  blinkChance: 0.33,
}

// 鼠标靠近·看你：「鼠标进到小岛矩形 120px（DIP）以内，眼睛朝鼠标那边挪：
// x = 3 × clamp((鼠标x − 小岛中心x) / 60, −1, 1)，y 固定 −1（抬起 1）」；壳里轮询 120ms 不变。
// 刚进来 160ms 一跳并眨一下（「看到你了」）；之后每来一个新目标都从当前位置 280ms 先快后慢地追过去
// （比轮询间隔长，前一段还没走完下一段就接上，看着是一路跟着走，不是 120ms 一档地跳）；
// 离开 360ms 慢慢回正。
export const NEAR = { rangePx: 120, reachPx: 60, maxPx: 3, liftPx: -1, pollMs: 120, noticeMs: 160, moveMs: 280, backMs: 360 }

// 接文件·期待：「先眼睛放大到 1.2（expect-1-1.svg r=6.6）、整个岛弹一下
// （scale 1→1.06→1，--curve-bounce，250ms），250ms 后再长开接文件」
export const EXPECT = { scale: 1.2, eyeMs: 120, bounce: 1.06, bounceMs: 250, waitMs: 250 }

// 干活·想一想：「每 6–10 秒停下来往右上看 800ms，再回去读稿」。
// 换过去、换回来都走上面「换表情」那一套（眨一下，从扁条的位置滑到右上的小圆眼）。
export const THINK = { minMs: 6000, maxMs: 10000, holdMs: 800, dx: 3, dy: -3 }

// 做完了·跳一下：「整个岛（#strip）往上跳 2px 再落下，--curve-bounce，300ms，只跳一次」
export const HOP = { px: 2, ms: 300 }

// 没干成·摇头：「岛左右晃 2px 两次，共 240ms（translateX 0→−2→+2→−2→+2→0）」
export const SHAKE = { px: 2, ms: 240 }

// 拖着走 · > <：「松手 150ms 恢复到当前状态的眼神」（换过去、换回来都眨一下）
export const DRAG = { backMs: 150 }

// 读稿下一步：x 是眼睛现在在行里的哪儿（−SCAN.px…SCAN.px），rand 给 0–1 的随机数。
// 没读到行尾就往右跳一小步；到了行尾就扫回行首（偶尔顺带眨一下）。
export function readPlan(x, rand = Math.random) {
  const hold = SCAN.holdMinMs + rand() * (SCAN.holdMaxMs - SCAN.holdMinMs)
  if (x >= SCAN.px - 0.5) {
    return { x: -SCAN.px, ms: SCAN.returnMs, curve: 'settle', hold, blink: rand() < SCAN.returnBlinkChance }
  }
  const step = SCAN.stepMinPx + rand() * (SCAN.stepMaxPx - SCAN.stepMinPx)
  const next = Math.min(SCAN.px, Math.round((x + step) * 10) / 10)
  return { x: next, ms: SCAN.stepMs, curve: 'saccade', hold, blink: false }
}

// 东张西望这一趟怎么走：一串 { dx, ms, curve, hold }，最后一步回正。
// blink：起步顺带眨一下。rand 给 0–1 的随机数。
export function glancePlan(rand = Math.random) {
  const dir = rand() < 0.5 ? -1 : 1
  const hold = () => GLANCE.holdMinMs + rand() * (GLANCE.holdMaxMs - GLANCE.holdMinMs)
  const blink = rand() < GLANCE.blinkChance
  const steps = [{ dx: dir * GLANCE.px, ms: GLANCE.moveMs, curve: 'saccade', hold: hold() }]
  if (rand() < GLANCE.twiceChance) {
    steps.push({ dx: -dir * Math.round(GLANCE.px * 2 / 3 * 10) / 10, ms: GLANCE.moveMs + 30, curve: 'saccade', hold: hold() })
  }
  steps.push({ dx: 0, ms: GLANCE.backMs, curve: 'settle', hold: 0 })
  return { blink, steps }
}

// 换形状时新形状从哪儿滑过来：旧形状中心 − 新形状中心（SVG 单位）
export function swapFrom(fromLook, toLook) {
  const from = SHAPE_CENTER[SHAPE_OF[fromLook]] || [0, 0]
  const to = SHAPE_CENTER[SHAPE_OF[toLook]] || [0, 0]
  return [Math.round((from[0] - to[0]) * 100) / 100, Math.round((from[1] - to[1]) * 100) / 100]
}

// 两个眼神是不是同一个形状（同一个就直接换，不用眨眼）
export function sameShape(a, b) {
  return (SHAPE_OF[a] || a) === (SHAPE_OF[b] || b)
}

// 犯困：「10 分钟没动静，眼睛 1.2 秒慢慢半闭」，「鼠标一碰……睁开（250ms）并重新计时」
export const SLEEPY = { idleMs: 10 * 60 * 1000, closeMs: 1200, wakeMs: 250 }
