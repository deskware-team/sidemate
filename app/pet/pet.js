// 小岛这一页：墨色小条、一双眼睛、冒的那一行，还有接文件时的接收托。
// 小动作：待命东张西望、犯困，鼠标靠近看你，干活读稿、想一想，接文件的期待、
// 做完了跳一下、没干成摇头、拖着走 > <。时长和幅度都在 eyes.mjs。
// 界面纯 JavaScript，不用框架、不用打包器。

import { theme, applyFont } from './theme.mjs'
import { bootPlan } from './intro.mjs'
import { endGesture, moveGesture, startGesture } from './gesture.mjs'
import { BLINK, DRAG, EXPECT, GLANCE, HOP, NEAR, SCAN, SHAKE, SLEEPY, THINK, eyeOf, glancePlan, readPlan, sameShape, swapFrom } from './eyes.mjs'
import { sleepyOf } from './sleepy.mjs'
import { layoutFor } from './layout.mjs'
import { paint } from '../copy/copy.mjs'

// 页面里写死的字（html 上的 data-t）：小岛第一次显示前先换掉
paint(document)

const body = document.body
const strip = document.getElementById('strip')
const eyes = document.getElementById('eyes')
const bubbleText = document.getElementById('bubble-text')
const bubbleActions = document.getElementById('bubble-actions')
const measureBox = document.getElementById('measure')
const media = matchMedia('(prefers-reduced-motion: reduce)')

let scene = 'strip'
let mode = 'idle'
let forcedStill = false
let blinkTimer = null
let thinkTimer = null
let thinkHoldTimer = null
let gesture = null
let depth = 0
let introStarted = false
let introLineSet = false
let lastScene = 'strip'
// 冒的那一行有多宽（页面上量的自然宽度）
let lineWidth = 0
// 平时那几句轮换：这一组、上次张开时是第几句（-1 是还没张开过）
let tips = null
let tipAt = -1
// 待命的小动作
let glanceTimer = null // 东张西望：每 10–20 秒往左或右看一眼
let glancing = false // 东张西望正走到一半
// 眼皮：'open' 睁着 / 'closing' 正在闭 / 'opening' 正在睁。眨眼和换形状都走它
let lid = 'open'
let lidTimer = null
let lastBlinkAt = 0
let shown = 'open' // 现在画着的眼神
let wanted = 'open' // 闭着眼的那一刻要换成的眼神
// 干活读稿：眼睛在这一行的哪儿（SVG 单位）
let readTimer = null
let readX = 0
let thinking = false
let sleepyTimer = null // 犯困：10 分钟没动静的检查
let wakeTimer = null
let lastActive = Date.now() // 上回有动静是什么时候
let sleepyOn = false
let nearOn = false // 看你：鼠标在小岛 120px 内（壳里轮询算好发来）
let hoverOn = false // 鼠标正停在小岛上
let dragEyes = false // 拖着走：眼睛是 > <，松手 150ms 恢复
let dragBackTimer = null

const still = () => forcedStill || media.matches
// 待命的小动作能不能做：待命着、没关动画、没犯困、没拖着
const idleQuiet = () => mode === 'idle' && !still() && !sleepyOn && !dragEyes

// 字号变了，小岛的高度、眼睛、表情区宽度、文字区边距都跟着变
function applyLayout(size = theme.font) {
  // 主题里那套尺寸也跟着换（页面里算文字区宽窄用的就是它，别留上一档的数）
  applyFont(size)
  const box = layoutFor(size)
  const style = body.style
  style.setProperty('--font-size', `${box.font}px`)
  style.setProperty('--font-stack', theme.fontStack)
  style.setProperty('--island-w', `${box.island}px`)
  style.setProperty('--island-h', `${box.height}px`)
  style.setProperty('--line-h', `${box.lineHeight}px`)
  style.setProperty('--eye-zone', `${box.eyeZone}px`)
  style.setProperty('--zone-gap', `${box.zoneGap}px`)
  style.setProperty('--pad-right', `${box.padRight}px`)
  style.setProperty('--text-pad', `${box.textPad}px`)
  style.setProperty('--dot-right', `${box.dotRight}px`)
  style.setProperty('--dot-top', `${box.dotTop}px`)
  style.setProperty('--dot-size', `${box.dotSize}px`)
  // 眼睛的平移都是 SVG 单位：乘这一档小岛的比例换成 px（svg 等比缩放，取宽高里小的那个）
  style.setProperty('--eye-u', `${Math.min(box.island / 112, box.height / 30)}`)
  // 展开时往左挪多少 px：整条宽的一半 − 表情区宽的一半（标准档是 28）
  style.setProperty('--eye-shift', `${box.island / 2 - box.eyeZone / 2}`)
  // 跟壳里改窗口大小同一个时长
  style.setProperty('--expand-ms', `${theme.expandMs}ms`)
  style.setProperty('--collapse-ms', `${theme.collapseMs}ms`)
  return box
}
applyLayout()
// 一开始先画上睁眼，别等状态来之前一个形状都没有
paintEyes('open')

