// 任务窗页面：拿到视图就照着画，用户的动作原样发回主进程；自己不算状态、不存东西。
// 顶上顶着文件夹，下面一条对话流：我说的话 · 模型说的每一段 · 产出卡。

import { markdownEl } from './markdown-view.js'
import { getChartTarget, svgToPng } from './chart-export.js'
import { quietLabel } from './timing.mjs'
import { countdownText } from './wait.mjs'
import { scrollDecision } from './scroll.mjs'
import { animStep } from './anim.mjs'
import { createTick } from './tick.mjs'
import { createInputAnim } from './input-anim.mjs'
import { SHADOW_BOTTOM, SHADOW_TOP } from './window.mjs'
import { createModelsMenu } from './models-view.js'
import { createHistoryView } from './history-view.js'
import { createTagRow } from './tagrow.mjs'
import { createChipRow } from './chips-view.js'
import { createPasteInput } from './paste-input.mjs'
import { escapeAction } from './escape.mjs'
import { askConsent, createConsentGate } from './consent-pop.mjs'
import { installEl as installCardEl } from './install-card.mjs'
import { permissionEl } from './permission-card.mjs'
import { codeTail } from '../copy/line.mjs'
import { paint, t } from '../copy/copy.mjs'
import { previewShown } from '../preview/model.mjs'

// 页面里写死的字（html 上的 data-t）：窗口第一次显示前先换掉
paint(document)

const $ = (sel) => document.querySelector(sel)
const els = {
  top: $('#top'),
  wherebtn: $('#where-btn'), wherename: $('#where-name'), previewbtn: $('#previewbtn'), newtask: $('#newtask'),
  flow: $('#flow'), latest: $('#latest'), tagrow: $('#tagrow'), tags: $('#tags'), notes: $('#notes'), banner: $('#banner'),
  addfile: $('#addfile'), inputwrap: $('#inputwrap'), input: $('#input'),
  send: $('#send'), sendtext: $('#sendtext'), stop: $('#stop'), chiprow: $('#chiprow'), handlebar: $('#handlebar'),
  drop: $('#dropmask'), tagmenu: $('#tagmenu'), docicon: $('#docicon'),
}
const bridge = window.task || null
const panel = document.getElementById('panel')
const stillMedia = matchMedia('(prefers-reduced-motion: reduce)')
let view = null
let lastJson = ''
let stick = true
let forceBottom = false // 刚发完消息，一定滚到底
let lastBlocks = ''
let inputOpen = false // 输入胶囊展开着没
let dragOn = false // 正在拖底边把手
let dragFrom = 0 // 按下那一下的面板高
let dragY = 0 // 按下那一下的指针位置
let outDrag = null // 正从产出卡往外拖：{ left } 离开过这个窗口没有；拖完了归 null

const act = (action) => { if (bridge) bridge.act(action) }

// 主进程让页面把那张图导成 PNG：另存为图片（存文件）或复制图片（进剪贴板）
if (bridge && typeof bridge.onChartExport === 'function') {
  bridge.onChartExport(async (payload) => {
    const one = getChartTarget()
    if (!one) return
    try {
      const dataUrl = await svgToPng(one.source)
      bridge.chartImage({ action: payload?.action === 'copy' ? 'copy' : 'save', dataUrl })
    } catch (error) {
      // 导不出来就当没这回事，不打扰用户
    }
  })
}

const consentGate = createConsentGate({ bridge, act }) // 没同意须知被拦下时：弹须知窗，同意了把原来那句重发一次

// 顶栏胶囊上写的字：壳给什么写什么（一直是「任务列表」，文件夹路径在停上去的提示里）
const folderLabel = (info) => info.text

const atBottom = () => els.flow.scrollHeight - els.flow.scrollTop - els.flow.clientHeight < 4

// 换模型：左下角小签，点开往上弹列表；选中交给主进程记在任务状态里，只管当前这个任务
let modelsData = null // { list, current }，主进程 task:models 给的

function refreshModels() {
  if (!bridge || typeof bridge.models !== 'function') return Promise.resolve()
  return bridge.models()
    .then((next) => {
      modelsData = next
      modelsMenu.render(modelsData, view ? view.phase : '')
    })
    .catch(() => {})
}

