// 「新闻」页的纯逻辑：主题清单放在哪、每行显示什么、弹窗表单跟主题对象怎么换、哪些按钮该灰。
// 不引 electron，node --test 直接测。主题怎么存走 app/news/topics.mjs 的规矩，不另造一套。
// 主题只记「想看什么」「什么时候」，不记来源：模型自己决定用什么工具去找。

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { appPaths, appRoot, dataPaths } from '../paths.mjs'
import { isMissed } from '../news/missed.mjs'
import { dayAllowed } from '../news/schedule.mjs'
import {
  DAYS,
  DEFAULT_AT,
  DEFAULT_DAYS,
  DEFAULT_PERMISSION,
  issueDir,
  loadNewsPrefs as loadPrefsFile,
  loadTopics,
  makeTopicId,
  normalizePrefs,
  normalizeTopic,
  removeTopic,
  saveNewsPrefs as savePrefsFile,
  saveTopics,
  todayString,
  validateTopic,
} from '../news/topics.mjs'
import { newsReady } from '../news/ready.mjs'
import { t } from '../copy/copy.mjs'
import { errorLineText } from '../copy/line.mjs'

// 主题清单放在程序数据目录里：news.json（跟 model.json 一样在根目录下）
export const NEWS_FILE_NAME = 'news.json'

// 没主题时列表里那一句话
export const EMPTY_TEXT = t('newsPage.empty')

// 存不上：这一类只有这一句、这一个码（Si907）
const SAVE_FAILED_LINE = errorLineText(t('stops.saveFailed'), 'Si907')

// 主题清单的路径：跟 modelFiles() 同一个根目录，这里自己拼，不改 files.mjs
export function newsFile(root = appRoot()) {
  return appPaths(root).newsTopics
}

// 后台上次跑的时间记在这个文件里（程序数据目录 data\ 下）
export const RUN_FILE_NAME = 'news-run.json'

// 每行第二行末尾那几句状态
export const STATUS_NOT_YET = t('newsPage.notYet')
export const STATUS_NOT_TODAY = t('newsPage.notToday')
export const STATUS_MISSED = t('newsPage.missed')

// 时间点只认 'HH:mm'，别的写法当作没有
function parseAt(at) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// 一个时刻写成 HH:mm
export function clockText(stamp) {
  const date = stamp instanceof Date ? stamp : new Date(Number(stamp))
  if (!Number.isFinite(date.getTime())) return ''
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

// 读后台上次跑的时间：{ 主题 id: 时间戳 }；文件没有或者坏了就是空的
export function readRuns(file) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const source = raw.lastRuns && typeof raw.lastRuns === 'object' ? raw.lastRuns : raw
  const result = {}
  for (const [id, value] of Object.entries(source)) {
    const stamp = Number(value)
    if (Number.isFinite(stamp)) result[id] = stamp
  }
  return result
}

// 今天这一份在不在：看桌伴数据目录里 新闻/<主题id>/<今天> 有没有 新闻.md，有就把文件时间记下来
export function statusFacts(low, topic, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(Number(options.now ?? Date.now()))
  const date = todayString(now)
  let newest = 0
  try {
    const info = statSync(join(issueDir(low, topic, date), t('report.file')))
    if (info.isFile()) newest = info.mtimeMs
  } catch { /* 今天那份还没有 */ }
  if (newest > 0) return { hasFile: true, fileTime: newest, ranToday: true }
  // 文件没有，但后台记着今天跑过：也是没交出来
  const last = Number(options.runs?.[topic?.id])
  const ranToday = Number.isFinite(last) && todayString(new Date(last)) === date
  return { hasFile: false, fileTime: 0, ranToday }
}

// 每行第二行末尾那一句状态：今天交了 / 还没到点 / 今天不生成 / 今天没交出来
export function todayStatus(topic, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(Number(options.now ?? Date.now()))
  const at = parseAt(topic?.at)
  if (!at) return { text: '', tone: '' }
  // 今天有新闻那份：写了交上的时刻（到点时错过了、后来点「立即生成」补上的也算交了）
  if (options.hasFile === true) {
    const time = clockText(options.fileTime)
    return { text: time ? t('newsPage.delivered', { time: time ? ` ${time}` : '' }) : t('newsPage.delivered', { time: '' }), tone: 'ok' }
  }
  // 今天这一份记着错过：到点时桌伴没开着
  if (options.missed === true) return { text: t('newsPage.notRun'), tone: '' }
  // 今天不是这个主题的日子：今天不动它
  if (!dayAllowed(topic?.days, now)) return { text: STATUS_NOT_TODAY, tone: '' }
  // 时间点还没到
  const stamp = new Date(now.getTime())
  stamp.setHours(at.hour, at.minute, 0, 0)
  if (now.getTime() < stamp.getTime()) return { text: STATUS_NOT_YET, tone: '' }
  // 到点了，文件却没有：没交出来
  return { text: STATUS_MISSED, tone: '' }
}