function applyScene(next) {
  // 平时那几句：每次张开换下一句
  if (next === 'expanded' && scene !== 'expanded' && tips) {
    tipAt = (tipAt + 1) % tips.length
    bubbleText.textContent = tips[tipAt]
  }
  scene = next
  body.dataset.scene = next
  if (next !== 'tray') strip.classList.remove('hot')
  // 换场景把定时器收干净：接文件时眼睛睁大等着、细线里眼睛看不见；回来了再排
  if (next === 'tray' || next === 'line') stopIdleLife()
  else scheduleIdleLife()
  layoutLine()
}

function applyMode(next, options = {}) {
  const prev = mode
  mode = next
  body.dataset.mode = next
  // 同一个状态又推了一遍（干活中进度一来就推）：读稿、想一想接着来，不从头起
  const changed = prev !== next
  if (changed) {
    stopThinking()
    stopReading()
  }
  if (!options.keepEyes && !dragEyes && !thinking) setEyes(eyeOf(next))
  if (next !== 'idle') {
    // 出了待命：待命的小动作都收回去（犯困睁眼、看你回正）
    sleepyOn = false
    eyes.classList.remove('sleepy', 'waking')
    clearTimeout(wakeTimer)
    wakeTimer = null
    clearGlance()
    nearOn = false
  }
  // 换了状态视线慢慢回正（读稿、东张西望、看你停在哪儿都从那儿滑回来，不瞬移）
  if (changed) setEyeMove(0, 0, NEAR.backMs, 'var(--curve-settle)')
  scheduleIdleLife()
  // 做完了跳一下、没干成摇头：进这两个状态那一下放一次
  if (!still()) {
    if (next === 'done' && prev !== 'done') playHop()
    if (next === 'fail' && prev !== 'fail') playShake()
  }
}

// 换眼神：待命睁眼、干活往下看、要看一眼睁大、做完了笑眼、没干成一条平线、想一想、拖着走 > <。
// 形状不一样就藏在一次眨眼里换（闭上 → 换 → 睁开时从旧形状的位置滑过来）；
// 同一个形状（睁眼 ↔ 往上看）、关了动画、定在静止帧时直接换
function setEyes(look) {
  if (still()) { showNow(look); return }
  wanted = look
  if (sameShape(shown, look) && lid === 'open') { paintEyes(look); return }
  closeLid()
}

// 直接换、不眨眼（关了动画、静止帧、收摊的时候）：眼皮也直接睁开，不留半闭
function showNow(look) {
  wanted = look
  clearTimeout(lidTimer)
  lidTimer = null
  lid = 'open'
  eyes.classList.remove('blink', 'swap-jump')
  eyes.style.setProperty('--swap-dx', '0')
  eyes.style.setProperty('--swap-dy', '0')
  paintEyes(look)
}

function paintEyes(look) {
  for (const one of ['open', 'down', 'wide', 'smile', 'flat', 'up', 'closed', 'think', 'drag']) eyes.classList.remove(`mode-${one}`)
  eyes.classList.add(`mode-${look}`)
  shown = look
}