// dsh 那边模型选项变了（热加载）：主进程推来一份新的，下拉跟着换
if (bridge && typeof bridge.onModels === 'function') {
  bridge.onModels((next) => {
    if (!next) return
    modelsData = next
    modelsMenu.render(modelsData, view ? view.phase : '')
  })
}

// 点模型行选模型（档位用它自己的默认）；点档位行连档位一起。
// Kilo 模型没同意过使用须知的：先看使用须知，同意了才选，不同意什么都不改。
function pickModel(item, effort) {
  modelsMenu.closeMenu()
  if (item.needsConsent) {
    void (async () => {
      if (!await askConsent(bridge)) return
      act({ type: 'model', entry: item.entry, model: item.model, effort: null })
      void refreshModels()
    })()
    return
  }
  act({ type: 'model', entry: item.entry, model: item.model, effort: effort ?? null })
  void refreshModels()
}

const modelsMenu = createModelsMenu({
  chipRow: els.chiprow,
  layer: document.body,
  onPick: (item, effort) => pickModel(item, effort),
  onManage: () => act({ type: 'settings' }),
})

// 历史：顶栏「▾」弹出的「历史记录」下拉 + 「看全部…」换出的整页。
// 列表和打开都走主进程；没有桥（预览壳）就拿不到列表，界面照样开、不报错。
const historyView = createHistoryView({
  where: $('#where'),
  panel,
  list: (payload) => (bridge && typeof bridge.historyList === 'function'
    ? bridge.historyList(payload).catch(() => null)
    : Promise.resolve(null)),
  open: (id) => (bridge && typeof bridge.historyOpen === 'function'
    ? bridge.historyOpen(id).catch(() => null)
    : Promise.resolve(null)),
})

// 小签行：文件、贴的图、贴的长文字都变成小签（画法和菜单在 ./tagrow.mjs）。
// 「改回文字」取回的字放进输入框：已有字就另起一行，展开胶囊接着打。
const tagRow = createTagRow({
  row: els.tagrow,
  list: els.tags,
  menu: els.tagmenu,
  act,
  bridge,
  view: () => view,
  onRestore: (text) => {
    els.input.value = els.input.value ? `${els.input.value}\n${text}` : text
    setInputOpen(true, true)
  },
})

// 输入框里贴东西的分流（图 / 长字 / 短字 / 文件）在 ./paste-input.mjs
if (bridge) createPasteInput({ input: els.input, bridge })

// 气泡里的小块：发出去的文件在工作区里的那份拷贝。图片带缩略图，其它带图标 + 文件名；
// 放不下收成「+N」。点一下让主进程在预览窗里打开那份拷贝（画法在 ./chips-view.js）
const chipRow = createChipRow({ doc: document, bridge, icon: els.docicon })

// 垂下来和收回：页面第一帧是收起状态，壳说一声才垂下来。
// 帘子往下拉开：露出的高度从 1 到整窗，同时从上方 16px 落到位，前 120ms 淡入。
// 收回：帘子往上收，窗往上走 12px，最后 120ms 淡出。
// 中途改了方向：倒着走，从当前位置接着走，不重放也不叠两段。
let anim = null // 现在这段动画
let animDir = '' // 这段动画的方向：'in' 往下拉开、'out' 往上收

// 停掉现在这段（不改落定的样子）
function stopAnim() {
  if (!anim) return
  const done = anim
  anim = null
  animDir = ''
  try { done.cancel() } catch { /* 停不了就算了 */ }
}

// 动画放完了：把落定的样子摆好（收起 = closed，展开 = 什么也不加）
function settle(dir) {
  stopAnim()
  panel.classList.remove('enter', 'leave')
  panel.classList.toggle('closed', dir === 'out')
}

