// 读网页的拦截插件：地址查不出来（DNS 查不到、超时）也拦下来。
// 判断不了是不是本机或局域网，就不放行。纯逻辑，不用起 dsh。

import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../../app/dsh/local-net-plugin.mjs'
import { t } from '../../app/copy/copy.mjs'

// 把插件挂上，拿到它拦读网页的那个函数
function preExecute() {
  const handlers = new Map()
  apply({ on: (event, fn) => handlers.set(event, fn) })
  return handlers.get('tools/pre-execute')
}

// 读一个网址，看插件让不让读
async function fetchVerdict(url) {
  let called = false
  const result = await preExecute()(
    { name: 'web_fetch', arguments: { url } },
    () => { called = true; return { kind: 'allow' } },
  )
  return { result, called }
}

test('地址查不出来：拦下来，给模型说这个地址查不到', async () => {
  const { result, called } = await fetchVerdict('http://查不出来的这个域名.invalid/')
  assert.equal(called, false, '没让读网页那边去读')
  assert.equal(result.kind, 'deny')
  assert.equal(result.reason, t('web.localNetUnresolved'))
  assert.match(result.reason, /查不到/)
})

test('地址就在本机：拦下来，给模型说这个地址在本机或局域网里', async () => {
  const { result, called } = await fetchVerdict('http://127.0.0.1:8080/')
  assert.equal(called, false, '没让读网页那边去读')
  assert.equal(result.kind, 'deny')
  assert.equal(result.reason, t('web.localNetDenied'))
})