// 闭着眼的那一刻换形状：新形状先摆在旧形状的中心（不过渡），睁眼的同时滑回自己的位置
function swapWhileClosed(look) {
  const [dx, dy] = swapFrom(shown, look)
  eyes.classList.add('swap-jump')
  eyes.style.setProperty('--swap-dx', String(dx))
  eyes.style.setProperty('--swap-dy', String(dy))
  paintEyes(look)
  void eyes.offsetWidth
  eyes.classList.remove('swap-jump')
  eyes.style.setProperty('--swap-dx', '0')
  eyes.style.setProperty('--swap-dy', '0')
}

// 眼皮：闭 80ms（先慢后快）→ 要换形状就这时候换 → 睁 140ms（先快后慢；要你看一眼睁得带弹性）
function closeLid() {
  if (lid === 'closing') return
  clearTimeout(lidTimer)
  lid = 'closing'
  lastBlinkAt = Date.now()
  eyes.style.setProperty('--lid-ms', `${BLINK.closeMs}ms`)
  eyes.style.setProperty('--lid-curve', 'var(--curve-lid-close)')
  eyes.classList.add('blink')
  lidTimer = setTimeout(openLid, BLINK.closeMs)
}

function openLid() {
  if (wanted !== shown) swapWhileClosed(wanted)
  lid = 'opening'
  eyes.style.setProperty('--lid-ms', `${BLINK.openMs}ms`)
  eyes.style.setProperty('--lid-curve', wanted === 'wide' ? 'var(--curve-bounce)' : 'var(--curve-lid-open)')
  eyes.classList.remove('blink')
  lidTimer = setTimeout(() => { lid = 'open'; lidTimer = null }, BLINK.openMs)
}

// —— 待命的小动作 ——

// 往哪儿看（东张西望、看你、读稿共用）：单位是 SVG 单位；ms 和曲线每回给
function setEyeMove(dx, dy, ms, curve = 'var(--curve-settle)') {
  eyes.style.setProperty('--eye-dx', String(dx))
  eyes.style.setProperty('--eye-dy', String(dy))
  eyes.style.setProperty('--move-ms', `${ms}ms`)
  eyes.style.setProperty('--move-curve', curve)
}

const CURVES = { saccade: 'var(--curve-saccade)', settle: 'var(--curve-settle)' }

// 有动静了：犯困重新计时，睡着了就睁开
function touchActivity() {
  lastActive = Date.now()
  wake()
  scheduleSleepy()
}

// 睁开（250ms）并重新计时
function wake() {
  if (!sleepyOn) return
  sleepyOn = false
  eyes.classList.remove('sleepy')
  eyes.classList.add('waking')
  clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => eyes.classList.remove('waking'), SLEEPY.wakeMs)
  scheduleBlink()
  scheduleGlance()
}

// 犯困时不眨、不东张西望
function fallAsleep() {
  if (sleepyOn) return
  sleepyOn = true
  clearTimeout(blinkTimer)
  blinkTimer = null
  clearGlance()
  setEyeMove(0, 0, GLANCE.backMs, 'var(--curve-settle)')
  clearTimeout(wakeTimer)
  wakeTimer = null
  eyes.classList.remove('waking')
  eyes.classList.add('sleepy')
}

function scheduleSleepy() {
  clearTimeout(sleepyTimer)
  sleepyTimer = null
  if (mode !== 'idle' || still()) return
  const plan = sleepyOf({ mode, lastActive, now: Date.now(), near: nearOn, hover: hoverOn })
  if (plan.sleepy) { fallAsleep(); return }
  if (sleepyOn) wake()
  sleepyTimer = setTimeout(scheduleSleepy, Math.max(1000, SLEEPY.idleMs - (Date.now() - lastActive)))
}

// 东张西望走到一半被打断（张开收起、换状态、看你）：别把眼睛晾在一边，慢慢回正；
// 接着要看别处的，调用方随后自己给新目标
function clearGlance() {
  clearTimeout(glanceTimer)
  glanceTimer = null
  if (!glancing) return
  glancing = false
  setEyeMove(0, 0, GLANCE.backMs, 'var(--curve-settle)')
}

function scheduleGlance() {
  clearGlance()
  // 和「看你」「犯困」互斥：那两个在时不东张西望
  if (!idleQuiet() || nearOn) return
  const wait = GLANCE.minMs + Math.random() * (GLANCE.maxMs - GLANCE.minMs)
  glanceTimer = setTimeout(glance, wait)
}

