// motion.mjs：弹簧引擎。
// 固定种子跑模拟：能停的神情 2 秒内 settled、done 跳峰 4.2±0.3、read 下蹲、
// write 周期 1 秒幅度 ≤1.15、think 大小眼、任意两个神情互切每一帧不跳变、snap 给终点帧。

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MOTION, createMotion } from '../../app/pet/motion.mjs'
import { POSES } from '../../app/pet/poses.mjs'

// 固定种子的随机数
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const DT = 1 / 120

// 从（默认 idle 的）静止跑 secs 秒，收每帧
function sim(pose, secs, { seed = 7, from = null, secs2 = 0 } = {}) {
  const m = createMotion({ rand: rng(seed) })
  if (from) {
    m.setPose(from)
    for (let i = 0; i < secs2 / DT; i++) m.tick(DT)
  }
  m.setPose(pose)
  const frames = []
  for (let i = 0; i < secs / DT; i++) {
    const t = (i + 1) * DT
    frames.push({ t, f: m.tick(DT), s: m.settled() })
  }
  return { m, frames }
}

const firstSettle = (frames) => {
  for (const { t, s } of frames) if (s) return t
  return null
}

test('能停的神情 2 秒内 settled（idle 两趟东张西望之间、look、asleep、done 跳完以后）', () => {
  for (const pose of ['idle', 'look', 'asleep', 'done']) {
    const { frames } = sim(pose, 2.2)
    const at = firstSettle(frames)
    assert.ok(at != null && at <= 2, `${pose} settled at ${at}`)
  }
})

test('idle：东张西望一趟之后、下一趟之前，还停得下来', () => {
  const { frames } = sim('idle', 40, { seed: 3 })
  // 头一趟在 10–20 秒之间来；走完（≤ +2 秒）到下一趟之间必须有一段 settled
  const settledLate = frames.filter(({ t, s }) => t > 12 && t < 19 && s)
  assert.ok(settledLate.length > 60, `两趟之间 settled 帧数 ${settledLate.length}`)
})

test('done：轻跳峰值 4.2±0.3（往下弹），全程岛位移不超过 5', () => {
  const { frames } = sim('done', 3)
  let peak = 0
  for (const { f } of frames) {
    assert.ok(Math.abs(f.island.x) <= 5 && Math.abs(f.island.y) <= 5, `岛跑出 5：${JSON.stringify(f.island)}`)
    assert.equal(f.eyesRot, f.island.rot) // 眼睛那层转角跟岛一份
    peak = Math.max(peak, Math.abs(f.island.y))
  }
  assert.ok(peak >= 3.9 && peak <= 4.5, `跳峰 ${peak}`)
  // islandFlipY：小岛贴顶，跳变成往下弹（y 往下为正）
  assert.ok(frames.some(({ f }) => f.island.y > 3.9), '没往下弹')
})

test('read：每跳下蹲约 0.4，眼睛往下看', () => {
  const { frames } = sim('read', 4)
  let dip = 0
  for (const { f } of frames) dip = Math.max(dip, Math.abs(f.island.y))
  // 目标下蹲 0.4（poses.mjs），弹簧追出来画面上约 0.34
  assert.ok(dip > 0.25 && dip < 0.45, `下蹲 ${dip}`)
  const last = frames[frames.length - 1].f
  assert.ok(Math.abs(last.L.cy - 19) < 0.6 && Math.abs(last.R.cy - 19) < 0.6, '眼睛往下看（y=19）')
})

test('write：约 1 秒一拍，跳动幅度不超过 1.15', () => {
  const { frames } = sim('write', 6)
  let highest = 0
  const beats = []
  for (let i = 1; i < frames.length - 1; i++) {
    const y = Math.abs(frames[i].f.island.y) // islandFlipY 后往下为正，按绝对值量
    highest = Math.max(highest, y)
    if (y > 0.3 && y >= Math.abs(frames[i - 1].f.island.y) && y >= Math.abs(frames[i + 1].f.island.y)) beats.push(frames[i].t)
  }
  assert.ok(highest <= 1.15, `最高 ${highest}`)
  assert.ok(beats.length >= 4, `波峰个数 ${beats.length}`)
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i] - beats[i - 1]
    assert.ok(Math.abs(gap - 1) < 0.1, `周期 ${gap}`)
  }
})

