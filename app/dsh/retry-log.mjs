// 桌伴读 dsh 那边写的重试播报文件：一行一条 JSON。
// 从上次读到的地方接着读（记着读到第几个字节），所以哪一条都不会漏。
// dsh 那边写一行就是一次重试，桌伴照着出等待行（第几次、等几秒）；
// 最后那次失败也是一行（kind 是 failure）：dsh 的码、HTTP 状态、原文。

import { closeSync, openSync, readSync, statSync } from 'node:fs'

// 起了个尾巴就一直看着那个文件；stop() 停。
export function createRetryTail(path, onLine, intervalMs = 120) {
  let offset = 0
  let rest = ''
  let stopped = false

  const read = () => {
    if (stopped) return
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      return // 还没写出来：等下一轮
    }
    if (size <= offset) return
    const buffer = Buffer.alloc(size - offset)
    let fd
    try {
      fd = openSync(path, 'r')
      readSync(fd, buffer, 0, buffer.length, offset)
    } catch {
      return // 读不动：等下一轮
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    offset += buffer.length
    // 一次读到的不一定是一整行：半行留着，下一轮接着拼
    const text = rest + buffer.toString('utf8')
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
    },
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
