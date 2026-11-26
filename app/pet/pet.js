// 小岛这一页：墨色小条、一双眼睛、冒的那一行，还有接文件时的接收托。
// 眼睛和整岛的小动作都交给弹簧引擎（poses.mjs 给目标、motion.mjs 追）：
// 这边只把状态翻成神情（poseFor）、把鼠标和拖着的文件翻成视线（setGaze），
// 排帧、眨眼、东张西望的定时都归 animator.mjs。
// 界面纯 JavaScript，不用框架、不用打包器。

import { theme, applyFont } from './theme.mjs'
import { bootPlan } from './intro.mjs'
import { endGesture, moveGesture, startGesture } from './gesture.mjs'
import { DRAG, NEAR, SLEEPY } from './eyes.mjs'
import { sleepyOf } from './sleepy.mjs'
import { nearOf } from './near.mjs'
import { layoutFor } from './layout.mjs'
import { createPoseGate, poseFor } from './pose-pick.mjs'
import { createMotion } from './motion.mjs'
import { createAnimator } from './animator.mjs'
import { createJankLimiter } from './jank-limit.mjs'
import { createBreath } from './breath.mjs'
import { paint } from '../copy/copy.mjs'

// 页面里写死的字（html 上的 data-t）：小岛第一次显示前先换掉
paint(document)

const body = document.body
const strip = document.getElementById('strip')
const bob = document.getElementById('bob')
const eyeSpin = document.getElementById('eye-spin')
const bubbleText = document.getElementById('bubble-text')
const bubbleActions = document.getElementById('bubble-actions')
const measureBox = document.getElementById('measure')
const media = matchMedia('(prefers-reduced-motion: reduce)')
// 两只眼睛各一个 g（每帧写 translate + scale），里面椭圆（大小 + 眼皮）和笑眼细线
const EYES = [
  { side: 'L', g: document.getElementById('eye-l'), pupil: document.querySelector('#eye-l .pupil'), lid: document.querySelector('#eye-l .lid') },
  { side: 'R', g: document.getElementById('eye-r'), pupil: document.querySelector('#eye-r .pupil'), lid: document.querySelector('#eye-r .lid') },
]
const dragLines = [...document.querySelectorAll('.sh-drag')]

let scene = 'strip'
let mode = 'idle'
let booted = false // boot 那套没走完前不翻神情（出场已经定过的别盖回去）
let forcedStill = false
let stillGiven = null // animator 上次拿到的 still（变了才调 animator.still）
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
// 犯困：awake / drowsy / asleep（sleepyOf 的 level）；waking = 刚被弄醒还在醒那 3.5 秒
let sleep = 'awake'
let waking = false
let forcedPose = null // 调试台 forcePose 按名字演；null = 照状态算（poseFor）
let wakeTimer = null
let sleepyTimer = null
let lastActive = Date.now() // 上回有动静是什么时候
let nearOn = false // 看你：鼠标在小岛 120px 内（壳里轮询算好发来）
let busy = false // 电脑忙（pet:busy）：收装饰小动作，神情和眨眼照常
let hoverOn = false // 鼠标正停在小岛上
let drag = false // 拖着走：眼睛是 > <，松手 150ms 恢复
let dragBackTimer = null
let hiddenPause = false // 窗口藏起来（visibilitychange）
let eyeU = 1 // SVG 单位换 px（applyLayout 里按这一档小岛算）
let breathing = false // 引擎说睡着了吗（body 上挂 data-breathing，留给调试和测试；起伏由 breath.mjs 低频写）

const still = () => forcedStill || media.matches

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
  // 眼睛和整岛位移都是 SVG 单位：乘这一档小岛的比例换成 px（取宽高里小的那个）
  eyeU = Math.min(box.island / 112, box.height / 30)
  style.setProperty('--eye-u', `${eyeU}`)
  // 展开时往左挪多少 px：整条宽的一半 − 表情区宽的一半（标准档是 28）
  style.setProperty('--eye-shift', `${box.island / 2 - box.eyeZone / 2}`)
  // 跟壳里改窗口大小同一个时长
  style.setProperty('--expand-ms', `${theme.expandMs}ms`)
  style.setProperty('--collapse-ms', `${theme.collapseMs}ms`)
  return box
}
applyLayout()

