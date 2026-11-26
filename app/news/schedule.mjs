import { readRuns, writeRuns } from './runs.mjs'
import { markMissed, missedDates } from './missed.mjs'
import { todayString } from './topics.mjs'

// 迟到的十分钟以内还算数（到点时桌伴开着就跑）；超过就不跑，记「未生成」。
export const CATCHUP_MS = 10 * 60 * 1000
// 往回记错过的天数上限：最多记七天前那些天。
export const MISSED_MAX_DAYS = 7

// 日子只能是 YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isDate(text) {
  return DATE_RE.test(String(text ?? ''))
}

// 主题的时间点只能是 'HH:mm'，别的写法当作没有时间点。
function parseAt(at) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// 本地时间里 dayOffset 天后的那个时间点。
function occurrence(at, stamp, dayOffset = 0) {
  const date = new Date(stamp)
  date.setHours(at.hour, at.minute, 0, 0)
  if (dayOffset !== 0) date.setDate(date.getDate() + dayOffset)
  return date.getTime()
}

// 这天跑不跑：每天、只有周一到周五、只有周一。
export function dayAllowed(days, date) {
  const kind = String(days ?? '').trim()
  if (kind === 'weekdays') {
    const week = date.getDay()
    return week >= 1 && week <= 5
  }
  if (kind === 'monday') return date.getDay() === 1
  return true
}

// 最近一次该跑的时刻：只算允许的日子，从今天往回找，最多找七天。
export function lastAllowedRun(topic, now = Date.now()) {
  const at = parseAt(topic?.at)
  if (!at) return null
  for (let back = 0; back <= 7; back += 1) {
    const date = new Date(now)
    date.setDate(date.getDate() - back)
    if (!dayAllowed(topic?.days, date)) continue
    const stamp = occurrence(at, date)
    if (stamp <= now) return stamp
  }
  return null
}

// 现在该跑哪些主题：每个主题最多一条，按时间从早到晚排。
// late 是「迟到得超过了十分钟」：到点时桌伴没开着，那一次就不跑了。
export function dueRuns(topics, lastRuns = {}, now = Date.now()) {
  const result = []
  for (const topic of topics ?? []) {
    if (!topic?.id) continue
    if (topic.enabled === false) continue
    const at = parseAt(topic.at)
    if (!at) continue
    const today = new Date(now)
    today.setHours(at.hour, at.minute, 0, 0)
    // 今天不是允许的日子，这个主题今天不动。
    const todayAllowed = dayAllowed(topic.days, today)
    const last = Number(lastRuns?.[topic.id])
    let dueAt = null
    if (Number.isFinite(last)) {
      // 最近一个已经过去的应跑时刻，只在允许的日子里找。
      const candidate = lastAllowedRun(topic, now)
      if (candidate !== null && candidate > last && candidate <= now) dueAt = candidate
    } else if (todayAllowed && today.getTime() <= now) {
      // 从没跑过的主题只从今天算，不补前几天。
      dueAt = today.getTime()
    }
    if (dueAt === null) continue
    // fresh：这个主题还没跑过（刚加的）。加的时候今天的时间点早过了，那一次不算错过
    result.push({ topicId: topic.id, dueAt, date: todayString(new Date(dueAt)), late: now - dueAt >= CATCHUP_MS, fresh: !Number.isFinite(last) })
  }
  result.sort((a, b) => a.dueAt - b.dueAt)
  return result
}

