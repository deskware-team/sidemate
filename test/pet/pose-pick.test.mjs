// pose-pick.mjs：页面状态选神情（优先级）、干活三件套换挡节流、犯困分档。

import test from 'node:test'
import assert from 'node:assert/strict'
import { poseFor, createPoseGate, sleepLevel } from '../../app/pet/pose-pick.mjs'
import { SLEEPY } from '../../app/pet/eyes.mjs'

const minute = 60 * 1000

test('poseFor：按顺序判，前面的赢', () => {
  assert.equal(poseFor({ drag: true, mode: 'work' }), 'drag') // 拖着最优先
  assert.equal(poseFor({ scene: 'tray', mode: 'done' }), 'expect') // 等松手排在做完前头
  assert.equal(poseFor({ sleep: 'asleep', mode: 'work' }), 'asleep') // 睡觉排在干活前头
  assert.equal(poseFor({ sleep: 'drowsy' }), 'drowsy')
  assert.equal(poseFor({ waking: true, mode: 'work' }), 'wake') // 醒来排在干活前头
  assert.equal(poseFor({ mode: 'work', phase: 'write' }), 'write')
  assert.equal(poseFor({ mode: 'work', phase: 'think' }), 'think')
  assert.equal(poseFor({ mode: 'work', phase: 'read' }), 'read')
  assert.equal(poseFor({ mode: 'work' }), 'read') // 没给 phase 就读稿
  assert.equal(poseFor({ mode: 'work', phase: '不认识' }), 'read')
  assert.equal(poseFor({ mode: 'look' }), 'look')
  assert.equal(poseFor({ mode: 'confirm' }), 'look')
  assert.equal(poseFor({ mode: 'done' }), 'done')
  assert.equal(poseFor({ mode: 'fail' }), 'fail')
  assert.equal(poseFor({ mode: 'idle' }), 'idle')
  assert.equal(poseFor({}), 'idle')
  assert.equal(poseFor(), 'idle')
})

test('pose gate：三件套之间没演够 minHoldSec 先不换、记最新的，到点换；别的立刻换', () => {
  const g = createPoseGate({ minHoldSec: 1.2 })
  assert.equal(g.want('read', 0), 'read')
  assert.equal(g.want('think', 0.5), 'read') // 没到 1.2 秒，先不换
  assert.equal(g.want('write', 0.9), 'read') // 记最新要的
  assert.equal(g.due(1.19), 'read') // 还没到点
  assert.equal(g.due(1.2), 'write') // 到点换上记着的
  assert.equal(g.want('done', 1.3), 'done') // 出干活：立刻换
  assert.equal(g.want('read', 1.4), 'read')
  assert.equal(g.want('look', 1.5), 'look') // look 也立刻
  assert.equal(g.want('read', 1.6), 'read')
  assert.equal(g.want('think', 2.0), 'read') // 又没演够
  assert.equal(g.want('write', 2.5), 'read') // 记的还是最新的
  assert.equal(g.due(2.8), 'write')
  assert.equal(g.due(9), 'write') // 没记着的就原样
})

test('sleepLevel：10 分钟先打盹，约 4 秒后睡着（坎在 SLEEPY，11-24 统一 10 分钟）', () => {
  assert.equal(SLEEPY.idleMs, 10 * minute)
  assert.equal(SLEEPY.asleepMs, SLEEPY.idleMs + SLEEPY.dozeMs)
  assert.ok(SLEEPY.dozeMs >= 2560 && SLEEPY.dozeMs <= 6000, '打盹要盖过 drowsy 走完的 2.56 秒，又不能拖太久')
  assert.equal(sleepLevel({ idleMs: 0 }), 'awake')
  assert.equal(sleepLevel({ idleMs: SLEEPY.idleMs - 1 }), 'awake')
  assert.equal(sleepLevel({ idleMs: SLEEPY.idleMs }), 'drowsy')
  assert.equal(sleepLevel({ idleMs: SLEEPY.asleepMs - 1 }), 'drowsy')
  assert.equal(sleepLevel({ idleMs: SLEEPY.asleepMs }), 'asleep')
  assert.equal(sleepLevel({ idleMs: Infinity }), 'asleep')
  assert.equal(sleepLevel({}), 'awake') // 没给当醒着
})