function playAnim(kind) {
  const dir = kind === 'in' ? 'in' : 'out'
  if (stillMedia.matches) {
    // 关了「显示动画」：直接出现 / 直接消失，不动
    settle(dir)
    return
  }
  const step = animStep(anim ? { state: anim.playState, dir: animDir } : null, dir)
  // 已经在走这个方向：不重放
  if (step === 'keep') return
  // 反方向：倒着走，从当前位置接着走
  if (step === 'reverse') {
    anim.reverse()
    animDir = dir
    return
  }
  // 新的一段：先摆好起点，再放
  stopAnim()
  panel.classList.remove('enter', 'leave', 'closed')
  void panel.offsetHeight
  panel.classList.add(dir === 'in' ? 'enter' : 'leave')
  const name = dir === 'in' ? 'win-drop' : 'win-up'
  const running = panel.getAnimations
    ? panel.getAnimations().find((one) => one.animationName === name && one.playState === 'running')
    : null
  if (!running) { settle(dir); return }
  anim = running
  animDir = dir
  running.addEventListener('finish', () => { if (anim === running) settle(animDir) })
}

panel.addEventListener('animationend', (event) => {
  if (event.target !== panel) return
  if (event.animationName !== 'win-drop' && event.animationName !== 'win-up') return
  if (!animDir) return
  settle(animDir)
})

// 输入胶囊：不用时收成一行的胶囊，点一下或开始打字展开成三行；失焦且没内容时收回。
// 展开 / 收起的过渡在 input-anim.mjs：先量高再切类，height 从旧值走到新值，发送钮贴着框角不动
const inputAnim = createInputAnim({ wrap: els.inputwrap, input: els.input, reduce: () => stillMedia.matches })
function setInputOpen(open, focus) {
  const want = open === true
  if (inputOpen === want) {
    if (want && focus) els.input.focus()
    return
  }
  inputOpen = want
  inputAnim.to(want)
  if (want && focus) els.input.focus()
}

function buttonEl(label, action, kind) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  if (kind) btn.dataset.act = kind
  btn.addEventListener('click', () => act(action))
  return btn
}

// 横幅、对话流里的按钮：「换模型」不是发给主进程的，是把模型菜单打开；
// 「使用须知」也不是发给主进程的，是弹须知窗
function buttonFor(one) {
  if (one.action === 'models' || one.action === 'consent') {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = one.label
    btn.addEventListener('click', () => { if (one.action === 'models') modelsMenu.openMenu(); else void consentGate.ask(one.round) })
    return btn
  }
  const btn = buttonEl(one.label, { type: one.action })
  if (one.action === 'continue') btn.classList.add('primary')
  return btn
}

// 等待行：模型那边忙，等一会儿自己再试。一段照常折行的字（秒数自己倒数），右边一个「停下」。
// 没有倒数的那种（超时那句本身就是「正在重新连接」，until 是 0）只摆整句，不再接倒数那截。
function waitEl(block) {
  const el = document.createElement('div')
  el.className = 'wait'
  const until = Number(block.until) || 0
  const text = document.createElement('span')
  text.className = 'wtext'
  const head = typeof block.head === 'string' ? block.head : ''
  const tail = typeof block.tail === 'string' ? block.tail : ''
  // 拆不出三段又没有倒数：整句照摆
  const whole = !head && !tail && until <= 0
  text.append(document.createTextNode(whole ? String(block.text || '') : head))
  if (until > 0) {
    const secs = document.createElement('span')
    secs.className = 'wsecs'
    secs.dataset.until = String(until)
    secs.textContent = countdownText(until)
    text.append(secs)
  }
  text.append(document.createTextNode(tail))
  el.append(text)
  if (block.buttons && block.buttons.length) {
    const btns = document.createElement('div')
    btns.className = 'btns'
    for (const one of block.buttons) btns.append(buttonFor(one))
    el.append(btns)
  }
  return el
}

// 我说的：右边纸色气泡，带了的文件在气泡里摆成小块（图片带缩略图，点一下能打开）
function userEl(block) {
  const el = document.createElement('div')
  el.className = 'user'
  const tx = document.createElement('div')
  tx.className = 'tx'
  tx.textContent = block.text
  const chips = chipRow.render(block)
  if (chips) tx.append(chips)
  el.append(tx)
  return el
}

// 干活中插进去的那句话：右边纸色气泡（跟「我说的」一样，干活中挂上的文件也摆成小块），
// 下面一行 11px 灰字写走的哪条路
function steerEl(block) {
  const el = document.createElement('div')
  el.className = 'steer'
  const bubble = document.createElement('div')
  bubble.className = 'user'
  const tx = document.createElement('div')
  tx.className = 'tx'
  tx.textContent = block.text
  const chips = chipRow.render(block)
  if (chips) tx.append(chips)
  bubble.append(tx)
  el.append(bubble)
  const note = document.createElement('div')
  note.className = 'snote'
  note.textContent = steerNote(block.status)
  el.append(note)
  return el
}