// 该跑却没跑的那些天：上次跑过之后、到现在之间，允许的日子里的每个时间点。
// 迟到十分钟以内的还能跑（不算错过）；已经记过的也不再记。
// 从没跑过的主题不算错过：它今天到点的那一次由 dueRuns 说。
// known 是按主题分的已记清单：{ 主题id: [日期, …] }。
export function missedRuns(topics, lastRuns = {}, now = Date.now(), known = {}) {
  const knownMap = known && typeof known === 'object' && !Array.isArray(known) ? known : {}
  const result = []
  for (const topic of topics ?? []) {
    if (!topic?.id) continue
    if (topic.enabled === false) continue
    const at = parseAt(topic.at)
    if (!at) continue
    // 每个主题一份已记清单：一个主题记过某天，不影响另一个主题。
    const seen = new Set((Array.isArray(knownMap[topic.id]) ? knownMap[topic.id] : []).filter(isDate))
    const last = Number(lastRuns?.[topic.id])
    if (!Number.isFinite(last)) continue
    for (let back = 0; back < MISSED_MAX_DAYS; back += 1) {
      const day = new Date(now)
      day.setDate(day.getDate() - back)
      if (!dayAllowed(topic.days, day)) continue
      const stamp = occurrence(at, day)
      if (stamp > now) continue
      if (stamp <= last) continue
      if (now - stamp < CATCHUP_MS) continue
      const date = todayString(day)
      if (seen.has(date)) continue
      seen.add(date)
      result.push({ topicId: topic.id, date, dueAt: stamp })
    }
  }
  result.sort((a, b) => a.dueAt - b.dueAt)
  return result
}

function readState(file) {
  return readRuns(file).lastRuns
}

function writeState(file, runs) {
  writeRuns(file, { lastRuns: runs })
}

function resolveTopics(source) {
  if (typeof source === 'function') return source() ?? []
  return source ?? []
}

// 新闻后台：到点跑一份，错过的不补跑——记一条「未生成：桌伴未运行」。
// root 是新闻目录：错过的那些天记在主题那一层（app/news/missed.mjs）。
export function createScheduler({ file, now = Date.now, run, topics = [], root = '' } = {}) {
  let running = false

  function markRan(topicId, at = now()) {
    const runs = readState(file)
    runs[String(topicId)] = at
    writeState(file, runs)
    return runs
  }

  // 某个主题错过的那些天
  const missedOf = (topic) => (root ? missedDates(root, topic) : [])

  // 记下错过的那一天
  function recordMissed(topic, date) {
    if (!root || !topic) return
    try {
      markMissed(root, topic, date)
    } catch { /* 记不上就算了 */ }
  }

  async function tick(topicList) {
    // 同一时间只跑一份。
    if (running) return 'busy'
    const stamp = now()
    const list = resolveTopics(topicList ?? topics)
    const runs = readState(file)
    // 该跑却没跑的（桌伴没开着）：记下来，不补跑。
    // 已记的错过日子按主题分开：主题 A 记过 11-17 不影响主题 B 也记 11-17。
    const known = {}
    for (const one of list) {
      if (!one || !one.id) continue
      known[one.id] = missedOf(one)
    }
    for (const one of missedRuns(list, runs, stamp, known)) {
      const topic = list.find((item) => item && item.id === one.topicId)
      recordMissed(topic, one.date)
    }
    const due = dueRuns(list, readState(file), stamp)
    if (due.length === 0) return 'idle'
    const first = due[0]
    const topic = list.find((item) => item && item.id === first.topicId)
    // 刚加的主题、今天的时间点早过了：主题那会儿还不在，不算错过；从下一个时间点起算
    if (first.late && first.fresh) {
      markRan(first.topicId, first.dueAt)
      return 'idle'
    }
    // 迟到超过十分钟：那次不跑，记「未生成」。
    if (first.late) {
      recordMissed(topic, first.date)
      markRan(first.topicId, first.dueAt)
      return 'missed'
    }
    // 已经记成错过的那一次：不跑，只把记号往前推。
    if (missedOf(topic).includes(first.date)) {
      markRan(first.topicId, first.dueAt)
      return 'missed'
    }
    running = true
    try {
      await run(first.topicId, { dueAt: first.dueAt })
    } catch {
      // 失败也算今天跑过：不自己再重跑，等下一个时间点；要马上再试就点「现在生成」
      markRan(first.topicId, stamp)
      return 'failed'
    } finally {
      running = false
    }
    markRan(first.topicId, stamp)
    return 'ran'
  }

  return {
    file,
    tick,
    markRan,
    // 错过的那些天：{ 主题 id: [日期, …] }
    missed() {
      const list = resolveTopics(topics)
      const out = {}
      for (const topic of list) {
        if (!topic || !topic.id) continue
        const dates = missedOf(topic)
        if (dates.length) out[topic.id] = dates
      }
      return out
    },
    lastRuns() {
      return readState(file)
    },
  }
}
