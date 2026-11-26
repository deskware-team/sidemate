// 神情怎么选：页面的状态 → 该演哪个神情、干活三件套换挡节流、犯困分档。
// 纯函数，不引 node: 和 electron，页面直接 import。

import { SLEEPY } from './eyes.mjs'

// 页面状态 → 神情。判的顺序就是列的顺序：拖着最优先，再接文件、睡觉、醒来、干活、结果，最后待命。
// mode / phase 是任务那边的状态字；scene 'tray' = 文件拿到小岛上方等松手；waking = 刚被弄醒还在醒。
export function poseFor({ mode, phase, scene, sleep, waking, drag } = {}) {
  if (drag) return 'drag'
  if (scene === 'tray') return 'expect'
  if (sleep === 'asleep') return 'asleep'
  if (sleep === 'drowsy') return 'drowsy'
  if (waking) return 'wake'
  if (mode === 'work') return phase === 'write' || phase === 'think' ? phase : 'read'
  if (mode === 'look' || mode === 'confirm') return 'look'
  if (mode === 'done') return 'done'
  if (mode === 'fail') return 'fail'
  return 'idle'
}

// 没动静多久算哪一档：小于 10 分钟醒着，到 10 分钟先犯困（打盹约 4 秒），再往后睡着。坎在 eyes.mjs 的 SLEEPY。
export function sleepLevel({ idleMs } = {}) {
  if (!(idleMs >= SLEEPY.idleMs)) return 'awake'
  if (!(idleMs >= SLEEPY.asleepMs)) return 'drowsy'
  return 'asleep'
}

// 干活三件套（read / write / think）之间互换的节流：当前神情没演够 minHoldSec 就先不换、
// 记下最新要演的，到点再换（模型一会儿想一会儿读，别让眼睛抖）。
// 别的换法（进出干活、done、fail、look、drag、expect、睡觉相关）一律立刻换。
export function createPoseGate({ minHoldSec = 1.2 } = {}) {
  const WORK = ['read', 'write', 'think']
  let current = null // 正在演的
  let since = 0 // 从几秒开始演的
  let pending = null // minHoldSec 内记下的最新要演的
  const bothWork = (a, b) => WORK.includes(a) && WORK.includes(b)
  return {
    // 现在该演哪个。pose 是 poseFor 的结果，now 是秒。
    want(pose, now) {
      if (pose === current) {
        pending = null // 又要回正演看这个，记着的作废；计时从开始演那刻继续算
        return current
      }
      if (current == null || !bothWork(current, pose) || now - since >= minHoldSec - 1e-9) {
        current = pose
        since = now
        pending = null
        return pose
      }
      pending = pose
      return current
    },
    // 到点没：把记着的换上，返回现在该演的（页面在闹钟里问一句）。
    due(now) {
      if (pending != null && now - since >= minHoldSec - 1e-9) {
        current = pending
        since = now
        pending = null
      }
      return current == null ? 'idle' : current
    },
  }
}