// 东张西望：往左或右一跳（150ms 带过冲）→ 停一会儿（每回不一样长）→ 偶尔再瞟另一边 → 慢慢回正。
// 偶尔起步顺带眨一下（眼珠大跳时眨眼，像真的在转头看）。
function glance() {
  if (!idleQuiet() || nearOn) return
  const plan = glancePlan(Math.random)
  if (plan.blink && Date.now() - lastBlinkAt > BLINK.gapMs) blink()
  glancing = true
  const run = (index) => {
    if (!idleQuiet() || nearOn) return
    const step = plan.steps[index]
    if (!step) { glancing = false; scheduleGlance(); return }
    setEyeMove(step.dx, 0, step.ms, CURVES[step.curve])
    glanceTimer = setTimeout(() => run(index + 1), step.ms + step.hold)
  }
  run(0)
}

// —— 干活读稿 ——

function stopReading() {
  clearTimeout(readTimer)
  readTimer = null
}

// 干活中（没在想、没被拖着）：一小跳一小跳往右读，读到行尾扫回来；已经在读就接着读
function scheduleRead() {
  if (readTimer || mode !== 'work' || still() || dragEyes || thinking) return
  readTimer = setTimeout(readStep, SCAN.firstMs)
}

function readStep() {
  readTimer = null
  if (mode !== 'work' || still() || dragEyes || thinking) return
  const plan = readPlan(readX, Math.random)
  readX = plan.x
  setEyeMove(plan.x, 0, plan.ms, CURVES[plan.curve])
  if (plan.blink && Date.now() - lastBlinkAt > BLINK.gapMs) blink()
  readTimer = setTimeout(readStep, plan.ms + plan.hold)
}

// —— 一次性动画 ——

// 做完了：整个岛往上跳 2px 再落下（弹一下曲线 300ms），只跳一次
function playHop() {
  strip.classList.remove('hop')
  void strip.offsetWidth
  strip.classList.add('hop')
  setTimeout(() => strip.classList.remove('hop'), HOP.ms)
}

// 没干成：岛左右晃 2px 两次，共 240ms
function playShake() {
  strip.classList.remove('shake')
  void strip.offsetWidth
  strip.classList.add('shake')
  setTimeout(() => strip.classList.remove('shake'), SHAKE.ms)
}

// —— 拖着走 · > < ——

// 被拖那一刻眼睛换成 > <；松手 150ms 恢复到当前状态的眼神。各种状态下拖都这样。
function dragFace(on) {
  if (on) {
    dragEyes = true
    clearTimeout(dragBackTimer)
    dragBackTimer = null
    clearGlance()
    stopReading()
    stopThinking()
    clearTimeout(blinkTimer)
    blinkTimer = null
    sleepyOn = false
    eyes.classList.remove('sleepy', 'waking', 'expect')
    if (nearOn) nearOn = false
    setEyeMove(0, 0, NEAR.backMs, 'var(--curve-settle)')
    setEyes('drag')
    body.dataset.dragging = '1'
    return
  }
  clearTimeout(dragBackTimer)
  dragBackTimer = setTimeout(() => {
    dragBackTimer = null
    dragEyes = false
    delete body.dataset.dragging
    setEyes(eyeOf(mode))
    scheduleIdleLife()
  }, DRAG.backMs)
}

// 换状态、换场景、藏起来时把定时器收干净（拖着走恢复那一个不算，松手自己管）
function stopIdleLife() {
  clearTimeout(blinkTimer)
  blinkTimer = null
  clearGlance()
  stopReading()
  clearTimeout(thinkTimer)
  thinkTimer = null
  stopThinking(false)
  // 正眨到一半就收摊：眼皮直接睁开，别留着半闭
  if (lid !== 'open') showNow(wanted)
  clearTimeout(sleepyTimer)
  sleepyTimer = null
  clearTimeout(wakeTimer)
  wakeTimer = null
  eyes.classList.remove('expect')
  strip.classList.remove('bounce', 'hop', 'shake')
  setEyeMove(0, 0, 0)
}

function scheduleIdleLife() {
  scheduleBlink()
  scheduleGlance()
  scheduleSleepy()
  scheduleThink()
  scheduleRead()
}

