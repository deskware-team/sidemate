// 「新闻」页的界面：每个主题一张白卡——顶上一行左边名字（自动总结的，能自己改）、右边开关和「删除」；
// 下面一句话、频率和时间、状态行（「看看」「立即生成」）。最下面「＋ 加一个主题」。
// 只管摆界面、收输入；调 IPC 的部分在 page.js。这一页跑在沙箱渲染进程里，引不了带 node 模块的文件，
// 纯逻辑都在主进程那边（app/settings/news.mjs）。

import { t } from '../copy/copy.mjs'
import { cleanUserName, clipUserName } from '../news/name.mjs'

// 还没存过的那张空卡（点了「＋ 加一个主题」、那句话还没写）用这个当 id
export const NEW_CARD = 'new'

// 主题 id → 那张卡上的节点
const cards = new Map()
// 现在画着的数据：主题 id → 那一项（走表时要用 since）
let shown = new Map()
// 正在生成的那张卡状态行每秒走一次
let ticker = null
// 事件交给谁：每次画都换成这次给的（page.js 给的一直是同一个）
let live = {}
let livePrefs = {}

function one(selector) {
  return document.querySelector(selector)
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// 用了多久：一分钟以内「40 秒」，再长「1 分 20 秒」（跟主进程 app/settings/news.mjs 的 elapsedText 一个写法）
function elapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? t('newsPage.elapsedMin', { m, s }) : t('newsPage.elapsedSec', { s })
}

// 卡片下面那行小字（空着那句提示、存不上的话、生成完的交代）
export function newsMessage(text) {
  const box = one('#news-message')
  if (box) box.textContent = text || ''
}

// 画整页：view = { topics, canAdd, notice, ready, readyHint, prefs }；adding 是页面上那张还没存的空卡。
// 事件转给 handlers（由 page.js 给，一直是同一个）。正打着字的输入框不盖。
export function renderNews(view, handlers = {}, adding = false) {
  const safe = view || {}
  live = handlers || {}
  const notice = one('#news-notice')
  if (notice) notice.textContent = String(safe.notice || '')
  const topics = Array.isArray(safe.topics) ? [...safe.topics] : []
  if (adding) topics.push({ id: NEW_CARD, name: t('newsPage.newName'), want: '', at: '08:00', days: 'daily', enabled: false, wantEmpty: true, status: { text: '', tone: '' } })
  shown = new Map(topics.map((topic) => [topic.id, topic]))

  const add = one('#news-add')
  if (add) {
    const full = safe.canAdd === false || adding
    add.disabled = full
    add.setAttribute('title', safe.canAdd === false ? t('newsPage.addMax') : '')
    if (!add.dataset.wired) {
      add.dataset.wired = '1'
      add.addEventListener('click', () => live.onAdd?.())
    }
  }

  const list = one('#news-cards')
  if (!list) return
  for (const [id, card] of [...cards.entries()]) {
    if (!shown.has(id)) {
      card.root.remove()
      cards.delete(id)
    }
  }
  topics.forEach((topic, index) => {
    let card = cards.get(topic.id)
    if (!card) {
      card = buildCard(topic.id)
      cards.set(topic.id, card)
    }
    updateCard(card, topic, safe)
    const at = list.children[index]
    if (at !== card.root) list.insertBefore(card.root, at || null)
  })
  syncTicker()
}

// 那张空卡存成了真的一项：节点挪到新 id 名下（输入框里的字和光标都不动）
export function adoptNewCard(id) {
  const card = cards.get(NEW_CARD)
  if (!card || !id) return
  cards.delete(NEW_CARD)
  card.id = id
  card.root.dataset.id = id
  cards.set(id, card)
}

// 光标放进某张卡的那句话里（新加的空卡）
export function focusCard(id) {
  cards.get(id)?.want.focus()
}