test('think：两眼大小比接近 0.70 / 1.30（基数 9.2）', () => {
  const { frames } = sim('think', 1.5)
  const { f } = frames[frames.length - 1]
  assert.ok(Math.abs(f.L.rx * 2 - 9.2 * 0.7) < 0.3, `左眼宽 ${f.L.rx * 2}`)
  assert.ok(Math.abs(f.R.rx * 2 - 9.2 * 1.3) < 0.3, `右眼宽 ${f.R.rx * 2}`)
  const ratio = (f.L.rx / f.R.rx) / (0.7 / 1.3)
  assert.ok(Math.abs(ratio - 1) < 0.05, `比例 ${ratio}`)
})

test('任意两个神情互切：每一帧的位置和大小都不跳变', () => {
  // 相邻两帧（1/120 秒）每个数的变化上限。实测量最大：眼位 0.5、眼形 0.22、
 // 眼皮 0.04、岛位移 0.87（done 跳的冲量、fail 晃）；达儿留了余量，
 // 真的硬切（一下跳 1px 以上、眼形突变）才会撞线。
  const CAP = { cx: 0.8, cy: 0.8, rx: 0.3, ry: 0.35, clipTop: 0.1, clipBottom: 0.1, smile: 0.15, sx: 0.45, sy: 0.45 }
  const CAP_ISLAND = { x: 1.4, y: 1.3, rot: 0.25, scale: 0.01 }
  const finite = (v) => typeof v === 'number' && Number.isFinite(v)
  let checked = 0
  // 卡：在 0.05、0.2、0.4、1.5、2.3 秒各切一遍（含 wake 抖到一半、fail 晃到一半、done 跳到一半切走）
  for (const CUT of [0.05, 0.2, 0.4, 1.5, 2.3]) {
    for (const A of POSES) {
      for (const B of POSES) {
        const m = createMotion({ rand: rng(11) })
        m.setPose(A)
        for (let i = 0; i < CUT / DT; i++) m.tick(DT) // A 停稳或停在半路
        m.setPose(B)
        let prev = null
        for (let i = 0; i < 1 / DT; i++) {
          const f = m.tick(DT)
          assert.ok(finite(f.island.x) && finite(f.island.rot), `${A}→${B}@${CUT} 出了非数`)
          assert.ok(Math.abs(f.island.x) <= 5 && Math.abs(f.island.y) <= 5, `${A}→${B}@${CUT} 岛跑出 5`)
          if (prev) {
            for (const side of ['L', 'R']) {
              for (const k of Object.keys(CAP)) {
                const d = Math.abs(f[side][k] - prev[side][k])
                assert.ok(d <= CAP[k], `${A}→${B}@${CUT} ${side}.${k} 一帧跳了 ${d}`)
              }
            }
            for (const k of Object.keys(CAP_ISLAND)) {
              const d = Math.abs(f.island[k] - prev.island[k])
              assert.ok(d <= CAP_ISLAND[k], `${A}→${B}@${CUT} island.${k} 一帧跳了 ${d}`)
            }
            checked++
          }
          prev = f
        }
      }
    }
  }
  assert.ok(checked > 1000)
})

