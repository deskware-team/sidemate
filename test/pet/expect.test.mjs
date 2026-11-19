// 接文件·期待：进来先弹一下等 250ms 再张托；这 250ms 里拖走了取消、不张托；
// 这 250ms 里松手了文件不能丢（不等托，直接照松手处理）；still 不弹不等立刻张托。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createExpect, expectOf } from '../../app/pet/expect.mjs'
import { EXPECT } from '../../app/pet/eyes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const shell = readFileSync(join(here, '../../app/pet/shell.mjs'), 'utf8')

test('进来的决定：弹一下 + 等 250ms；still 不弹不等', () => {
  assert.deepEqual(expectOf('enter', { still: false }), { bounce: true, waitMs: EXPECT.waitMs })
  assert.deepEqual(expectOf('enter', { still: true }), { bounce: false, waitMs: 0 })
  assert.equal(EXPECT.waitMs, 250)
})

test('这 250ms 里拖走了：取消，不张托', async () => {
  const opened = []
  const sent = []
  const tray = createExpect({
    send: (channel, payload) => sent.push(payload),
    still: () => false,
    openTray: () => opened.push('tray'),
    log: () => {},
  })
  tray.enter()
  assert.deepEqual(sent, [{ phase: 'enter' }], '进来那一下先弹（眼睛放大 + 岛弹）')
  tray.leave()
  assert.deepEqual(sent, [{ phase: 'enter' }, { phase: 'off' }], '拖走了把脸收回去')
  await sleep(EXPECT.waitMs + 150)
  assert.deepEqual(opened, [], '没张托')
})

test('这 250ms 里松手了：托不等，文件直接照松手处理（不能丢）', async () => {
  const opened = []
  const tray = createExpect({
    send: () => {},
    still: () => false,
    openTray: () => opened.push('tray'),
    log: () => {},
  })
  tray.enter()
  tray.drop()
  await sleep(EXPECT.waitMs + 150)
  assert.deepEqual(opened, [], '没先张托')
  // 松手那一下的决定：取消等待、直接处理
  assert.deepEqual(expectOf('drop'), { bounce: false, waitMs: 0, cancel: true, dropNow: true })
})

test('没拖走没松手：250ms 后张开成接收托', async () => {
  const opened = []
  const sent = []
  const tray = createExpect({
    send: (_channel, payload) => sent.push(payload),
    still: () => false,
    openTray: () => opened.push('tray'),
    log: () => {},
  })
  tray.enter()
  await sleep(EXPECT.waitMs + 150)
  assert.deepEqual(opened, ['tray'])
  assert.deepEqual(sent, [{ phase: 'enter' }, { phase: 'off' }])
})

test('still：不弹不等，立刻张托', () => {
  const opened = []
  const sent = []
  const tray = createExpect({
    send: (_channel, payload) => sent.push(payload),
    still: () => true,
    openTray: () => opened.push('tray'),
    log: () => {},
  })
  tray.enter()
  assert.deepEqual(opened, ['tray'], '立刻张托')
  assert.deepEqual(sent, [], '不弹脸')
})

test('壳里的接法：拖进、拖走、松手三条路都接上期待那一摊', () => {
  const dragEnter = shell.slice(shell.indexOf("'pet:drag-enter'"), shell.indexOf("'pet:drag-leave'"))
  assert.match(dragEnter, /expectTray\.enter\(\)/)
  const dragLeave = shell.slice(shell.indexOf("'pet:drag-leave'"), shell.indexOf("'pet:drop'"))
  assert.match(dragLeave, /expectTray\.leave\(\)/)
  const drop = shell.slice(shell.indexOf("'pet:drop'"), shell.indexOf("'pet:click'"))
  assert.match(drop, /expectTray\.drop\(\)/)
  assert.match(drop, /petDrop\(\{/, '松手照样把文件交给任务那一摊')
})
