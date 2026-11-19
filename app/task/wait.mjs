// 等模型重试：等待行、倒数，这一摊事的纯函数都在这儿（主进程和页面都能用，不引 electron）。
// 字都在 app/copy：等待行是状态码 St301 / St306，停工那句在 errors.mjs。

import { around, t } from '../copy/copy.mjs'

// 等待行是哪一条：按错的种类分——
// 忙 St301、服务出错 St303、模型一直不回 St304、连接断了 St305。
// 不念厂商名。
const waitKey = (options) => {
  const kind = String(options?.kind || '')
  if (kind === 'server') return 'St303'
  if (kind === 'noreply') return 'St304'
  if (kind === 'network') return 'St305'
  return 'St301'
}

// 倒数那一截：还有几秒自动重试；到 0 是「重新连接中」
const afterOf = (left) => (left > 0 ? t('St301.after', { left }) : t('St306'))

// 等待行的头一截（「模型忙，」「模型服务出错，」「模型连接中断，」）：跟任务窗那行同一条，小岛悬停那行接在倒数前面
export function waitHead(kind) {
  return around(waitKey({ kind }), 'after')[0]
}

// 等待行：头 + 还有几秒 + 第几次 + 最多几次
export function waitLine(seconds, retry, max, options = {}) {
  const left = Math.max(0, Math.floor(Number(seconds) || 0))
  const nth = Math.max(1, Math.floor(Number(retry) || 1))
  const cap = Math.max(1, Math.floor(Number(max) || 1))
  return t(waitKey(options), { after: afterOf(left), nth, max: cap })
}

// 倒数的秒数：到点就是 0
export function secondsLeft(until, now = Date.now()) {
  const at = Number(until) || 0
  if (!at) return 0
  return Math.max(0, Math.ceil((at - now) / 1000))
}

// 等待行：还有几秒、第几次、最多几次；until 是倒数到头的时刻。
// head/tail 拆出来给页面用：中间的秒数自己倒数，尾巴上写第几次、最多几次。
export function waitInfo(delayMs, retry, max, now = Date.now(), options = {}) {
  const ms = Math.max(0, Number(delayMs) || 0)
  const seconds = Math.round(ms / 1000)
  const nth = Math.max(1, Number(retry) || 1)
  const cap = Math.max(1, Number(max) || 1)
  const kind = String(options?.kind || '')
  const [head, tail] = around(waitKey(options), 'after', { nth, max: cap })
  return {
    text: waitLine(seconds, nth, cap, options),
    head,
    tail,
    // 这一行没有倒数那截（超时那句就是「正在重新连接」）：不给倒数
    until: tail ? now + ms : 0,
    retry: nth,
    max: cap,
    kind,
  }
}

// 等待行上的倒数：「60 秒后自动重试」。数到 0 就说「重新连接中」，不留「0 秒后自动重试」。
export function countdownText(until, now = Date.now()) {
  return afterOf(secondsLeft(until, now))
}

// 一次「模型忙、dsh 要重试」的事件：算出这一轮等待行。
export function retryWait(event, now = Date.now(), options = {}) {
  return waitInfo(event?.delayMs, event?.retry, event?.maxRetries, now, {
    kind: event?.kind || options.kind || '',
  })
}