test('snap：直接给终点帧（关了显示动画用）', () => {
  const m = createMotion({ rand: rng(5) })
  m.setPose('done')
  for (let i = 0; i < 0.25 / DT; i++) m.tick(DT) // 正在放大那一步
  const f = m.snap()
  assert.ok(f.L.smile > 0.999 && f.R.smile > 0.999, `smile ${f.L.smile}`)
  assert.ok(Math.abs(f.L.ry * 2 - 3.0) < 1e-9, `细线高 ${f.L.ry * 2}`)
  assert.equal(f.island.y, 0)
  assert.ok(m.settled()) // 跳到目标上就是停稳
  const m2 = createMotion({ rand: rng(5) })
  m2.setPose('idle')
  const f2 = m2.snap()
  assert.ok(Math.abs(f2.L.rx * 2 - 10.6) < 1e-9 && Math.abs(f2.R.rx * 2 - 10.6) < 1e-9)
  const m3 = createMotion({ rand: rng(5) })
  m3.setPose('read')
  for (let i = 0; i < 0.5 / DT; i++) m3.tick(DT)
  const f3 = m3.snap() // 一直读的神情没有终点，停在当前目标上
  assert.equal(f3.shape, 'eyes')
  assert.ok(Number.isFinite(f3.L.cx))
})

test('setGaze：expect 跟着偏移看，右眼晚一点', () => {
  const m = createMotion({ rand: rng(3) })
  m.setPose('expect')
  for (let i = 0; i < 0.3 / DT; i++) m.tick(DT)
  m.setGaze({ x: 3, y: 0 })
  let sawLag = false
  let f = null
  for (let i = 0; i < 0.6 / DT; i++) {
    f = m.tick(DT)
    if (f.L.cx - 46 > 0.3 && Math.abs(f.R.cx - 66) < 0.05) sawLag = true // 右眼还没起步
  }
  assert.ok(sawLag, '右眼没落后')
  assert.ok(Math.abs(f.L.cx - 49) < 0.3 && Math.abs(f.R.cx - 69) < 0.3, `跟到 ${f.L.cx}`)
  m.setGaze(null)
  for (let i = 0; i < 1 / DT; i++) f = m.tick(DT)
  assert.ok(Math.abs(f.L.cx - 46) < 0.05 && Math.abs(f.R.cx - 66) < 0.05, '松开回正')
})

test('眨眼：待命 4–8 秒一次，右眼不比左眼早', () => {
  const { frames } = sim('idle', 12, { seed: 7 })
  let tL = null
  let tR = null
  let maxL = 0
  let maxR = 0
  for (const { t, f } of frames) {
    if (tL == null && f.L.clipTop > 0.1) tL = t
    if (tR == null && f.R.clipTop > 0.1) tR = t
    maxL = Math.max(maxL, f.L.clipTop)
    maxR = Math.max(maxR, f.R.clipTop)
  }
  assert.ok(tL != null && tL >= 4, `头一次眨眼 ${tL}`) // 待命 4 秒之内不眨
  assert.ok(tR == null || tR >= tL - DT, `右眼 ${tR} 早于左眼 ${tL}`)
  assert.ok(maxL > 0.5 && maxR > 0.5, '两只眼都眨到')
})

test('眨眼间隔两档：待命 60 秒里都在 4–8 秒，干活（read）仍是 3–5 秒；连眨的第二下不算', () => {
  // 眨一下时眼皮拍起过 0.4（干活的神情眼皮平时也压着一点，不能只看从 0 抬起）：拍过那一下算一次
  const startsOf = (frames) => {
    const starts = []
    let prev = 0
    for (const { t, f } of frames) {
      if (prev <= 0.4 && f.L.clipTop > 0.4) starts.push(t)
      prev = f.L.clipTop
    }
    return starts
  }
  const idle = startsOf(sim('idle', 60, { seed: 7 }).frames)
  assert.ok(idle.length >= 5, `待命眨眼次数 ${idle.length}`)
  for (let i = 1; i < idle.length; i++) {
    const gap = idle[i] - idle[i - 1]
    if (gap < 2) continue // 连眨的第二下不算
    assert.ok(gap >= 3.9 && gap <= 8.1, `待命眨眼间隔 ${gap}`)
  }
  const work = startsOf(sim('read', 40, { seed: 7 }).frames)
  assert.ok(work.length >= 5, `干活眨眼次数 ${work.length}`)
  for (let i = 1; i < work.length; i++) {
    const gap = work[i] - work[i - 1]
    if (gap < 2) continue
    assert.ok(gap >= 2.9 && gap <= 5.1, `干活眨眼间隔 ${gap}`)
  }
})

