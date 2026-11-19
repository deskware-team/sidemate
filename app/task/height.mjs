// 任务窗的高度：拖底边把手怎么算、能拖到哪儿、上次拖到多高记在哪儿。
// 只有计算和一个 json 小文件的读写（存法照 app/pet/place-store.mjs），不碰 Electron，node --test 直接测。
// 页面那头只量指针；这里的函数两边都不依赖窗口对象。

import { readFileSync, writeFileSync } from 'node:fs'
import { MIN_PANEL } from './window.mjs'

// 默认高 520，所有状态一样高；拖动最低 360（跟 window.mjs 的 MIN_PANEL 同一个数）、最高屏幕工作区高度减 120
export const DEFAULT_H = 520
export const MIN_H = MIN_PANEL
export const SCREEN_KEEP = 120

// 这块屏幕的工作区最多给到多高
export function maxHeightFor(workAreaHeight) {
  const value = Math.floor(Number(workAreaHeight))
  if (!Number.isFinite(value)) return MIN_H
  return Math.max(MIN_H, value - SCREEN_KEEP)
}

// 想要的高度夹进上下限：低于下限抬回下限，高于上限压回上限。
// 上限本身比下限还小（屏幕太小）时取下限，宁可超出一点也不缩成一牙。
// 字号档位 ≠ 标准时下限也跟着放大（min），默认还是 360。
export function clampHeight(wanted, limit, min = MIN_H) {
  const floor = Number.isFinite(Number(min)) ? Math.floor(Number(min)) : MIN_H
  const top = Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_H
  const value = Number(wanted)
  const base = Number.isFinite(value) ? Math.round(value) : DEFAULT_H
  return Math.min(Math.max(floor, base), Math.max(floor, top))
}

// 拖底边把手：从按下的那一下起算，指针往下走多少窗就长多少。坏的输入给 NaN，调用那边自己丢
export function dragHeight(from, startY, nowY) {
  const base = Number(from)
  const dy = Number(nowY) - Number(startY)
  if (!Number.isFinite(base) || !Number.isFinite(dy)) return NaN
  return Math.round(base + dy)
}

// 上次的高度记在壳 userData 里的一个 json：读不出、坏了都当没有
export function readHeight(file) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    const value = Math.round(Number(saved?.height))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeHeight(file, height) {
  const value = Math.round(Number(height))
  if (!Number.isFinite(value) || value <= 0) return false
  try {
    writeFileSync(file, JSON.stringify({ height: value }))
    return true
  } catch {
    return false
  }
}
