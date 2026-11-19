// 跑了多久：一段毫秒 → 「14 秒」「1 分 34 秒」。小岛悬停那行用。
// 纯函数，主进程和页面都能用。字在 app/copy/status.mjs（elapsed、St101、St104）。

import { t } from '../copy/copy.mjs'

// 静下来以后「还需要更长时间」「等待模型响应」多久换一次
export const SWAP_MS = 30_000

export function elapsedText(ms) {
  const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return min ? t('elapsed.min', { min, sec: rest }) : t('elapsed', { sec: rest })
}

// 静下来以后的状态：从静下来那一刻（at）起，「还需要更长时间」「等待模型响应」每 30 秒换一次
export function quietLabel(at, now = Date.now()) {
  const turn = Math.floor(Math.max(0, now - (Number(at) || now)) / SWAP_MS)
  return turn % 2 === 0 ? t('St104') : t('St101')
}
