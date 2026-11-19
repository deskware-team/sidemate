// 「新闻」页和「加一个主题」弹窗：只管摆界面、收输入、调 IPC。
// 这一页跑在沙箱渲染进程里，引不了带 node 模块的文件，纯逻辑都在主进程那边，这里只 import 同目录的浏览器模块：
// 主题怎么存、怎么校验都在主进程那边（app/settings/news.mjs），这里只管看得见的样子。
// 样子：720 宽的设置窗里右边内容区一列主题，
// 弹窗 480 宽、块间距 16、内边距 24、圆角 12。
// Esc 和滚动那条线这两件共用事放在 overlay.js 里，跟另外两个弹窗同一套。

import { makeEscStack, markScroll } from './overlay.js'
import { t } from '../copy/copy.mjs'

// 生成中那个按钮上的字：跟「现在生成」一样宽
const GENERATING_TEXT = t('newsPage.generating')
const DELETE_TEXT = t('newsDialog.removeLink')
// 不能订的时候，按钮旁边直接写为什么（主进程也会送来一句，这里只是兜底）：错误码 Si104 那句
const NOT_READY_NOTE_TEXT = t('stops.newsSearch')

// 摆一个节点：class / text / checked / disabled / value / on 开头的事件，其余走属性
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props || {})) {
    if (name === 'class') node.className = value
    else if (name === 'text') node.textContent = value
    else if (name === 'checked') node.checked = value === true
    else if (name === 'hidden') node.hidden = value === true
    else if (name === 'disabled') node.disabled = value === true
    else if (name === 'value') node.value = value ?? ''
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value)
  }
  node.append(...children.filter(Boolean))
  return node
}

// 开关：32×18 的轨条加圆点，勾上墨底白点滑到右边
function switchBox(checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) })
  return {
    el: el('label', { class: 'switch' }, input, el('span', { class: 'track' })),
    get: () => input.checked,
    set: (value) => { input.checked = value === true },
  }
}

// —————————————————————————————— 页面 ——————————————————————————————

// 一个主题一行：第一行只有名字，第二行一句话；右边「现在生成」「改」和开关
function topicRow(row, handlers, busy = '') {
  const item = el('li', { class: row.enabled === false ? 'off' : '' })

  const text = el('div', { class: 'text' })
  // 第二行：一句话，末尾跟着今天那一句状态。一句话太长只截它自己（停上去看全文），
  // 状态那一截（生成失败的红字也在这）总露在外面
  const note = el('p', { class: 'note' })
  note.append(el('span', { class: 'sum', text: row.summary || '', title: row.summary || '' }))
  // 自动配置权限选了「允许」的主题：第二行末尾标一句（默认的「拒绝」不标）
  if (row.permission === 'allow' && row.permissionText) {
    note.append(el('span', { class: 'rowstatus', text: row.permissionText, title: row.permissionText }))
  }
  const status = row.status && typeof row.status === 'object' ? row.status : null
  if (status && status.text) {
    note.append(el('span', {
      class: 'rowstatus' + (status.tone ? ' ' + status.tone : ''),
      text: status.text,
      title: status.text,
    }))
  }
  text.append(
    el('p', { class: 'name', text: row.name || '' }),
    note,
  )

  const side = el('div', { class: 'side' })
  for (const one of row.buttons || []) {
    const isNow = one.id === 'now'
    // 这一份正在生成：按钮写成「生成中…」并且灰掉；别的行也先灰掉
    const mine = Boolean(busy) && String(row.id) === String(busy)
    const label = isNow && mine ? GENERATING_TEXT : one.label
    const disabled = isNow ? (mine ? true : (Boolean(busy) || one.disabled === true)) : one.disabled === true
    const button = el('button', {
      type: 'button',
      class: isNow ? 'btn now' : 'btn',
      text: label,
      disabled,
      title: one.title || '',
      onclick: () => (isNow ? handlers?.onGenerate?.(row) : handlers?.onEdit?.(row)),
    })
    side.append(button)
  }
  const toggle = switchBox(row.enabled === true, (on) => handlers?.onToggle?.(row, on))
  side.append(toggle.el)

  item.append(text, side)
  return item
}

// 「加一个主题」那个按钮旁边那句话：页面上 span.fine，找不到就当没有
function addNoteOf(button) {
  if (!button) return null
  const parent = button.parentNode || button.parentElement
  if (!parent) return null
  const kids = Array.from(parent.children || [])
  return kids.find((one) => String(one.className || '').split(/\s+/).includes('fine')) || null
}

