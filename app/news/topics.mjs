// 新闻主题存取：主题怎么写、存哪、报过的怎么记。
// 纯 node 模块，不带界面，也不负责抓内容——找链接在 links.mjs，排期在 schedule.mjs。

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { normalizeNewsLink } from './links.mjs'
import { t } from '../copy/copy.mjs'

// 主题名要当文件夹用，这些字符不能出现。
const NAME_BAD_CHARS = /[/\\:*?"<>|]/
// 默认的时间点。
export const DEFAULT_AT = '08:00'
// 主题隔几天跑一次：每天、工作日（周一到周五）、每周一。
export const DAYS = ['daily', 'weekdays', 'monday']
export const DEFAULT_DAYS = 'daily'
// 这个主题后台生成时自动配置的权限：拒绝（deny，默认）/ 允许（allow，会话切成完全访问）。
export const PERMISSIONS = ['deny', 'allow']
export const DEFAULT_PERMISSION = 'deny'
// 整个新闻页的设置：错过要不要补、好了要不要说一声。
export const DEFAULT_PREFS = { catchUp: true, notify: true }
// 排好的那一页叫这个名字，就放在当天的日期目录里；接着问时给模型指的也是它。
export const PAPER_FILE = t('report.file')
// 「报过的」只留最近 90 天。
export const REPORTED_KEEP_DAYS = 90

// 名字里的字符能不能当路径用。
function validNameChars(name) {
  return !NAME_BAD_CHARS.test(name)
}

// 字符个数（中文按一个字算）。
function charLength(text) {
  return Array.from(String(text ?? '')).length
}

// 主题 id：从名字里取出能用的部分，取不出就拿时间戳。
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 造一个没被占用的 id。
export function makeTopicId(name, taken = []) {
  const used = new Set(Array.isArray(taken) ? taken : [])
  let base = slugify(name).slice(0, 34)
  if (!base) base = Date.now().toString(36)
  let id = `t-${base}`
  let n = 2
  while (used.has(id)) {
    id = `t-${base}-${n}`
    n += 1
  }
  return id
}

// 是不是合法的时间点写法。
function validAt(at) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim())
  if (!match) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

// 隔几天跑一次：缺省按每天，写错的原样留着，交给校验去拦。
function normalizeDays(days) {
  if (days === undefined || days === null || days === '') return DEFAULT_DAYS
  return String(days)
}

// 补齐缺省字段。空缺的东西按默认来。
export function normalizeTopic(topic) {
  const src = topic && typeof topic === 'object' ? topic : {}
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  const want = typeof src.want === 'string' ? src.want.trim() : ''
  const at = validAt(src.at) ? String(src.at).trim() : DEFAULT_AT
  return {
    id: typeof src.id === 'string' && src.id.trim() ? src.id.trim() : '',
    name,
    want,
    at,
    days: normalizeDays(src.days),
    // 权限只有两个：拒绝、允许；别的写法都当拒绝
    permission: src.permission === 'allow' ? 'allow' : DEFAULT_PERMISSION,
    enabled: src.enabled !== false,
    createdAt: typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : new Date().toISOString(),
  }
}

// 校验一个主题，返回中文错误数组，空数组就是没问题。
// others 是同一份清单里的其他主题，用来挡同名。
export function validateTopic(topic, others = []) {
  const errors = []
  if (!topic || typeof topic !== 'object') return [t('newsDialog.badIncomplete')]

  const name = typeof topic.name === 'string' ? topic.name.trim() : ''
  if (charLength(name) < 1 || charLength(name) > 16) errors.push(t('newsDialog.badName'))
  if (!validNameChars(name)) errors.push(t('newsDialog.badNameChars'))

  const want = typeof topic.want === 'string' ? topic.want.trim() : ''
  if (charLength(want) < 1 || charLength(want) > 200) errors.push(t('newsDialog.badWant'))

  // 没填的时间和格式按默认算，填错了才报错。
  const at = topic.at === undefined || topic.at === null || topic.at === '' ? DEFAULT_AT : topic.at
  if (!validAt(at)) errors.push(t('newsDialog.badTime'))

  // 隔几天跑一次只能是每天、工作日或每周一。
  const days = topic.days === undefined || topic.days === null || topic.days === '' ? DEFAULT_DAYS : topic.days
  if (!DAYS.includes(days)) errors.push(t('newsDialog.badDays'))

  const list = Array.isArray(others) ? others : []
  if (name && list.some((other) => other && other !== topic && String(other.name ?? '').trim() === name)) {
    errors.push(t('newsDialog.badDuplicate'))
  }

  return [...new Set(errors)]
}

// 读主题清单：文件缺了或坏了就当空的。
export function loadTopics(file) {
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(raw?.topics) ? raw.topics : []
  return list.filter((item) => item && typeof item === 'object').map(normalizeTopic)
}

// 读文件里已经有的 prefs：存主题的时候别把它弄丢了。
function readPrefs(file) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const prefs = raw.prefs
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null
  return prefs
}

// 整页的设置：缺省是错过补一份、好了说一声。
export function normalizePrefs(prefs) {
  const src = prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {}
  return {
    catchUp: src.catchUp === undefined ? DEFAULT_PREFS.catchUp : src.catchUp !== false,
    notify: src.notify === undefined ? DEFAULT_PREFS.notify : src.notify !== false,
  }
}

// 读新闻页的设置：文件缺了或坏了就按默认来。
export function loadNewsPrefs(file) {
  return normalizePrefs(readPrefs(file))
}