// 隔几天跑一次写成一句话
export function daysText(days) {
  const kind = DAYS.includes(days) ? days : DEFAULT_DAYS
  if (kind === 'weekdays') return t('newsDialog.workdays')
  if (kind === 'monday') return t('newsDialog.monday')
  return t('newsDialog.daily')
}

// 时间点写成一句话：8:30 → 「每天 8:30」
export function atText(at, days = DEFAULT_DAYS) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim())
  if (!match) return `${daysText(days)} ${DEFAULT_AT}`
  return `${daysText(days)} ${Number(match[1])}:${match[2]}`
}

// 列表每一行：名字、想看什么、隔几天几点、右边按钮和开关
export function newsRows(topics, options = {}) {
  const list = Array.isArray(topics) ? topics : []
  const statuses = options.statuses && typeof options.statuses === 'object' ? options.statuses : {}
  // 模型不能联网搜时，「现在生成」灰着
  const ready = options.ready === true
  return list
    .filter((topic) => topic && typeof topic === 'object')
    .map((topic) => {
      const days = DAYS.includes(topic.days) ? topic.days : DEFAULT_DAYS
      const when = atText(topic.at, days)
      const want = String(topic.want ?? '')
      const id = String(topic.id ?? '')
      const status = statuses[id] && typeof statuses[id] === 'object' ? statuses[id] : { text: '', tone: '' }
      // 这个主题后台生成时自动配置的权限：拒绝（默认）/ 允许
      const permission = topic.permission === 'allow' ? 'allow' : DEFAULT_PERMISSION
      return {
        id,
        name: String(topic.name ?? ''),
        want,
        at: String(topic.at ?? DEFAULT_AT),
        days,
        atText: when,
        permission,
        permissionText: t(permission === 'allow' ? 'newsPage.permAllow' : 'newsPage.permDeny'),
        // 「每天 8:30，想看什么」：设置里的行不用「· 」隔开
        summary: want ? `${when}，${want}` : when,
        status,
        enabled: topic.enabled !== false,
        form: newsForm(topic),
        buttons: [
          { id: 'now', label: t('newsPage.generate'), disabled: !ready, title: ready ? '' : (options.readyHint || '') },
          { id: 'edit', label: t('common.edit') },
        ],
      }
    })
}

// 失败：这一行第二行末尾用红字写那句话
export function failedRows(rows, topicId, message) {
  const id = String(topicId ?? '')
  return (Array.isArray(rows) ? rows : []).map((row) => (
    String(row?.id) === id
      ? { ...row, status: { text: String(message || t('newsPage.failed')), tone: 'bad' } }
      : row
  ))
}

// 弹窗的表单：新建时是空的，改的时候照主题填进去。
export function newsForm(topic = null) {
  const src = topic && typeof topic === 'object' ? topic : {}
  return {
    id: typeof src.id === 'string' ? src.id.trim() : '',
    name: typeof src.name === 'string' ? src.name : '',
    want: typeof src.want === 'string' ? src.want : '',
    at: typeof src.at === 'string' && src.at.trim() ? src.at.trim() : DEFAULT_AT,
    days: DAYS.includes(src.days) ? src.days : DEFAULT_DAYS,
    permission: src.permission === 'allow' ? 'allow' : DEFAULT_PERMISSION,
    enabled: src.enabled !== false,
  }
}

// 表单换成主题对象：存盘前交给 topics.mjs 的校验。
export function topicFromForm(form) {
  const src = form && typeof form === 'object' ? form : {}
  return {
    id: String(src.id ?? '').trim(),
    name: String(src.name ?? '').trim(),
    want: String(src.want ?? '').trim(),
    at: String(src.at ?? '').trim(),
    days: DAYS.includes(src.days) ? src.days : DEFAULT_DAYS,
    permission: src.permission === 'allow' ? 'allow' : DEFAULT_PERMISSION,
    enabled: src.enabled !== false,
  }
}

// —————————————————————————————— 存取 ——————————————————————————————

// 读清单：文件缺了或坏了就当空的
export function loadNews(file) {
  return loadTopics(file)
}

// 读整页的设置：错过补不补、好了说不说
export function loadNewsPrefs(file) {
  return loadPrefsFile(file)
}

