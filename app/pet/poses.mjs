// 各神情在「进入这个神情后第 t 秒」的目标值。
// 纯函数，不引 node: 和 electron，页面直接 import。
// 数字一律以设计卡为准；小样 docs/0.4/island-v4/index.html 里没改的旧数字不用，
// 每个数字后面注释写着来历（v4 = 小样 index.html 那一段，eyes = 0.3 的 eyes.mjs，卡 = 本卡）。
// 目标只是「要去哪」，怎么过去（弹簧、过冲、回弹）是 motion.mjs 的事；
// 换神情时弹簧不重置，所以任意两个神情互切自然是顺的。
// 时间 t 从进这个神情那刻算起，由引擎的 tick 推进；随机数在 preparePose 里一次抽定，
// 之后 poseAt 对同一个 t 永远给同一串目标（右眼落后 = 取 t − lag 的目标）。

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, u) => a + (b - a) * u
// v4 map：t 走过 a..b 的进度（0..1，出界夹住）
const seg = (t, a, b) => clamp((t - a) / (b - a || 1), 0, 1)
const easeOut = (u) => 1 - Math.pow(1 - u, 2.2) // v4 easeOut
const smooth = (u) => u * u * (3 - 2 * u) // v4 smoothstep

export const REST = 10.6 // 待命圆眼直径（半径 5.3，卡：idle 两眼等大 r=5.3）

// 右眼比左眼晚多少秒跟上（v4 LAG / 各神情自己的取法）
const LAG = { idle: 0.036, expect: 0.036, read: 0.028, think: 0.04, look: 0.036 } // 卡：look 也晚 36ms

export const POSES = ['idle', 'drowsy', 'asleep', 'wake', 'expect', 'read', 'think', 'write', 'done', 'fail', 'look', 'drag']

// 脚本有限的神情走到几秒算完（snap 跳终点、live 收尾用）；null = 一直演。
// look / expect 的 0.15 是进场放大那一缓动走完的时刻：目标之后不变，
// 但 snap（关了显示动画）要跳到睁大了的那一格，不能停在 t=0 的普通大小
const END_T = { drowsy: 2.56, wake: 3.5, think: 3.2, done: 0.75, fail: 0.45, look: 0.15, expect: 0.15 }

// 眨眼（或慢眨）的包络：t0 开始，c 秒闭上（先快后慢，1.6 次方），o 秒睁开（smoothstep）。v4 blinkLids。
export function blinkCurve(t, t0, c, o) {
  if (t < t0 || t > t0 + c + o) return 0
  if (t < t0 + c) return 1 - Math.pow(1 - (t - t0) / c, 1.6)
  return 1 - smooth((t - t0 - c) / o)
}

// 一份全rest的目标，各神情在上面改
function base() {
  return {
    xL: 0, yL: 0, xR: 0, yR: 0,
    wL: REST, hL: REST, wR: REST, hR: REST,
    upL: 0, loL: 0, upR: 0, loR: 0,
    smileL: 0, smileR: 0,
    iX: 0, iY: 0, iRot: 0, iScale: 1,
    hop: 0, // 一次性冲量（done 的轻跳），引擎一个神情只吃一次
    kinX: null, kinRot: null, // 不为 null 时整岛横移/旋转直接写值不走弹簧（wake 抖、fail 晃）
    blink: true, // 这个时刻允不允许引擎的随机眨眼
    live: false, // 还有连续动作时为 true（settled() 拿它当门）
    shape: 'eyes',
    breathing: false, // 卡：asleep 的呼吸标记给页面（breath.mjs 低频写 transform，不走 CSS 动画）
  }
}

// ---------- idle：待命。不要一直微颤；每 10–20 秒一趟东张西望，之间目标不动 ----------

function prepIdle(rand) {
  return { rand, trips: [], nextAt: 10 + rand() * 10 } // 卡：每 10–20 秒来一趟
}