// 待命时隔一阵眨一下：4–8 秒随机，偶尔连眨两下；干活中 3–5 秒随机一次
function scheduleBlink() {
  clearTimeout(blinkTimer)
  blinkTimer = null
  if (still()) return
  if (mode === 'idle') {
    if (sleepyOn || dragEyes) return
    const wait = theme.blinkMinMs + Math.random() * (theme.blinkMaxMs - theme.blinkMinMs)
    blinkTimer = setTimeout(() => {
      // 偶尔连眨两下（约 1/5 的几率）
      if (Math.random() < BLINK.twiceChance) blinkTwice()
      else blink()
      scheduleBlink()
    }, wait)
    return
  }
  if (mode === 'work') {
    const wait = BLINK.minMs + Math.random() * (BLINK.maxMs - BLINK.minMs)
    blinkTimer = setTimeout(() => { blink(); scheduleBlink() }, wait)
  }
}

// 干活中隔一阵停下来往右上看（想一想）：6–10 秒随机，停 800ms 再回去读稿
function scheduleThink() {
  clearTimeout(thinkTimer)
  thinkTimer = null
  if (mode !== 'work' || still()) return
  const wait = THINK.minMs + Math.random() * (THINK.maxMs - THINK.minMs)
  thinkTimer = setTimeout(() => { think(); scheduleThink() }, wait)
}

// 想一想：停下读稿，眨一下换成右上的小圆眼（从扁条的位置滑过去），停 800ms，再眨一下换回来接着读
function think() {
  if (mode !== 'work' || still() || dragEyes || thinking) return
  thinking = true
  body.dataset.thinking = '1'
  stopReading()
  setEyeMove(0, 0, BLINK.closeMs + BLINK.openMs, 'var(--curve-settle)')
  setEyes('think')
  clearTimeout(thinkHoldTimer)
  thinkHoldTimer = setTimeout(stopThinking, BLINK.closeMs + THINK.holdMs)
}

// resume：还在干活就眨一下换回往下看、从行首接着读；false 是收摊（藏起来、换场景），直接换回，不接着读。
// 换了状态的由 applyMode 自己换眼神
function stopThinking(resume = true) {
  clearTimeout(thinkHoldTimer)
  thinkHoldTimer = null
  if (body.dataset.thinking) delete body.dataset.thinking
  if (!thinking) return
  thinking = false
  if (mode !== 'work' || dragEyes) return
  if (!resume) { showNow('down'); return }
  setEyes('down')
  readX = 0
  scheduleRead()
}

// 眨一下（关了动画、犯困时不眨；正在闭眼的那一下 closeLid 自己挡）
function blink() {
  if (still() || sleepyOn) return
  closeLid()
}

// 有新早报：眨两下（用同一个眨眼动画；关了「显示动画」blink 自己会挡，只亮红点）
function blinkTwice() {
  blink()
  setTimeout(blink, BLINK.closeMs + BLINK.openMs + 40)
}

function setBubble(line) {
  // 平时那几句轮换：每次张开换一句（applyScene 里换），量的时候按最宽的那句量
  tips = Array.isArray(line?.tips) && line.tips.length ? line.tips.slice() : null
  bubbleText.textContent = tips ? tips[Math.max(0, tipAt) % tips.length] : (line?.text || '')
  bubbleActions.textContent = ''
  for (const action of line?.actions || []) {
    const button = document.createElement('button')
    button.className = 'action'
    button.type = 'button'
    button.textContent = action.label
    button.dataset.id = action.id
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      pet.action(action.id)
    })
    bubbleActions.append(button)
  }
  measure()
}

// 量出那行字有多宽，壳照这个把条拉长
// 量的时候要把「字 + 空 + 能点的」整组一起量：
// 只量字会少 8px（空的那一组也算一个间距），窗口就窄 8px，
// 靠右排的字会往左溢出去，第一个字被裁掉
function measure() {
  let width = 0
  // 平时那几句轮换：一句一句量，按最宽的那句定宽，换句子时窗口不用跟着变
  for (const text of tips || [bubbleText.textContent]) {
    measureBox.textContent = ''
    measureBox.append(bubbleText.cloneNode(true), bubbleActions.cloneNode(true))
    measureBox.firstChild.textContent = text
    width = Math.max(width, measureBox.getBoundingClientRect().width)
  }
  lineWidth = width
  pet.measure(Math.ceil(width))
  layoutLine()
}