test('换神情：已排的下一次比新一档最长还远就重排（idle 切 read，头一次眨眼不超 5 秒）', () => {
  const m = createMotion({ rand: rng(23) })
  m.setPose('idle') // 初始按待命排，可能在 8 秒外
  m.setPose('read') // read 最长 5 秒：重排
  let tFirst = null
  for (let i = 0; i < 5.5 / DT; i++) {
    if (tFirst == null && m.tick(DT).L.clipTop > 0.02) tFirst = (i + 1) * DT
  }
  assert.ok(tFirst != null && tFirst <= 5.1, `切到 read 后头一次眨眼 ${tFirst}`)
})

test('setGaze 在 idle 和 look 里也生效：替掉视线，右眼晚 36ms；null 回东张西望', () => {
  const m = createMotion({ rand: rng(3) })
  m.setPose('idle')
  for (let i = 0; i < 0.5 / DT; i++) m.tick(DT)
  m.setGaze({ x: 3, y: -1 }) // 单位同「看你」：SVG 单位，x ±3、y -1
  let sawLag = false
  let f = null
  for (let i = 0; i < 0.6 / DT; i++) {
    f = m.tick(DT)
    if (f.L.cx - 46 > 0.3 && Math.abs(f.R.cx - 66) < 0.05) sawLag = true // 右眼还没起步
  }
  assert.ok(sawLag, '右眼没落后')
  assert.ok(Math.abs(f.L.cx - 49) < 0.3 && Math.abs(f.L.cy - 14) < 0.3, `左眼跟到 ${f.L.cx},${f.L.cy}`)
  assert.ok(Math.abs(f.R.cx - 69) < 0.3 && Math.abs(f.R.cy - 14) < 0.3, `右眼跟到 ${f.R.cx},${f.R.cy}`)
  m.setGaze(null)
  for (let i = 0; i < 1.5 / DT; i++) f = m.tick(DT)
  assert.ok(Math.abs(f.L.cx - 46) < 0.05 && Math.abs(f.R.cx - 66) < 0.05, '松开回正')
  const m2 = createMotion({ rand: rng(3) })
  m2.setPose('look')
  m2.setGaze({ x: -3, y: -1 })
  let f2 = null
  for (let i = 0; i < 0.6 / DT; i++) f2 = m2.tick(DT)
  assert.ok(Math.abs(f2.L.cx - 43) < 0.3 && Math.abs(f2.L.cy - 14) < 0.3, `look 跟到 ${f2.L.cx}`)
  assert.ok(Math.abs(f2.R.cx - 63) < 0.3, `look 右眼跟到 ${f2.R.cx}`)
})

test('blink()：立刻眨一下，正在眨或不许眨就不眨；下一次随机眨眼往后推', () => {
  const m = createMotion({ rand: rng(6) })
  m.setPose('idle')
  for (let i = 0; i < 1 / DT; i++) m.tick(DT)
  assert.ok(m.settled())
  assert.equal(m.blink(), true)
  assert.equal(m.blink(), false) // 正在眨就不管
  let maxL = 0
  for (let i = 0; i < 0.6 / DT; i++) maxL = Math.max(maxL, m.tick(DT).L.clipTop)
  assert.ok(maxL > 0.5, `眨到 ${maxL}`)
  for (let i = 0; i < 1 / DT; i++) m.tick(DT) // 眨完停稳（下一次还被推在 4 秒外）
  assert.ok(m.settled())
  // 手动眨过：下一次随机眨眼被推后一个间隔 —— 至少 4 秒内不再眨，至多 8+1 秒内会再眨（不睡死）
  let open = false // 先等这下（可能连眨的第二下）眨完
  let tNext = null
  for (let i = 0; i < 9 / DT; i++) {
    const T = 2.6 + (i + 1) * DT
    const c = m.tick(DT).L.clipTop
    if (!open) {
      if (c < 0.02) open = true
      continue
    }
    if (c > 0.1) { tNext = T; break }
  }
  assert.ok(tNext != null && tNext >= 5 && tNext <= 9, `下一次眨眼 ${tNext}`)
  const m2 = createMotion({ rand: rng(6) })
  m2.setPose('asleep') // 当前神情 blink 为 false 时不眨
  assert.equal(m2.blink(), false)
})

