// 早报两个入口的纯逻辑：右键「新闻订阅」菜单怎么搭、日子怎么写、一份早报有几条、
// 哪些还没看，都在这里算好。不引 electron，node --test 直接测。
// 主题存取在 ./topics.mjs（issueDates、loadTopics），生成在 ./runner.mjs，
// 壳那头的接线在 ../pet/news.mjs。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { t } from '../copy/copy.mjs'

// 合法日期的样子：YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// 早报 .md 里一条选题的标题行：整行一对粗体
const ITEM_LINE = /^\*\*.+\*\*$/
// 「新闻订阅」里每个主题最多列最近这几天
export const MENU_DAYS = 7

function isDate(text) {
  return DATE_RE.test(String(text ?? ''))
}

// 两个日期差几天（later - earlier），跨月跨年也对；不合法给 NaN
function dayGap(earlier, later) {
  const from = Date.parse(`${earlier}T00:00:00Z`)
  const to = Date.parse(`${later}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN
  return Math.round((to - from) / 86_400_000)
}

// 菜单里那一天怎么写：今天 11-11 · 昨天 11-10 · 11-09
export function dayLabel(date, today) {
  const gap = dayGap(String(date ?? ''), String(today ?? ''))
  const tail = String(date ?? '').slice(5)
  if (gap === 0) return t('newsMenu.today', { date: tail })
  if (gap === 1) return t('newsMenu.yesterday', { date: tail })
  return tail
}

// 数一份早报 .md 里「今天」「进展」两节的条目：一条就是一行整行粗体的标题（全部对话页新闻那行写「N 条」）。
// 两节都没有（比如「今天这个主题没有新动静」那份）就算数不出来，给 null，那行改写时间。
export function countPaperItems(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  let seen = false
  let inSection = false
  let count = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      inSection = line === '## 今天' || line === '## 进展'
      if (inSection) seen = true
      continue
    }
    if (inSection && ITEM_LINE.test(line)) count += 1
  }
  return seen ? count : null
}

// ——————————————— 已读（程序数据目录 data\news-read.json） ———————————————

// { [主题id]: 最后看过的日期 }。文件缺了、坏了、形状不对，都当什么都没看过。
export function readNewsRead(file) {
  let raw = null
  try {
    raw = JSON.parse(readFileSync(String(file ?? ''), 'utf8'))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const read = {}
  for (const [id, date] of Object.entries(raw)) {
    if (id && isDate(date)) read[id] = String(date)
  }
  return read
}

// 看过一份：那个主题的「最后看过」推到那一天。写不上也不拦着，只是红点下次还会亮。
export function markNewsRead(file, topicId, date) {
  const read = readNewsRead(file)
  if (!topicId || !isDate(date)) return read
  read[topicId] = String(date)
  try {
    mkdirSync(dirname(String(file ?? '')), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, `${JSON.stringify(read, null, 2)}\n`, 'utf8')
    renameSync(temp, file)
  } catch { /* 存不上就算了 */ }
  return read
}

// ——————————————— 未读 ———————————————

// 一个主题有没有没看的早报：期号（从新到旧）里有比「最后看过」新的，返回那份的日期；都看过了给空。
export function unreadDate(dates, readDate) {
  const seen = isDate(readDate) ? String(readDate) : ''
  const list = (Array.isArray(dates) ? dates : []).filter(isDate).sort().reverse()
  return list.find((date) => date > seen) ?? null
}

// 哪些主题有没看的早报：[{ topicId, name, date }]，没看到的日期从新到旧。
export function unreadTopics({ topics, datesOf, read = {} }) {
  const readMap = read && typeof read === 'object' ? read : {}
  const out = []
  for (const topic of Array.isArray(topics) ? topics : []) {
    if (!topic || !topic.id) continue
    const dates = typeof datesOf === 'function' ? datesOf(topic) : []
    const date = unreadDate(dates, readMap[topic.id])
    if (date) out.push({ topicId: topic.id, name: topic.name || topic.id, date })
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

// ——————————————— 菜单 ———————————————

// 「新闻订阅」子菜单的模板：一个主题一项，有没看的后面标「● 新」；主题里再按天选（只写日子，不写条数），
// 点了开那一天的早报对话；每个主题子菜单最后都能去管订阅。
//   topics —— 主题清单（loadTopics 的结果）
//   datesOf(topic) —— 那个主题出过哪些期（issueDates，从新到旧）
//   missedOf(topic) —— 那个主题错过的那几天（到点时桌伴没开着）
//   read —— 新闻-已读.json 读出来的
//   onOpenIssue(topicId, date) / onManage() —— 点了干什么，由壳接上
export function newsMenuTemplate({ topics, datesOf, missedOf, read = {}, today = '', onOpenIssue, onManage } = {}) {
  const open = typeof onOpenIssue === 'function' ? onOpenIssue : () => {}
  const manage = typeof onManage === 'function' ? onManage : () => {}
  const list = (Array.isArray(topics) ? topics : []).filter((topic) => topic && topic.id)
  // 一个主题都没有：只有「加一个主题…」，点了去设置的「新闻」页
  if (!list.length) return [{ label: t('newsMenu.addTopic'), click: manage }]
  const readMap = read && typeof read === 'object' ? read : {}
  return list.map((topic) => {
    const dates = (typeof datesOf === 'function' ? datesOf(topic) : []).filter(isDate)
    // 错过的那几天也在列表里：那几天写明「未生成：桌伴未运行」
    const missed = (typeof missedOf === 'function' ? missedOf(topic) : []).filter(isDate)
    const all = [...new Set([...dates, ...missed])].sort().reverse()
    const days = all.slice(0, MENU_DAYS).map((date) => {
      // 只是错过、没生成的那天：灰的、不能点（点了也没有东西可开）。
      if (missed.includes(date) && !dates.includes(date)) {
        return {
          label: `${dayLabel(date, today)} ${t('newsMenu.missed')}`,
          enabled: false,
        }
      }
      return { label: dayLabel(date, today), click: () => open(topic.id, date) }
    })
    // 一份都还没有的主题：子菜单里一项灰的「还没有新闻」，后面照旧能去管订阅
    const submenu = days.length ? days : [{ label: t('newsMenu.empty'), enabled: false }]
    submenu.push({ type: 'separator' }, { label: t('newsMenu.manage'), click: manage })
    return {
      label: unreadDate(dates, readMap[topic.id]) ? `${topic.name} ${t('newsMenu.flag')}` : topic.name,
      submenu,
    }
  })
}