// 一趟：反向预备一点 → 往一边看 ±3 → 停 450–900ms →（约 1/3）再往另一边瞥 → 回正
function genTrip(st) {
  const rand = st.rand
  const p = { t0: st.nextAt }
  p.dir = rand() < 0.5 ? -1 : 1
  p.second = rand() < 1 / 3 // 卡：约 1/3 再往另一边瞥
  p.asym = rand() < 1 / 3 // 卡：偶尔一大一小、一高一低
  p.hold = 0.45 + rand() * 0.45 // 卡：停 450–900ms
  p.prep = 0.06 // v4 1.70–1.76 的反向预备
  p.gap = 0.22 // v4 2.50–2.92 第一眼看完到第二眼起步
  p.prep2 = 0.08 // v4 2.92–3.00
  p.look2 = 0.55 // v4 3.00–3.55
  st.trips.push(p)
  const len = p.prep + p.hold + p.gap + (p.second ? p.prep2 + p.look2 : 0)
  st.nextAt = p.t0 + len + 0.4 + 10 + rand() * 10 // 走完这趟再隔 10–20 秒
}

function tripLen(p) {
  return p.prep + p.hold + p.gap + (p.second ? p.prep2 + p.look2 : 0)
}

// 待命注视轨迹（纯函数，右眼取 t − LAG.idle 就是落后）
function idleGazeAt(st, tt) {
  for (const p of st.trips) {
    const tau = tt - p.t0
    if (tau < 0 || tau >= tripLen(p)) continue
    if (tau < p.prep) return { x: -p.dir * 0.5, y: 0.1 } // 反向预备（v4 1.70–1.76）
    if (tau < p.prep + p.hold) return { x: p.dir * 3, y: -0.2 } // 卡：往一边看 ±3
    const g = p.prep + p.hold + p.gap
    if (p.second && tau >= g && tau < g + p.prep2) return { x: p.dir * 0.4, y: -0.15 } // v4 2.92–3.00
    if (p.second && tau >= g + p.prep2 && tau < g + p.prep2 + p.look2)
      return { x: -p.dir * 2, y: 1.35 } // 另一边，幅度 2/3（v4 3.00–3.55）
  }
  return { x: 0, y: 0 }
}

// 偶尔一大一小、一高一低（v4 3.00–3.55 那段），落在这一趟最后一眼里
function idleAsymAt(st, tt) {
  for (const p of st.trips) {
    if (!p.asym) continue
    const tau = tt - p.t0
    const a = p.second ? p.prep + p.hold + p.gap + p.prep2 : p.prep
    const b = a + (p.second ? p.look2 : p.hold)
    if (tau >= a && tau < b) return easeOut(seg(tau, a, a + 0.18)) * (1 - seg(tau, b - 0.15, b))
  }
  return 0
}

function idleAt(t, st, gazeAt) {
  const g = base()
  // 电脑忙（引擎 setQuiet 给的 st.quiet）：不排也不演东张西望，视线留在中间；
  // setGaze 给的偏移照跟（接文件时页面还会设），右眼仍晚 36ms
  if (st.quiet) {
    const gz = gazeAt && gazeAt(t)
    if (gz) {
      g.xL = gz.x; g.yL = gz.y
      const gr = gazeAt(t - LAG.idle) || { x: 0, y: 0 }
      g.xR = gr.x; g.yR = gr.y
    }
    return g
  }
  while (st.nextAt < t + 1) genTrip(st)
  while (st.trips.length > 2 && st.trips[1].t0 < t - 3) st.trips.shift()
  let gl = idleGazeAt(st, t)
  let gr = idleGazeAt(st, t - LAG.idle)
  const gz = gazeAt && gazeAt(t)
  if (gz) {
    // 卡：setGaze 给了偏移就替掉东张西望的视线（右眼仍晚 36ms），null 回到东张西望
    gl = gz
    gr = gazeAt(t - LAG.idle) || { x: 0, y: 0 }
  }
  g.xL = gl.x; g.yL = gl.y; g.xR = gr.x; g.yR = gr.y
  const u = idleAsymAt(st, t)
  if (u > 0) {
    g.yL -= 0.7 * u; g.yR += 0.35 * u // v4：左眼略抬、右眼略落
    g.wL = lerp(REST, 9.8, u); g.hL = lerp(REST, 11.2, u)
    g.wR = lerp(REST, 11.4, u); g.hR = lerp(REST, 10.0, u)
  }
  return g
}

// ---------- drowsy：左眼皮先垂，右眼晚约 0.3 秒跟上，收成下半圆，中间慢眨一次 ----------

