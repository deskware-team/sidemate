// 页面上那个每秒走一次的表：干活中那两句（每 30 秒换一次）、等待行上的秒数。
// 只在真有东西要倒数的时候才开这个表：没事干的时候不开（每秒扫一遍页面是白花的力气），
// 页面藏起来（任务窗收着）也停，露出来再接着走（秒数按时刻算，不会差）。
// 纯判断（needsTick）不碰 DOM，node --test 直接测。

import { quietLabel } from './timing.mjs'
import { countdownText } from './wait.mjs'

// 等待行上的秒数：没过点就还在倒，过了点就不倒了（那一行的字不再变）
export function stillCounting(until, now = Date.now()) {
  return (Number(until) || 0) > now
}

// 该不该走秒表：
//   quietAt：干活中那两句的静默时刻（0 = 没有）
//   untils：等待行各自到头的时刻
export function needsTick({ quietAt = 0, untils = [] } = {}, now = Date.now()) {
  if (Number(quietAt) || 0) return true
  for (const one of untils) {
    if (stillCounting(one, now)) return true
  }
  return false
}

// 表：flow 是对话流那一块（要倒数的东西都在里面）；hidden() 说页面是不是藏起来了
export function createTick({ flow, hidden = () => false }) {
  let timer = null

  // 页面上要倒数的东西：干活中那两句的静默时刻、等待行各自到头的时刻
  const targets = () => {
    let quietAt = 0
    const untils = []
    for (const one of flow.querySelectorAll('.working .quiet')) {
      const at = Number(one.dataset.at) || 0
      if (at > quietAt) quietAt = at
    }
    for (const one of flow.querySelectorAll('.wsecs')) untils.push(Number(one.dataset.until) || 0)
    return { quietAt, untils }
  }

  const stop = () => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const tick = () => {
    const now = Date.now()
    for (const one of flow.querySelectorAll('.working .quiet')) {
      const text = quietLabel(one.dataset.at, now)
      // 字没变就别动它：改了要重排重画
      if (one.textContent !== text) one.textContent = text
    }
    // 等待行上的秒数：数到 0 就说「重新连接中」，不留「0 秒后自动重试」
    for (const one of flow.querySelectorAll('.wsecs')) {
      const text = countdownText(one.dataset.until, now)
      if (one.textContent !== text) one.textContent = text
    }
    // 没东西要倒数了：这个表就停，别每秒白醒一次
    if (!needsTick(targets(), now)) stop()
  }

  const start = () => {
    if (timer !== null) return
    timer = setInterval(tick, 1000)
  }

  // 该走就走，不该走就停：没东西要倒数、或者页面藏起来了，都停。
  // 藏起来的时候表停了，露出来先走一次：刚才那段时间秒数可能已经到点了，字要对一下。
  const sync = () => {
    if (hidden()) {
      stop()
      return
    }
    tick()
    if (needsTick(targets())) start()
    else stop()
  }

  return { sync }
}
