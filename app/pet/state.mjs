// 宠的五个状态：待命 / 干活中 / 要你看一眼 / 做完了 / 没干成。
// 状态来源还是 pet.ingest(event)：壳把 dsh 和任务窗的事件收成这五种。
// 做完了、要你看一眼、没干成这三种一直保持到用户点开小岛（任务窗打开）才回待命。
// 好几个任务同时跑时，小岛说的是最近一个做完（或没干成、在问你）的那个：
// 别的任务还在干活的动静不顶掉它。
// 另外记几样给冒的那一行用：wait / waitKind（在等重试，倒数到头的时刻、错的种类）、sees（现在干活的模型看不看得了图）、
// running（几个任务在跑，两个以上冒「执行中 · N 个任务」）。
// 还有 phase：模型这一会儿在干什么（在读 / 在写 / 在想），干活中才有，出了干活就清掉。

import { t } from '../copy/copy.mjs'

// 做完了那一句：通知用（状态码 St705，跟小岛悬停那行同一句）
export const DONE_NOTE = t('St705')

const HELD = new Set(['done', 'look', 'fail', 'confirm'])

export function createState() {
  return { mode: 'idle', taskId: null, message: '', artifact: '', notice: '', phase: '' }
}

// 通知正文：事件里带了话就用它；什么都没带是「出错了！」（St706）
function textOf(event) {
  if (typeof event.message === 'string' && event.message.trim()) return event.message.trim()
  if (typeof event.reason === 'string' && event.reason.trim()) return event.reason.trim()
  return t('St706')
}

// 通知的话：事件里带了就用它（等你一句话），没带就用正文
function noticeOf(event, fallback) {
  return typeof event.notice === 'string' && event.notice.trim() ? event.notice.trim() : fallback
}

// 现在的模型看不看得了图、几个任务在跑、这一会儿在干什么：换状态时不丢（新状态里自己带了的照新的）
function keep(from, to) {
  if (!from) return to
  const out = { ...to }
  if (typeof from.sees === 'boolean' && typeof out.sees !== 'boolean') out.sees = from.sees
  if (from.running && out.running === undefined) out.running = from.running
  // 阶段：出了干活就清掉；进了干活还没记下的先当「在读」
  if (from.mode === 'work' && to.mode !== 'work') out.phase = ''
  else if (to.mode === 'work' && !out.phase) out.phase = from.phase || 'read'
  return out
}

// 还有任务在跑时的「干活中」：不对着哪一个任务，下一条动静来了再记是谁
const workOf = () => ({ mode: 'work', taskId: null, message: '', artifact: '', notice: '' })

export function reduce(state, event) {
  const step = reduceMode(state, event)
  return step.state === state ? step : { ...step, state: keep(state, step.state) }
}

function reduceMode(state, event) {
  const none = { state, notify: false, hold: false }
  if (!event || typeof event.type !== 'string') return none
  // 任务窗告诉的：现在干活的模型看不看得了图（不换状态）
  if (event.type === 'sees') return { state: { ...state, sees: event.sees === true }, notify: false, hold: false }
  // 任务窗告诉的：几个任务在跑。都停了就回待命；待命时有在跑的就是干活中
  if (event.type === 'running') {
    const running = Math.max(0, Math.floor(Number(event.count) || 0))
    let next = { ...state, running }
    if (!running && next.mode === 'work') next = { ...createState(), running }
    else if (running && next.mode === 'idle') next = { ...workOf(), running }
    return { state: next, notify: false, hold: false }
  }
  // 阶段（在读、在写、在想）：只更新阶段，不弹通知、不换状态。停在做完了那三种的不记
  if (event.type === 'phase') {
    if (state.mode !== 'work' && state.mode !== 'idle') return none
    const phase = typeof event.phase === 'string' ? event.phase : ''
    if (!phase || phase === state.phase) return none
    return { state: { ...state, phase }, notify: false, hold: false }
  }
  const taskId = event.taskId ?? null
  // 有一个做完了（没干成、在问你）还没看：别的任务的动静不顶掉它，换成另一个做完的才换
  const other = HELD.has(state.mode) && taskId !== state.taskId
  const artifact = typeof event.path === 'string' && event.path ? event.path : state.artifact
  // 任务窗问了一句：要你看一眼（睁大 + 红点，一直保持）
  if (event.type === 'ask' || event.type === 'question') {
    const message = textOf(event)
    return { state: { mode: 'look', taskId, message, artifact, notice: noticeOf(event, message) }, notify: true, hold: true }
  }
  // 有任务在等确认（权限卡）：跟「要你看一眼」一样的眼睛，说的是「等你确认」
  if (event.type === 'confirm') {
    const message = textOf(event)
    return { state: { mode: 'confirm', taskId, message, artifact, notice: noticeOf(event, message) }, notify: true, hold: true }
  }
  // 没干成：平线，一直保持
  if (event.type === 'error' || (event.type === 'end' && event.status === 'error')) {
    const message = textOf(event)
    return { state: { mode: 'fail', taskId, message, artifact, notice: message }, notify: true, hold: true }
  }
  if (event.type === 'end' && event.status === 'cancelled') {
    if (other) return none
    return { state: state.running ? workOf() : createState(), notify: false, hold: false }
  }
  // 做完了：笑眼，一直保持（勾和「停一下回待命」都不要了）。
  // 「打开」只开这一轮自己交出去的那份：事件里没带就是这一轮没交文件，不沿用别的任务的
  if (event.type === 'end' && event.status === 'done') {
    const own = typeof event.path === 'string' ? event.path : ''
    return { state: { mode: 'done', taskId, message: DONE_NOTE, artifact: own, notice: DONE_NOTE }, notify: true, hold: true }
  }
  if (other) return none
  // 干活中：往下看 + 左右慢慢扫；在等重试时记下倒数到头的时刻和错的种类（悬停那行照种类说）
  if (event.type === 'progress' || event.type === 'artifact' || event.type === 'usage') {
    const text = typeof event.text === 'string' ? event.text.trim() : ''
    const fresh = event.type === 'progress'
    const wait = fresh ? Number(event.wait) || 0 : Number(state.wait) || 0
    const waitKind = fresh ? (typeof event.waitKind === 'string' ? event.waitKind : '') : state.waitKind || ''
    return {
      state: { mode: 'work', taskId, message: text || state.message, artifact, notice: '', ...(wait ? { wait, waitKind } : {}) },
      notify: false,
      hold: false,
    }
  }
  if (taskId && taskId !== state.taskId) {
    return { state: { mode: 'work', taskId, message: state.message, artifact, notice: '' }, notify: false, hold: false }
  }
  return none
}

// 点小岛时交给任务窗的：停在做完了、要你看一眼、没干成时，是它说的那一轮的 taskId（任务窗切到那条对话）；
// 别的时候不带，任务窗照旧开眼前那条
export function heldTask(state) {
  return HELD.has(state?.mode) && typeof state.taskId === 'string' && state.taskId ? { taskId: state.taskId } : undefined
}

// 用户点开小岛 / 任务窗打开：这三种收回去，还有任务在跑就是干活中，没有就回待命
export function clearHeld(state) {
  if (!HELD.has(state.mode)) return state
  return keep(state, state.running ? workOf() : createState())
}