// 写一个属性 / 样式：格式化后的字符串没变就不碰 DOM（停帧那一会儿画面静止，别白写）
function attrWriter(el, name) {
  let last
  return (value) => {
    if (value === last) return
    last = value
    if (value == null) el.removeAttribute(name)
    else el.setAttribute(name, value)
  }
}
function styleWriter(el, prop) {
  let last
  return (value) => {
    if (value === last) return
    last = value
    el.style[prop] = value
  }
}

// —— 引擎的一帧画到页面上（照 v4 的 applyEye）——
// 每只眼睛一个 g：translate(cx cy) scale(sx sy)；椭圆的 rx/ry、上下眼皮 clip-path。
// 笑眼 smile ≥ 0.42 时只显示细线、小于时只显示椭圆，不交叉淡化（避免半透明发灰）。
// 整岛动写在 #bob 上（别写 #strip，会把 .press 盖掉）；island.rot 不用，只用 eyesRot 转眼睛那层。
const writeBob = styleWriter(bob, 'transform')
const writeSpin = attrWriter(eyeSpin, 'transform')
const writeDrag = dragLines.map((line) => styleWriter(line, 'display'))
for (const eye of EYES) {
  eye.writeG = attrWriter(eye.g, 'transform')
  eye.writeRx = attrWriter(eye.pupil, 'rx')
  eye.writeRy = attrWriter(eye.pupil, 'ry')
  eye.writeClip = styleWriter(eye.pupil, 'clipPath')
  eye.writePupil = attrWriter(eye.pupil, 'opacity')
  eye.writeLid = attrWriter(eye.lid, 'opacity')
}
function render(frame) {
  writeBob(`translate(${(frame.island.x * eyeU).toFixed(2)}px, ${(frame.island.y * eyeU).toFixed(2)}px) scale(${frame.island.scale.toFixed(4)})`)
  writeSpin(frame.eyesRot ? `rotate(${frame.eyesRot.toFixed(2)} 56 15)` : null)
  const dragOn = frame.shape === 'drag'
  for (const eye of EYES) {
    const e = frame[eye.side]
    eye.writeG(`translate(${e.cx.toFixed(2)} ${e.cy.toFixed(2)}) scale(${e.sx.toFixed(3)} ${e.sy.toFixed(3)})`)
    eye.writeRx(e.rx.toFixed(2))
    eye.writeRy(e.ry.toFixed(2))
    if (e.clipTop > 0.015 || e.clipBottom > 0.015) eye.writeClip(`inset(${(e.clipTop * 100).toFixed(1)}% 0 ${(e.clipBottom * 100).toFixed(1)}% 0)`)
    else eye.writeClip('none')
    const smileOn = e.smile >= 0.42
    eye.writePupil(smileOn || dragOn ? '0' : '1')
    eye.writeLid(smileOn && !dragOn ? '1' : '0')
  }
  for (const write of writeDrag) write(dragOn ? '' : 'none')
  if (frame.breathing !== breathing) {
    breathing = frame.breathing
    if (breathing) body.dataset.breathing = '1'
    else delete body.dataset.breathing
  }
  // 呼吸：引擎说睡着、没关动画、没暂停（藏起来 / 收成细线）、电脑不忙才跑，其余一律停（停了写回 0）
  if (frame.breathing && !still() && !busy && !(hiddenPause || scene === 'line')) breath.start()
  else breath.stop()
}

