// animator.mjs：引擎和页面之间那一层。
// 假的 raf、假闹钟、假的时钟：停稳后不再请求 raf、闹钟到点接着走且眨了眼、
// still 时不走 raf、pause 时什么都不跑、换神情后视线还在、待命 60 秒帧数远少于 60×60、
// 120Hz 屏一秒最多 61 帧（封顶 60）且终点和不封顶一样、60Hz 屏不跳帧。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createMotion } from '../../app/pet/motion.mjs'
import { createAnimator } from '../../app/pet/animator.mjs'
import { createPoseGate } from '../../app/pet/pose-pick.mjs'

// 固定种子的随机数（跟 motion.test.mjs 同一个）
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// 假的环境：时钟、raf 队列、闹钟表。advance 每帧 16ms，先到点的闹钟先响，
// 再把排着队的 raf 回调跑掉（跑的时候又可以排下一帧）。
function makeLab() {
  let now = 0
  let seq = 0
  const rafQueue = []
  const timers = new Map()
  const stats = { rafCalls: 0, frames: 0 }
  return {
    now: () => now,
    raf(fn) {
      stats.rafCalls += 1
      const id = ++seq
      rafQueue.push({ id, fn })
      return id
    },
    caf(id) {
      const at = rafQueue.findIndex((entry) => entry.id === id)
      if (at >= 0) rafQueue.splice(at, 1)
    },
    setTimer(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimer(id) { timers.delete(id) },
    jump(ms) { now += ms }, // 只挪时钟，不跑帧（模拟“叫醒以后隔了很久才画第一帧”）
    advance(ms, frameMs = 16) {
      const end = now + ms
      while (now < end - 1e-9) {
        now = Math.min(now + frameMs, end)
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) { timers.delete(id); timer.fn() }
        }
        for (const { fn } of rafQueue.splice(0)) fn()
      }
    },
    pendingRaf: () => rafQueue.length,
    timers: () => timers.size,
    stats,
  }
}

// 真引擎 + 假环境 + 记下来的帧
function make({ seed = 7, gate = null, maxFps, onJank } = {}) {
  const lab = makeLab()
  const motion = createMotion({ rand: rng(seed) })
  const frames = []
  const animator = createAnimator({
    motion,
    render: (frame) => { frames.push(frame); lab.stats.frames += 1 },
    raf: lab.raf,
    caf: lab.caf,
    setTimer: lab.setTimer,
    clearTimer: lab.clearTimer,
    now: lab.now,
    gate,
    maxFps,
    onJank,
  })
  return { lab, motion, frames, animator }
}

test('停稳后不再请求 raf：没有排着的帧，也不再多要', () => {
  const { lab, animator } = make()
  animator.setPose('asleep') // 睡着：不眨也不东张西望，wakeIn 是 Infinity
  lab.advance(2000)
  assert.equal(lab.pendingRaf(), 0, '停稳了还排着 raf')
  assert.equal(lab.timers(), 0, 'Infinity 不定闹钟')
  const calls = lab.stats.rafCalls
  lab.advance(5000)
  assert.equal(lab.stats.rafCalls, calls, '停稳后还在要 raf')
})

test('停稳但有下一拍的：raf 停了，闹钟排上', () => {
  const { lab, animator } = make()
  animator.setPose('look')
  lab.advance(1500)
  assert.equal(lab.pendingRaf(), 0, 'raf 没停')
  assert.equal(lab.timers(), 1, '没排闹钟（下一次眨眼）')
})

test('闹钟到点接着走，且眨了眼', () => {
  const { lab, animator, frames } = make({ seed: 21 })
  animator.setPose('idle')
  lab.advance(1000) // 停稳（头一趟东张西望在 10 秒外），闹钟排上下一次眨眼
  assert.ok(lab.pendingRaf() === 0 && lab.timers() === 1)
  const before = frames.length
  const rafBefore = lab.stats.rafCalls
  lab.advance(8000) // 闹钟到点：skip 睡过去的那段，接着 raf
  const after = frames.slice(before)
  assert.ok(after.length > 10, `闹钟响了没接着走（只多了 ${after.length} 帧）`)
  assert.ok(lab.stats.rafCalls > rafBefore, '没再要 raf')
  assert.ok(after.some((f) => f.L.clipTop > 0.1 || f.R.clipTop > 0.1), '睡醒了眨眼没发生')
})

