// 接文件·期待：文件拖近时眼睛放大到 1.2，整个岛弹一下（弹一下曲线 250ms），
// 再长开接文件。决定是纯函数：进来弹不弹、等多久张托；
// 这 250ms 里拖走了就取消、不张托；这 250ms 里松手了文件不能丢（不等托，照松手直接处理）；
// still（关了「显示动画」）时不弹不等，立刻张托。

import { EXPECT } from './eyes.mjs'

// 事件 → 该怎么办：
// - enter：弹一下 + 等 EXPECT.waitMs 再张托；still 就 waitMs 0（立刻张托，不弹）
// - leave：等的取消，不张托
// - drop：等的取消，松手的文件直接处理（dropNow），别丢
export function expectOf(event, options = {}) {
  if (event === 'enter') {
    if (options.still === true) return { bounce: false, waitMs: 0 }
    return { bounce: true, waitMs: EXPECT.waitMs }
  }
  if (event === 'leave') return { bounce: false, waitMs: 0, cancel: true }
  if (event === 'drop') return { bounce: false, waitMs: 0, cancel: true, dropNow: true }
  return { bounce: false, waitMs: 0, cancel: true }
}

// 壳里挂的那一摊：enter 记下 250ms 后张托，leave / drop 取消。
// openTray：真正长开接文件（张不张得成由调用方再核一遍场景）；still：现在关没关「显示动画」。
export function createExpect({ send, still, openTray, log = () => {}, waitMs = EXPECT.waitMs, schedule = setTimeout, cancelTimer = clearTimeout }) {
  let timer = null
  const off = () => send('pet:expect', { phase: 'off' })
  const clear = (by) => {
    if (!timer) return false
    cancelTimer(timer)
    timer = null
    off()
    log('expect-cancel', { by })
    return true
  }
  return {
    enter() {
      const plan = expectOf('enter', { still: still() })
      clear('enter')
      if (plan.bounce) send('pet:expect', { phase: 'enter' })
      if (!plan.waitMs) { openTray(); return }
      log('expect', { waitMs: plan.waitMs })
      timer = schedule(() => {
        timer = null
        off()
        openTray()
      }, waitMs)
    },
    leave() { clear('leave') },
    drop() { clear('drop') },
    stop() {
      if (timer) cancelTimer(timer)
      timer = null
    },
  }
}
