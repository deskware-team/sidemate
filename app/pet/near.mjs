// 鼠标靠近·看你的纯计算 + 壳里的轮询：鼠标进到小岛 120px 内，眼睛朝鼠标那边挪，
// 最多 3px，抬起 1px；离开 300ms 回正。鼠标位置只有主进程知道，
// 这里算好偏移发给页面；页面只管把眼睛挪过去。纯函数，不碰 electron，好测。

import { NEAR } from './eyes.mjs'

// 取到 0.5 精度：偏移变了才发 IPC，别一点鼠标就刷屏
function roundHalf(value) {
  return Math.round(value * 2) / 2
}

// cursor：鼠标的屏幕位置（DIP）；bounds：小岛矩形 { x, y, width, height }（DIP）。
// 进到矩形 120px 以内（四边各放宽 120）：x = 3 × clamp((鼠标x − 小岛中心x) / 60, −1, 1)，
// y 固定 −1（抬起 1；toward-1-1.svg 是 +3 / −1）。在外头就 { near: false }。
export function nearOf(cursor, bounds) {
  if (!cursor || !bounds) return { near: false, dx: 0, dy: 0 }
  const { x, y, width = 0, height = 0 } = bounds
  const reach = NEAR.rangePx
  if (cursor.x < x - reach || cursor.x > x + width + reach
    || cursor.y < y - reach || cursor.y > y + height + reach) {
    return { near: false, dx: 0, dy: 0 }
  }
  const center = x + width / 2
  const ratio = Math.max(-1, Math.min(1, (cursor.x - center) / NEAR.reachPx))
  return { near: true, dx: roundHalf(NEAR.maxPx * ratio), dy: NEAR.liftPx }
}

// 轮询：active() 说该看着鼠标（小岛显示着、strip 或 expanded、没在拖、没在出场、
// 不是 still、待命中）才起表；一轮里条件变了就自己停。
// 偏移取到 0.5 精度，变了才 send。纯逻辑，注入时钟和取值，好测。
export function watchNear({ getCursor, getBounds, active, send, interval = NEAR.pollMs }) {
  let timer = null
  let key = ''
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    key = ''
  }
  const tick = () => {
    if (!active()) { stop(); return }
    const plan = nearOf(getCursor(), getBounds())
    const next = `${plan.near ? 1 : 0}|${plan.dx}|${plan.dy}`
    if (next === key) return
    key = next
    send(plan)
  }
  return {
    stop,
    sync() {
      if (timer || !active()) return
      timer = setInterval(tick, interval)
      tick()
    },
  }
}
