// 「新闻」页的纯逻辑：每个主题怎么存、名字怎么来、页面显示什么、哪些按钮该灰。
// 不引 electron，node --test 直接测。存储走 app/news/topics.mjs 的规矩：news.json 里是主题清单，
// 最多 MAX_TOPICS 个；每项的「想看什么」就是卡片上那一句话。页面只记「想看什么」「什么时候」，
// 不记来源：模型自己决定用什么工具去找。
// 名字是自动总结的（只显示不能改）：先用本地规则（app/news/name.mjs），后台问模型要个更好的，
// 回来用 renameTopic 换上（nameOf 记着起名时那句话，那句话再变就又按本地规则先顶上）。

import { statSync } from 'node:fs'
import { join } from 'node:path'

import { appPaths, appRoot, dataPaths } from '../paths.mjs'
import { isMissed } from '../news/missed.mjs'
import { dayAllowed } from '../news/schedule.mjs'
import { readRuns } from '../news/runs.mjs'
import { statusOf } from '../news/status.mjs'
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
  saveNewsPrefs as savePrefsFile,
  saveTopics,
  todayString,
  validateTopic,
} from '../news/topics.mjs'
import { newsReady } from '../news/ready.mjs'
import { cleanUserName, localName } from '../news/name.mjs'
import { t } from '../copy/copy.mjs'
import { errorLineText } from '../copy/line.mjs'

// 主题清单放在程序数据目录里：news.json（跟 model.json 一样在根目录下）
export const NEWS_FILE_NAME = 'news.json'
// 最多订几个主题
export const MAX_TOPICS = 5

// 存不上：这一类只有这一句、这一个码（Si907）
const SAVE_FAILED_LINE = errorLineText(t('stops.saveFailed'), 'Si907')

// 主题清单的路径：跟 modelFiles() 同一个根目录，这里自己拼，不改 files.mjs
export function newsFile(root = appRoot()) {
  return appPaths(root).newsTopics
}

// 卡片里状态行那几句
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

// 用了多久：一分钟以内「40 秒」，再长「1 分 20 秒」
export function elapsedText(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? t('newsPage.elapsedMin', { m, s }) : t('newsPage.elapsedSec', { s })
}

// 这个主题的名字要不要问模型：写了那句话、名字不是照这句话起的，而且名字不是用户自己改的
export function needsName(topic) {
  const want = String(topic?.want ?? '').trim()
  if (!want) return false
  if (String(topic?.nameBy ?? '') === 'user') return false
  return String(topic?.nameOf ?? '').trim() !== want
}

// —————————————————————————————— 存取 ——————————————————————————————

// 读清单：文件缺了或坏了就当空的
export function loadNews(file) {
  return loadTopics(file)
}

// 读整页的设置：好了说不说
export function loadNewsPrefs(file) {
  return loadPrefsFile(file)
}

// 存整页的设置：跟主题清单放在同一个文件里，主题不动
export function saveNewsPrefs(file, prefs) {
  return savePrefsFile(file, normalizePrefs(prefs))
}

// 整页那个权限开关现在是开是关：有主题就看主题上的（开关一拨会写到每一个主题上；
// 0.4 测试版和 0.3 升上来的只写在主题上），一个主题都没有就看整页设置里记的
export function pagePermission(list, prefs) {
  const topics = (Array.isArray(list) ? list : []).filter(Boolean)
  if (topics.length) return topics.some((topic) => topic.permission === 'allow') ? 'allow' : DEFAULT_PERMISSION
  return prefs?.permission === 'allow' ? 'allow' : DEFAULT_PERMISSION
}

// 写盘：写不上统一回那一句（Si907）
function write(file, next, list, extra = {}) {
  try {
    saveTopics(file, next)
  } catch {
    return { ok: false, message: SAVE_FAILED_LINE, errors: [SAVE_FAILED_LINE], list }
  }
  return { ok: true, message: '', errors: [], list: next, ...extra }
}