// 模型不能联网搜时，「加一个主题」灰着，旁边直接写清楚为什么；能订的时候旁边不摆字
function drawAddButton(view) {
  const button = document.querySelector('#news-add')
  if (!button) return
  const ready = view.ready === true
  button.disabled = !ready
  if (button.classList) button.classList.toggle('off', !ready)
  const note = addNoteOf(button)
  if (ready) {
    if (note) {
      note.textContent = ''
      if (typeof note.remove === 'function') note.remove()
    }
    return
  }
  const text = view.readyHint || NOT_READY_NOTE_TEXT
  if (note) {
    note.textContent = text
    return
  }
  const parent = button.parentNode || button.parentElement
  if (parent) parent.append(el('span', { class: 'fine', text }))
}

// 画整页：没主题时列表里摆一句空状态的话
export function renderNews(view, handlers = {}) {
  const safe = view || { rows: [], empty: true }
  const list = document.querySelector('#news-list')
  if (!list) return
  list.replaceChildren()
  drawAddButton(safe)
  // 页面上方那一句提醒：没配密钥、也没搜索工具，可能搜不到新闻
  if (safe.notice) list.append(el('li', { class: 'fine', text: safe.notice }))
  const rows = Array.isArray(safe.rows) ? safe.rows : []
  if (rows.length === 0) {
    list.append(el('li', { class: 'empty', text: safe.emptyText || t('newsPage.empty') }))
    return
  }
  const busy = String(safe.busy ?? '')
  for (const row of rows) list.append(topicRow(row, handlers, busy))
}

// 整页的设置：错过补不补、好了说不说
export function renderNewsPrefs(prefs, handlers = {}) {
  const safe = prefs && typeof prefs === 'object' ? prefs : {}
  // 「休眠错过后补生成」那一行撤了：错过的都不补跑（迟到十分钟以内的那一次照跑）。
  // 留着是个说了不算的开关，就从页面上拿掉。
  hideCatchUpRow()
  const notify = document.querySelector('#news-notify input')
  if (notify) notify.checked = safe.notify !== false
  for (const [id, key] of [['#news-notify', 'notify']]) {
    const wrap = document.querySelector(id)
    if (!wrap || wrap.dataset.wired) continue
    wrap.dataset.wired = '1'
    const input = wrap.querySelector('input')
    if (input) input.addEventListener('change', () => handlers?.onToggle?.(key, input.checked))
  }
}

// 把「休眠错过后补生成」那一行从页面上拿掉（开关本身在 page.html 里，那一行的外壳是它上面那层）
function hideCatchUpRow() {
  const wrap = document.querySelector('#news-catchup')
  const row = wrap && typeof wrap.closest === 'function' ? wrap.closest('.pref-row') : null
  if (!row || !row.parentNode || typeof row.parentNode.removeChild !== 'function') return
  row.parentNode.removeChild(row)
}

// —————————————————————————————— 弹窗 ——————————————————————————————