test('wakeIn + skip：停帧睡 wakeIn 秒、拨过去、再 tick，眨眼确实发生', () => {
  const m = createMotion({ rand: rng(21) })
  m.setPose('idle')
  for (let i = 0; i < 2 / DT; i++) m.tick(DT) // 停稳（头一趟东张西望还在 8 秒外）
  assert.ok(m.settled())
  const w = m.wakeIn()
  assert.ok(Number.isFinite(w) && w > 1 && w <= 6, `wakeIn ${w}`) // 醒着时是眨眼那一下（待命 4–8 秒一排，已过 2 秒）
  assert.ok(m.settled()) // 还停着
  m.skip(w) // 睡过去
  let blinked = false
  for (let i = 0; i < 1.2 / DT; i++) {
    const f = m.tick(DT)
    if (f.L.clipTop > 0.1 || f.R.clipTop > 0.1) blinked = true
  }
  assert.ok(blinked, '睡醒了眨眼没发生')
  for (let i = 0; i < 3 / DT; i++) m.tick(DT) // 眨完又停稳，下一次排上
  assert.ok(m.settled())
  assert.ok(m.wakeIn() > 0.5, `下一次 wakeIn ${m.wakeIn()}`)
  // 没停稳时 skip 当 tick 用（read 一直演）
  const a = createMotion({ rand: rng(4) })
  a.setPose('read')
  const b = createMotion({ rand: rng(4) })
  b.setPose('read')
  a.settled(); b.settled() // 同样的前置调用，随机数对齐
  assert.deepEqual(a.skip(0.05), b.tick(0.05))
})

test('wakeIn：没停稳给 0；不会再变给 Infinity', () => {
  const m = createMotion({ rand: rng(8) })
  m.setPose('read')
  m.tick(DT)
  assert.equal(m.wakeIn(), 0) // read 一直读，停不下来
  const m2 = createMotion({ rand: rng(8) })
  m2.setPose('asleep')
  for (let i = 0; i < 1.5 / DT; i++) m2.tick(DT)
  assert.ok(m2.settled())
  assert.equal(m2.wakeIn(), Infinity) // 睡着不眨也不东张西望
})

test('asleep 给 breathing 标记，drag 给 shape，别的没有', () => {
  const asleep = sim('asleep', 1).frames[0].f
  assert.equal(asleep.breathing, true)
  const idle = sim('idle', 0.5).frames[0].f
  assert.equal(idle.breathing, false)
  assert.equal(idle.shape, 'eyes')
  const drag = sim('drag', 0.5).frames[0].f
  assert.equal(drag.shape, 'drag')
})

test('rest()：停稳时把弹簧放到目标上、速度清零（接着 tick 一帧都不挪）；没停稳什么都不做', () => {
  const m = createMotion({ rand: rng(5) })
  m.setPose('done')
  m.tick(DT)
  assert.equal(m.rest(), undefined) // 还在跳：没停稳，什么都不做
  m.setPose('idle')
  for (let i = 0; i < 1.5 / DT; i++) m.tick(DT)
  assert.ok(m.settled())
  const f = m.rest()
  assert.ok(f, '停稳了 rest 该给一帧')
  assert.equal(f.island.x, 0)
  assert.equal(f.island.y, 0)
  assert.equal(f.island.rot, 0)
  assert.equal(f.L.cx, 46) // restXL
  assert.equal(f.R.cx, 66)
  assert.equal(f.L.cy, 15) // restY
  assert.equal(f.L.clipTop, 0)
  assert.ok(m.settled()) // 放到目标上还是停稳
  for (let i = 0; i < 0.5 / DT; i++) { // 余速清了，还没到下一次眨眼：接着 tick 也不挪
    const g = m.tick(DT)
    assert.equal(g.L.cx, 46)
    assert.equal(g.island.y, 0)
    assert.equal(g.L.clipTop, 0)
  }
})