// 走通了就一行灰字：插进这一步了、排队等这轮干完，说的是同一句
function steerNote(status) {
  return view && status ? view.labels.steer : ''
}

// 干活中：对话流最下面一行浅字，只说在干什么，不带计时。
// 静了好一会儿：状态在「还需要更长时间」「等待模型响应」之间每 30 秒换一次，自己换
function workingEl(block) {
  const el = document.createElement('div')
  el.className = 'working'
  const label = document.createElement('span')
  label.textContent = block.text
  if (block.quiet) {
    label.className = 'quiet'
    label.dataset.at = String(block.quiet)
    label.textContent = quietLabel(block.quiet)
  }
  el.append(label)
  return el
}

// 产出卡：文档图标 · 文件名 · 一行说明 · 预览 / 另存为（这张卡能拖出去，右键有系统菜单）
function cardEl(block) {
  const card = block.card
  const el = document.createElement('article')
  el.className = 'card'
  el.dataset.path = card.path || ''
  const head = document.createElement('div')
  head.className = 'head'
  const icon = els.docicon.cloneNode(true)
  icon.removeAttribute('hidden')
  const nm = document.createElement('span')
  nm.className = 'nm'
  nm.textContent = card.label
  head.append(icon, nm)
  const sub = document.createElement('div')
  sub.className = 'sub'
  sub.textContent = card.line
  sub.title = card.name
  const btns = document.createElement('div')
  btns.className = 'btns'
  // 预览放前面，是这张卡的主按钮（跟横幅上「继续」一样的主次写法）
  const preview = buttonEl(t('output.preview'), { type: 'preview', path: card.path }, 'preview')
  preview.classList.add('primary')
  btns.append(preview)
  btns.append(buttonEl(view.labels.saveAs, { type: 'save-as', path: card.path }, 'save-as'))
  el.append(head, sub, btns)
  // 右键这张卡：弹系统原生菜单（预览 / 打开 / 在文件夹里显示 / 另存为），主进程那边弹
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (bridge && typeof bridge.cardMenu === 'function') bridge.cardMenu(card.path)
  })
  // 按住这张卡拖，文件跟着鼠标走（主进程起系统拖拽）；按下那一下先让主进程问好这种文件的图标
  el.draggable = true
  el.addEventListener('pointerdown', () => {
    if (bridge && typeof bridge.dragPrep === 'function') bridge.dragPrep(card.path)
  })
  el.addEventListener('dragstart', (event) => {
    event.preventDefault()
    // 刚从自己这儿拖出去：没离开过这个窗口之前，窗口不接这份（免得一拖就落回聊天里）
    outDrag = { left: false }
    if (bridge && typeof bridge.dragOut === 'function') bridge.dragOut(card.path)
  })
  return el
}

function blockEl(block) {
  if (block.kind === 'user') return userEl(block)
  if (block.kind === 'steer') return steerEl(block)
  if (block.kind === 'working') return workingEl(block)
  if (block.kind === 'wait') return waitEl(block)
  if (block.kind === 'card') return cardEl(block)
  if (block.kind === 'install') return installCardEl(block, view.labels, act)
  if (block.kind === 'permission') return permissionEl(block, view.labels, act)
  const el = document.createElement('div')
  el.className = block.kind === 'reply' ? 'reply' : 'note'
  if (block.kind === 'reply') {
    el.append(markdownEl(block.text, bridge))
    if (block.ask) {
      const tail = document.createElement('span')
      tail.className = 'tail'
      tail.textContent = view.labels.askTail
      el.append(tail)
    }
    return el
  }
  el.textContent = block.text
  if (block.buttons && block.buttons.length) {
    const btns = document.createElement('div')
    btns.className = 'btns'
    for (const one of block.buttons) btns.append(buttonFor(one))
    el.append(btns)
  }
  return el
}

