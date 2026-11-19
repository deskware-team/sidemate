// 全屏检测：前台窗口的矩形和类名直接问 user32（koffi），不起任何子进程。
// 这里塞一份假的 user32 进去，验的是「拿到矩形 → 认出盖满整块屏 → 小岛收成细线」这条链。

import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { coversDisplay, isDesktopClass, readForeground, watchForeground } from '../../app/pet/foreground.mjs'

// 假 user32：说前台是谁、它的矩形多大、类名是什么
function fakeUser32({ handle = 1, rect = { Left: 0, Top: 0, Right: 1920, Bottom: 1080 }, className = 'ApplicationFrameWindow' } = {}) {
  return {
    getForegroundWindow: () => handle,
    getWindowRect: () => rect,
    getClassName: () => className,
  }
}

test('全屏程序盖住整块屏才算盖住，最大化的不算', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  assert.equal(coversDisplay({ x: 0, y: 0, width: 1920, height: 1080 }, display), true)
  assert.equal(coversDisplay({ x: 0, y: 0, width: 1920, height: 1040 }, display), false)
  assert.equal(coversDisplay({ x: 100, y: 100, width: 800, height: 600 }, display), false)
  assert.equal(coversDisplay(null, display), false)
})

test('桌面本身不算全屏程序：小岛不能因此收成细线', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  const desktop = { x: 0, y: 0, width: 1920, height: 1080, className: 'Progman' }
  assert.equal(coversDisplay(desktop, display), false)
  assert.equal(coversDisplay({ ...desktop, className: 'WorkerW' }, display), false)
  assert.equal(coversDisplay({ ...desktop, className: 'Shell_TrayWnd' }, display), false)
  assert.equal(isDesktopClass('Progman'), true)
  assert.equal(isDesktopClass('WorkerW'), true)
  assert.equal(isDesktopClass('Shell_TrayWnd'), true)
  assert.equal(isDesktopClass('Windows.UI.Core.CoreWindow'), false)
  // 别的前台程序盖满整块屏还是算全屏
  assert.equal(coversDisplay({ ...desktop, className: 'ApplicationFrameWindow' }, display), true)
})

test('问一次前台窗口：拿到的矩形跟老版本给出去的一样', () => {
  const rect = readForeground(fakeUser32({ rect: { Left: 10, Top: 20, Right: 1930, Bottom: 1100 } }))
  assert.deepEqual(rect, { x: 10, y: 20, width: 1920, height: 1080, className: 'ApplicationFrameWindow' })
})

test('问不到窗口时不给出矩形（没有前台、没有矩形）', () => {
  assert.equal(readForeground(fakeUser32({ handle: 0 })), null)
  assert.equal(readForeground({
    getForegroundWindow: () => 1,
    getWindowRect: () => null,
    getClassName: () => '',
  }), null)
  assert.equal(readForeground(null), null)
})

test('盯着前台窗口：矩形一到就交出去，停了就不再交', async () => {
  const seen = []
  const stop = watchForeground((rect) => seen.push(rect), { api: fakeUser32(), pollMs: 20 })
  await sleep(80)
  stop()
  const count = seen.length
  assert.ok(count >= 1, '一次都没问出来')
  assert.equal(coversDisplay(seen[0], { x: 0, y: 0, width: 1920, height: 1080 }), true)
  await sleep(80)
  assert.equal(seen.length, count, '停了还在问')
})

test('装不上 user32 就关掉全屏检测：小岛照常显示，不报错', async () => {
  const seen = []
  const stop = watchForeground((rect) => seen.push(rect), { load: async () => null, pollMs: 20 })
  await sleep(80)
  stop()
  assert.deepEqual(seen, [])
})
