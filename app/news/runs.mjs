// data\news-run.json：每个主题上次跑到什么时候（lastRuns）和那次出了几条（delivered）。
// 排期（app/news/schedule.mjs）和生成（app/news/runner.mjs）都往这一个文件里写，
// 写的时候把对方写的那几项留着，别把对方的那份抹掉。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// 读整个文件：
//   lastRuns  —— { 主题id: 时刻 }（排期用：这个主题上次跑到什么时候）
//   delivered —— { 主题id: { time, count } }（交出来的：那次出了几条）
export function readRuns(file) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { lastRuns: {}, delivered: {} }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { lastRuns: {}, delivered: {} }
  const source = raw.lastRuns && typeof raw.lastRuns === 'object' ? raw.lastRuns : raw
  const lastRuns = {}
  for (const [id, value] of Object.entries(source)) {
    const stamp = Number(value)
    if (Number.isFinite(stamp)) lastRuns[id] = stamp
  }
  const delivered = {}
  for (const [id, value] of Object.entries(raw.delivered && typeof raw.delivered === 'object' ? raw.delivered : {})) {
    if (!value || typeof value !== 'object') continue
    const time = Number(value.time)
    if (!Number.isFinite(time)) continue
    const count = Number(value.count)
    delivered[id] = { time, count: Number.isFinite(count) ? count : 0 }
  }
  return { lastRuns, delivered }
}

// 写整个文件：把给的这两项写进去，文件里别的键留着。
export function writeRuns(file, patch = {}) {
  const current = readRuns(file)
  const lastRuns = { ...current.lastRuns, ...(patch.lastRuns || {}) }
  const delivered = { ...current.delivered, ...(patch.delivered || {}) }
  const body = `${JSON.stringify({ version: 1, lastRuns, delivered }, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
  return { lastRuns, delivered }
}

// 记一次跑：某个主题跑到什么时候
export function markRan(file, id, at) {
  return writeRuns(file, { lastRuns: { [String(id)]: at } })
}

// 记一次交出来的结果：那个主题那次出了几条
export function markDelivered(file, id, time, count) {
  return writeRuns(file, { delivered: { [String(id)]: { time, count } } })
}
