// poses.mjs：各神情在「进神情后第 t 秒」的目标值。
// 固定种子 / 固定随机串跑，断言每个神情的形状、时序和不对称细节。
// 纯目标层面的数字（大小、眼皮、倾角、下蹲）在这里量；弹簧追出来什么样在 motion.test.mjs。

import test from 'node:test'
import assert from 'node:assert/strict'
import { POSES, REST, blinkCurve, poseAt, preparePose } from '../../app/pet/poses.mjs'

// 固定的一串随机数（循环取）
function seq(...values) {
  let i = 0
  return () => values[i++ % values.length]
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

test('神情清单齐', () => {
  assert.deepEqual(POSES, ['idle', 'drowsy', 'asleep', 'wake', 'expect', 'read', 'think', 'write', 'done', 'fail', 'look', 'drag'])
})

test('idle：待命静止两眼等大，目标不动', () => {
  const st = preparePose('idle', seq(0.5))
  const g = poseAt('idle', 1, st)
  near(g.wL, 10.6); near(g.hL, 10.6); near(g.wR, 10.6); near(g.hR, 10.6)
  near(g.xL, 0); near(g.yL, 0); near(g.xR, 0); near(g.yR, 0)
  assert.equal(g.blink, true)
  assert.equal(g.live, false)
  assert.equal(g.breathing, false)
})

test('idle：东张西望一趟（反向预备 → ±3 → 停 → 回正）', () => {
  // 随机串：首趟 15 秒，dir=−1，不瞥第二眼，不对称也不来；hold = 0.45+0.5*0.45 = 0.675
  const st = preparePose('idle', seq(0.5, 0.2, 0.9, 0.9, 0.5))
  const g0 = poseAt('idle', 14.9, st)
  near(g0.xL, 0) // 还没起步
  const prep = poseAt('idle', 15.03, st) // 预备 0.06 秒，反向（dir=−1 → 预备朝 +）
  near(prep.xL, 0.5, 1e-9); near(prep.yL, 0.1, 1e-9)
  const look = poseAt('idle', 15.2, st)
  near(look.xL, -3, 1e-9); near(look.yL, -0.2, 1e-9) // 卡：往一边看 ±3
  const back = poseAt('idle', 16.2, st) // 0.06+0.675 后走完，回正
  near(back.xL, 0, 1e-9)
  assert.equal(back.live, false)
})

test('idle：约 1/3 再往另一边瞥（幅度 2）＋右眼落后', () => {
  // dir=−1、second=true：预备 +0.5 → −3 → 预备 −0.4 → +2 → 回正
  const st = preparePose('idle', seq(0.5, 0.0, 0.0, 0.9, 0.5))
  // 首趟 t0 = 10 + 0.5*10 = 15；hold = 0.45 + 0.5*0.45 = 0.675
  // [0,0.06) 预备 +0.5；[0.06,0.735) 看 −3；[0.735,0.955) 停；
  // [0.955,1.035) 预备 −0.4；[1.035,1.585) 瞥 +2；之后回正
  near(poseAt('idle', 15.03, st).xL, 0.5, 1e-9)
  near(poseAt('idle', 15.2, st).xL, -3, 1e-9)
  near(poseAt('idle', 15.97, st).xL, -0.4, 1e-9) // 预备同第一眼方向
  const g2 = poseAt('idle', 16.4, st)
  near(g2.xL, 2, 1e-9); near(g2.yL, 1.35, 1e-9)
  near(poseAt('idle', 17.2, st).xL, 0, 1e-9)
})

test('idle：偶尔一大一小、一高一低（v4 3.0–3.55 那段）', () => {
  // dir=−1、second=false、asym=true、hold=0.675：asym 落在第一眼窗口 [0.06, 0.735]
  const st = preparePose('idle', seq(0.5, 0.2, 0.9, 0.2, 0.5))
  const g = poseAt('idle', 15.4, st) // 窗口中间，u=1
  near(g.wL, 9.8, 1e-3); near(g.hL, 11.2, 1e-3)
  near(g.wR, 11.4, 1e-3); near(g.hR, 10.0, 1e-3)
  near(g.yL, -0.2 - 0.7, 1e-3); near(g.yR, -0.2 + 0.35, 1e-3)
})

test('drowsy：左眼皮先垂，右眼晚约 0.3 秒，上眼皮 0.5', () => {
  const g = poseAt('drowsy', 1.3)
  near(g.upL, 0.5, 1e-9)
  near(g.upR, 0.5 * (1.0 / 1.15), 1e-3) // seg(1.3, 0.3, 1.45)
  near(g.hL, 10.0, 1e-9)
  assert.equal(g.blink, false)
  const mid = poseAt('drowsy', 2.1) // 慢眨闭眼中（2.0 起，闭 0.2）
  assert.ok(mid.upL > 0.55 && mid.upL < 0.62, `upL ${mid.upL}`)
  assert.ok(mid.upL > mid.upR) // 左眼先眨
  const done = poseAt('drowsy', 2.6) // 睁完（2.48 结束）
  near(done.upL, 0.5, 1e-9)
  assert.equal(done.live, false)
})

test('asleep：居中细缝，左右略不对称，breathing 标记', () => {
  const g = poseAt('asleep', 2)
  near(g.upL, 0.41); near(g.loL, 0.37)
  near(g.upR, 0.38); near(g.loR, 0.34)
  near(g.wL, 10.0); near(g.wR, 11.0)
  near(g.yL, 0.25); near(g.yR, 0.1)
  near(g.xL, 0); near(g.xR, 0)
  assert.equal(g.breathing, true)
  assert.equal(g.blink, false)
  assert.equal(g.live, false)
})

test('wake：左眼先睁成小半圆，右眼后睁更大，抖一下，扫两眼，回 idle', () => {
  const early = poseAt('wake', 0.35)
  near(early.upR, 0.38); near(early.loR, 0.34); near(early.wR, 11.0) // 右眼还睡着
  assert.ok(early.upL > 0.41 && early.upL <= 0.5) // 左眼皮在垂向小半圆
  assert.ok(early.wL < 10.0) // 缩成小半圆
  const mid = poseAt('wake', 1.2)
  assert.ok(mid.wR > 11.5 && mid.wR < 13.2) // 右眼睁得比左眼大
  const shake = poseAt('wake', 2.5)
  assert.ok(shake.kinX != null) // 整岛在抖
  near(shake.xL, -2.6, 1e-9) // 迷糊扫两眼第一段
  const end = poseAt('wake', 3.6)
  near(end.upL, 0); near(end.wL, 10.6); near(end.xL, 0) // 回 idle
  assert.equal(end.kinX, null)
  assert.equal(end.live, false)
  assert.equal(poseAt('wake', 3.4).live, true)
})

test('expect：两眼放大且不一样大，跟偏移看，右眼晚 36ms', () => {
  const gazeAt = (tau) => (tau >= 1.08 ? { x: 3, y: -1 } : { x: 0, y: 0 })
  const g = poseAt('expect', 1.1, {}, gazeAt)
  near(g.wL, 12.8); near(g.hL, 12.8)
  near(g.wR, 13.8); near(g.hR, 13.8)
  near(g.xL, 3); near(g.yL, -1) // 左眼已经看到
  near(g.xR, 0) // 右眼还差 36ms，还没动
  const g2 = poseAt('expect', 1.2, {}, gazeAt)
  near(g2.xR, 3)
})

test('read：扁胶囊，一小跳一小跳，每跳下蹲 0.4', () => {
  const st = preparePose('read', seq(0.5))
  const g0 = poseAt('read', 0.2, st) // 首跳在 0.35
  near(g0.wL, 9.6); near(g0.hL, 5.8); near(g0.wR, 10.4); near(g0.hR, 6.2)
  near(g0.yL, 4); near(g0.yR, 4)
  near(g0.xL, -5)
  assert.equal(g0.live, true)
  const g1 = poseAt('read', 0.35 + 0.12, st) // 第一跳正中（step = 2+0.5 = 2.5）
  near(g1.xL, -2.5, 1e-9)
  near(g1.iY, -0.4, 1e-9) // 卡：每跳整岛下蹲约 0.4px
  near(g1.hL, 5.8 - 0.4 * 0.5, 1e-9)
  const g2 = poseAt('read', 0.35 + 0.3, st) // 蹲完
  near(g2.iY, 0, 1e-9)
})

test('think：左眼 0.70 倍右眼 1.30 倍（基数 9.2），岛倾 -3.2°', () => {
  const g = poseAt('think', 1)
  near(g.wL, 9.2 * 0.7, 1e-9); near(g.hL, 9.2 * 0.7, 1e-9)
  near(g.wR, 9.2 * 1.3, 1e-9); near(g.hR, 9.2 * 1.3, 1e-9)
  near(g.upL, 0.16); near(g.upR, 0)
  near(g.iRot, -3.2)
  near(g.xL, 0.2) // 扫到中段（v4 thinkGaze 第二段）
  const g116 = poseAt('think', 1.16) // 刚换段：左眼已到 −2.8，右眼晚 40ms 还在上一段
  near(g116.xL, -2.8, 1e-9); near(g116.xR, 0.2, 1e-9)
  assert.equal(poseAt('think', 3.1).live, true)
  assert.equal(poseAt('think', 3.3).live, false)
})

test('write：低头、左眼更眯、约 1 秒一拍、偶尔瞥旁边', () => {
  const st = preparePose('write', seq(0.5))
  const g0 = poseAt('write', 0.2, st) // 还没起跳（0.25 起）
  near(g0.yL, 1.35); near(g0.yR, 1.05)
  near(g0.upL, 0.12); near(g0.upR, 0.05)
  near(g0.wL, 10.4); near(g0.hL, 7.6)
  near(g0.iY, 0)
  const beat = poseAt('write', 0.5, st) // (0.5-0.25)*2π = π/2，拍在顶上
  assert.ok(beat.iY <= -0.9 && beat.iY >= -1.15, `iY ${beat.iY}`) // 卡：不超过 1.15px
  near(beat.iRot, 0.9, 1e-9)
  const beat2 = poseAt('write', 1.5, st) // 周期 1 秒，同一拍形
  near(beat2.iY, beat.iY, 1e-9)
  // 瞥一眼旁边：rand=0 → 头一眼在 1.65 秒
  const st2 = preparePose('write', seq(0))
  const glance = poseAt('write', 1.71, st2) // τ=0.06，u = easeOut(0.5)
  const u = 1 - Math.pow(0.5, 2.2)
  near(glance.xL, -0.3 + 2.4 * u, 1e-9)
  near(glance.yL, 1.35 - 0.6 * u, 1e-9)
  assert.equal(poseAt('write', 3, st).live, true)
})

test('done：先放大（12.8 / 14.2）再收成 ^ ^，轻跳一次', () => {
  const g0 = poseAt('done', 0.25)
  near(g0.wL, 12.8); near(g0.hL, 12.8)
  near(g0.wR, 14.2); near(g0.hR, 14.2)
  const mid = poseAt('done', 0.5) // 收线中
  const s = 1 - Math.pow(1 - (0.5 - 0.32) / 0.28, 2.2) // easeOut(seg(0.5, 0.32, 0.6))，窗口 0.28 秒
  near(mid.smileL, s, 1e-9)
  near(mid.wL, 12.8 + (10.2 - 12.8) * s, 1e-9)
  assert.ok(poseAt('done', 0.36).hop < 0) // 轻跳冲量
  assert.equal(poseAt('done', 0.4).hop, 0) // 只给一次
  const end = poseAt('done', 0.8)
  near(end.smileL, 1); near(end.smileR, 1)
  near(end.hL, 3.0); near(end.hR, 3.2)
  assert.equal(end.live, false)
})

test('fail：平的细缝，整岛左右晃 2px 两次、共 240ms', () => {
  const closing = poseAt('fail', 0.1)
  // 0.39：上下对合后留下的缝约 2.3px（跟 0.3 那条平线一样粗；0.46 时不到 1px，几乎看不见）
  assert.ok(closing.upL > 0.34 && closing.upL < 0.37, `上眼皮 ${closing.upL}`)
  near(closing.upL, closing.loL) // 上下对合，不弯
  near(closing.smileL, 0)
  const shake = poseAt('fail', 0.3) // u2 = 0.625 → sin(2.5π) = 1 → 在最左
  near(shake.kinX, -2, 1e-9)
  const done = poseAt('fail', 0.5)
  assert.equal(done.kinX, null)
  assert.equal(done.live, false)
})

test('look：两眼睁大到半径 7，不动', () => {
  const g = poseAt('look', 0.3)
  near(g.wL, 14); near(g.hL, 14); near(g.wR, 14); near(g.hR, 14)
  near(g.xL, 0); near(g.xR, 0)
  assert.equal(g.live, false)
})

test('drag：shape 给 drag', () => {
  const g = poseAt('drag', 0.5)
  assert.equal(g.shape, 'drag')
  assert.equal(g.blink, false)
})

test('blinkCurve：闭上先快后慢，睁开 smoothstep，外面是 0', () => {
  assert.equal(blinkCurve(0.99, 1, 0.1, 0.1), 0)
  assert.equal(blinkCurve(1.25, 1, 0.1, 0.1), 0)
  near(blinkCurve(1.05, 1, 0.1, 0.1), 1 - Math.pow(0.5, 1.6))
  near(blinkCurve(1.1, 1, 0.1, 0.1), 1)
  near(blinkCurve(1.15, 1, 0.1, 0.1), 0.5)
})

test('脚本有限的神情带 endT，别的没有', () => {
  assert.equal(preparePose('drowsy').endT, 2.56)
  assert.equal(preparePose('wake').endT, 3.5)
  assert.equal(preparePose('think').endT, 3.2)
  assert.equal(preparePose('done').endT, 0.75)
  assert.equal(preparePose('fail').endT, 0.45)
  assert.equal(preparePose('look').endT, 0.15) // 进场放大那一缓动走完的时刻（snap 要跳到睁大了的那一格）
  assert.equal(preparePose('expect').endT, 0.15)
  assert.equal(preparePose('idle').endT, null)
  assert.equal(preparePose('read').endT, null)
  assert.equal(preparePose('write').endT, null)
  near(REST, 10.6)
})
