// breath.mjs：睡着的呼吸（省电）——低频定时器替代一直不停的 CSS 动画。
// 假定时器把钟拨着走：一秒只写 2 次、幅度 0–amp、4.5 秒一个周期、stop 后不再写且写回 0。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createBreath } from '../../app/pet/breath.mjs'

// 假的钟和定时器：advance(ms) 按到期顺序跑回调，跑完把钟拨到终点
function fakeTimers() {
  let t = 0
  let pending = []
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = { fn, at: t + ms }
      pending.push(id)
      return id
    },
    clearTimer: (id) => { pending = pending.filter((x) => x !== id) },
    advance(ms) {
      const end = t + ms
      for (;;) {
        pending.sort((a, b) => a.at - b.at)
        const i = pending.findIndex((x) => x.at <= end)
        if (i < 0) break
        const [id] = pending.splice(i, 1)
        t = id.at
        id.fn()
      }
      t = end
    },
  }
}

function makeBreath(amp = 0.22) {
  const clock = fakeTimers()
  const writes = []
  const breath = createBreath({
    write: (v) => writes.push({ t: clock.now(), v }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    amp,
  })
  return { breath, writes, clock }
}

test('一秒只写 2 次（fps = 2）；start 两次也还是一份定时器', () => {
  const { breath, writes, clock } = makeBreath()
  assert.equal(breath.running, false)
  breath.start()
  assert.equal(breath.running, true)
  breath.start() // 页面每帧都调 start：已经在跑就不重排、不重置相位
  clock.advance(1000)
  assert.deepEqual(writes.map((w) => w.t), [500, 1000])
})

test('幅度在 0–amp 之间、4.5 秒一个周期（2.25 秒到顶、4.5 秒回 0）', () => {
  const { breath, writes, clock } = makeBreath(2) // amp 给 2，数字好认
  breath.start()
  clock.advance(9100) // 两个周期多一点，好对相位
  assert.ok(writes.length > 15, `写入次数 ${writes.length}`) // 一秒 2 次，9.1 秒 ≈ 18 下
  let peak = 0
  for (const w of writes) {
    assert.ok(w.v >= -1e-9 && w.v <= 2 + 1e-9, `幅度出界 ${w.v}`)
    peak = Math.max(peak, w.v)
  }
  // 2.25 秒的顶不在 0.5 秒的格子上：采样到的顶是 2.0 / 2.5 秒那两下
  assert.ok(Math.abs(peak - 2 * (0.5 - 0.5 * Math.cos((2 * Math.PI * 2) / 4.5))) < 1e-9, `顶点 ${peak}`)
  const byT = new Map(writes.map((w) => [w.t, w.v]))
  assert.ok(Math.abs(byT.get(4500)) < 1e-9, '4.5 秒没回到 0')
  for (const [t, v] of byT) {
    const other = byT.get(t + 4500)
    if (other != null) assert.ok(Math.abs(v - other) < 1e-9, `t=${t} 和 t+4.5 写的不一样`)
  }
})

test('stop 后不再写，且写回 0', () => {
  const { breath, writes, clock } = makeBreath()
  breath.start()
  clock.advance(2000)
  const n = writes.length
  assert.ok(n > 0)
  breath.stop()
  assert.equal(breath.running, false)
  assert.equal(writes.length, n + 1, '停那一下写一次 0')
  assert.equal(writes[writes.length - 1].v, 0)
  clock.advance(5000)
  assert.equal(writes.length, n + 1, '停了还在写')
})

test('stop 之后再 start：重新跑起来', () => {
  const { breath, writes, clock } = makeBreath()
  breath.start()
  clock.advance(1000)
  breath.stop()
  breath.start()
  assert.equal(breath.running, true)
  clock.advance(500)
  assert.ok(writes[writes.length - 1].v > 0, '新一轮 500ms 那一下已经不在 0')
})