// 字放得下才露出来：
// 窗口从 112 长到够宽，中间那一下不露字，免得第一个字被裁掉半个；
// 顶到 460 还是放不下，字自己收成省略号。
function layoutLine() {
  if (scene !== 'expanded' || !lineWidth) { body.dataset.bubble = 'hidden'; return }
  const box = layoutFor(theme.font)
  // 文字区有多宽：字在区里居中，两边各留 8
  const room = body.clientWidth - box.eyeZone - box.zoneGap - box.padRight - box.textPad * 2
  if (room >= lineWidth - 0.5) { body.dataset.bubble = 'fit'; return }
  if (body.clientWidth >= box.bubbleHardMax - 0.5) { body.dataset.bubble = 'tight'; return }
  body.dataset.bubble = 'hidden'
}

function bindPointer() {
  strip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    touchActivity()
    try { strip.setPointerCapture(event.pointerId) } catch { /* 抓不住就算了 */ }
    // 先只记下起点：挪够 4px（DRAG_THRESHOLD_PX）才算拖，点一下不发 drag
    gesture = startGesture({ x: event.screenX, y: event.screenY })
  })
  document.addEventListener('pointermove', (event) => {
    if (!gesture) return
    const next = moveGesture(gesture, { x: event.screenX, y: event.screenY })
    if (next === gesture) return
    // 挪够了，这一下才算拖：这才开始收小条、跟鼠标走，眼睛换成 > <
    gesture = next
    pet.dragStart()
    dragFace(true)
  })
  const release = (event) => {
    if (!gesture) return
    const what = endGesture(gesture, { x: event.screenX, y: event.screenY })
    gesture = null
    touchActivity()
    if (what === 'drag') pet.dragEnd()
    else pet.click()
    if (what === 'drag') dragFace(false)
  }
  document.addEventListener('pointerup', release)
  document.addEventListener('pointercancel', release)
  addEventListener('contextmenu', (event) => { event.preventDefault(); touchActivity(); pet.menu() })
  // 「停在小岛上」只看得见的那一截算数：鼠标停在 #strip 上才算停在岛上；
  // 停在窗里下面那截透明的地方不算——底色只画主题那么高，
  // 窗被 Windows 垫出来的那一截是透明的，停在上面不该冒字、也不该把小岛叫回来。
  strip.addEventListener('mouseover', (event) => {
    // 在同一块里挪（从眼睛挪到字）：不算新的进入
    if (event.relatedTarget && strip.contains(event.relatedTarget)) return
    hoverOn = true
    touchActivity()
    pet.hover()
  })
  strip.addEventListener('mouseout', (event) => {
    if (event.relatedTarget && strip.contains(event.relatedTarget)) return
    hoverOn = false
    scheduleSleepy()
    pet.leave()
  })
}

function bindDrop() {
  addEventListener('dragenter', (event) => {
    event.preventDefault()
    touchActivity()
    if (depth++ === 0) pet.dragEnter()
  })
  addEventListener('dragover', (event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    // 文件压在长开的小岛上：描一圈边
    const box = strip.getBoundingClientRect()
    strip.classList.toggle('hot', event.clientY <= box.bottom)
  })
  addEventListener('dragleave', () => {
    if (--depth !== 0) return
    strip.classList.remove('hot')
    pet.dragLeave()
  })
  addEventListener('drop', (event) => {
    event.preventDefault()
    depth = 0
    touchActivity()
    strip.classList.remove('hot')
    pet.drop([...event.dataTransfer.files], { x: event.clientX, y: event.clientY })
  })
}

// 被点那一下：缩到 0.96 再弹回
function playPress(payload) {
  if (still()) return
  const scale = Number(payload?.scale) || 0.96
  const downMs = Number(payload?.downMs) || 80
  const backMs = Number(payload?.backMs) || 120
  strip.style.setProperty('--press-scale', String(scale))
  strip.classList.remove('press', 'press-back')
  void strip.offsetWidth
  strip.classList.add('press')
  setTimeout(() => {
    strip.classList.remove('press')
    strip.classList.add('press-back')
    setTimeout(() => strip.classList.remove('press-back'), backMs)
  }, downMs)
}