// 存新闻页的设置：跟主题清单放在同一个文件里，主题不动。
export function saveNewsPrefs(file, prefs) {
  const next = normalizePrefs(prefs)
  const list = loadTopics(file)
  mkdirSync(dirname(file), { recursive: true })
  const body = `${JSON.stringify({ version: 1, topics: list, prefs: next }, null, 2)}\n`
  const temp = `${file}.tmp`
  writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
  return { ok: true, prefs: next, errors: [] }
}

// 存主题清单：先写临时文件再改名顶上。文件里已有的 prefs 留着。
export function saveTopics(file, topics) {
  const list = Array.isArray(topics) ? topics.filter((item) => item && typeof item === 'object') : []
  const prefs = readPrefs(file)
  const body = `${JSON.stringify({ version: 1, topics: list, ...(prefs ? { prefs } : {}) }, null, 2)}\n`
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
}

// 删一个主题：清单里没有就不动。
export function removeTopic(list, id) {
  const base = Array.isArray(list) ? list : []
  const found = base.some((item) => item && item.id === id)
  if (!found) return { ok: false, list: base, errors: [t('stops.newsTopic')] }
  return { ok: true, list: base.filter((item) => !item || item.id !== id), errors: [] }
}

// —————————————————————————————— 路径 ——————————————————————————————
// 主题自己那一套放在程序数据目录的 news\ 下，按主题 id 分文件夹，文件夹里按日期分每一期：
// <news>\<主题id>\<YYYY-MM-DD>
// 这里的 root 就是 news 那个目录（app/paths.mjs 里的 paths.news）。

// 主题的目录：<news>/<主题id>
export function topicDir(root, topic) {
  const id = typeof topic === 'string' ? topic.trim() : String(topic?.id ?? '').trim()
  return join(String(root ?? ''), id)
}

// 某一天的那一期：<news>/<主题id>/<YYYY-MM-DD>
export function issueDir(root, topic, date) {
  return join(topicDir(root, topic), String(date ?? '').trim())
}

// 「报过的」文件：<news>/<主题id>/reported.md
export function reportedFile(root, topic) {
  return join(topicDir(root, topic), 'reported.md')
}

// 已经出过几期：从新到旧，只认 YYYY-MM-DD 名字的文件夹。
export function issueDates(low, topic) {
  let entries
  try {
    entries = readdirSync(topicDir(low, topic), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && isDate(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
}

// —————————————————————————————— 报过的 ——————————————————————————————

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isDate(text) {
  if (!DATE_PATTERN.test(String(text ?? ''))) return false
  const stamp = Date.parse(`${text}T00:00:00Z`)
  return Number.isFinite(stamp)
}

// 今天的日期，写成 YYYY-MM-DD。
export function todayString(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 链接里的跟踪参数（utm_*）不比：同一个链接带不带它算同一个。
function stripTracking(url) {
  try {
    const parsed = new URL(url)
    const kept = []
    for (const [key, value] of parsed.searchParams) {
      if (/^utm_/i.test(key)) continue
      kept.push([key, value])
    }
    parsed.search = ''
    for (const [key, value] of kept) parsed.searchParams.append(key, value)
    return parsed.toString()
  } catch {
    return url
  }
}

// 一条记录用什么当去重的钥匙：优先链接，其次标题。
function itemKey(item) {
  const link = normalizeNewsLink(item?.url)
  if (link) return stripTracking(link)
  const title = String(item?.title ?? '').trim().toLowerCase()
  return title ? `title:${title}` : ''
}

// 读「报过的」：[{ title, url, date }]，文件没有就是空数组。
export function readReported(root, topic) {
  let raw
  try {
    raw = readFileSync(reportedFile(root, topic), 'utf8')
  } catch {
    return []
  }
  const items = []
  let date = ''
  for (const line of String(raw).split(/\r?\n/)) {
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim())
    if (heading) {
      date = heading[1]
      continue
    }
    const entry = /^\s*-\s+\[(.+)\]\((.+)\)\s*$/.exec(line)
    if (!entry) continue
    items.push({ title: entry[1].trim(), url: entry[2].trim(), date })
  }
  return items
}

// 记一批报过的：按链接去重，按日期分节写回文件，只留最近 90 天。
export function appendReported(root, topic, items, date) {
  const day = isDate(date) ? String(date).trim() : todayString()
  const existing = readReported(root, topic)
  const seen = new Set()
  const merged = []

  for (const item of existing) {
    const key = itemKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push({ title: item.title, url: item.url, date: isDate(item.date) ? item.date : day })
  }
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue
    const key = itemKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push({ title: String(item.title ?? '').trim(), url: String(item.url ?? '').trim(), date: day })
  }

  // 只留最近 90 天：以最新的一天为基准往前数。
  const newest = merged.reduce((acc, item) => (item.date > acc ? item.date : acc), day)
  const limit = Date.parse(`${newest}T00:00:00Z`) - REPORTED_KEEP_DAYS * 24 * 60 * 60 * 1000
  const kept = merged.filter((item) => Date.parse(`${item.date}T00:00:00Z`) >= limit)

  const sections = new Map()
  for (const item of kept) {
    if (!sections.has(item.date)) sections.set(item.date, [])
    sections.get(item.date).push(item)
  }
  const dates = [...sections.keys()].sort().reverse()

  const lines = ['# Reported', '']
  for (const one of dates) {
    lines.push(`## ${one}`, '')
    for (const item of sections.get(one)) {
      lines.push(`- [${item.title}](${item.url})`)
    }
    lines.push('')
  }

  const file = reportedFile(root, topic)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
  return kept
}
