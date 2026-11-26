// 电脑忙不忙：量整机 CPU 的忙碌比例，按规矩算出忙 / 不忙，变了才发给页面。
// 规矩：连续 10 秒高于 85% 算忙，降到 70% 以下连续 10 秒算恢复；
// 中间那档（70%–85%）什么都不算，连续计时重新开始。
// 纯计算，不引 electron，也不引 node:（采样由外面拿进来），好测。

// os.cpus() 每个核的累计时间（毫秒）：用户态、内核态、空闲
const FIELDS = ['user', 'nice', 'sys', 'irq']

// 一个核的 times 摊成数；少字段或不是数就算数据不对
function coreTimes(times) {
  if (!times || typeof times !== 'object') return null
  const out = {}
  for (const key of [...FIELDS, 'idle']) {
    const value = times[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    out[key] = value
  }
  return out
}

// 两次 os.cpus() 采样之间，整机忙碌比例（0–1）：忙 = 总时间 − 空闲。
// 核数变了、数据不对、这段时间没走（计数器没动）就返回 null（当没采到）。
export function cpuBusyFraction(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return null
  if (prev.length === 0 || prev.length !== next.length) return null
  let busy = 0
  let total = 0
  for (let i = 0; i < prev.length; i++) {
    const before = coreTimes(prev[i] && prev[i].times)
    const after = coreTimes(next[i] && next[i].times)
    if (!before || !after) return null
    let spent = 0
    for (const key of FIELDS) spent += after[key] - before[key]
    const idle = after.idle - before.idle
    if (spent < 0 || idle < 0) return null // 计数器回退了：数据不对
    spent += idle
    if (spent === 0) continue // 这个核这段时间没走：不进分母
    busy += spent - idle
    total += spent
  }
  if (total <= 0) return null
  return Math.max(0, Math.min(1, busy / total))
}

// 忙不忙的迟滞：不忙时连续 holdMs 高于 busyAbove 才变忙；忙时连续 holdMs 低于 calmBelow 才恢复。
// 中间那档和没采到（null）都不算连续，计时重新开始；状态本身不动。
export function createBusyGate({ busyAbove = 0.85, calmBelow = 0.70, holdMs = 10000 } = {}) {
  let busy = false
  let highSince = null
  let lowSince = null
  return {
    get busy() { return busy },
    feed(fraction, now) {
      if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
        highSince = null
        lowSince = null
        return busy
      }
      if (!busy) {
        if (fraction > busyAbove) {
          if (highSince === null) highSince = now
          else if (now - highSince >= holdMs) {
            busy = true
            highSince = null
            lowSince = null
          }
        } else {
          highSince = null
        }
      } else if (fraction < calmBelow) {
        if (lowSince === null) lowSince = now
        else if (now - lowSince >= holdMs) {
          busy = false
          lowSince = null
          highSince = null
        }
      } else {
        lowSince = null
      }
      return busy
    },
  }
}

// 采样：每 interval 毫秒采一次 os.cpus()（sample 给的是上一次的数组），
// 两次之间算出忙碌比例喂给 gate；忙不忙变了才 send({ busy })。
// active() 说该不该采（小岛看得见才采）；条件没了自己停。时钟和定时器从外面传，好测。
export function watchBusy({
  sample,
  send,
  active = () => true,
  setTimer = setInterval,
  clearTimer = clearInterval,
  now = () => Date.now(),
  interval = 2000,
  gate = createBusyGate(),
} = {}) {
  let timer = null
  let prev = null
  let busy = false

  function tick() {
    if (!active()) { stop(); return }
    const current = sample()
    if (prev) {
      const next = gate.feed(cpuBusyFraction(prev, current), now())
      if (next !== busy) {
        busy = next
        send({ busy })
      }
    }
    prev = current
  }

  function start() {
    if (timer) return
    prev = null
    timer = setTimer(tick, interval)
    tick()
  }

  function stop() {
    if (timer) clearTimer(timer)
    timer = null
    prev = null
  }

  return {
    start,
    stop,
    sync() {
      if (timer || !active()) return
      start()
    },
    get busy() { return busy },
  }
}
