// 开机启动那一次（命令行带 --login）怎么起来：只出小岛。
import assert from 'node:assert/strict'
import test from 'node:test'
import { startupPlan } from '../../app/main/startup.mjs'

test('带 --login：不开任务窗、不播出场、不自己弹首次运行', () => {
  const plan = startupPlan({ argv: ['C:\\app\\sidemate.exe', '--login'] })
  assert.equal(plan.login, true)
  assert.equal(plan.openTask, false)
  assert.equal(plan.playIntro, false)
  assert.equal(plan.firstRun, false)
})

test('平时双击起来：任务窗照开', () => {
  const plan = startupPlan({ argv: ['C:\\app\\sidemate.exe'] })
  assert.equal(plan.login, false)
  assert.equal(plan.openTask, true)
  assert.equal(plan.playIntro, true)
  assert.equal(plan.firstRun, true)
})

test('没有参数也照旧', () => {
  const plan = startupPlan({})
  assert.equal(plan.login, false)
  assert.equal(plan.firstRun, true)
})
