// 任务窗「换模型」的页面这头：展开的输入区左下角小签、往上的弹出列表和「思考」二级菜单。
// 只建节点、摆位置、管显隐；列表怎么拼、选了算谁的都在主进程（./models-menu.mjs），这里不算。

import { t } from '../copy/copy.mjs'

// 弹出在小签上方，宽 232、每行 41 高（名字 + 小字两行）；二级菜单贴在行的右边
const POPUP_W = 232
const POPUP_GAP = 6
const SUB_W = 150

function spanOf(className) {
  const el = document.createElement('span')
  el.className = className
  return el
}

// 模型名写进去：自定义条目是「条目」「模型」两截，各一个 span，中间的空白由样式给（.parts）
function fillName(el, parts) {
  el.textContent = ''
  for (const one of parts || []) {
    const part = document.createElement('span')
    part.textContent = one
    el.append(part)
  }
}

// box：小签插进输入区；layer：弹出和二级菜单挂在页面这层（fixed 定位）。
// onPick(item, effort)：点模型行 effort 是 null，点档位行是那个档位。
// onManage：点「管理模型…」。
export function createModelsMenu({ chipRow, layer, onPick, onManage }) {
  // 小签：圆点 + 模型名 + ▾
  const chip = document.createElement('button')
  chip.type = 'button'
  chip.id = 'modelchip'
  chip.hidden = true
  const dot = spanOf('dot')
  const nm = spanOf('nm parts')
  const caret = spanOf('caret')
  caret.textContent = '▾'
  caret.hidden = true
  chip.append(dot, nm, caret)
  chipRow.append(chip)

  // 弹出列表和「思考」二级菜单（两个分开的层：弹出里要滚，嵌着摆会被裁掉）
  const popup = document.createElement('div')
  popup.id = 'modelmenu'
  popup.hidden = true
  const sub = document.createElement('div')
  sub.id = 'modelsub'
  sub.hidden = true
  layer.append(popup, sub)

  let data = null // { list, current }，主进程 task:models 给的
  let phase = ''
  let shown = false
  let subTimer = 0

  function renderChip() {
    const current = data?.current
    chip.hidden = !current?.name
    fillName(nm, current?.parts)
    nm.title = current?.name || ''
    // 能点的模型只有一个、或正在干活：变灰、没有 ▾、点了没反应
    const openable = Boolean(data?.list && data.list.length > 1 && phase !== 'working' && current?.name)
    chip.disabled = !openable
    caret.hidden = !openable
  }

  function hideSub() {
    clearTimeout(subTimer)
    sub.hidden = true
  }

  function hideSubSoon() {
    clearTimeout(subTimer)
    subTimer = setTimeout(hideSub, 150)
  }

  // 「思考」二级菜单：只列这一行模型的档位，摆在行的右边，出了窗就往回收
  function showSub(row, item) {
    clearTimeout(subTimer)
    sub.textContent = ''
    const head = document.createElement('div')
    head.className = 'msub-head'
    head.textContent = t('models.thinking')
    sub.append(head)
    const current = data?.current
    const mine = Boolean(current && current.entry === item.entry && current.model === item.model)
    // 这个模型正在用：选过档位就是那一档，没选过就是 dsh 默认的那一档
    const chosen = mine ? (current.effort ?? item.defaultEffort ?? null) : null
    for (const one of item.efforts) {
      const btn = document.createElement('button')
      btn.type = 'button'
      const pick = spanOf('pick')
      if (chosen === one.id) {
        pick.classList.add('on')
        btn.classList.add('now')
      }
      btn.append(pick, document.createTextNode(one.label))
      // 没选档位时用的就是这一档：后面写一个灰的「默认」
      if (item.defaultEffort === one.id) {
        const tag = spanOf('dflt')
        tag.textContent = t('models.effortDefault')
        btn.append(tag)
      }
      btn.addEventListener('click', () => onPick(item, one.id))
      sub.append(btn)
    }
    sub.hidden = false
    const whole = popup.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    sub.style.left = `${Math.max(4, Math.min(whole.right + 2, innerWidth - SUB_W - 4))}px`
    let top = at.top
    if (top + sub.offsetHeight > innerHeight - 6) top = Math.max(6, innerHeight - sub.offsetHeight - 6)
    sub.style.top = `${top}px`
  }

  function rowOf(item) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'mrow'
    // 名字长了会被省略号截掉：停上去看全名
    row.title = item.name
    const current = data?.current
    const now = Boolean(current && current.entry === item.entry && current.model === item.model)
    if (now) row.classList.add('now')
    // 选中的那个模型：左边一个灰色小圆点
    const pick = spanOf('pick')
    if (now) pick.classList.add('on')
    const txt = document.createElement('span')
    txt.className = 'txt'
    const name = spanOf('nm parts')
    fillName(name, item.parts)
    txt.append(name)
    if (item.note) {
      const note = spanOf('note')
      note.textContent = item.note
      txt.append(note)
    }
    row.append(pick, txt)
    if (item.efforts.length) {
      const arrow = spanOf('arr')
      arrow.textContent = '›'
      row.append(arrow)
      row.addEventListener('pointerenter', () => showSub(row, item))
      row.addEventListener('pointerleave', hideSubSoon)
    } else {
      row.addEventListener('pointerenter', hideSub)
    }
    row.addEventListener('click', () => onPick(item, null))
    return row
  }

  function renderPopup() {
    popup.textContent = ''
    const head = document.createElement('div')
    head.className = 'mhead'
    head.textContent = t('models.pickTitle')
    popup.append(head)
    for (const item of data?.list || []) popup.append(rowOf(item))
    if (typeof onManage === 'function') {
      const sep = document.createElement('div')
      sep.className = 'msep'
      const manage = document.createElement('button')
      manage.type = 'button'
      manage.className = 'mmanage'
      manage.textContent = t('models.manage')
      manage.addEventListener('click', () => { closeMenu(); onManage() })
      popup.append(sep, manage)
    }
  }

  function openMenu() {
    if (!data?.current?.name || phase === 'working' || (data?.list || []).length < 2) return
    renderPopup()
    popup.hidden = false
    shown = true
    // 小签在输入区左下角：弹出贴着它往上，左边对齐，摆不下就压矮一点
    const at = chip.getBoundingClientRect()
    popup.style.left = `${Math.max(4, Math.min(at.left, innerWidth - POPUP_W - 4))}px`
    popup.style.bottom = `${Math.max(POPUP_GAP, innerHeight - at.top + POPUP_GAP)}px`
    popup.style.maxHeight = `${Math.max(120, at.top - 12)}px`
  }

  function closeMenu() {
    shown = false
    popup.hidden = true
    hideSub()
  }

  // 数据或干活状态变了：小签跟着写，弹开着就连列表一起重画；干活中把弹收掉
  function render(next, phaseNow) {
    if (next) data = next
    if (typeof phaseNow === 'string') phase = phaseNow
    if (phase === 'working' && shown) closeMenu()
    renderChip()
    if (shown) renderPopup()
  }

  sub.addEventListener('pointerenter', () => clearTimeout(subTimer))
  sub.addEventListener('pointerleave', hideSubSoon)

  return { chip, popup, sub, render, openMenu, closeMenu, isOpen: () => shown }
}
