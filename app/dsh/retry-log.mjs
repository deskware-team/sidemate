// 桌伴读 dsh 那边写的重试播报文件：一行一条 JSON。
// 从上次读到的地方接着读（记着读到第几个字节），所以哪一条都不会漏。
// dsh 那边写一行就是一次重试，桌伴照着出等待行（第几次、等几秒）；
// 最后那次失败也是一行（kind 是 failure）：dsh 的码、HTTP 状态、原文。

import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

// 起了个尾巴就一直看着那个文件；stop() 停。
// 文件一出现就打开一次、一直开着，之后每轮只问这个句柄有多大、从上次的位置接着读。
// 不按路径反复 stat / open / close：dsh 那头一直在往这个文件里写，Windows 上按路径打开、
// 查一个正在被写的文件会被杀毒软件拦下来扫，主进程实测卡过 300ms（逐字流每来一条消息都要读一把）。
export function createRetryTail(path, onLine, intervalMs = 120) {
  let offset = 0
  let rest = ''
  let stopped = false
  let fd

  const read = () => {
    if (stopped) return
    if (fd === undefined) {
      try {
        fd = openSync(path, 'r')
      } catch {
        return // 还没写出来：等下一轮
      }
    }
    let size = 0
    try {
      size = fstatSync(fd).size
    } catch {
      return // 查不动：等下一轮
    }
    if (size <= offset) return
    const buffer = Buffer.alloc(size - offset)
    let got = 0
    try {
      got = readSync(fd, buffer, 0, buffer.length, offset)
    } catch {
      return // 读不动：等下一轮
    }
    if (got <= 0) return
    offset += got
    // 一次读到的不一定是一整行：半行留着，下一轮接着拼
    const text = rest + buffer.subarray(0, got).toString('utf8')
    const lines = text.split('\n')
    rest = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      onLine(line)
    }
  }

  const timer = setInterval(read, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* 关不掉就算了 */ }
        fd = undefined
      }
    },
    // 现在就读一把：不等下一个 Interval（要按顺序先于某条消息处理时用）
    poll: read,
  }
}

// 读播报文件、出重试事件：这一段整个搬在这儿（app/dsh/index.mjs 只管接着用）。
// 一行 JSON 出一回事件：种类、第几次、最多几次、等几秒。
// 最后那次失败那一行：kind 是 failure，带 dsh 的码、HTTP 状态、原文。
// 一个 dsh 进程上跑好几个会话，所以每一行还带着会话号（sessionId），桌伴按会话分开。
// 不是 JSON 的、半行的、没有种类的都跳过：等下一条，别把一轮带崩。
export function createRetryWatcher({ path, onEvent, intervalMs = 120 } = {}) {
  return createRetryTail(path, (line) => {
    let info
    try {
      info = JSON.parse(line)
    } catch {
      return // 不是一行完整的 JSON：跳过
    }
    const kind = String(info?.kind || '')
    if (!kind) return
    if (kind === 'failure') {
      onEvent({
        kind,
        sessionId: String(info?.sessionId || ''),
        code: String(info?.code || ''),
        status: Number(info?.status) || 0,
        detail: String(info?.detail || ''),
      })
      return
    }
    onEvent({
      kind,
      sessionId: String(info?.sessionId || ''),
      code: String(info?.code || ''),
      retry: Number(info.retry) || 0,
      maxRetries: Number(info.maxRetries) || 0,
      delayMs: Number(info.delayMs) || 0,
      detail: String(info?.detail || ''),
    })
  }, intervalMs)
}
