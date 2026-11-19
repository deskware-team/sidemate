// 错过的那些天：到点的时候桌伴没开着，那一次就没有新闻。
// 记在主题那一层：<news>/<主题id>/missed.json，内容是那些天的日期（YYYY-MM-DD）。
// 纯 node 模块，不引 electron，node --test 直接测。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { topicDir } from './topics.mjs'

// 记着错过的那几天的文件
const FILE_NAME = 'missed.json'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isDate(text) {
  return DATE_RE.test(String(text ?? ''))
}

// 记着错过的那几天的文件：<news>/<主题id>/missed.json
export function missedFile(root, topic) {
  return join(topicDir(root, topic), FILE_NAME)
}

// 读错过的那些天（从新到旧）：文件没有或者坏了就是空的
export function missedDates(root, topic) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(missedFile(root, topic), 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(raw?.dates) ? raw.dates : []
  return [...new Set(list.filter(isDate))].sort().reverse()
}

// 记一天错过：已经记过的不重复记，返回记完的清单
export function markMissed(root, topic, date) {
  const day = String(date ?? '').trim()
  if (!isDate(day)) return missedDates(root, topic)
  const list = missedDates(root, topic)
  if (list.includes(day)) return list
  const next = [day, ...list].sort().reverse()
  const file = missedFile(root, topic)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify({ version: 1, dates: next }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
  return next
}

// 某一天是不是记着错过
export function isMissed(root, topic, date) {
  return missedDates(root, topic).includes(String(date ?? '').trim())
}