test('setParams / params：合进当前参数、重算刚度阻尼、不重置状态', () => {
  const m = createMotion({ rand: rng(3) })
  assert.equal(m.params().saccK, DEFAULT_MOTION.saccK)
  const copy = m.params()
  copy.saccK = 999
  assert.equal(m.params().saccK, DEFAULT_MOTION.saccK, 'params() 给的是拷贝')
  m.setPose('look')
  for (let i = 0; i < 0.5 / DT; i++) m.tick(DT) // 睁大的眼睛到位
  m.setParams({ saccK: 60, saccZeta: 1.1 })
  assert.equal(m.params().saccK, 60)
  assert.equal(m.params().saccZeta, 1.1)
  assert.equal(m.params().blinkMinSec, DEFAULT_MOTION.blinkMinSec, '没给的参数留着')
  const f = m.tick(DT)
  assert.ok(Math.abs(f.L.rx * 2 - 14) < 0.3, `不重置状态（还在 look）：宽 ${f.L.rx * 2}`)
  // 刚度真换算了：软弹簧跟新视线慢一截
  m.setGaze({ x: 3, y: 0 })
  let soft = 0
  for (let i = 0; i < 0.3 / DT; i++) soft = Math.max(soft, m.tick(DT).L.cx - 46)
  const hard = createMotion({ rand: rng(3) })
  hard.setPose('look')
  for (let i = 0; i < 0.5 / DT; i++) hard.tick(DT)
  hard.setGaze({ x: 3, y: 0 })
  let fast = 0
  for (let i = 0; i < 0.3 / DT; i++) fast = Math.max(fast, hard.tick(DT).L.cx - 46)
  assert.ok(soft < fast * 0.6, `软弹簧没慢下来：${soft} vs ${fast}`)
})

test('同一种子同一条 tick 序列，帧完全一样；DEFAULT_MOTION 参数齐', () => {
  const a = createMotion({ rand: rng(9) })
  const b = createMotion({ rand: rng(9) })
  a.setPose('wake'); b.setPose('wake')
  for (let i = 0; i < 2 / DT; i++) assert.deepEqual(a.tick(DT), b.tick(DT))
  for (const k of [
    'saccK', 'saccZeta', 'saccRK', 'saccRZeta', 'shapeK', 'shapeZeta',
    'lidCloseK', 'lidCloseZeta', 'lidOpenK', 'lidOpenZeta',
    'smileK', 'smileZeta', 'hopK', 'hopZeta', 'scaleK', 'scaleZeta',
    'blinkCloseSec', 'blinkOpenSec', 'blinkMinSec', 'blinkMaxSec', 'idleBlinkMinSec', 'idleBlinkMaxSec',
    'blinkLagMinSec', 'blinkLagMaxSec', 'blinkTwiceChance',
    'squashVel', 'squashMax', 'squashCross', 'settleEps', 'settleVelEps', 'restXL', 'restXR', 'restY',
  ]) assert.ok(typeof DEFAULT_MOTION[k] === 'number', `DEFAULT_MOTION.${k}`)
  assert.equal(DEFAULT_MOTION.islandFlipY, true)
})

// —— setQuiet：电脑忙（页面这一半）——

test('setQuiet(true)：忙时 idle 30 秒视线不动，眨眼照常，wakeIn 只剩眨眼', () => {
  const m = createMotion({ rand: rng(13) })
  m.setPose('idle')
  for (let i = 0; i < 1 / DT; i++) m.tick(DT)
  assert.ok(m.settled())
  m.setQuiet(true)
  let moved = 0
  let blinked = 0
  let maxWake = 0
  for (let i = 0; i < 30 / DT; i++) {
    const f = m.tick(DT)
    moved = Math.max(moved, Math.abs(f.L.cx - 46), Math.abs(f.R.cx - 66), Math.abs(f.L.cy - 15), Math.abs(f.R.cy - 15))
    if (f.L.clipTop > 0.1) blinked++
    maxWake = Math.max(maxWake, m.wakeIn())
  }
  assert.ok(moved < 0.01, `视线动了 ${moved}`)
  assert.ok(blinked > 0, '忙时也眨眼')
  assert.ok(maxWake <= Math.max(DEFAULT_MOTION.blinkMaxSec, DEFAULT_MOTION.idleBlinkMaxSec) + 1e-9, `wakeIn ${maxWake} 超过眨眼间隔（把东张西望算进去了）`)
})