// 重画对话流：滚到哪，看离底多远。
// 用户自己在往上翻着看（离底超过 80px）就别硬拽，右下角露一个「回到最新」。
// 它说的话（回答、说明、产出卡、干活中那行）前面带一个小岛头像，连续几段共用一个。
function renderFlow() {
  const el = els.flow
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  const decision = scrollDecision({ distance, force: forceBottom })
  const back = el.scrollTop
  const sig = JSON.stringify(view.blocks)
  el.textContent = ''
  let group = null
  for (const block of view.blocks) {
    if (block.kind === 'user' || block.kind === 'steer') {
      group = null
      el.append(blockEl(block))
      continue
    }
    if (!group) {
      group = document.createElement('div')
      group.className = 'them'
      const ava = document.createElement('span')
      ava.className = 'ava'
      const body = document.createElement('div')
      body.className = 'tbody'
      group.append(ava, body)
      el.append(group)
    }
    group.lastChild.append(blockEl(block))
  }
  if (decision === 'bottom') {
    el.scrollTop = el.scrollHeight
    stick = true
  } else {
    el.scrollTop = back
    stick = false
  }
  lastBlocks = sig
  forceBottom = false
  updateLatest()
}

// 右下角那个小按钮「回到最新」：往上翻着看的时候露出来
function updateLatest() {
  if (!view) return
  els.latest.hidden = stick
  els.latest.textContent = view.labels.latest
}

// 输入框上方那一条：报错是红色横幅（停工那句 · Si 码 错误，下面一排按钮）；
// 提示是灰色一行，右边一个 ×（点了收起，发下一句也收起）
function renderBanner() {
  const one = view.banner
  els.banner.textContent = ''
  els.banner.hidden = !one
  els.banner.className = one ? one.level : ''
  if (!one) return
  const text = document.createElement('div')
  text.className = 'btext'
  text.textContent = one.text
  // 后面一截灰色小字：「· Si429 错误，原文」，查日志时对得上
  if (one.code) {
    const tag = document.createElement('span')
    tag.className = 'code'
    tag.textContent = codeTail(one.code, one.raw)
    text.append(tag)
  }
  els.banner.append(text)
  if (one.buttons.length) {
    const btns = document.createElement('div')
    btns.className = 'btns'
    for (const b of one.buttons) { btns.append(buttonFor(b)); if (b.action === 'consent') void consentGate.offer(b.round) } // 「使用须知」那个钮：横幅一画出来就弹一次（同一轮只弹一次）
    els.banner.append(btns)
  }
  if (one.level === 'notice') {
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'x'
    close.textContent = '×'
    close.title = view.labels.dismiss
    close.addEventListener('click', () => act({ type: 'dismiss' }))
    els.banner.append(close)
  }
}

// 小签：文件变成输入区上沿的小签，签多了收成 +n；画法在 ./tagrow.mjs

function renderTags() {
  tagRow.render()
}

// 窗高定一条：拖底边把手改（算法在主进程的 height.mjs），这里只量指针。
// 面板高 = 窗高减上下给阴影留的余量
const panelHeight = () => innerHeight - SHADOW_TOP - SHADOW_BOTTOM

// 静下来以后那两句的轮换、等待行的倒数：自己走（表在 ./tick.mjs：
// 只在真有东西要倒数的时候才开，页面藏起来也停）
const tick = createTick({ flow: els.flow, hidden: () => document.visibilityState === 'hidden' })

