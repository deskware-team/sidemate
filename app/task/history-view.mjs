// 历史界面这头的纯逻辑：下拉列哪几条、当前那一条、整页的行怎么拼、筛选参数、空状态那句话。
// 按天分组和时间标签也归这里（history.mjs 转手再导出去）：history.mjs 引着 node:fs，
// 渲染进程引不了它；这个文件什么都不引，两边都能用。

import { t } from '../copy/copy.mjs'
import { errorText } from './codes.mjs'

// 下拉里最多列最近这么多条
export const DROPDOWN_MAX = 8

// 同一天的两个时间戳算同一天
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

// 往回数一天
function yesterdayOf(d) {
  const y = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  y.setDate(y.getDate() - 1)
  return y
}

// 日期标签：今天、昨天、MM-DD，跨年的写 YYYY-MM-DD
function dayLabel(d, now) {
  if (sameDay(d, now)) return t('history.today')
  if (sameDay(d, yesterdayOf(now))) return t('history.yesterday')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}-${mo}-${day}`
  }
  return `${mo}-${day}`
}

// 时间和日期凑成 MM-DD HH:mm
function stampLabel(d) {
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mo}-${day} ${h}:${mi}`
}

// 把一堆摘要按天分组，组和组内都从新到旧；坏的条目、没时间的跳过不炸
export function groupByDay(items, now = Date.now()) {
  const nowDate = new Date(now)
  const list = (Array.isArray(items) ? items : []).filter((one) => one && typeof one === 'object' && Number.isFinite(Number(one.updatedAt)))
  list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const groups = []
  const index = new Map()
  for (const item of list) {
    const label = dayLabel(new Date(item.updatedAt), nowDate)
    if (!index.has(label)) {
      const group = { label, items: [] }
      index.set(label, group)
      groups.push(group)
    }
    index.get(label).items.push(item)
  }
  groups.sort((a, b) => (Number(b.items[0].updatedAt) || 0) - (Number(a.items[0].updatedAt) || 0))
  return groups
}

// 界面上显示的时间：今天的只写 HH:mm，别的写 MM-DD HH:mm
export function timeLabel(at, now = Date.now()) {
  const d = new Date(at)
  const nowDate = new Date(now)
  if (sameDay(d, nowDate)) {
    const h = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${h}:${mi}`
  }
  return stampLabel(d)
}

// 下拉要列的行：最新最多 DROPDOWN_MAX 条，按天分组；当前那条带记号、行里写好时间
export function dropdownGroups(items, currentId, now = Date.now()) {
  const all = (Array.isArray(items) ? items : [])
    .filter((one) => one && typeof one === 'object' && Number.isFinite(Number(one.updatedAt)))
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const picked = all.slice(0, DROPDOWN_MAX)
  return groupByDay(picked, now).map((group) => ({
    label: group.label,
    rows: group.items.map((one) => ({
      id: String(one?.id ?? ''),
      title: String(one?.title ?? ''),
      time: timeLabel(Number(one?.updatedAt) || 0, now),
      status: markerStatus(one),
      now: one?.id === currentId,
    })),
  }))
}

// 每条对话现在的状态：id → 'running'（在跑）、'unread'（在后台跑完了、还没回来看）、''（没有）
// rows 是每条对话的样子：{ id, running, shown }。在眼前看着的算看过，不算 unread。
export function statusMap(rows) {
  const out = {}
  for (const one of Array.isArray(rows) ? rows : []) {
    const id = String(one?.id ?? '')
    if (!id) continue
    if (one?.running === true) out[id] = 'running'
    else if (one?.shown !== true) out[id] = 'unread'
    else out[id] = ''
  }
  return out
}

// 状态签名变了没有：变了才重新要一遍列表（每个字都来一次太吵）
export function statusChanged(prev, next) {
  return String(prev ?? '') !== String(next ?? '')
}

// 标记长什么样：在跑的是个转圈，在后台跑完还没看的是个绿点，其余没有
export function markerOf(status) {
  if (status === 'running') return { cls: 'run', label: t('history.statusRunning') }
  if (status === 'unread') return { cls: 'unread', label: t('history.statusUnread') }
  return null
}

// 「全部对话」页的行：右边任务写文件夹和时间两截（页面隔开摆，中间不用「·」），新闻订阅写「N 条」
export function pageGroups(items, now = Date.now()) {
  return groupByDay(Array.isArray(items) ? items : [], now).map((group) => ({
    label: group.label,
    rows: group.items.map((one) => ({
      id: String(one?.id ?? ''),
      title: String(one?.title ?? ''),
      status: markerStatus(one),
      meta: one?.kind === 'news'
        ? [newsMeta(one, now)]
        : [one?.folderName ? String(one.folderName) : '', timeLabel(Number(one?.updatedAt) || 0, now)].filter(Boolean),
    })),
  }))
}

// 行里的状态标记：只认 running 和 unread，别的当没有
function markerStatus(one) {
  const status = String(one?.status ?? '')
  return status === 'running' || status === 'unread' ? status : ''
}

// 新闻订阅那行右边写什么：数得出条数就写「N 条」，数不出来就写时间，不拿消息条数糊弄。
function newsMeta(one, now) {
  const raw = one?.count
  const count = raw === null || raw === undefined ? NaN : Number(raw)
  if (Number.isInteger(count) && count > 0) return t('history.count', { count })
  return timeLabel(Number(one?.updatedAt) || 0, now)
}

// 拿列表用的参数：输入框的尾巴去掉，不认的类型都当不限
// 搜索已经能匹配文件夹名（见 history.mjs 的 matchQuery），不用再按文件夹筛
export function listParams({ query = '', kind = '' } = {}) {
  return {
    query: String(query ?? '').trim(),
    kind: kind === 'task' || kind === 'news' ? kind : null,
  }
}

// 空状态那句话：筛新闻订阅空着是一句，其余没找到是一句
export function emptyText({ query = '', kind = '' } = {}) {
  if (kind === 'news' && !String(query ?? '').trim()) return t('history.emptyNews')
  return t('history.emptyNone')
}

// 打不开一条对话时给用户看的那句：对方说了原因就用它的，没说就说「打不开这条对话」（带 Si902 码）
export function openFailedText(message) {
  const one = typeof message === 'string' ? message.trim() : ''
  return one || errorText('Si902')
}