// —— 睡着的呼吸（省电）——
// 不再用 CSS 无限动画（透明置顶小窗上它让 GPU 进程每帧合成，睡着烧一个核的 16–21%），
// 低频定时器一档一档写 #eyes 的 transform。amp 的 0.22 是 SVG 单位，
// px 在 write 里乘这一档的比例（--eye-u）：布局换了档也跟着对。
// 只在格式化后的字符串变了时才碰 DOM（零点几像素的幅度，大部分时候都是同一串）。
const eyesBox = document.getElementById('eyes')
let lastBreath = null
const breath = createBreath({
  write: (offset) => {
    const s = `translateY(${(offset * eyeU).toFixed(2)}px)`
    if (s === lastBreath) return
    lastBreath = s
    eyesBox.style.transform = s
  },
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  now: () => performance.now(),
  amp: 0.22,
})

const gate = createPoseGate() // 干活三件套（读 / 写 / 想）互换的节流
const motion = createMotion()
// 卡顿上报限流：1 分钟最多 10 条，多的丢掉（省 IPC，也省日志）
const jankLimit = createJankLimiter({ max: 10, windowMs: 60_000 })
const animator = createAnimator({
  motion,
  render,
  gate,
  raf: requestAnimationFrame,
  caf: cancelAnimationFrame,
  setTimer: setTimeout,
  clearTimer: clearTimeout,
  now: () => performance.now(),
  // 卡了一下：记一条给主进程（只记状态，不记用户内容）
  onJank: ({ gapMs, pose }) => {
    if (!jankLimit()) return
    pet.jank({ gapMs, pose: pose || '', mode, sleep, waking, scene })
  },
})

// 调试台专用（真机页面没有 window.petLab）：改弹簧参数、问参数、按名字演神情。
// setMotion 改完到 refreshPose 走一圈，停着的循环被叫醒、新刚度马上生效。
if (window.petLab) {
  window.petLab.setMotion = (p) => { motion.setParams(p); refreshPose() }
  window.petLab.motionParams = () => motion.params()
  window.petLab.forcePose = (name) => { forcedPose = name || null; refreshPose() }
}

// 状态、场景、拖动、犯困等级、醒来，哪个变了都重算一次神情交给 animator
function refreshPose() {
  if (!booted) return
  const quiet = still()
  if (quiet !== stillGiven) {
    stillGiven = quiet
    animator.still(quiet)
  }
  // 调试台按名字演时用它，别的时候照状态算
  const pose = forcedPose ?? poseFor({ mode, phase: body.dataset.phase, scene, sleep, waking, drag })
  animator.setPose(pose, forcedPose != null)
}

function applyPause() {
  // 窗口藏起来、收成细线：什么都不跑；反之从现在接着走
  animator.pause(hiddenPause || scene === 'line')
  // 暂停后 render 不再被调到：呼吸在这里一起停（回来时 render 会重新 start）
  if (hiddenPause || scene === 'line') breath.stop()
}

function applyScene(next) {
  // 平时那几句：每次张开换下一句
  if (next === 'expanded' && scene !== 'expanded' && tips) {
    tipAt = (tipAt + 1) % tips.length
    bubbleText.textContent = tips[tipAt]
  }
  scene = next
  body.dataset.scene = next
  if (next !== 'tray') strip.classList.remove('hot')
  applyPause()
  // 犯困也重算一遍（调试台把钟拨过去后靠事件重算），重算里会刷新神情
  checkSleepy()
  layoutLine()
}

function applyMode(next, options = {}) {
  mode = next
  body.dataset.mode = next
  if (next !== 'idle') {
    // 出了待命：不犯困了（只有待命着才算没动静）
    sleep = 'awake'
    waking = false
    clearTimeout(wakeTimer)
    wakeTimer = null
    scheduleSleepy()
  }
  if (!options.keepEyes) refreshPose()
}

// —— 犯困 ——