// 某张卡里现在写着的：想看什么、频率、时间、名字（用户改过的才有，没改过是 undefined）
export function newsFormValues(id) {
  const card = cards.get(id)
  if (!card) return { want: '', days: 'daily', at: '08:00' }
  return { want: card.want.value, days: card.days.value, at: card.at.value, name: card.namePending }
}

function buildCard(id) {
  const call = (name, ...args) => live[name]?.(...args)
  const card = { id }
  const root = el('div', 'card news-card')
  root.dataset.id = id

  // 顶上那行：左边名字（点一下能改），右边开关和「删除」
  const head = el('div', 'news-head')
  const name = el('input', 'news-name')
  name.type = 'text'
  name.maxLength = 8
  name.spellcheck = false
  name.title = t('newsPage.nameEdit')
  const side = el('div', 'news-side')
  const remove = el('button', 'link news-remove', t('newsPage.remove'))
  remove.type = 'button'
  const enabledWrap = el('span', 'switch')
  const enabled = el('input')
  enabled.type = 'checkbox'
  enabledWrap.append(enabled, el('span', 'track'))
  side.append(remove, enabledWrap)
  head.append(name, side)

  const want = el('textarea', 'news-want')
  want.rows = 3
  want.spellcheck = false
  want.placeholder = t('newsPage.wantPlaceholder')
  const hint = el('p', 'news-hint', t('newsPage.wantHint'))

  const when = el('div', 'news-when')
  const days = el('select', 'news-days')
  for (const [value, key] of [['daily', 'daily'], ['weekdays', 'workdays'], ['monday', 'monday']]) {
    const option = el('option', '', t(`newsPage.${key}`))
    option.value = value
    days.append(option)
  }
  const at = el('input', 'news-at time')
  at.type = 'text'
  at.spellcheck = false
  when.append(days, at, el('span', 'news-suffix', t('newsPage.atSuffix')))

  const today = el('div', 'news-today')
  const status = el('span', 'news-status')
  const look = el('button', 'btn news-look', t('newsPage.look'))
  look.type = 'button'
  const generate = el('button', 'btn now news-generate', t('newsPage.generate'))
  generate.type = 'button'
  today.append(status, look, generate)

  root.append(head, want, hint, when, el('hr', 'news-inner-line'), today)

  // 事件：id 从 card 上现取（空卡存成真的一项后会换 id）
  const typed = () => want.value.trim() !== ''
  // 名字：打字时收拾干净，回车或失焦就存，Esc 放弃这一次
  name.addEventListener('input', () => {
    card.nameDirty = true
    const clean = clipUserName(name.value)
    if (clean !== name.value) name.value = clean
  })
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commitName(card)
      name.blur?.()
      return
    }
    if (event.key === 'Escape') {
      card.nameDirty = false
      name.value = card.namePending !== undefined ? card.namePending : (card.nameWas ?? '')
    }
  })
  name.addEventListener('blur', () => { if (card.nameDirty) commitName(card) })
  want.addEventListener('input', () => { newsMessage(''); call('onWantInput', card.id) })
  want.addEventListener('blur', () => call('onWantBlur', card.id))
  days.addEventListener('change', () => call('onDays', card.id))
  at.addEventListener('change', () => call('onAt', card.id))
  enabled.addEventListener('change', () => {
    if (enabled.checked && !typed()) {
      // 空着开不了：拨回去，卡片下面写那一句
      enabled.checked = false
      newsMessage(t('newsPage.wantEmpty'))
      return
    }
    call('onToggleEnabled', card.id, enabled.checked)
  })
  remove.addEventListener('click', () => call('onRemove', card.id, name.value))
  generate.addEventListener('click', () => {
    if (!typed()) { newsMessage(t('newsPage.wantEmpty')); return }
    call('onGenerate', card.id)
  })
  look.addEventListener('click', () => call('onLook', card.id))

  return Object.assign(card, { root, name, enabled, enabledWrap, remove, want, days, at, status, look, generate })
}