function render(next) {
  const first = !view
  // 同一个视图不重画：重画会把按钮换掉，鼠标点下去就落空
  const json = JSON.stringify(next)
  if (json === lastJson) return
  lastJson = json
  const wasFocus = view ? view.input.focus : false
  view = next
  document.title = view.title
  els.wherename.textContent = folderLabel(view.top.path)
  // 名字长了胶囊里是省略号：停上去看全名
  els.wherebtn.title = els.wherename.textContent
  // 「预览」的小图标：这次对话有成品或材料才露出来
  const preview = view.top.preview
  els.previewbtn.hidden = !previewShown(preview)
  if (!els.previewbtn.hidden) els.previewbtn.title = t('output.preview')
  // 干活中也能点：这一条留在后台接着跑，另开一条新的
  els.newtask.textContent = view.top.newTask
  // 历史下拉跟着视图走：当前那条换了重描一遍
  historyView.setView({ currentId: view.top.historyId, statusSig: view.statusSig })
  renderTags()
  // 输入框上方那句提醒：图、扫描件现在的模型看不了（只提醒，带一个「去配」）
  els.notes.textContent = ''
  if (view.remind) {
    const line = document.createElement('div')
    line.className = 'remind'
    // 「去配」开设置·模型；「去选」打开换模型的菜单（跟横幅上「换模型」同一个口子）
    line.append(document.createTextNode(view.remind.text), buttonFor({ action: view.remind.action, label: view.remind.label }))
    els.notes.append(line)
  }
  els.notes.hidden = !view.remind
  renderBanner()
  els.input.placeholder = view.input.hint
  // 干活中：发送钮一直是发，停下另有一个钮；停在这儿（模型一直忙）时发送钮变成「接着干」
  els.sendtext.textContent = view.input.button === 'stop' ? view.labels.stop : view.input.button === 'continue' ? view.labels.continue : view.labels.send
  els.send.classList.toggle('stop', view.input.button === 'stop')
  // 现在的模型看不了图、这几份还没发出去：发送钮灰着（回车也发不出去，trySend 认 input.canSend）
  els.send.disabled = view.input.canSend === false && view.input.button === 'send'
  els.stop.hidden = view.phase !== 'working'
  els.stop.textContent = view.labels.stop
  // 要回话的、带了文件的画面自动展开；没内容也不在打字的收回去
  if (view.input.focus && (!wasFocus || first)) setInputOpen(true, true)
  else if (!els.input.value.trim() && document.activeElement !== els.input && !modelsMenu.isOpen()) setInputOpen(false)
  renderFlow()
  // 有没有东西要倒数：有就开秒表，没有就停（空闲时页面上一个表都不留）
  tick.sync()
  // 换模型的小签跟着视图走：干活中变灰、不能点
  modelsMenu.render(modelsData, view.phase)
}

function trySend() {
  if (!view || !view.input.canSend) return
  const text = els.input.value
  if (!text.trim()) return
  // 干活中发出去的是插进去的那一句，不干活时是新的一轮
  forceBottom = true // 发完滚到底，别跳顶
  act({ type: view.phase === 'working' ? 'steer' : 'send', text })
  els.input.value = ''
  setInputOpen(false) // 发完收回胶囊
}

function hideDrop() {
  els.drop.hidden = true
  for (const one of els.drop.querySelectorAll('.zone')) one.classList.remove('on')
}

