// 用量统计：从 dsh 的会话投影缓存里读 token 数，等这一轮的 turn/end 之后的那份。
// 单独一个文件：读缓存这摊事跟起进程（dsh/index.mjs）分开放。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 用量文件和边界是同一时刻的快照：tokenUsage 是数，turnBoundary 说这份是不是这一轮 turn/end 之后写的。
export function readTokenUsage(dshHome, sessionId) {
  const path = join(dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const rows = parsed.record?.rows ?? parsed.rows
    if (!rows) return undefined
    return { token: rows.tokenUsage?.val, boundary: rows.turnBoundary?.val }
  } catch {
    return undefined
  }
}

// 跟上了 = turn/end 之后写的那份：openTurnStartSeq 归空，且轮号已经过了起点。
export function usageCaughtUp(rows, startTurn) {
  const boundary = rows?.boundary
  return Boolean(boundary) && boundary.openTurnStartSeq === null && (boundary.lastTurn ?? 0) > startTurn
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