// 名字存下去：用户写的归用户管；没改过就不用存
function commitName(card) {
  card.nameDirty = false
  const value = cleanUserName(card.name.value)
  card.name.value = value
  if (value === (card.nameWas ?? '')) {
    card.namePending = undefined
    return
  }
  card.namePending = value
  live.onName?.(card.id, value)
}

// 状态行那一句：正在生成的那张自己走表
function statusText(topic) {
  if (topic.running && topic.since) return t('newsPage.running', { time: elapsed(Date.now() - topic.since) })
  return String(topic.status?.text ?? '')
}

function updateCard(card, topic, view) {
  // 名字：用户改过的以他写的为准，没改过的照清单上的来
  const blank = topic.id === NEW_CARD
  const stored = blank ? '' : String(topic.name || t('newsPage.newName'))
  // 清单上的名字变了（存上了，或者模型换了）：以它为准，用户改的那次丢掉
  if (card.namePending !== undefined && stored !== card.nameWas) card.namePending = undefined
  card.nameWas = stored
  const shown = card.namePending !== undefined ? card.namePending : stored
  // 正打着字的那一栏不动：不然光标会跳
  if (document.activeElement !== card.name && card.name.value !== shown) card.name.value = shown
  card.name.placeholder = blank ? t('newsPage.newName') : String(topic.autoName || '')
  const empty = topic.wantEmpty === true
  card.enabled.checked = topic.enabled === true && !empty
  card.enabledWrap.classList.toggle('off', empty)
  // 正打着字的那一栏不动：不然光标会跳
  if (document.activeElement !== card.want && card.want.value !== String(topic.want ?? '')) card.want.value = String(topic.want ?? '')
  if (card.days.value !== topic.days) card.days.value = topic.days || 'daily'
  if (document.activeElement !== card.at && card.at.value !== topic.at) card.at.value = topic.at || '08:00'
  const text = statusText(topic)
  card.status.textContent = text
  card.status.title = text
  card.status.className = `news-status${topic.status?.tone ? ` ${topic.status.tone}` : ''}`
  card.look.hidden = topic.look !== true
  const busy = topic.running === true || topic.queued === true
  card.generate.textContent = busy ? t('newsPage.generating') : t('newsPage.generate')
  // 生成中、排队中、不能联网搜时真的点不了；那句话空着只是灰样子，点了写那一句
  card.generate.disabled = busy || view.ready === false
  card.generate.classList.toggle('off', empty || view.ready === false)
  card.generate.title = view.ready === false ? String(view.readyHint || '') : ''
  // 空卡还没存：删除就是把这张空卡拿掉
  card.remove.hidden = false
}

// 有卡在生成：每秒把它的状态行走一下；都不在生成就停
function syncTicker() {
  const running = [...shown.values()].some((topic) => topic.running && topic.since)
  if (running && !ticker) {
    ticker = setInterval(() => {
      for (const [id, topic] of shown) {
        if (!topic.running || !topic.since) continue
        const card = cards.get(id)
        if (card) card.status.textContent = statusText(topic)
      }
    }, 1000)
  } else if (!running && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

// 整页的设置：好了说不说、后台能不能跑命令改文件（这两个是整页一个）
export function renderNewsPrefs(prefs, handlers = {}) {
  livePrefs = handlers || {}
  const safe = prefs && typeof prefs === 'object' ? prefs : {}
  const notify = one('#news-notify input')
  if (notify) notify.checked = safe.notify !== false
  const perm = one('#news-perm input')
  if (perm) perm.checked = safe.permission === 'allow'
  for (const [id, key] of [['#news-notify', 'notify'], ['#news-perm', 'permission']]) {
    const wrap = one(id)
    if (!wrap || wrap.dataset.wired) continue
    wrap.dataset.wired = '1'
    const input = wrap.querySelector ? wrap.querySelector('input') : null
    if (input) input.addEventListener('change', () => livePrefs.onToggle?.(key, input.checked))
  }
}