test('still 时不走 raf：setPose / setGaze 各 snap 一帧就停', () => {
  const { lab, animator, frames } = make()
  animator.still(true)
  animator.setPose('look')
  animator.setGaze({ x: 3, y: -1 })
  lab.advance(2000)
  assert.equal(lab.stats.rafCalls, 0, 'still 还在要 raf')
  assert.equal(lab.timers(), 0, 'still 还排着闹钟')
  // 三帧：still(true) 自己一帧，setPose、setGaze 各一帧
  assert.equal(frames.length, 3, `该正好三帧，是 ${frames.length}`)
  const eye = frames[frames.length - 1].L
  assert.ok(Math.abs(eye.cx - 49) < 0.01 && Math.abs(eye.rx * 2 - 14) < 0.01, 'snap 不是终点帧')
})

test('pause 时什么都不跑，回来从现在接着走', () => {
  const { lab, animator, frames } = make()
  animator.setPose('idle')
  lab.advance(600)
  animator.pause(true)
  const framesAt = frames.length
  const rafAt = lab.stats.rafCalls
  lab.advance(5000)
  assert.equal(frames.length, framesAt, 'pause 里还画了帧')
  assert.equal(lab.stats.rafCalls, rafAt, 'pause 里还排了 raf')
  assert.equal(lab.timers(), 0, 'pause 里还留着闹钟')
  animator.setPose('done') // 藏着的时候换神情：也不动
  lab.advance(1000)
  assert.equal(frames.length, framesAt, 'pause 里 setPose 也画了帧')
  animator.pause(false)
  lab.advance(600)
  assert.ok(frames.length > framesAt, '回来没接着走')
  // done 的跳没被补算：跳峰还在（藏起来那会儿的冲动不重放）
  let peak = 0
  for (const f of frames.slice(framesAt)) peak = Math.max(peak, Math.abs(f.island.y))
  assert.ok(peak > 3.5, `done 跳峰 ${peak}`)
})

test('换神情后视线还在（motion.setPose 清掉，animator 记着重设）', () => {
  const { animator, frames } = make()
  animator.setPose('idle')
  animator.setGaze({ x: 3, y: -1 })
  animator.setPose('look')
  animator.still(true) // 直接跳到 look 的终点看眼睛在哪
  const eye = frames[frames.length - 1].L
  assert.ok(Math.abs(eye.cx - 49) < 0.3, `左眼跟到 ${eye.cx}（视线没保住）`)
  animator.setGaze(null)
  const eye2 = frames[frames.length - 1].L
  assert.ok(Math.abs(eye2.cx - 46) < 0.05, `松开后回正 ${eye2.cx}`)
})

test('干活三件套的节流：1.2 秒内不换，到点每帧问 due 换上', () => {
  const { lab, animator, frames } = make({ gate: createPoseGate({ minHoldSec: 1.2 }) })
  animator.setPose('read')
  lab.advance(300)
  animator.setPose('write') // 还没演够：先记着
  lab.advance(500)
  let last = frames[frames.length - 1].L
  assert.ok(Math.abs(last.rx * 2 - 9.6) < 0.3, `还在读（宽 ${last.rx * 2}）`)
  lab.advance(1500) // 到点换上
  last = frames[frames.length - 1].L
  assert.ok(Math.abs(last.rx * 2 - 10.4) < 0.3, `没换到写（宽 ${last.rx * 2}）`)
})

test('待命 60 秒：raf 帧数远少于 60×60（停稳就停帧）', () => {
  const { lab, animator } = make({ seed: 3 })
  animator.setPose('idle')
  lab.advance(60000)
  assert.ok(lab.stats.frames < 1200, `60 秒画了 ${lab.stats.frames} 帧（满帧是 3600）`)
})

test('120Hz 屏不再画 120 帧：一秒最多 61 帧（帧率封顶 60）', () => {
  // read 一直演（live）：停不稳，raf 不会自己停，正好量封顶
  const { lab, animator } = make()
  animator.setPose('read')
  lab.advance(1000, 8.33)
  assert.ok(lab.stats.frames <= 61, `一秒画了 ${lab.stats.frames} 帧`)
})

test('60Hz 屏不跳帧：一秒约 60 帧（留 1ms 余量的用处）', () => {
  const { lab, animator } = make()
  animator.setPose('read')
  lab.advance(1000, 16)
  assert.ok(lab.stats.frames >= 59 && lab.stats.frames <= 63, `一秒画了 ${lab.stats.frames} 帧`)
})