// 「加一个主题」弹窗：改主题也用它。form 由主进程给（主题对象换成的表单），
// 存好了回调 onSaved 重画这一页。
export function openNewsDialog(payload, { onSaved, onRemove } = {}) {
  const safe = payload || {}
  const form = { ...(safe.form || {}) }
  const overlay = el('div', { class: 'overlay' })
  // Esc 关这个弹窗；关掉时把 keydown 监听撤掉
  const stack = makeEscStack(document)
  let release = () => {}
  const close = () => {
    overlay.remove()
    release()
  }
  release = stack.push({ close })

  const title = el('h2', { text: form.id ? t('common.titleEdit', { name: form.name || '' }) : t('newsDialog.titleAdd') })

  // 主题：名字
  const nameInput = el('input', { type: 'text', value: form.name || '', spellcheck: 'false' })
  // 想看什么：一句话
  const wantInput = el('textarea', { class: 'area', rows: '3', spellcheck: 'false' })
  wantInput.value = form.want || ''

  // 什么时候：每天、工作日、每周一，再加一个时间
  let days = ['daily', 'weekdays', 'monday'].includes(form.days) ? form.days : 'daily'
  const atInput = el('input', { type: 'text', class: 'time', value: form.at || '08:00', spellcheck: 'false' })
  const dayButtons = [
    { id: 'daily', label: t('newsDialog.daily') },
    { id: 'weekdays', label: t('newsDialog.workdays') },
    { id: 'monday', label: t('newsDialog.monday') },
  ].map((one) => el('button', {
    type: 'button',
    class: 'segbtn',
    text: one.label,
    onclick: () => pickDays(one.id),
  }))
  const daySeg = el('div', { class: 'seg', role: 'group' }, ...dayButtons)
  function pickDays(value) {
    days = value
    dayButtons.forEach((button, index) => {
      const id = ['daily', 'weekdays', 'monday'][index]
      button.classList.toggle('on', id === value)
    })
  }
  pickDays(days)

  // 自动配置权限：后台生成时给不给模型运行权限。拒绝（默认）/ 允许
  const PERMISSION_IDS = ['deny', 'allow']
  let permission = PERMISSION_IDS.includes(form.permission) ? form.permission : 'deny'
  const permissionButtons = [
    { id: 'deny', label: t('newsDialog.permissionDeny') },
    { id: 'allow', label: t('newsDialog.permissionAllow') },
  ].map((one) => el('button', {
    type: 'button',
    class: 'segbtn',
    text: one.label,
    onclick: () => pickPermission(one.id),
  }))
  const permissionSeg = el('div', { class: 'seg', role: 'group' }, ...permissionButtons)
  function pickPermission(value) {
    permission = value
    permissionButtons.forEach((button, index) => {
      const id = PERMISSION_IDS[index]
      button.classList.toggle('on', id === value)
    })
  }
  pickPermission(permission)
  // 标签后面的 i：鼠标停上去说清这一项管什么、选拒绝会怎样
  const permissionTip = t('newsDialog.permissionTip')
  const permissionLabel = el('span', { class: 'flabel' },
    el('span', { text: t('newsDialog.labelPermission') }),
    el('span', { class: 'info', text: 'i', title: permissionTip, 'aria-label': permissionTip, tabindex: '0' }))

  // 底下几个按钮：取消、保存并生成一份、保存
  const problem = el('span', { class: 'result bad', role: 'status' })
  const saveButton = el('button', { class: 'primary', type: 'button', text: t('common.save'), onclick: () => runSave(false) })
  const saveMoreButton = el('button', { class: 'ghost', type: 'button', text: t('newsDialog.saveAndGenerate'), onclick: () => runSave(true) })

  // 删掉这个主题：改已有主题时才有，放在最左边
  const removeLink = form.id
    ? el('button', { type: 'button', class: 'textlink deletelink', text: DELETE_TEXT, onclick: () => {
        if (typeof onRemove === 'function') onRemove(form, close)
      } })
    : null

  async function runSave(withGenerate) {
    if (saveButton.disabled) return
    saveButton.disabled = true
    saveMoreButton.disabled = true
    problem.textContent = ''
    const payloadForm = {
      id: form.id || '',
      name: nameInput.value,
      want: wantInput.value,
      at: atInput.value.trim(),
      days,
      permission,
      enabled: form.enabled !== false,
    }
    try {
      const back = await window.settings.newsSave(payloadForm)
      if (!back || back.ok !== true) {
        problem.textContent = back?.message || t('stops.saveFailed')
        return
      }
      // 「保存并生成一份」：先存下，关掉弹窗，再走列表里那条「现在生成」的路
      if (withGenerate) {
        close()
        if (typeof onSaved === 'function') onSaved(back, { generate: true })
        return
      }
      close()
      if (typeof onSaved === 'function') onSaved(back, { generate: false })
    } finally {
      saveButton.disabled = false
      saveMoreButton.disabled = false
    }
  }

  // 弹窗分三段：标题在上、中间自己滚、底下按钮那一排永远露在弹窗里
  const body = el('div', { class: 'dialog-body' })
  body.append(
    el('label', { class: 'field' },
      el('span', { class: 'flabel', text: t('newsDialog.labelName') }),
      nameInput),
    el('div', { class: 'field' },
      el('span', { class: 'flabel', text: t('newsDialog.labelWant') }),
      wantInput),
    el('div', { class: 'field' },
      el('span', { class: 'flabel', text: t('newsDialog.labelWhen') }),
      el('div', { class: 'timerow' }, daySeg, atInput)),
    el('div', { class: 'field' },
      permissionLabel,
      permissionSeg),
  )
  const dialog = el('div', { class: 'dialog news-dialog' },
    title,
    body,
    el('div', { class: 'actions news-actions' },
      removeLink,
      el('span', { class: 'grow' }),
      problem,
      el('button', { class: 'ghost', type: 'button', text: t('common.cancel'), onclick: close }),
      saveMoreButton,
      saveButton))
  overlay.append(dialog)

  document.body.append(overlay)
  markScroll(dialog, body)
}