test('setQuiet：正在东张西望时变忙不跳帧，视线顺着弹簧回正', () => {
  const m = createMotion({ rand: rng(3) })
  m.setPose('idle')
  let off = null // 等到头一趟东张西望正走着（眼睛已经挪出去）
  for (let i = 0; i < 25 / DT; i++) {
    const f = m.tick(DT)
    if (Math.abs(f.L.cx - 46) > 1.5) { off = f; break }
  }
  assert.ok(off, '没等到东张西望')
  m.setQuiet(true)
  let maxStep = 0
  let prev = null
  let backAt = null
  for (let i = 0; i < 2 / DT; i++) {
    const f = m.tick(DT)
    if (prev) maxStep = Math.max(maxStep, Math.abs(f.L.cx - prev.L.cx), Math.abs(f.L.cy - prev.L.cy), Math.abs(f.R.cx - prev.R.cx))
    prev = f
    if (backAt == null && Math.abs(f.L.cx - 46) < 0.05 && Math.abs(f.L.cy - 15) < 0.05) backAt = (i + 1) * DT
  }
  assert.ok(maxStep <= 0.8, `一帧跳了 ${maxStep}`)
  assert.ok(backAt != null, '视线没回正')
  // 回正前后赶上眨眼正在走的那半秒，settled 本来就是 false：等眨完（最多 1 秒）再验
  for (let i = 0; i < 1 / DT && !m.settled(); i++) m.tick(DT)
  assert.ok(m.settled())
})

test('setQuiet：asleep 忙时 breathing 一律 false，变回不忙又有', () => {
  const m = createMotion({ rand: rng(5) })
  m.setPose('asleep')
  for (let i = 0; i < 1.5 / DT; i++) m.tick(DT)
  assert.equal(m.tick(DT).breathing, true)
  m.setQuiet(true)
  assert.equal(m.tick(DT).breathing, false)
  m.setQuiet(false)
  assert.equal(m.tick(DT).breathing, true)
})

test('setQuiet(false)：从现在起重新排下一趟，20 秒内会再东张西望', () => {
  const m = createMotion({ rand: rng(7) })
  m.setPose('idle')
  m.setQuiet(true)
  for (let i = 0; i < 25 / DT; i++) m.tick(DT) // 忙着：视线一直没动（原来的排程早过了）
  m.setQuiet(false)
  let tMove = null
  for (let i = 0; i < 20 / DT; i++) {
    const f = m.tick(DT)
    if (Math.abs(f.L.cx - 46) > 0.5) { tMove = (i + 1) * DT; break }
  }
  assert.ok(tMove != null && tMove > 9 && tMove <= 20, `再东张西望 ${tMove}`)
})

test('setQuiet：忙着换神情照演（done 照跳），setGaze 在忙着的 idle 里也生效', () => {
  const m = createMotion({ rand: rng(9) })
  m.setQuiet(true)
  m.setPose('done')
  let peak = 0
  for (let i = 0; i < 1.5 / DT; i++) peak = Math.max(peak, Math.abs(m.tick(DT).island.y))
  assert.ok(peak > 3.9 && peak < 4.5, `轻跳峰 ${peak}`)
  const m2 = createMotion({ rand: rng(9) })
  m2.setPose('idle')
  m2.setQuiet(true)
  for (let i = 0; i < 0.5 / DT; i++) m2.tick(DT)
  m2.setGaze({ x: 3, y: -1 })
  let f = null
  for (let i = 0; i < 0.8 / DT; i++) f = m2.tick(DT)
  assert.ok(Math.abs(f.L.cx - 49) < 0.3, `忙着的 idle 里 setGaze 没跟到 ${f.L.cx}`)
})
