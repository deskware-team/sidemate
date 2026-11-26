// 忙不忙：两次采样的忙碌比例、迟滞（连续 10 秒才算）、采样只在变了时发。
// 纯计算，不碰 electron。

import assert from 'node:assert/strict'
import test from 'node:test'
import { cpuBusyFraction, createBusyGate, watchBusy } from '../../app/pet/busy.mjs'

// 造一个 os.cpus() 那样的采样：每核 { user, nice, sys, idle, irq } 累计毫秒
function snapshot(cores) {
  return cores.map((times) => ({ model: 'Fake', speed: 0, times: { nice: 0, irq: 0, ...times } }))
}

test('忙碌比例：忙 = 总时间 − 空闲，两次采样之间算', () => {
  const before = snapshot([
    { user: 1000, sys: 500, idle: 2000 },
    { user: 1000, sys: 500, idle: 2000 },
  ])
  const after = snapshot([
    { user: 1500, sys: 600, idle: 2100 },
    { user: 1500, sys: 600, idle: 2100 },
  ])
  // 每核：走了 700ms，空闲 100ms → 忙 600ms
  assert.equal(cpuBusyFraction(before, after), 600 / 700)
})

test('忙碌比例：全空闲是 0，全忙是 1', () => {
  const before = snapshot([{ user: 0, sys: 0, idle: 0 }])
  const idle = snapshot([{ user: 0, sys: 0, idle: 1000 }])
  assert.equal(cpuBusyFraction(before, idle), 0)
  const busy = snapshot([{ user: 1000, sys: 0, idle: 0 }])
  assert.equal(cpuBusyFraction(before, busy), 1)
})

test('忙碌比例：核数变了、数据不对、没走过时间，都返回 null', () => {
  const one = snapshot([{ user: 0, sys: 0, idle: 0 }])
  const two = snapshot([{ user: 0, sys: 0, idle: 0 }, { user: 0, sys: 0, idle: 0 }])
  assert.equal(cpuBusyFraction(one, two), null, '核数变了')
  assert.equal(cpuBusyFraction(two, one), null, '核数变了')
  assert.equal(cpuBusyFraction(null, two), null, '不是数组')
  assert.equal(cpuBusyFraction(one, [{ times: { user: 'x', sys: 0, idle: 0 } }]), null, '数据不对')
  assert.equal(cpuBusyFraction(one, one), null, '时间没走')
})

test('gate：连续 10 秒高于 85% 才算忙（9.9 秒不算，10 秒算）', () => {
  const gate = createBusyGate()
  assert.equal(gate.feed(0.9, 0), false)
  assert.equal(gate.feed(0.9, 9900), false)
  assert.equal(gate.feed(0.9, 10000), true)
  assert.equal(gate.busy, true)
})

test('gate：中间掉到 70%–85% 那档，重新计时', () => {
  const gate = createBusyGate()
  assert.equal(gate.feed(0.9, 0), false)
  assert.equal(gate.feed(0.9, 5000), false)
  assert.equal(gate.feed(0.75, 6000), false, '中间那档不算忙')
  assert.equal(gate.feed(0.9, 15000), false, '断了之后重新开始计时')
  assert.equal(gate.feed(0.9, 25000), true, '新的连续高位满 10 秒')
})

test('gate：忙时 75% 不恢复，降到 70% 以下连续 10 秒才恢复', () => {
  const gate = createBusyGate()
  gate.feed(0.9, 0)
  gate.feed(0.9, 10000)
  assert.equal(gate.busy, true)
  assert.equal(gate.feed(0.75, 11000), true, '中间那档不算恢复')
  assert.equal(gate.feed(0.69, 20000), true, '刚降下来还没到 10 秒')
  assert.equal(gate.feed(0.69, 30000), false)
  assert.equal(gate.busy, false)
})

test('gate：null（没采到）不算连续，状态不动', () => {
  const gate = createBusyGate()
  assert.equal(gate.feed(0.9, 0), false)
  assert.equal(gate.feed(null, 5000), false)
  assert.equal(gate.feed(0.9, 10000), false, 'null 之后重新计时')
  // 已经忙了：null 不把它变回去
  const busyGate = createBusyGate()
  busyGate.feed(0.9, 0)
  busyGate.feed(0.9, 10000)
  assert.equal(busyGate.feed(null, 20000), true)
  assert.equal(busyGate.busy, true)
})

// 假定时器：自己推进时间，不占真时间
function fakeClock() {
  const timers = []
  return {
    timers,
    setTimer(fn, ms) {
      const handle = { fn, ms, cleared: false }
      timers.push(handle)
      return handle
    },
    clearTimer(handle) { handle.cleared = true },
    fire() {
      const handle = timers[timers.length - 1]
      if (!handle || handle.cleared) return null
      handle.fn()
      return handle
    },
  }
}

// 按「忙 / 不忙」的顺序造一串累计计数器采样
function sampler(pattern) {
  let user = 0
  let idle = 0
  let index = 0
  return () => {
    const busy = pattern[Math.min(index, pattern.length - 1)]
    if (busy) user += 1000
    else idle += 1000
    index++
    return snapshot([{ user, sys: 0, idle }])
  }
}

test('watchBusy：只在忙不忙变了才发，停了就不再采', () => {
  const clock = fakeClock()
  const sent = []
  let clockNow = 0
  let sampleCount = 0
  const take = sampler([false, true, true, false, false])
  const watch = watchBusy({
    sample: () => { sampleCount++; return take() },
    send: (payload) => sent.push(payload),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => clockNow,
    interval: 2000,
  })
  watch.start()
  assert.equal(sampleCount, 1, '刚起表先采一次，没有上一次比不了')
  clockNow = 2000
  clock.fire() // 第二次采样：开始连续高位
  assert.deepEqual(sent, [])
  clockNow = 12000
  clock.fire() // 高位满 10 秒 → 忙
  assert.deepEqual(sent, [{ busy: true }])
  clockNow = 14000
  clock.fire() // 降到低位，刚开始计
  assert.deepEqual(sent, [{ busy: true }])
  clockNow = 24000
  clock.fire() // 低位满 10 秒 → 不忙
  assert.deepEqual(sent, [{ busy: true }, { busy: false }])
  assert.equal(watch.busy, false)
  // 停了：表清了，不再采，也不再发
  const before = sampleCount
  watch.stop()
  assert.equal(clock.timers[clock.timers.length - 1].cleared, true)
  clock.fire()
  assert.equal(sampleCount, before, '停了就一条也不采')
  assert.equal(sent.length, 2)
})

test('watchBusy：小岛看不见就不采（条件没了自己停）', () => {
  const clock = fakeClock()
  let visible = true
  let sampleCount = 0
  const watch = watchBusy({
    sample: () => { sampleCount++; return snapshot([{ user: 0, sys: 0, idle: 0 }]) },
    send: () => {},
    active: () => visible,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => 0,
  })
  watch.start()
  assert.equal(sampleCount, 1)
  visible = false
  clock.fire()
  assert.equal(sampleCount, 1, '看不见就不采了')
  assert.equal(clock.timers[clock.timers.length - 1].cleared, true, '表自己停了')
})