// 存整页的设置：跟主题放在同一个文件里，主题不动
export function saveNewsPrefs(file, prefs) {
  return savePrefsFile(file, prefs)
}

// 整页的数据：行、能不能订、主题个数和整页设置。low 是新闻目录（期号在那下面），
// 不传就用真那份（程序数据目录下的 news\）。
export function newsView(file, options = {}) {
  const list = loadNews(file)
  const low = options.low ?? appPaths().news
  const now = options.now ?? Date.now()
  const runs = options.runs ?? readRuns(dataPaths().newsRun)
  // 每行第二行末尾那一句状态：今天交了没有
  const statuses = {}
  for (const topic of list) {
    if (!topic || !topic.id) continue
    const facts = statusFacts(low, topic, { now, runs })
    // 今天这一份记着错过没有：记着就写「未生成：桌伴未运行」
    const missed = isMissed(low, topic, todayString(now))
    statuses[topic.id] = todayStatus(topic, { now, ...facts, missed })
  }
  // 能不能订：模型能联网搜才成——只认 DeepSeek 自带的联网搜索。规则跟生成那头同一份。
  const ready = newsReady({ hasSearchKey: options.hasKey === true })
  // 没有 DeepSeek 密钥、也没有开着的搜索工具：页面上方提醒一句
  const notice = options.hasKey === true || options.hasSearchTool === true ? '' : t('newsPage.noSearch')
  return {
    rows: newsRows(list, { ready: ready.ok, readyHint: ready.ok ? '' : ready.text, statuses }),
    hasKey: options.hasKey === true,
    hasSearchTool: options.hasSearchTool === true,
    notice,
    ready: ready.ok,
    readyHint: ready.ok ? '' : ready.text,
    count: list.length,
    empty: list.length === 0,
    emptyText: EMPTY_TEXT,
    prefs: normalizePrefs(loadNewsPrefs(file)),
  }
}

// 存一个主题：表单里有 id 就是改，没有就是加。错了不写盘。
export function saveNewsTopic(file, form) {
  const list = loadNews(file)
  const src = form && typeof form === 'object' ? form : {}
  const id = String(src.id ?? '').trim()
  const candidate = topicFromForm(src)
  if (id) {
    const index = list.findIndex((one) => one && one.id === id)
    if (index < 0) {
      return { ok: false, message: t('stops.newsTopic'), errors: [t('stops.newsTopic')], list }
    }
    const others = list.filter((_, i) => i !== index)
    const merged = { ...list[index], ...candidate, id }
    const errors = validateTopic(merged, others)
    if (errors.length > 0) {
      return { ok: false, message: errors[0], errors, list }
    }
    const topic = normalizeTopic(merged)
    const next = list.slice()
    next[index] = topic
    try {
      saveTopics(file, next)
    } catch {
      // 写盘失败：存不上只有这一句、这一个码（Si907）
      return { ok: false, message: SAVE_FAILED_LINE, errors: [SAVE_FAILED_LINE], list }
    }
    return { ok: true, message: '', errors: [], list: next, topic }
  }
  const errors = validateTopic(candidate, list)
  if (errors.length > 0) {
    return { ok: false, message: errors[0], errors, list }
  }
  const taken = list.map((one) => one?.id).filter(Boolean)
  const topic = normalizeTopic({ ...candidate, id: makeTopicId(candidate.name, taken) })
  const next = [...list, topic]
  try {
    saveTopics(file, next)
  } catch {
    return { ok: false, message: SAVE_FAILED_LINE, errors: [SAVE_FAILED_LINE], list }
  }
  return { ok: true, message: '', errors: [], list: next, topic }
}

// 删一个主题：清单里没有就报错。已经生成的那些还在历史里。
export function removeNewsTopic(file, id) {
  const list = loadNews(file)
  const result = removeTopic(list, String(id ?? '').trim())
  if (!result.ok) {
    return { ok: false, message: result.errors[0] || t('stops.newsTopic'), errors: result.errors, list }
  }
  saveTopics(file, result.list)
  return { ok: true, message: '', errors: [], list: result.list }
}

// 开关：只改 enabled，不动别的
export function setNewsEnabled(file, id, enabled) {
  const list = loadNews(file)
  const key = String(id ?? '').trim()
  const found = list.some((topic) => topic && topic.id === key)
  if (!found) {
    return { ok: false, message: t('stops.newsTopic'), errors: [t('stops.newsTopic')], list }
  }
  const next = list.map((topic) => (topic && topic.id === key ? { ...topic, enabled: enabled === true } : topic))
  saveTopics(file, next)
  return { ok: true, message: '', errors: [], list: next }
}