test('封顶 60 帧：动画走完的终点和不封顶一样（弹簧用真实 dt）', () => {
  const run = (maxFps) => {
    const { lab, animator, frames } = make({ seed: 21, maxFps })
    animator.setPose('done')
    lab.advance(2000, 8.33)
    return { count: lab.stats.frames, last: frames[frames.length - 1] }
  }
  const capped = run(60)
  const free = run(1000) // 不封顶：120Hz 每一帧都画
  assert.ok(capped.count < free.count, `封顶没少画（${capped.count} vs ${free.count}）`)
  // 两边都停稳在 rest 那一帧：弹簧放到目标上，终点应该一模一样
  for (const side of ['L', 'R']) {
    assert.ok(Math.abs(capped.last[side].cx - free.last[side].cx) < 1e-9, `${side} 眼 x 不一样`)
    assert.ok(Math.abs(capped.last[side].rx - free.last[side].rx) < 1e-9, `${side} 眼宽不一样`)
    assert.ok(Math.abs(capped.last[side].clipTop - free.last[side].clipTop) < 1e-9, `${side} 眼皮不一样`)
  }
  assert.ok(Math.abs(capped.last.island.y - free.last.island.y) < 1e-9, '整岛落点不一样')
})

test('卡顿观察：普通帧不报，间隔 200ms 的报', () => {
  const jank = []
  const { lab, animator } = make({ onJank: (info) => jank.push(info) })
  animator.setPose('read')
  lab.advance(1000) // 16ms 一帧：不算卡
  assert.equal(jank.length, 0, `普通帧报了 ${jank.length} 次`)
  lab.advance(600, 200) // 每帧隔 200ms：算卡
  assert.ok(jank.length >= 1, '隔 200ms 的帧该报')
  assert.ok(jank.every((j) => j.gapMs >= 150), '报的间隔不对')
  assert.ok(jank.every((j) => typeof j.pose === 'string'), '报的时候该带上神情')
})

test('卡顿观察：停帧后重新起步的第一帧不报', () => {
  const jank = []
  const { lab, animator } = make({ onJank: (info) => jank.push(info) })
  animator.setPose('asleep') // 停稳：raf 停了
  lab.advance(2000)
  assert.equal(lab.pendingRaf(), 0, '停稳了还排着 raf')
  animator.setPose('read') // 叫醒：重新起步
  lab.jump(500) // 叫醒以后隔了半秒才画第一帧
  lab.advance(16)
  assert.equal(jank.length, 0, `重新起步的第一帧报了 ${jank.length} 次`)
  // 后面的帧照常报（不是把观察关了）
  lab.advance(400, 200)
  assert.ok(jank.length >= 1, '之后的卡顿该报')
})

test('卡顿观察：不传 onJank 也不出错', () => {
  const { lab, animator } = make()
  animator.setPose('read')
  lab.advance(1000, 200)
  assert.ok(lab.stats.frames > 0)
})

test('眨眼停帧：从开始闭眼到停帧不超过 0.6 秒，停下那帧余速已清干净', () => {
  const { lab, animator, frames } = make({ seed: 21 })
  animator.setPose('idle')
  lab.advance(1000) // 停稳，闹钟排上下一次眨眼（待命 4–8 秒一排）
  const seen = frames.length
  let closedAt = null
  let stoppedAt = null
  while (lab.now() < 9000 && stoppedAt == null) {
    lab.advance(16)
    if (closedAt == null && frames.slice(seen).some((f) => f.L.clipTop > 0.05)) closedAt = lab.now()
    if (closedAt != null && lab.pendingRaf() === 0) stoppedAt = lab.now()
  }
  assert.ok(closedAt != null, '没等到眨眼')
  assert.ok(stoppedAt != null, '眨完没停帧')
  assert.ok(stoppedAt - closedAt <= 600, `从闭眼到停帧 ${stoppedAt - closedAt}ms`)
  // 停下那一帧是 rest 给的：弹簧在目标上、眼皮全开，没有余速拖着
  const last = frames[frames.length - 1]
  assert.equal(last.L.clipTop, 0)
  assert.equal(last.R.clipTop, 0)
  assert.equal(last.L.cx, 46)
})
