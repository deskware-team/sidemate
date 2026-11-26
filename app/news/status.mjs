// 新闻生成的状态：主进程记一份——哪个主题在生成、什么时候开始的、是定时还是手动、哪些在排队。
// 设置页、小岛、右键菜单都从这里拿（这几个都在主进程里，共用这一份）。
// 纯模块：不引 node，也不引 electron。

// 正在跑的那个：{ topicId, name, at, reason }（reason：'now' 手动 / 'schedule' 定时）
let running = null
// 排队中的那些（按排的先后）：{ topicId, name, at, reason }
let queue = []
// 盯着状态变化的人
const listeners = new Set()

// 开始跑一个（它要是在排队，从队里拿掉）
export function startRun(topicId, name, reason = 'now', at = Date.now()) {
  const id = String(topicId ?? '')
  queue = queue.filter((one) => one.topicId !== id)
  running = { topicId: id, name: String(name ?? ''), at, reason: reason === 'now' ? 'now' : 'schedule' }
  announce(null)
  return runningOf()
}

// 排上队（已经在跑或已经在队里就不再排）
export function enqueueRun(topicId, name, reason = 'now', at = Date.now()) {
  const id = String(topicId ?? '')
  if (running && running.topicId === id) return statusOf(id)
  if (!queue.some((one) => one.topicId === id)) {
    queue = [...queue, { topicId: id, name: String(name ?? ''), at, reason: reason === 'now' ? 'now' : 'schedule' }]
  }
  announce(null)
  return statusOf(id)
}

// 跑完了（成功、失败、中途停下都算）。result 是那一轮的结果，跟着这次通知一起给出去
export function endRun(topicId, result = null) {
  const id = String(topicId ?? '')
  const was = running && running.topicId === id ? running : null
  if (was) running = null
  queue = queue.filter((one) => one.topicId !== id)
  announce(was ? { ...was, ok: result?.ok === true } : null)
  return runningOf()
}

// 正在跑的那一个（没有就是 null）
export function runningOf() {
  return running ? { ...running } : null
}

// 排队中的那些
export function queuedOf() {
  return queue.map((one) => ({ ...one }))
}

// 某个主题的状态：{ state: 'running' | 'queued', at, reason, name }；不在跑也不在排就是 null
export function statusOf(topicId) {
  const id = String(topicId ?? '')
  if (running && running.topicId === id) return { ...running, state: 'running' }
  const wait = queue.find((one) => one.topicId === id)
  if (wait) return { ...wait, state: 'queued' }
  return null
}

// 盯着状态变化：fn({ running, queued, ended })，ended 是刚跑完的那一个（没有就是 null）。返回取消的办法
export function onStatusChange(fn) {
  if (typeof fn === 'function') listeners.add(fn)
  return () => listeners.delete(fn)
}

// 测试用：清空
export function resetStatus() {
  running = null
  queue = []
  listeners.clear()
}

function announce(ended) {
  const snapshot = { running: runningOf(), queued: queuedOf(), ended }
  for (const fn of listeners) {
    try {
      fn(snapshot)
    } catch { /* 听的人坏了不能耽误事 */ }
  }
}