function drowsyAt(t) {
  const g = base()
  const uL = seg(t, 0, 1.15) // v4 4.40–5.55
  const uR = seg(t, 0.3, 1.45) // 卡：右眼晚约 0.3 秒（v4 4.70–5.85）
  g.upL = 0.5 * uL // 卡：上眼皮约 0.5 → 下半圆
  g.upR = 0.5 * uR
  g.yL = 0.4 * uL; g.yR = 0.3 * uR // v4
  g.xL = -0.4; g.xR = 0.25
  g.hL = lerp(REST, 10.0, uL)
  g.blink = false // 慢眨自己管，不吃引擎的快眨
  // 中间慢眨一次：闭 0.2 秒、睁 0.28 秒（卡），右眼晚 0.04（v4 6.50 那条 dR）
  const c = 0.2, o = 0.28, t0 = 2.0
  g.upL = Math.max(g.upL, 0.88 * blinkCurve(t, t0, c, o))
  g.loL = Math.max(g.loL, 0.14 * blinkCurve(t, t0, c, o))
  g.upR = Math.max(g.upR, 0.88 * blinkCurve(t - 0.04, t0, c, o))
  g.loR = Math.max(g.loR, 0.14 * blinkCurve(t - 0.04, t0, c, o))
  g.live = t < END_T.drowsy
  return g
}

// ---------- asleep：居中细缝，左右略不对称；呼吸不在引擎里做 ----------

function asleepAt(t) {
  const g = base()
  const u = easeOut(seg(t, 0, 1.2)) // v4 8.00–9.20
  g.upL = lerp(0.5, 0.41, u); g.loL = lerp(0, 0.37, u) // 卡：upL 0.41 loL 0.37
  g.upR = lerp(0.5, 0.38, u); g.loR = lerp(0, 0.34, u) // 卡：upR 0.38 loR 0.34
  g.wL = lerp(REST, 10.0, u); g.wR = lerp(REST, 11.0, u) // v4
  g.hL = lerp(REST, 10.0, u)
  g.yL = 0.25; g.yR = 0.1 // v4
  g.breathing = true // 卡：页面 breath.mjs 低频写呼吸起伏（不再用 CSS 动画，省电）
  g.blink = false
  return g
}

// ---------- wake：左眼先睁成小半圆，右眼后睁更大，整岛抖一下，迷糊扫两眼，回 idle。约 3.5 秒 ----------

function wakeAt(t) {
  const g = base()
  // v4 14.50–18.35 那段压到约 3.5 秒（×0.91）
  const leftOpen = easeOut(seg(t, 0.07, 0.64))
  const rightOpen = easeOut(seg(t, 0.89, 1.57))
  const both = easeOut(seg(t, 1.62, 2.32))
  // 左眼先睁成小半圆（v4：上睑 0.41→0.50、下睑收 0，缩到 7.6，往下挪）
  const up1 = lerp(0.41, 0.5, leftOpen)
  const lo1 = lerp(0.37, 0, leftOpen)
  g.upL = lerp(up1, 0, both)
  g.loL = lerp(lo1, 0, both)
  g.wL = g.hL = lerp(lerp(10.0, 7.6, leftOpen), REST, both)
  g.yL = lerp(lerp(0.25, 0.55, leftOpen), 0, both)
  // 右眼后睁、更大（v4：11.0→13.2，下睑先收）
  if (rightOpen <= 0) {
    g.upR = 0.38; g.loR = 0.34; g.wR = g.hR = 11.0; g.yR = 0.1
  } else {
    g.upR = lerp(0.38, 0, rightOpen)
    g.loR = lerp(0.34, 0, Math.min(1, rightOpen * 2.2))
    g.wR = g.hR = lerp(11.0, 13.2, rightOpen)
    g.yR = lerp(0.1, -0.45, rightOpen)
  }
  g.upR = lerp(g.upR, 0, both); g.loR = lerp(g.loR, 0, both)
  g.wR = lerp(g.wR, REST, both); g.hR = lerp(g.hR, REST, both)
  g.yR = lerp(g.yR, 0, both)
  // 迷糊地扫两眼（v4 16.95–18.30 ×0.91）
  if (t >= 2.24 && t < 3.46) {
    const gz = t < 2.69 ? { x: -2.6, y: 0.8 } : t < 3.15 ? { x: 2.4, y: -0.5 } : { x: 0, y: 0 }
    const fade = 1 - seg(t, 3.25, 3.46)
    g.xL += gz.x * fade; g.yL += gz.y * fade
    g.xR += gz.x * fade; g.yR += gz.y * 0.85 * fade
    if (t < 2.82) { // v4 T<17.6 那段：刚醒大小眼
      g.wL = lerp(g.wL, 9.4, fade); g.wR = lerp(g.wR, 12.0, fade); g.hR = lerp(g.hR, 12.2, fade)
    }
  }
  // 整岛抖一下约 0.7 秒（卡；v4 16.70–17.40 shiver，去掉相位差让起点从 0 起）
  if (t >= 2.0 && t < 2.7) {
    const u = (t - 2.0) / 0.7
    const amp = 2.5 * (1 - u)
    g.kinX = Math.sin(u * Math.PI * 7) * amp + Math.sin(u * Math.PI * 11) * amp * 0.35
    g.kinRot = Math.sin(u * Math.PI * 7) * 2.0 * (1 - u)
  }
  g.blink = t >= 1.8 // v4：醒来前半段不眨
  g.live = t < END_T.wake
  return g
}