pet.onState((payload) => {
  // 状态一变：犯困睁眼、重新计时
  touchActivity()
  applyMode(payload.mode || 'idle')
})
pet.onBubble((line) => setBubble(line))
// 有新早报：亮红点、眨两下；看过了红点熄
pet.onNews((payload) => {
  if (payload?.dot === true) body.dataset.news = '1'
  else delete body.dataset.news
  if (payload?.blink === true) blinkTwice()
})
pet.onScene((payload) => { lastScene = payload.scene || 'strip'; applyScene(lastScene) })
// 看你：壳里轮询鼠标，算好偏移发来（只在待命）。
// 刚进来一跳并眨一下（「看到你了」）；之后每个新目标都从当前位置先快后慢地追过去；离开慢慢回正
pet.onNear((payload) => {
  const was = nearOn
  nearOn = payload?.near === true
  if (nearOn) {
    // 鼠标进了 120px：算动静，睡着了就睁开；看你时东张西望停
    const sleeping = sleepyOn
    touchActivity()
    clearGlance()
    if (!idleQuiet()) return
    const dx = payload?.dx || 0
    const dy = payload?.dy ?? NEAR.liftPx
    if (was) { setEyeMove(dx, dy, NEAR.moveMs, 'var(--curve-follow)'); return }
    setEyeMove(dx, dy, NEAR.noticeMs, 'var(--curve-saccade)')
    if (!sleeping && Date.now() - lastBlinkAt > BLINK.gapMs) blink()
    return
  }
  if (was) {
    if (idleQuiet()) setEyeMove(0, 0, NEAR.backMs, 'var(--curve-settle)')
    scheduleGlance()
    scheduleSleepy()
  }
})
// 接文件·期待：眼睛放大到 1.2、岛弹一下；壳等 250ms 才张开成接收托
pet.onExpect((payload) => {
  if (payload?.phase === 'enter' && !still()) {
    eyes.classList.add('expect')
    strip.classList.remove('bounce')
    void strip.offsetWidth
    strip.classList.add('bounce')
    setTimeout(() => strip.classList.remove('bounce'), EXPECT.bounceMs)
    return
  }
  eyes.classList.remove('expect')
  strip.classList.remove('bounce')
})
// 小岛露脸（叫回来、开机）：定时器重新排，动静从现在重新算
pet.onShown(() => {
  lastActive = Date.now()
  wake()
  scheduleIdleLife()
})
// 首次运行的小岛出场：壳说滑、说落定、说冒一行，这里只管眼睛和字
pet.onIntro((payload) => {
  introStarted = true
  const phase = payload?.phase || 'slide'
  if (phase === 'slide') { setEyes('up'); return }
  if (phase === 'land') { setEyes('open'); blink(); return }
  if (phase === 'line') {
    introLineSet = true
    setBubble({ text: payload.text || '', actions: [] })
    pet.introLine()
  }
})
pet.onPress((payload) => playPress(payload))
// 小岛大小那档变了：整套尺寸重算，眼睛、冒的那行字、红点都跟着
pet.onLayout((payload) => { if (payload?.font) applyLayout(payload.font) })

bindPointer()
bindDrop()
addEventListener('resize', layoutLine)
const boot = await pet.ready()
forcedStill = !!boot.still
if (forcedStill) body.classList.add('still')
// 主进程算好的那套尺寸（含小岛大小那档）：页面这边跟着重算一遍
if (boot.font) applyLayout(boot.font)
// 红点在页面起来之前就亮着的（比如刚生成好），开机补上
if (boot.news === true) body.dataset.news = '1'
// 场景和状态照开机那套来；眼神要是出场已经定过了就别盖回去
const plan = bootPlan({ introStarted, introLineSet, bootScene: boot.scene || 'strip', lastScene })
applyScene(plan.scene)
applyMode(boot.mode || 'idle', { keepEyes: plan.keepEyes })
// 出场已经冒过那一行了，就别拿开机那行盖回去
if (plan.setBubble) setBubble(boot.bubble || { text: '', actions: [] })
