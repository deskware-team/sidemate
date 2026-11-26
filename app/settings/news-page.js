// 「新闻」页的动作：每张卡的一句话、频率、时间、开关、删除、立即生成、看看，都走主进程，回来重画这一页。
// 界面在 ./news-view.js。主进程那边一有变化（开始生成、排队、跑完、名字起好了）就推 settings:news-changed，
// 这里收到就重新要一遍这一页，所以关掉设置窗再打开、切到别的页再回来，「正在生成」都还在。

import { t } from '../copy/copy.mjs'
import { openAskDialog } from './ask-view.js'
import { adoptNewCard, focusCard, NEW_CARD, newsFormValues, newsMessage, renderNews, renderNewsPrefs } from './news-view.js'

let newsData = { topics: [], canAdd: true, notice: '', ready: false, readyHint: '', prefs: { notify: true, permission: 'deny' } }
// 页面上那张还没存的空卡（点了「＋ 加一个主题」，那句话还没写）
let adding = false

function draw() {
  renderNews(newsData, handlers, adding)
  renderNewsPrefs(newsData.prefs, prefsHandlers)
}

// 那句话停笔 600ms 再存，别打断打字；失焦和频率、时间、开关都是马上存。每张卡各记各的
const WANT_SAVE_DELAY = 600
const saveTimers = new Map()

function scheduleSave(id) {
  clearTimeout(saveTimers.get(id))
  saveTimers.set(id, setTimeout(() => { saveTimers.delete(id); saveNow(id) }, WANT_SAVE_DELAY))
}

// 同一张卡的存一个接一个排着，免得空卡连存两次建出两项
const chains = new Map()

function saveNow(id) {
  clearTimeout(saveTimers.get(id))
  saveTimers.delete(id)
  const prev = chains.get(id) || Promise.resolve()
  const next = prev.then(() => saveCard(id))
  chains.set(id, next.catch(() => {}))
  return next
}

// 存一张卡：连着那张卡上现在写的一起存，别把刚打的字落下。空卡写了那句话才建成真的一项
async function saveCard(id) {
  const card = adopted.get(id) || id
  const values = newsFormValues(card)
  if (card === NEW_CARD && !values.want.trim()) return null
  try {
    const back = await window.settings.newsSave(card === NEW_CARD ? values : { id: card, ...values })
    if (!back || back.ok !== true) {
      newsMessage(back?.message || t('newsPage.failed'))
      return back
    }
    if (card === NEW_CARD && back.savedId) {
      // 空卡建成了：节点挪到新 id 名下，后面这张卡都按新 id 存
      adoptNewCard(back.savedId)
      adopted.set(NEW_CARD, back.savedId)
      adding = false
    }
    newsMessage('')
    newsData = { ...newsData, ...back }
    draw()
    return back
  } catch {
    newsMessage(t('newsPage.failed'))
    return null
  }
}

// 空卡建成以后还在路上的那几次存（停笔计时器、失焦）要按新 id 存
const adopted = new Map()

export async function refreshNews() {
  const view = await window.settings.newsList()
  if (view) newsData = { ...newsData, ...view }
  draw()
}

const handlers = {
  onAdd() {
    if (adding || newsData.canAdd === false) return
    adopted.delete(NEW_CARD)
    adding = true
    draw()
    focusCard(NEW_CARD)
  },
  onWantInput(id) {
    scheduleSave(id)
  },
  // 名字改好了：存这张卡（名字在 newsFormValues 里）
  onName(id) {
    saveNow(id)
  },
  onWantBlur(id) {
    saveNow(id)
  },
  onDays(id) {
    saveNow(id)
  },
  onAt(id) {
    saveNow(id)
  },
  async onRemove(id, name) {
    // 还没存的空卡：直接拿掉，不用问
    if (id === NEW_CARD) {
      adding = false
      draw()
      return
    }
    if (!await openAskDialog({ text: t('newsPage.removeAsk', { name }), ok: t('common.delete'), cancel: t('common.cancel'), danger: true })) return
    const back = await window.settings.newsRemove(id)
    if (back) newsData = { ...newsData, ...back }
    draw()
  },
  async onToggleEnabled(id, on) {
    if (id === NEW_CARD) return
    const back = await window.settings.newsToggle(id, on === true)
    if (back) newsData = { ...newsData, ...back }
    draw()
  },
  async onGenerate(id) {
    // 刚打的字可能还没落盘：先存一份（空卡这一下才拿到 id），存不上（比如超长）就不生成
    const back = await saveNow(id)
    const real = id === NEW_CARD ? adopted.get(NEW_CARD) : id
    if (!real || (back && back.ok === false)) return
    newsMessage('')
    const view = await window.settings.newsGenerate(real)
    if (view) newsData = { ...newsData, ...view }
    draw()
  },
  onLook(id) {
    const topic = (newsData.topics || []).find((one) => one.id === id)
    if (topic) window.settings.newsLook(id, topic.date)
  },
}

// 整页的那两项设置：好了说不说、后台能不能跑命令改文件
const prefsHandlers = {
  onToggle(key, on) {
    if (key === 'permission') {
      window.settings.newsPermission(on === true).then((back) => {
        if (back) newsData = { ...newsData, ...back }
        draw()
      })
      return
    }
    const prefs = { ...(newsData.prefs || {}), [key]: on === true }
    window.settings.newsSavePrefs(prefs).then((back) => {
      newsData = { ...newsData, prefs: { ...prefs, ...((back && back.prefs) || {}), permission: newsData.prefs?.permission } }
      renderNewsPrefs(newsData.prefs, prefsHandlers)
    })
  },
}

export async function initNews() {
  // 主进程推过来：重新要一遍这一页；跑完那次带着结果——成了写那句交代，没成写在那张卡的状态行
  window.settings.onNewsChanged?.(async (payload) => {
    await refreshNews()
    if (!payload || !payload.id) return
    if (payload.ok === true) newsMessage(String(payload.message || ''))
    else if (payload.message) markFailed(payload.id, String(payload.message))
  })
  await refreshNews()
}

// 生成失败：那张卡的状态行写红字（下一次重画会换回平时那句）
function markFailed(id, message) {
  newsData = {
    ...newsData,
    topics: (newsData.topics || []).map((one) => (one.id === id ? { ...one, status: { text: message, tone: 'bad' } } : one)),
  }
  draw()
}
