// 新闻入口在壳这头的接线：右键和托盘的「新闻订阅」菜单、小岛红点要的「有没有没看的」，
// 都从这里现读现算。纯逻辑在 ../news/entry.mjs，这里只碰盘（主题、期号、已读），
// 不引 electron，node --test 直接测；开对话、开设置页这些动作由壳的回调接上。

import { join } from 'node:path'

import { markNewsRead, newsMenuTemplate, readNewsRead, unreadTopics } from '../news/entry.mjs'
import { issueNameOf } from '../news/issue-name.mjs'
import { missedDates } from '../news/missed.mjs'
import { issueDates, loadTopics } from '../news/topics.mjs'
import { runningOf } from '../news/status.mjs'
import { dataPaths } from '../paths.mjs'

// 红点该不该亮：有没看的早报、且用户手头没在干活。
// 正在干活的先等（hold），活干完壳会再问一遍，那时才亮。
export function newsDotOf({ pending, busy }) {
  return { dot: pending === true && busy !== true, hold: pending === true && busy === true }
}

// deps：
//   root / topicsFile —— 主题清单（news.json）和已读记录（data\news-read.json）的路径（字符串或 () => 字符串）
//   low —— 新闻目录（news\），期号都在这下面；不传就用 root
export function createNewsEntry({ root, low, topicsFile } = {}) {
  const rootOf = () => (typeof root === 'function' ? root() : String(root ?? ''))
  const lowOf = () => (low === undefined || low === null ? rootOf() : (typeof low === 'function' ? low() : String(low ?? '')))
  const fileOf = () => (typeof topicsFile === 'function' ? topicsFile() : String(topicsFile ?? ''))
  const read = () => readNewsRead(dataPaths(rootOf()).newsRead)
  // 生成成功时 runner 会把那份对话的编号带回来（另一张卡在接）；先记下，点开就不用再翻
  const historyIds = new Map()
  const keyOf = (topicId, date) => `${topicId}/${date}`
  const topics = () => loadTopics(fileOf())
  const datesOf = (topic) => issueDates(lowOf(), topic)
  const unreadList = () => unreadTopics({ topics: topics(), datesOf, read: read() })

  return {
    // 「新闻订阅」子菜单：菜单弹出来那一刻现算（主题、期号、未读都可能刚变过）
    menu({ today, onOpenIssue, onManage } = {}) {
      return newsMenuTemplate({
        topics: topics(),
        datesOf,
        // 错过的那几天：到点时桌伴没开着，那几天写明「未生成：桌伴未运行」
        missedOf: (topic) => missedDates(lowOf(), topic),
        // 那几期生成时的名字（订阅后来改过名的话跟现在不一样）：读那一期文件夹里的标题
        nameOf: (topic, date) => issueNameOf(lowOf(), topic, date),
        read: read(),
        today,
        onOpenIssue,
        onManage,
        // 正在生成的那一项：名字后面写「生成中」
        busyId: runningOf()?.topicId || '',
      })
    },
    // 有没看的早报的主题，从新到旧
    unread: unreadList,
    hasUnread: () => unreadList().length > 0,
    // 最新一份没看的：红点亮着的时候，点一下小岛就开它
    latest() {
      const one = unreadList()[0]
      return one ? { ...one, historyId: historyIds.get(keyOf(one.topicId, one.date)) || '' } : null
    },
    // 菜单里点的那一天
    issueOf(topicId, date) {
      const topic = topics().find((item) => item.id === topicId)
      if (!topic || !date) return null
      return { topicId, name: topic.name, date, historyId: historyIds.get(keyOf(topicId, date)) || '' }
    },
    // 生成好了：记下那份对话的编号（有就记）
    onGenerated({ topicId, date, historyId } = {}) {
      if (topicId && date && historyId) historyIds.set(keyOf(topicId, date), String(historyId))
    },
    // 看过了：那个主题的「最后看过」推到那一天
    markRead(topicId, date) {
      markNewsRead(dataPaths(rootOf()).newsRead, topicId, date)
    },
  }
}
