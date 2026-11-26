// 没同意使用须知被拦下时（Kilo 须知升版后要重新同意）：任务窗立刻弹须知窗；
// 用户同意了，把原来那句重发一次；没同意就不重发，也不再弹（那一行留着，用户自己点「使用须知」）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { consentRound, createConsentGate } from '../../app/task/consent-pop.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '../../app/task/task.js'), 'utf8')

// 假的视图：输入框上方那条红色横幅（Si102）上有一个「使用须知」那个钮
function view(round) {
  return {
    banner: {
      level: 'block',
      text: '必须阅读并同意使用须知',
      code: 'Si102',
      buttons: [{ action: 'consent', label: '使用须知', round }, { action: 'retry', label: '重来' }],
    },
  }
}

// 假的桥：同意就是 true；act 记下重发
function harness(agreed) {
  const seen = { asked: 0, acts: [] }
  const gate = createConsentGate({
    bridge: { consent: async () => { seen.asked += 1; return agreed } },
    act: (action) => seen.acts.push(action),
  })
  return { gate, seen }
}

test('1 横幅上那个钮：认得出是哪一轮', () => {
  assert.equal(consentRound(view(3)), 3)
  assert.equal(consentRound({ banner: { buttons: [{ action: 'retry', label: '重来' }] } }), null)
  assert.equal(consentRound({ banner: null }), null)
  assert.equal(consentRound(null), null)
})

test('2 这一轮被拦下：弹一次须知窗', async () => {
  const h = harness(false)
  await h.gate.offer(2)
  await h.gate.offer(2)
  assert.equal(h.seen.asked, 1)
})

test('3 同意了：重发原来那句', async () => {
  const h = harness(true)
  assert.equal(await h.gate.offer(1), true)
  assert.deepEqual(h.seen.acts, [{ type: 'retry' }])
})

test('4 不同意：不重发；这一轮不再弹，用户自己点还能弹', async () => {
  const h = harness(false)
  assert.equal(await h.gate.offer(4), false)
  assert.deepEqual(h.seen.acts, [])
  assert.equal(await h.gate.offer(4), false)
  assert.equal(h.seen.asked, 1)
  assert.equal(await h.gate.ask(4), false)
  assert.equal(h.seen.asked, 2)
  assert.deepEqual(h.seen.acts, [])
})

test('5 页面：横幅上那个钮一画出来就弹须知窗；钮自己也是弹须知窗', () => {
  assert.match(page, /createConsentGate\(\{ bridge, act \}\)/)
  assert.match(page, /if \(b\.action === 'consent'\) void consentGate\.offer\(b\.round\)/)
  assert.match(page, /else void consentGate\.ask\(one\.round\)/)
})