// 10 分钟（犯困）和打完盹（睡着）两个坎上都重算；睡着了就不再排，等有动静
function scheduleSleepy() {
  clearTimeout(sleepyTimer)
  sleepyTimer = null
  if (mode !== 'idle' || still()) return
  const idle = Date.now() - lastActive
  let next = null
  if (idle < SLEEPY.idleMs) next = SLEEPY.idleMs - idle
  else if (idle < SLEEPY.asleepMs) next = SLEEPY.asleepMs - idle
  if (next != null) sleepyTimer = setTimeout(checkSleepy, Math.max(1000, next))
}

function checkSleepy() {
  clearTimeout(sleepyTimer)
  sleepyTimer = null
  const plan = sleepyOf({ mode, lastActive, now: Date.now(), near: nearOn, hover: hoverOn })
  sleep = plan.level
  scheduleSleepy()
  refreshPose()
}

// 有动静了：犯困重新计时；睡着了先醒（waking 3.5 秒，醒完回待命）；犯困直接回待命
function touchActivity() {
  lastActive = Date.now()
  if (sleep === 'asleep' && !waking) {
    waking = true
    clearTimeout(wakeTimer)
    // 3.5 秒 = poses.mjs 里 wake 神情的 END_T.wake
    wakeTimer = setTimeout(() => {
      wakeTimer = null
      waking = false
      refreshPose()
    }, 3500)
  }
  sleep = 'awake'
  scheduleSleepy()
  refreshPose()
}

// —— 电脑忙 ——

// 主进程量整机 CPU 得出的忙 / 不忙（开机数据里带一份，之后 pet:busy 变了才发）。
// 忙时只收装饰小动作：idle 不东张西望、呼吸停（motion.setQuiet），鼠标靠近不跟也不「看到你了」眨眼，
// 已经在跟的松开；拖文件到小岛上方跟着文件看照常（bindDrop 那条路不动）。
function applyBusy(on) {
  const next = on === true
  if (next === busy) return
  busy = next
  motion.setQuiet(busy)
  if (busy && nearOn) animator.setGaze(null)
  refreshPose() // 排程变了，叫醒循环重画一帧（呼吸标记、下一次醒点）
}

// —— 拖着走 · > < ——

// 被拖那一刻眼睛换成 > <；松手 150ms 恢复到当前状态的神情。各种状态下拖都这样。
function dragFace(on) {
  if (on) {
    drag = true
    clearTimeout(dragBackTimer)
    dragBackTimer = null
    animator.setGaze(null)
    body.dataset.dragging = '1'
    refreshPose()
    return
  }
  clearTimeout(dragBackTimer)
  dragBackTimer = setTimeout(() => {
    dragBackTimer = null
    drag = false
    delete body.dataset.dragging
    refreshPose()
  }, DRAG.backMs)
}

// —— 冒的那一行 ——

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