// 存一张卡：form = { id?, want, days, at, name? }。有 id 改那一项；没有 id 就新建一项（那句话空着不建）。
// 想写的东西不对就拦下来不写盘。改了那句话：名字按本地规则先顶上（normalizeTopic 管），模型的名字后台再换。
// 名字：带 name 就是用户自己改的（清空了就是不要这个名字，回到自动）；不带 name 就是这次没动名字。
export function saveNewsForm(file, form = {}) {
  const list = loadTopics(file)
  const id = String(form.id ?? '').trim()
  const current = id ? list.find((topic) => topic && topic.id === id) || null : null
  if (id && !current) return { ok: false, message: t('stops.newsTopic'), errors: [t('stops.newsTopic')], list }
  const want = form.want !== undefined ? String(form.want).trim() : String(current?.want ?? '').trim()
  const days = DAYS.includes(form.days) ? form.days : (current?.days ?? DEFAULT_DAYS)
  const at = parseAt(form.at) ? String(form.at).trim() : (current?.at ?? DEFAULT_AT)
  // 用户写的名字：去掉不能当路径用的字符，最多 8 个字。清空了就是回到自动（nameOf 清掉，模型再问一次）。
  const written = form.name !== undefined ? cleanUserName(form.name) : ''
  const named = form.name === undefined
    ? {}
    : (written ? { name: written, nameBy: 'user', nameOf: '' } : { nameBy: 'auto', nameOf: '' })

  if (!current) {
    // 新建：空卡不存（页面上那张空卡只在页面里，写了那句话才落盘）
    if (!want) return { ok: false, message: t('newsPage.wantEmpty'), errors: [t('newsPage.wantEmpty')], list }
    if (list.length >= MAX_TOPICS) return { ok: false, message: t('newsPage.addMax'), errors: [t('newsPage.addMax')], list }
    const topic = normalizeTopic({
      want,
      at,
      days,
      // 新加的主题跟整页的权限开关一致
      permission: pagePermission(list, loadNewsPrefs(file)),
      enabled: true,
      createdAt: new Date().toISOString(),
      ...named,
    })
    const errors = validateTopic(topic)
    if (errors.length > 0) return { ok: false, message: errors[0], errors, list }
    const withId = { ...topic, id: makeTopicId(topic.name, list.map((one) => one?.id).filter(Boolean)) }
    return write(file, [...list, withId], list, { topic: withId })
  }

  // 改一项：那句话清空了就存成关着的（整份开关和「立即生成」都灰，要开先写那一句）
  const candidate = normalizeTopic({
    ...current,
    want,
    days,
    at,
    enabled: want ? (form.enabled !== undefined ? form.enabled !== false : (current.want ? current.enabled !== false : true)) : false,
    ...named,
  })
  const errors = want ? validateTopic(candidate) : []
  if (errors.length > 0) return { ok: false, message: errors[0], errors, list }
  const next = list.map((topic) => (topic && topic.id === id ? candidate : topic))
  return write(file, next, list, { topic: candidate })
}

// 删一项：只删订阅，已经生成的那几期不动
export function removeNewsTopic(file, id) {
  const list = loadTopics(file)
  const key = String(id ?? '').trim()
  if (!list.some((topic) => topic && topic.id === key)) {
    return { ok: false, message: t('stops.newsTopic'), errors: [t('stops.newsTopic')], list }
  }
  return write(file, list.filter((topic) => topic && topic.id !== key), list)
}

// 一份的开关：只改 enabled，不动别的（那句话空着的存不进「开」）
export function setNewsEnabled(file, id, enabled) {
  const list = loadTopics(file)
  const key = String(id ?? '').trim()
  if (!list.some((topic) => topic && topic.id === key)) {
    return { ok: false, message: t('stops.newsTopic'), errors: [t('stops.newsTopic')], list }
  }
  const next = list.map((topic) => (
    topic && topic.id === key
      ? { ...topic, enabled: enabled === true && String(topic.want ?? '').trim() !== '' }
      : topic
  ))
  return write(file, next, list)
}

// 权限开关：整页一个——写到每一个主题上，也记进整页设置（新加的主题跟它一致）
export function setNewsPermission(file, allowed) {
  const permission = allowed === true ? 'allow' : DEFAULT_PERMISSION
  try {
    savePrefsFile(file, { ...loadNewsPrefs(file), permission })
  } catch {
    return { ok: false, message: SAVE_FAILED_LINE, errors: [SAVE_FAILED_LINE], list: loadTopics(file) }
  }
  const list = loadTopics(file)
  return write(file, list.map((topic) => ({ ...topic, permission })), list)
}

// 名字换成模型给的那个：只在那句话还是起名时那句的时候换（问的路上用户又改了就不换）
export function renameTopic(file, id, name, want) {
  const list = loadTopics(file)
  const key = String(id ?? '').trim()
  const text = String(name ?? '').trim()
  const asked = String(want ?? '').trim()
  const topic = list.find((one) => one && one.id === key)
  if (!text || !topic || topic.want !== asked) return { ok: false, list }
  // 用户自己改过的名字：模型不覆盖
  if (topic.nameBy === 'user') return { ok: false, list }
  const next = list.map((one) => (one && one.id === key ? { ...one, name: text, nameOf: asked } : one))
  return write(file, next, list)
}

// —————————————————————————————— 状态行 ——————————————————————————————

// 今天这一份在不在：看新闻目录里 <主题id>/<今天> 有没有 新闻.md，有就把文件时间记下来；
// 那次出了几条记在 news-run.json 的 delivered 里（今天的才算）
export function statusFacts(low, topic, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(Number(options.now ?? Date.now()))
  const date = todayString(now)
  let newest = 0
  try {
    const info = statSync(join(issueDir(low, topic, date), t('report.file')))
    if (info.isFile()) newest = info.mtimeMs
  } catch { /* 今天那份还没有 */ }
  const record = options.delivered?.[topic?.id]
  const count = record && todayString(new Date(Number(record.time))) === date ? Number(record.count) || 0 : 0
  if (newest > 0) return { hasFile: true, fileTime: newest, ranToday: true, count }
  // 文件没有，但后台记着今天跑过：也是没交出来
  const last = Number(options.runs?.[topic?.id])
  const ranToday = Number.isFinite(last) && todayString(new Date(last)) === date
  return { hasFile: false, fileTime: 0, ranToday, count: 0 }
}