// ---------- expect：拖文件过来。两眼放大且不一样大，跟 setGaze 的偏移看 ----------

function expectAt(t, st, gazeAt) {
  const g = base()
  const k = easeOut(seg(t, 0, 0.15)) // v4 18.55–18.70
  g.wL = g.hL = lerp(REST, 12.8, k) // 卡：左 12.8
  g.wR = g.hR = lerp(REST, 13.8, k) // 卡：右 13.8
  const gl = (gazeAt && gazeAt(t)) || { x: 0, y: 0 }
  const gr = (gazeAt && gazeAt(t - LAG.expect)) || { x: 0, y: 0 } // 卡：右眼晚约 36ms（没设过就是不看）
  g.xL = gl.x; g.yL = gl.y; g.xR = gr.x; g.yR = gr.y
  return g
}

// ---------- read：压成扁胶囊，往右一小跳一小跳，到头扫回；每跳整岛下蹲一点 ----------

function prepRead(rand) {
  return { rand, x: -5, events: [], until: 0.35 } // eyes SCAN.firstMs：刚进先停一下
}

function genRead(st) {
  const rand = st.rand
  if (st.x >= 4.5) {
    // 到头扫回行首（eyes：returnMs 220）
    st.events.push({ t: st.until, x: -5, sweep: true })
    st.x = -5
    st.until += 0.22 + 0.3 + rand() * 0.18
  } else {
    const step = 2 + rand() * 1 // 卡：每步 2–3
    st.x = Math.min(5, st.x + step)
    st.events.push({ t: st.until, x: st.x })
    st.until += 0.3 + rand() * 0.18 // 卡：停 300–480ms 不等
  }
}

function readXAt(st, tt) {
  let x = -5
  for (const e of st.events) {
    if (e.t <= tt) x = e.x
    else break
  }
  return x
}

// 每跳一下的下蹲包络：半正弦。时长 0.24 秒（v4 是 0.14，但短脉冲会被弹簧吃掉一半，
// 下不到卡说的 0.4px；放宽到 0.24 后画面上量得到约 0.4），扫回不蹲
function readDipAt(st, tt) {
  const DUR = 0.24
  for (let i = st.events.length - 1; i >= 0; i--) {
    const e = st.events[i]
    if (e.t <= tt - DUR) break
    if (e.sweep) continue
    const tau = tt - e.t
    if (tau >= 0 && tau < DUR) return Math.sin((tau / DUR) * Math.PI) * 0.4 // 卡：下蹲约 0.4px
  }
  return 0
}

function readAt(t, st) {
  const g = base()
  while (st.until < t + 1) genRead(st)
  while (st.events.length > 2 && st.events[1].t < t - 1) st.events.shift()
  g.wL = 9.6; g.hL = 5.8; g.wR = 10.4; g.hR = 6.2 // 卡：左 9.6×5.8、右 10.4×6.2
  g.upL = 0.110; g.upR = 0.08 // v4
  g.yL = g.yR = 4 // 往下看（eyes：down 中心 y=19 = 15+4）
  g.xL = readXAt(st, t)
  g.xR = readXAt(st, t - LAG.read) // 卡：右眼晚 28ms
  const dip = readDipAt(st, t)
  g.iY = -dip // 每跳整岛下蹲
  g.hL -= dip * 0.5; g.hR -= dip * 0.36 // v4 比例（0.35/0.7、0.25/0.7）
  g.live = true // 一直读，停不下来
  return g
}

