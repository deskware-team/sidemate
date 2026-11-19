// 任务窗高度的纯函数：默认 520、最低 360、屏幕工作区减 120；拖把手的算法；记高度的 json。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_H, MIN_H, clampHeight, dragHeight, maxHeightFor, readHeight, writeHeight } from '../../app/task/height.mjs'

test('默认 520、最低 360，屏幕给工作区留 120', () => {
  assert.equal(DEFAULT_H, 520)
  assert.equal(MIN_H, 360)
  assert.equal(maxHeightFor(1080), 960)
  assert.equal(maxHeightFor(1044.9), 924)
  // 屏幕太小：再小也不破最低那条
  assert.equal(maxHeightFor(440), 360)
  assert.equal(maxHeightFor('x'), 360)
})

test('想要的高度夹进上下限', () => {
  assert.equal(clampHeight(520, 960), 520)
  assert.equal(clampHeight(200, 960), 360)
  assert.equal(clampHeight(2000, 960), 960)
  // 上限低于想要的高度：听上限的
  assert.equal(clampHeight(400, 380), 380)
  // 上限比最低还低：取最低
  assert.equal(clampHeight(400, 300), 360)
  // 坏的输入退默认，小数四舍五入
  assert.equal(clampHeight('abc', 960), 520)
  assert.equal(clampHeight(undefined, 960), 520)
  assert.equal(clampHeight(522.4, 960), 522)
  assert.equal(clampHeight(undefined, 380), 380)
})

test('拖把手：指针走多少，窗高跟多少', () => {
  assert.equal(dragHeight(520, 100, 100), 520)
  assert.equal(dragHeight(520, 100, 180), 600)
  assert.equal(dragHeight(520, 100, 20), 440)
  assert.equal(dragHeight(360, 0, 400.6), 761)
  assert.ok(Number.isNaN(dragHeight('x', 1, 2)))
  assert.ok(Number.isNaN(dragHeight(520, 'x', 2)))
})

test('记高度：写进 json 再原样读出来；坏了当没有', () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-height-'))
  try {
    const file = join(dir, 'task-height.json')
    assert.equal(readHeight(file), null)
    assert.equal(writeHeight(file, 640), true)
    assert.equal(readHeight(file), 640)
    assert.equal(writeHeight(file, 361.6), true)
    assert.equal(readHeight(file), 362)
    // 不写坏数
    assert.equal(writeHeight(file, 'x'), false)
    assert.equal(writeHeight(file, -5), false)
    assert.equal(readHeight(file), 362)
    // 文件坏了、写的是歪形状：都当没有
    writeFileSync(file, 'not json', 'utf8')
    assert.equal(readHeight(file), null)
    writeFileSync(file, '{"height":"高"}', 'utf8')
    assert.equal(readHeight(file), null)
    writeFileSync(file, '{"height":0}', 'utf8')
    assert.equal(readHeight(file), null)
    // 读不到的路径也稳
    assert.equal(readHeight(join(dir, '没有这个', 'x.json')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