// 状态行那一句：正在生成 / 排队中 / 今天交了 / 还没到点 / 今天不生成 / 今天没交出来
export function todayStatus(topic, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(Number(options.now ?? Date.now()))
  if (options.run?.state === 'running') {
    return { text: t('newsPage.running', { time: elapsedText(now.getTime() - Number(options.run.at)) }), tone: 'busy' }
  }
  if (options.run?.state === 'queued') return { text: t('newsPage.queued'), tone: 'busy' }
  const at = parseAt(topic?.at)
  if (!at) return { text: '', tone: '' }
  // 今天有新闻那份：写了交上的时刻（到点时错过了、后来点「立即生成」补上的也算交了）；知道几条就带上
  if (options.hasFile === true) {
    const clock = clockText(options.fileTime)
    const time = clock ? ` ${clock}` : ''
    if (Number(options.count) > 0) return { text: t('newsPage.deliveredCount', { time, count: Number(options.count) }), tone: 'ok' }
    return { text: t('newsPage.delivered', { time }), tone: 'ok' }
  }
  // 今天这一份记着错过：到点时桌伴没开着
  if (options.missed === true) return { text: t('newsPage.notRun'), tone: '' }
  // 今天不是这份新闻的日子：今天不动它
  if (!dayAllowed(topic?.days, now)) return { text: STATUS_NOT_TODAY, tone: '' }
  // 时间点还没到
  const stamp = new Date(now.getTime())
  stamp.setHours(at.hour, at.minute, 0, 0)
  if (now.getTime() < stamp.getTime()) return { text: STATUS_NOT_YET, tone: '' }
  // 到点了，文件却没有：没交出来
  return { text: STATUS_MISSED, tone: '' }
}

// —————————————————————————————— 整页 ——————————————————————————————

// 整页的数据：topics 是每张卡（按清单里的先后，也就是建立的先后），外加整页那几样。
// low 是新闻目录（期号在那下面），不传就用真那份（程序数据目录下的 news\）。
// status(id) 给某个主题现在在不在生成（不传就问 app/news/status.mjs）。
export function newsView(file, options = {}) {
  const list = loadTopics(file)
  const low = options.low ?? appPaths().news
  const now = options.now ?? Date.now()
  const runs = options.runs ?? readRuns(dataPaths().newsRun)
  const status = typeof options.status === 'function' ? options.status : statusOf
  const topics = []
  for (const topic of list) {
    if (!topic || !topic.id) continue
    const facts = statusFacts(low, topic, { now, runs: runs.lastRuns, delivered: runs.delivered })
    const missed = isMissed(low, topic, todayString(new Date(Number(now))))
    const run = status(topic.id)
    topics.push({
      id: topic.id,
      name: topic.name || t('newsPage.newName'),
      // 自动起的那个名字：输入框清空时占位用
      autoName: localName(topic.want),
      want: topic.want,
      at: topic.at,
      days: DAYS.includes(topic.days) ? topic.days : DEFAULT_DAYS,
      enabled: topic.enabled !== false && Boolean(topic.want),
      wantEmpty: !String(topic.want ?? '').trim(),
      status: todayStatus(topic, { now, ...facts, missed, run }),
      // 正在生成 / 排队中：「立即生成」灰着写「生成中…」；since 给页面自己每秒走表
      running: run?.state === 'running',
      queued: run?.state === 'queued',
      since: run?.state === 'running' ? Number(run.at) || 0 : 0,
      // 今天那份在：状态行右边出「看看」
      look: facts.hasFile === true && !run,
      date: todayString(new Date(Number(now))),
    })
  }
  // 能不能订：模型能联网搜才成——只认 DeepSeek 自带的联网搜索。规则跟生成那头同一份。
  const ready = newsReady({ hasSearchKey: options.hasKey === true })
  return {
    topics,
    canAdd: topics.length < MAX_TOPICS,
    max: MAX_TOPICS,
    // 没有 DeepSeek 密钥、也没有开着的搜索工具：页面上方提醒一句
    notice: options.hasKey === true || options.hasSearchTool === true ? '' : t('newsPage.noSearch'),
    hasKey: options.hasKey === true,
    hasSearchTool: options.hasSearchTool === true,
    ready: ready.ok,
    readyHint: ready.ok ? '' : ready.text,
    prefs: { ...normalizePrefs(loadNewsPrefs(file)), permission: pagePermission(list, loadNewsPrefs(file)) },
  }
}