// ---------- think：先往上翻，再左右扫；左眼变小右眼变大，岛倾斜 -3.2° ----------

function thinkGazeAt(t) {
  // v4 thinkGaze（换成进神情后的相对时间）
  if (t < 0.75) return { x: 2.6, y: -3.1 }
  if (t < 1.15) return { x: 0.2, y: -3.6 }
  if (t < 1.8) return { x: -2.8, y: -2.8 }
  if (t < 2.4) return { x: 2.9, y: -3.2 }
  if (t < 3.0) return { x: -1.6, y: -3.0 }
  return { x: 1.8, y: -3.2 } // 扫完停在这
}

function thinkAt(t) {
  const g = base()
  const u = easeOut(seg(t, 0.2, 0.65)) // v4 28.50–28.95
  g.wL = g.hL = lerp(9.2, 9.2 * 0.7, u) // 卡：左眼 0.70 倍，基数 9.2
  g.wR = g.hR = lerp(9.2, 9.2 * 1.3, u) // 卡：右眼 1.30 倍
  g.upL = 0.16 * u // 卡：左眼更眯（v4）
  g.iRot = -3.2 * u // 卡：岛倾斜 3.2°，方向照小样 -3.2
  g.yL = -0.25 * u; g.yR = 0.15 * u // v4
  const gl = thinkGazeAt(t)
  const gr = thinkGazeAt(t - LAG.think)
  g.xL = gl.x; g.yL += gl.y
  g.xR = gr.x; g.yR += gr.y
  g.live = t < END_T.think
  return g
}

// ---------- write：低头，左眼更眯，约 1 秒一拍小跳加挤压，偶尔瞥一眼旁边 ----------

// 跳动幅度：目标给 1.0，弹簧追出来约 1.1，压在卡说的「不超过 1.15px」里（v4 的 1.15 是目标值，会超）
const WRITE_KICK = 1.0

function prepWrite(rand) {
  return { rand, glances: [], nextAt: 1.65 + rand() * 2.5 } // v4 33.80 = 进神情 1.65 秒后头一眼
}

function writeAt(t, st) {
  const g = base()
  g.wL = 10.4; g.hL = 7.6; g.wR = 11.6; g.hR = 8.6 // v4
  g.yL = 1.35; g.yR = 1.05 // 卡：低头约 +1.2（v4 1.35/1.05）
  g.xL = -0.3; g.xR = 0.5
  g.upL = 0.12; g.upR = 0.05 // 卡：左眼比右眼眯
  while (st.nextAt < t + 1) {
    st.glances.push({ t0: st.nextAt })
    st.nextAt += 4 + st.rand() * 3 // 偶尔瞥一眼旁边
  }
  while (st.glances.length > 2 && st.glances[1].t0 < t - 1) st.glances.shift()
  for (const p of st.glances) {
    const tau = t - p.t0
    if (tau < 0 || tau >= 0.45) continue
    const u = easeOut(seg(tau, 0, 0.12)) * (1 - seg(tau, 0.28, 0.45)) // v4 33.80–34.25
    g.xL += 2.4 * u; g.xR += 2.1 * u; g.yL -= 0.6 * u; g.yR -= 0.4 * u
  }
  if (t >= 0.25) {
    const b = Math.sin((t - 0.25) * Math.PI * 2) // 卡：约 1 秒一拍（v4 的 sin(6t) 是旧数字）
    const kick = Math.max(0, b)
    g.iY = -kick * WRITE_KICK
    g.iRot = b * 0.9 // v4
    g.hL -= kick * 0.55; g.hR -= kick * 0.4 // v4 的挤压
    g.wL += kick * 0.35; g.wR += kick * 0.25
  }
  g.live = true // 一直写
  return g
}

// ---------- done：先放大（不一样大）再收成细线 ^ ^，轻跳一次 ----------

// 轻跳冲量：校准到峰值 4.2px（卡：4.2±0.3，不超过 5）。v4 是 -125（实测会到 4.7）。
const DONE_HOP = -110

