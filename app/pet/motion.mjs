// 小岛动画引擎：弹簧追目标。纯函数，不引 node: 和 electron，页面直接 import。
// 算法照 docs/0.4/island-v4/index.html 的 body / stepSpring / damp / makeEye / stepWorld / applyEye：
// 目标由 poses.mjs 按「进这个神情后第 t 秒」给出，弹簧去追，过渡带过冲回弹，
// 任意两个神情互切都从当前弹簧状态出发，顺、不硬切（换神情不重置弹簧）。
// 时间只靠 tick(dt) 推进，不读系统时钟；随机数（眨眼、东张西望的排程）从外面传进来。

import { BASE } from './layout.mjs'
import { REST, blinkCurve, poseAt, preparePose } from './poses.mjs'

// 调试台滑块一套。来源写着：v4 = 小样 index.html，卡 = 设计卡，eyes = 0.3 的 eyes.mjs。
export const DEFAULT_MOTION = {
  // 弹簧：刚度 k 和阻尼比 ζ（阻尼 d = 2ζ√k，v4 damp）
  saccK: 220, saccZeta: 0.55, // 左眼扫视（v4 K.sacc / saccD）
  saccRK: 190, saccRZeta: 0.6, // 右眼扫视，稍软、跟上带点拖腔（v4 K.saccR / saccRD）
  shapeK: 120, shapeZeta: 0.68, // 眼形宽高（v4 K.shape / shapeD）
  lidCloseK: 520, lidCloseZeta: 0.8, // 眼皮合，快（v4 K.lidC / lidCD）
  lidOpenK: 170, lidOpenZeta: 0.9, // 眼皮睁，慢（v4 K.lidO / lidOD）
  smileK: 260, smileZeta: 0.7, // 笑眼 ^ ^（v4 K.smile / smileD）
  hopK: 160, hopZeta: 0.52, // 整岛跳 / 横移（v4 K.hop / hopD）
  scaleK: 150, scaleZeta: 0.62, // 整岛缩放（v4 K.scale / scaleD）
  // 眨眼
  blinkCloseSec: 0.07, // 闭上时长（v4 BLINKS.c ≈ 0.058–0.075）
  blinkOpenSec: 0.15, // 睁开时长（v4 BLINKS.o ≈ 0.130–0.150）
  blinkMinSec: 3, blinkMaxSec: 5, // 卡：3–5 秒一次
  idleBlinkMinSec: 4, idleBlinkMaxSec: 8, // 0.3 eyes.mjs 的 BLINK：待命 4–8 秒，干活中 3–5 秒
  blinkLagMinSec: 0.018, blinkLagMaxSec: 0.04, // 卡：右眼晚 18–40ms（v4 BLINKS.dR）
  blinkTwiceChance: 0.2, // 卡：约 1/5 连眨
  blinkTwiceGapSec: 0.15, // 连眨两下之间隔（v4 1.08→1.36 那两条扣掉时长）
  blinkLidUp: 0.88, blinkLidLo: 0.14, blinkSquash: 0.08, // v4 blinkLids 的上/下睑和挤压
  // 挤压拉伸：眼珠动得越快越压（v4 applyEye）
  squashVel: 0.014, squashMax: 0.16, squashCross: 0.65,
  // 其它
  settleEps: 0.01, // 卡：settled 的位置要离目标小于 0.01
  settleVelEps: 0.3, // 卡：速度另算一档——原来速度也卡 0.01，眨完眼的长尾要多烧约 0.5 秒帧；实测眼皮弹簧 ω≈13，阈值 0.05 还比位置 0.01 严，0.3 配 rest() 才停得进 0.6 秒
  maxStepSec: 1 / 60, // tick 内部切成不超过这么大的小步
  restXL: BASE.island / 2 - BASE.eyeGap / 2, // 46：左眼中心（layout BASE）
  restXR: BASE.island / 2 + BASE.eyeGap / 2, // 66：右眼中心
  restY: BASE.eyeY, // 15：眼睛中心的 y
  islandFlipY: true, // 卡：小岛贴顶，跳变成往下弹（true 时 frame.island.y 取反，往下为正）
}