// —— 指针和接文件 ——

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
    // 文件压在长开的小岛上：描一圈边；眼睛跟文件看（跟「看你」同一个偏移）
    const box = strip.getBoundingClientRect()
    strip.classList.toggle('hot', event.clientY <= box.bottom)
    if (scene === 'tray') {
      const plan = nearOf({ x: event.clientX, y: event.clientY }, box)
      animator.setGaze(plan.near ? { x: plan.dx, y: plan.dy } : null)
    }
  })
  addEventListener('dragleave', () => {
    if (--depth !== 0) return
    strip.classList.remove('hot')
    animator.setGaze(null)
    pet.dragLeave()
  })
  addEventListener('drop', (event) => {
    event.preventDefault()
    depth = 0
    touchActivity()
    strip.classList.remove('hot')
    animator.setGaze(null)
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

// —— 壳发来的 ——

pet.onState((payload) => {
  // 阶段（在读、在写、在想）先记下来：poseFor 要用它
  if (payload.phase) body.dataset.phase = payload.phase
  else delete body.dataset.phase
  // 状态真的变了才算有动静：犯困睁眼、重新计时。
  // 主进程每来一个事件都会再推一遍状态（模式没变也推），以前每推一次就重新计时，
  // 真机上待命 10 分钟常常睡不着（0.4 测试包实测晚了 3–9 分钟）
  const next = payload.mode || 'idle'
  if (next !== mode) touchActivity()
  applyMode(next)
})
pet.onBubble((line) => setBubble(line))
// 有新早报：亮红点、眨一下（引擎自己偶尔连眨）；看过了红点熄
pet.onNews((payload) => {
  if (payload?.dot === true) body.dataset.news = '1'
  else delete body.dataset.news
  if (payload?.blink === true) animator.blink()
})
pet.onScene((payload) => { lastScene = payload.scene || 'strip'; applyScene(lastScene) })
// 看你：壳里轮询鼠标，算好偏移发来（只在待命）。
// 刚进来那一下眨一下（「看到你了」）；离开就不跟了
pet.onNear((payload) => {
  const was = nearOn
  nearOn = payload?.near === true
  if (!nearOn) {
    if (was) animator.setGaze(null)
    return
  }
  touchActivity()
  if (busy) return // 电脑忙：不跟鼠标、也不「看到你了」眨眼（不忙了下一回 near 更新自然接上）
  if (!was) animator.blink()
  animator.setGaze({ x: payload?.dx || 0, y: payload?.dy ?? NEAR.liftPx })
})
// 小岛露脸（叫回来、开机）：从现在接着演，动静从现在重新算
pet.onShown(() => {
  hiddenPause = false
  applyPause()
  touchActivity()
})
// 首次运行的小岛出场：壳说滑、说落定、说冒一行，这里只管眼睛和字
pet.onIntro((payload) => {
  introStarted = true
  const phase = payload?.phase || 'slide'
  if (phase === 'slide') {
    if (!still()) animator.setGaze({ x: 0, y: -2 }) // 滑下来时往上看
    return
  }
  if (phase === 'land') {
    if (!still()) animator.blink() // 落定眨一下回正
    return
  }
  if (phase === 'line') {
    introLineSet = true
    setBubble({ text: payload.text || '', actions: [] })
    pet.introLine()
  }
})
pet.onPress((payload) => playPress(payload))
// 小岛大小那档变了：整套尺寸重算，眼睛、冒的那行字、红点都跟着
pet.onLayout((payload) => { if (payload?.font) applyLayout(payload.font) })
// 电脑忙 / 不忙：收装饰小动作，有意义的神情照常
pet.onBusy((payload) => applyBusy(payload?.busy === true))

bindPointer()
bindDrop()
addEventListener('resize', layoutLine)
// 窗口藏起来 / 又露脸：停帧和续帧
document.addEventListener('visibilitychange', () => {
  hiddenPause = document.hidden
  applyPause()
})
// Windows 关掉「动画效果」是系统级的：变过来就跟着换
if (media.addEventListener) media.addEventListener('change', () => { refreshPose() })

const boot = await pet.ready()
forcedStill = !!boot.still
if (forcedStill) body.classList.add('still')
// 主进程算好的那套尺寸（含小岛大小那档）：页面这边跟着重算一遍
if (boot.font) applyLayout(boot.font)
// 红点在页面起来之前就亮着的（比如刚生成好），开机补上
if (boot.news === true) body.dataset.news = '1'
// 开机那一刻就已经忙着的：装饰小动作从一开始就收着
if (boot.busy) applyBusy(true)
// 场景和状态照开机那套来；神情要是出场已经定过了就别盖回去
const plan = bootPlan({ introStarted, introLineSet, bootScene: boot.scene || 'strip', lastScene })
applyScene(plan.scene)
// 开机这一刻的阶段（在读 / 在写 / 在想）：先记下来，第一次翻神情就要用它
if (boot.phase) body.dataset.phase = boot.phase
booted = true
applyMode(boot.mode || 'idle', { keepEyes: plan.keepEyes })
// 出场已经冒过那一行了，就别拿开机那行盖回去
if (plan.setBubble) setBubble(boot.bubble || { text: '', actions: [] })