function doneAt(t) {
  const g = base()
  if (t < 0.32) {
    const k = easeOut(seg(t, 0, 0.18)) // v4 36.50–36.70
    g.wL = g.hL = lerp(REST, 12.8, k) // 卡：左 12.8
    g.wR = g.hR = lerp(REST, 14.2, k) // 卡：右 14.2
    g.yL = -0.15 * k; g.yR = 0.15 * k // v4 的落点
    g.xL = -0.2 * k; g.xR = 0.25 * k
  } else {
    const s = easeOut(seg(t, 0.32, 0.6)) // v4 36.88–37.18
    g.smileL = g.smileR = s // 卡：smile 到 1，收成细线 ^ ^
    g.wL = lerp(12.8, 10.2, s); g.hL = lerp(12.8, 3.0, s) // v4
    g.wR = lerp(14.2, 10.8, s); g.hR = lerp(14.2, 3.2, s)
    g.yL = -0.1; g.yR = 0.15; g.xL = -0.15; g.xR = 0.2
    if (t >= 0.35 && t < 0.38) g.hop = DONE_HOP // 轻跳一次（v4 37.12，挪到收线快完时）
  }
  g.live = t < END_T.done
  return g
}

// ---------- fail：两眼收成平的细缝（不弯），整岛左右晃 2px 两次、共 240ms ----------

function failAt(t) {
  const g = base()
  const u = easeOut(seg(t, 0, 0.15))
  g.upL = g.loL = g.upR = g.loR = 0.39 * u // 卡：上下眼皮对合（0.39 留下约 2.3px 的缝，跟 0.3 那条平线一样粗）
  if (t >= 0.15 && t < 0.39) {
    // 卡：晃 2px 两次共 240ms（eyes SHAKE：0→−2→+2→−2→+2→0）
    const u2 = (t - 0.15) / 0.24
    g.kinX = -2 * Math.sin(u2 * Math.PI * 4)
  }
  g.live = t < END_T.fail
  return g
}

// ---------- look：要你看一眼 / 等确认。两眼睁大到半径 7，不动 ----------

function lookAt(t, gazeAt) {
  const g = base()
  const k = easeOut(seg(t, 0, 0.15))
  g.wL = g.hL = g.wR = g.hR = lerp(REST, 14, k) // 卡：半径 7 = 直径 14
  const gz = gazeAt && gazeAt(t)
  if (gz) {
    // 卡：setGaze 在 look 里也跟（右眼晚 36ms）
    g.xL = gz.x; g.yL = gz.y
    const gr = gazeAt(t - LAG.look) || { x: 0, y: 0 }
    g.xR = gr.x; g.yR = gr.y
  }
  return g
}

// ---------- drag：拖着走。shape 给 'drag'，页面照旧画 > < ----------

function dragAt() {
  const g = base()
  g.shape = 'drag'
  g.blink = false
  return g
}

// ---------- 对外 ----------

const PREP = { idle: prepIdle, read: prepRead, write: prepWrite }

// 进一个神情时把要随机的东西一次抽好（右眼落后要取 t−lag 的目标，轨迹必须是定的）。
// ctx 是引擎 setPose 透传的上下文，现在各神情都用不上，先留着。
export function preparePose(name, rand = Math.random, ctx) {
  const st = PREP[name] ? PREP[name](rand) : {}
  st.endT = END_T[name] != null ? END_T[name] : null
  return st
}

// 这个神情在 t 秒的目标。gazeAt(τ) 由引擎给（setGaze 的历史），expect 用它跟偏移。
export function poseAt(name, t, st, gazeAt) {
  switch (name) {
    case 'idle': return idleAt(t, st, gazeAt)
    case 'drowsy': return drowsyAt(t)
    case 'asleep': return asleepAt(t)
    case 'wake': return wakeAt(t)
    case 'expect': return expectAt(t, st, gazeAt)
    case 'read': return readAt(t, st)
    case 'think': return thinkAt(t)
    case 'write': return writeAt(t, st)
    case 'done': return doneAt(t)
    case 'fail': return failAt(t)
    case 'look': return lookAt(t, gazeAt)
    case 'drag': return dragAt()
    default: return base()
  }
}
