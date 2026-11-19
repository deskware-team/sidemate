// 犯困：10 分钟没动静，眼睛 1.2 秒慢慢半闭；鼠标一碰就睁开。
// 计时放页面那边（pet.js），困不困在这儿算：纯函数，好测。

import { SLEEPY } from './eyes.mjs'

// mode：现在什么状态；lastActive：上回有动静的时刻；now：现在；
// near / hover：鼠标是不是正在 120px 内 / 正停在小岛上（不算没动静）。
// 只有待命着、够 10 分钟没动静才困；干活等着别的状态不困。
export function sleepyOf({ mode, lastActive, now = Date.now(), near = false, hover = false } = {}) {
  const quiet = mode === 'idle' && !near && !hover
  const idleMs = Number.isFinite(lastActive) ? now - lastActive : Infinity
  return { sleepy: quiet && idleMs >= SLEEPY.idleMs }
}