const damp = (k, z) => 2 * z * Math.sqrt(k)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// v4 body / stepSpring：半隐式欧拉
function body(x) {
  return { x, v: 0 }
}
function spring(b, target, k, d, dt) {
  const a = -k * (b.x - target) - d * b.v
  b.v += a * dt
  b.x += b.v * dt
}
function makeEye() {
  return { x: body(0), y: body(0), w: body(REST), h: body(REST), up: body(0), lo: body(0), smile: body(0) }
}

// 对外：createMotion({ params, rand }) → { setPose, setGaze, tick, snap, settled, rest, setParams, params }
export function createMotion({ params, rand = Math.random } = {}) {
  const P = Object.assign({}, DEFAULT_MOTION, params || {})
  const sp = (b, target, pair, dt) => spring(b, target, pair[0], pair[1], dt)
  const W = { L: makeEye(), R: makeEye(), iX: body(0), iY: body(0), iRot: body(0), iScale: body(1) }
  // 各弹簧的刚度 / 阻尼对：setParams 改了参数就重算这一份
  const springs = () => ({
    sacc: [P.saccK, damp(P.saccK, P.saccZeta)],
    saccR: [P.saccRK, damp(P.saccRK, P.saccRZeta)],
    shape: [P.shapeK, damp(P.shapeK, P.shapeZeta)],
    lidC: [P.lidCloseK, damp(P.lidCloseK, P.lidCloseZeta)],
    lidO: [P.lidOpenK, damp(P.lidOpenK, P.lidOpenZeta)],
    smile: [P.smileK, damp(P.smileK, P.smileZeta)],
    hop: [P.hopK, damp(P.hopK, P.hopZeta)],
    scale: [P.scaleK, damp(P.scaleK, P.scaleZeta)],
  })
  let S = springs()
  const allBodies = [
    W.L.x, W.L.y, W.L.w, W.L.h, W.L.up, W.L.lo, W.L.smile,
    W.R.x, W.R.y, W.R.w, W.R.h, W.R.up, W.R.lo, W.R.smile,
    W.iX, W.iY, W.iRot, W.iScale,
  ]
  let name = 'idle'
  let st = preparePose(name, rand)
  let quiet = false // 电脑忙（pet:busy）：停装饰小动作（东张西望、呼吸），神情和眨眼照常
  let t = 0 // 进当前神情多久（秒），poseAt 用
  let T = 0 // 引擎总共走了多久（秒），眨眼排程和 setGaze 的时间戳用
  let hopped = false // 一个神情只吃一次跳的冲量
  let gazeLog = [] // setGaze 的历史（神情内时间 t）：右眼落后要查 t−lag 时的值
  let blinkL = null // { t0, c, o }
  let blinkR = null
  let blinkChainAt = -1 // 连眨第二下开始的时刻
  // 眨眼间隔两档（卡）：待命类神情（idle / look / drowsy）用 4–8 秒，其余（读 / 写 / 想等）仍 3–5 秒
  const blinkRange = () => (name === 'idle' || name === 'look' || name === 'drowsy'
    ? [P.idleBlinkMinSec, P.idleBlinkMaxSec]
    : [P.blinkMinSec, P.blinkMaxSec])
  const scheduleBlink = () => {
    const [lo, hi] = blinkRange()
    nextBlink = T + lo + rand() * (hi - lo)
  }
  let nextBlink = 0
  scheduleBlink()

  // τ 秒时眼睛该看哪（setGaze 的历史里找）
  function gazeAt(tau) {
    let g = null
    for (const e of gazeLog) {
      if (e.t <= tau) g = e.g
      else break
    }
    return g
  }

  // 目标 = 神情在 tp 秒的目标 + 眨眼叠上去（v4 targetsAt 里的 blinkLids）
  function targets(tp) {
    const g = poseAt(name, tp, st, gazeAt)
    const uL = blinkL ? blinkCurve(T, blinkL.t0, blinkL.c, blinkL.o) : 0
    const uR = blinkR ? blinkCurve(T, blinkR.t0, blinkR.c, blinkR.o) : 0
    g.upL = Math.max(g.upL, P.blinkLidUp * uL)
    g.loL = Math.max(g.loL, P.blinkLidLo * uL)
    g.wL *= 1 + P.blinkSquash * uL
    g.upR = Math.max(g.upR, P.blinkLidUp * uR)
    g.loR = Math.max(g.loR, P.blinkLidLo * uR)
    g.wR *= 1 + P.blinkSquash * uR
    return g
  }

  function startBlink(chain) {
    const c = P.blinkCloseSec
    const o = P.blinkOpenSec
    const dR = P.blinkLagMinSec + rand() * (P.blinkLagMaxSec - P.blinkLagMinSec)
    blinkL = { t0: T, c, o }
    blinkR = { t0: T + dR, c, o }
    blinkChainAt = chain ? T + c + o + P.blinkTwiceGapSec : -1
  }

  function step(dt) {
    const g = targets(t)
    if (blinkL && T > blinkL.t0 + blinkL.c + blinkL.o) blinkL = null
    if (blinkR && T > blinkR.t0 + blinkR.c + blinkR.o) blinkR = null
    if (!blinkL && !blinkR) {
      if (blinkChainAt >= 0 && T >= blinkChainAt) startBlink(false)
      else if (g.blink && T >= nextBlink) {
        startBlink(rand() < P.blinkTwiceChance)
        scheduleBlink()
      }
    }
    // v4 stepWorld
    sp(W.L.x, g.xL, S.sacc, dt)
    sp(W.L.y, g.yL, S.sacc, dt)
    sp(W.R.x, g.xR, S.saccR, dt)
    sp(W.R.y, g.yR, S.saccR, dt)
    sp(W.L.w, g.wL, S.shape, dt)
    sp(W.L.h, g.hL, S.shape, dt)
    sp(W.R.w, g.wR, S.shape, dt)
    sp(W.R.h, g.hR, S.shape, dt)
    // 闭快睁慢（v4：目标比现在更闭就用快弹簧）
    const closing = g.upL + g.upR > W.L.up.x + W.R.up.x + 0.05
    const lid = closing ? S.lidC : S.lidO
    sp(W.L.up, g.upL, lid, dt)
    sp(W.L.lo, g.loL, lid, dt)
    sp(W.R.up, g.upR, lid, dt)
    sp(W.R.lo, g.loR, lid, dt)
    sp(W.L.smile, g.smileL, S.smile, dt)
    sp(W.R.smile, g.smileR, S.smile, dt)
    if (g.hop && !hopped) {
      W.iY.v += g.hop
      hopped = true
    }
    if (g.kinX != null) {
      W.iX.x = g.kinX // wake 抖 / fail 晃：直接写位置不走弹簧（v4 shiver）
      W.iX.v = 0
    } else sp(W.iX, g.iX, S.hop, dt)
    if (g.kinRot != null) {
      W.iRot.x = g.kinRot
      W.iRot.v = 0
    } else sp(W.iRot, g.iRot, S.shape, dt)
    sp(W.iY, g.iY, S.hop, dt)
    sp(W.iScale, g.iScale, S.scale, dt)
  }

  // v4 applyEye 的挤压拉伸
  function eyeFrame(E, restX) {
    const vx = E.x.v
    const vy = E.y.v
    const amt = Math.min(P.squashMax, Math.sqrt(vx * vx + vy * vy) * P.squashVel)
    const sx = 1 + amt * (Math.abs(vx) >= Math.abs(vy) ? 1 : -P.squashCross)
    const sy = 1 + amt * (Math.abs(vy) > Math.abs(vx) ? 1 : -P.squashCross)
    return {
      cx: restX + E.x.x,
      cy: P.restY + E.y.x,
      rx: Math.max(0.2, E.w.x / 2),
      ry: Math.max(0.2, E.h.x / 2),
      clipTop: clamp(E.up.x, 0, 0.92),
      clipBottom: clamp(E.lo.x, 0, 0.92),
      smile: clamp(E.smile.x, 0, 1),
      sx,
      sy,
    }
  }

  function frame() {
    const g = poseAt(name, t, st, gazeAt)
    return {
      L: eyeFrame(W.L, P.restXL),
      R: eyeFrame(W.R, P.restXR),
      // +0 把取反出来的 -0 洗成 0（不然测试和页面会见到 -0）
      island: { x: W.iX.x, y: (P.islandFlipY ? -W.iY.x : W.iY.x) + 0, rot: W.iRot.x, scale: W.iScale.x },
      eyesRot: W.iRot.x, // 卡：页面只拿它转眼睛那一层（整岛转会被屏幕顶边裁）
      shape: g.shape,
      breathing: quiet ? false : g.breathing, // 电脑忙：呼吸一律停
    }
  }

  // 走 dt 秒，给一帧。时间只从这里推进（skip 没停稳时也走它）。
  function tickClock(dt) {
    // shortcut: 一次 tick 最多走 0.25 秒（页面卡一下别把弹簧冲爆）；再长的分多次 tick
    const total = clamp(Number(dt) || 0, 0, 0.25)
    const n = Math.max(1, Math.ceil(total / P.maxStepSec))
    const h = total / n
    for (let i = 0; i < n; i++) {
      t += h
      T += h
      step(h)
    }
    return frame()
  }

  // 停没停稳：位置和速度分开看（卡），且当前神情没有连续动作。
  // 位置那档按画面上画的数算：直接画的（眼位、岛、笑眼）用 settleEps；
  // w/h 存的是直径、画面画的是半径（rx=w/2），那 0.01 的档对直径就是 2×；
  // 眼皮 pet.js 里小于 0.015 根本不写 clip（写 'none'），小于它的残影看不见。
  // 速度那档：眨完眼实测，眼皮弹簧 ω≈13 rad/s，速度阈值 0.05 比位置 0.01 还严、
  // 得等到约 0.85 秒才停得下来；0.3（整个眼珠一秒才攎 0.3 个单位）配 rest() 清余速，
  // 停帧提前到 0.6 秒内，停下来那一帧也看不出跳（调试台量的）。
  function isSettled() {
    const g = targets(t)
    if (g.live || g.kinX != null || g.kinRot != null) return false
    const near = (b, target, eps = P.settleEps) => Math.abs(b.x - target) < eps && Math.abs(b.v) < P.settleVelEps
    return (
      near(W.L.x, g.xL) && near(W.L.y, g.yL) && near(W.L.w, g.wL, P.settleEps * 2) && near(W.L.h, g.hL, P.settleEps * 2) &&
      near(W.L.up, g.upL, 0.015) && near(W.L.lo, g.loL, 0.015) && near(W.L.smile, g.smileL) &&
      near(W.R.x, g.xR) && near(W.R.y, g.yR) && near(W.R.w, g.wR, P.settleEps * 2) && near(W.R.h, g.hR, P.settleEps * 2) &&
      near(W.R.up, g.upR, 0.015) && near(W.R.lo, g.loR, 0.015) && near(W.R.smile, g.smileR) &&
      near(W.R.up, g.upR) && near(W.R.lo, g.loR) && near(W.R.smile, g.smileR) &&
      near(W.iX, g.iX) && near(W.iY, g.iY) && near(W.iRot, g.iRot) && near(W.iScale, g.iScale)
    )
  }

  // 把所有弹簧直接放到目标上、速度清零（snap 和 rest 共用）
  function place(g) {
    W.L.x.x = g.xL; W.L.y.x = g.yL; W.L.w.x = g.wL; W.L.h.x = g.hL
    W.L.up.x = g.upL; W.L.lo.x = g.loL; W.L.smile.x = g.smileL
    W.R.x.x = g.xR; W.R.y.x = g.yR; W.R.w.x = g.wR; W.R.h.x = g.hR
    W.R.up.x = g.upR; W.R.lo.x = g.loR; W.R.smile.x = g.smileR
    W.iX.x = g.iX; W.iY.x = g.iY; W.iRot.x = g.iRot; W.iScale.x = g.iScale
    for (const b of allBodies) b.v = 0
  }

  return {
    // 换神情。弹簧不动，从现在的位置追新目标，所以过渡是顺的。
    setPose(next, ctx) {
      name = next
      st = preparePose(next, rand, ctx)
      if (quiet) st.quiet = true // 忙着进的 idle 也不排东张西望（poses 的 idleAt 看 st.quiet）
      t = 0
      hopped = false // 每次进神情都能再跳一次
      gazeLog = [] // 历史是神情内时间，换神情作废；页面要跟就再设
      // 换神情：已排的下一次比新一档的最长还远就重排（待命排到 8 秒外，切去干活别等那么久）
      if (nextBlink > T + blinkRange()[1]) scheduleBlink()
    },
    // 眼睛跟一个偏移看（expect / idle / look；鼠标「看你」、拖着的文件都用它）。null = 不跟了。
    setGaze(offset) {
      const g = offset ? { x: Number(offset.x) || 0, y: Number(offset.y) || 0 } : null
      const last = gazeLog[gazeLog.length - 1]
      if (last && last.t === t) last.g = g
      else gazeLog.push({ t, g })
      if (gazeLog.length > 64) gazeLog.shift()
    },
    // 走 dt 秒，给一帧。时间只从这里推进。
    tick(dt) {
      return tickClock(dt)
    },
    // 页面停帧用：停稳时还有多久目标会变（下一次眨眼、idle 下一趟东张西望的起点，取小的）；
    // 不会再变给 Infinity；没停稳给 0。页面拿它停掉动画帧、定一个闹钟。
    wakeIn() {
      if (!isSettled()) return 0
      if (blinkL || blinkR) return 0 // 正在眨（包络刚起或正走）：还要演，别停帧
      let next = Infinity
      if (blinkChainAt >= 0) next = blinkChainAt - T
      else if (poseAt(name, t, st, gazeAt).blink) next = nextBlink - T
      // 正跟着 setGaze 看时东张西望不变目标，不算在内；电脑忙时不排东张西望，也不算
      if (name === 'idle' && !quiet && !(gazeAt && gazeAt(t))) next = Math.min(next, st.nextAt - t)
      return Math.max(0, next)
    },
    // 页面停帧睡过去的秒数：两个钟（t 和 T）直接拨过去，不逐步算弹簧。
    // 只在停稳时生效，否则当 tick 用。眨眼 / 东张西望的排程不推：留在原地的话钟一拨过去就到点，
    // 下一拍 tick 补上，之后按新钟接着排 —— 页面睡了也不会永远不眨。
    skip(sec) {
      const s = Math.max(0, Number(sec) || 0)
      if (!isSettled()) return tickClock(s)
      t += s
      T += s
      return frame()
    },
    // 立刻眨一下（正在眨、或当前神情 blink 为 false 就不眨），并把下一次随机眨眼往后推一个间隔。
    // 鼠标刚靠近时「看到你了」用。
    blink() {
      if (blinkL || blinkR) return false
      if (!poseAt(name, t, st, gazeAt).blink) return false
      startBlink(rand() < P.blinkTwiceChance)
      scheduleBlink()
      return true
    },
    // 「关了显示动画」用：弹簧直接放到目标上（脚本有限的神情放到走完那格），给终点帧。
    snap() {
      blinkL = null
      blinkR = null
      blinkChainAt = -1
      const ts = st.endT != null ? st.endT : t
      if (ts > t) t = ts
      place(targets(t))
      return frame()
    },
    // 所有弹簧离目标小于 settleEps、速度小于 settleVelEps，且当前神情没有连续动作（卡）。
    settled() {
      return isSettled()
    },
    // 停帧前用：已经停稳时把弹簧直接放到当前目标上、速度清零（差值小于 eps，看不出来），
    // 返回那一帧——停下来时没有余速，下次 skip 接着走也不会漂。没停稳就什么都不做，返回 undefined。
    rest() {
      if (!isSettled()) return undefined
      place(targets(t))
      return frame()
    },
    // 电脑忙（pet:busy）收装饰小动作：true 时 idle 不排也不演东张西望（正在走的那趟
    // 目标回中间，弹簧顺着回正、不硬跳）、frame.breathing 一律 false、wakeIn 不算东张西望的排程；
    // 眨眼和别的神情不动。false 时 idle 从现在起重新排下一趟（10–20 秒后）。
    setQuiet(on) {
      quiet = Boolean(on)
      st.quiet = quiet
      if (!quiet && name === 'idle') {
        st.trips.length = 0
        st.nextAt = t + 10 + rand() * 10
      }
    },
    // 调试台改参数用：合进当前参数、重算各弹簧的刚度和阻尼，不重置状态（神情、弹簧位置都留着）。
    setParams(next) {
      Object.assign(P, next || {})
      S = springs()
    },
    // 当前参数的一份拷贝（改它不影响引擎）
    params() {
      return Object.assign({}, P)
    },
  }
}