function bind() {
  // 胶囊整块一个按钮：点哪都是开关「历史记录」下拉
  els.wherebtn.addEventListener('click', () => historyView.toggle())
  // 「预览」的小图标：打开预览窗看这次对话（选中最新的一份成品）
  els.previewbtn.addEventListener('click', () => {
    const preview = view && view.top.preview
    if (preview && preview.path) act({ type: 'preview-folder', path: preview.path })
  })
  // 小签：点开把列表重新拿一遍再弹（密钥、同意状态可能刚变过），再点一下或点外面就收
  modelsMenu.chip.addEventListener('click', (event) => {
    event.stopPropagation()
    if (modelsMenu.chip.disabled) return
    if (modelsMenu.isOpen()) { modelsMenu.closeMenu(); return }
    void refreshModels()
    modelsMenu.openMenu()
  })
  els.newtask.addEventListener('click', () => {
    act({ type: 'new' })
    // 新任务回到清单默认选的模型，把当前那一口重新拿一遍
    void refreshModels()
  })
  els.addfile.addEventListener('click', () => act({ type: 'add' }))
  // 输入胶囊：点一下展开；开始打字也展开；失焦且没内容时收回
  els.inputwrap.addEventListener('pointerdown', () => {
    if (!inputOpen) setInputOpen(true, true)
  })
  els.input.addEventListener('input', () => {
    if (!inputOpen && els.input.value) setInputOpen(true, false)
  })
  els.input.addEventListener('blur', () => {
    if (inputOpen && !els.input.value.trim() && !modelsMenu.isOpen()) setInputOpen(false)
  })
  addEventListener('pointerdown', (event) => {
    // 点胶囊自己不算「点外面」：下拉的开关交给胶囊的点击处理
    if (!els.wherebtn.contains(event.target)) historyView.outside(event.target)
    if (!els.tagmenu.hidden && !els.tagmenu.contains(event.target)) els.tagmenu.hidden = true
    // 「思考」二级菜单是挂在外面的另一层：点它不算点外面，不然按下去菜单就收了、档位点不上
    const inMenu = modelsMenu.popup.contains(event.target) || modelsMenu.sub.contains(event.target) || modelsMenu.chip.contains(event.target)
    if (modelsMenu.isOpen() && !inMenu) modelsMenu.closeMenu()
  }, true)
  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    // 弹层、下拉、菜单开着先关它们；都没开就把任务窗收起来（输入框里有字也收，字留着）
    const what = escapeAction({
      history: historyView.isOpen() || historyView.isPageOpen(),
      tag: !els.tagmenu.hidden,
      models: modelsMenu.isOpen(),
      inputOpen,
      inputEmpty: !els.input.value.trim(),
    })
    if (what === 'history') { historyView.onEscape(); return }
    if (what === 'tag') { els.tagmenu.hidden = true; return }
    if (what === 'models') { modelsMenu.closeMenu(); return }
    if (what === 'input') { setInputOpen(false); return }
    if (bridge && typeof bridge.hide === 'function') bridge.hide()
  })
  els.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    trySend()
  })
  els.send.addEventListener('click', () => {
    if (!view) return
    if (view.input.button === 'continue') { act({ type: 'continue' }); return }
    trySend()
  })
  els.stop.addEventListener('click', () => {
    if (!view) return
    act({ type: 'stop' })
  })
  els.flow.addEventListener('scroll', () => {
    stick = atBottom()
    updateLatest()
  })
  // 任务窗收起来（页面藏起来）的时候秒表停；露出来再接着走
  document.addEventListener('visibilitychange', () => tick.sync())
  els.latest.addEventListener('click', () => {
    stick = true
    els.flow.scrollTop = els.flow.scrollHeight
    updateLatest()
  })
  // 底边把手：拖着改窗高，算法在主进程；抬手那一下记下来
  els.handlebar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragOn = true
    dragFrom = panelHeight()
    dragY = event.clientY
    try { els.handlebar.setPointerCapture(event.pointerId) } catch { /* 没抓住也能拖 */ }
    event.preventDefault()
  })
  els.handlebar.addEventListener('pointermove', (event) => {
    if (!dragOn || !bridge) return
    bridge.height({ from: dragFrom, startY: dragY, nowY: event.clientY })
  })
  const endDrag = (event, commit) => {
    if (!dragOn) return
    dragOn = false
    if (bridge) bridge.height({ from: dragFrom, startY: dragY, nowY: event.clientY, commit })
  }
  els.handlebar.addEventListener('pointerup', (event) => endDrag(event, true))
  els.handlebar.addEventListener('pointercancel', (event) => endDrag(event, false))
  // 拖着文件进窗：整窗一块，压上去变实线（干活中拖进来的也收：挂在输入框上，跟下一句一起发）。
  // 从自己的产出卡拖出去的：还没离开过这个窗口就不接（不显示那一层、松手也不落）；出去再回来才接
  const inOwnWindow = () => Boolean(outDrag && !outDrag.left)
  addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files') || inOwnWindow()) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    els.drop.hidden = false
  })
  addEventListener('dragleave', (event) => {
    if (event.relatedTarget) return
    if (outDrag) outDrag.left = true
    hideDrop()
  })
  addEventListener('drop', () => {
    outDrag = null
    hideDrop()
  })
  if (bridge && typeof bridge.onDragEnd === 'function') bridge.onDragEnd(() => { outDrag = null; hideDrop() })
  els.drop.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files') || inOwnWindow()) return
    event.preventDefault()
    const zone = event.target.closest('.zone')
    for (const one of els.drop.querySelectorAll('.zone')) one.classList.toggle('on', one === zone)
  })
  els.drop.addEventListener('drop', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    hideDrop()
    if (bridge) bridge.drop([...event.dataTransfer.files])
  })
}

bind()
if (bridge) {
  // 有壳才有收起状态：壳说一声才垂下来
  panel.classList.add('closed')
  bridge.onView((next) => render(next))
  bridge.onAnim((kind) => playAnim(kind))
  bridge.ready().then((first) => { if (first) render(first) }).catch(() => {})
  void refreshModels()
}
