// 模型忙时的那些话：等一会儿再试的那一行、停在这儿的那一行、接着干说的那句。

import assert from 'node:assert/strict'
import test from 'node:test'
import { secondsLeft, waitInfo, waitLine } from '../../app/task/wait.mjs'
import { t } from '../../app/copy/copy.mjs'

test('等待行：模型忙、还有几秒自动重试、第几次、最多几次；不念厂商名，到 0 是重新连接中', () => {
  assert.equal(waitLine(37, 5, 10), '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(waitLine(5, 1, 10), '模型忙，5 秒后自动重试（第 1 次，最多 10 次）')
  assert.equal(waitLine(0, 1, 10), '模型忙，重新连接中（第 1 次，最多 10 次）')
})

test('接着干只说一句短话：原来那句要求和文件不再带上', () => {
  assert.equal(t('continue'), '接着干，把刚才没做完的接着做完。')
})

test('倒数：到点就是 0', () => {
  const now = 1_000_000
  assert.equal(secondsLeft(now + 20_000, now), 20)
  assert.equal(secondsLeft(now + 1, now), 1)
  assert.equal(secondsLeft(now, now), 0)
  assert.equal(secondsLeft(now - 5_000, now), 0)
  assert.equal(secondsLeft(0, now), 0)
})

test('等待行的数：秒数、到点的时候、第几次、最多几次', () => {
  const now = 1_000_000
  const info = waitInfo(20_000, 3, 10, now)
  assert.equal(info.text, '模型忙，20 秒后自动重试（第 3 次，最多 10 次）')
  assert.equal(info.head, '模型忙，')
  assert.equal(info.tail, '（第 3 次，最多 10 次）')
  assert.equal(info.until, now + 20_000)
  assert.equal(info.retry, 3)
  assert.equal(info.max, 10)
  // 缺的东西不炸
  const thin = waitInfo(0, 0, 0, now)
  assert.equal(thin.text, '模型忙，重新连接中（第 1 次，最多 1 次）')
  assert.equal(thin.until, now)
})

test('厂商的业务码不单说：忙就是忙', () => {
  // 不认厂商的业务码了：并发满了、平台过载都是模型忙
  assert.equal(waitLine(37, 5, 10, { code: 1302 }), '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(waitLine(37, 5, 10, { code: 1305 }), '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(waitLine(37, 5, 10, {}), '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
})
