// 真 dsh + 本机假服务：模型忙的时候自己重试；试够了停在这儿，点「接着干」从停的地方继续。
// 重试是 dsh 自己做的（它只重发那一次模型请求），桌伴照着它的播报出等待行。
// 重试的策略是 dsh 的默认：最多 5 次（桌伴不写策略了）。
// 这里只把退避调短（0.5–10 秒起步在测试里等不起），次数照 dsh 默认。

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { choiceValue, routesYaml } from '../../app/dsh/models.mjs'
import { envName } from '../../app/models/keys.mjs'
import { t } from '../../app/copy/copy.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const ROUTE = 'c-fake'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 测试里把退避调短：次数和重试的码都不写，用 dsh 自己的默认（最多 5 次）
const FAST = [
  '        retryPolicy:',
  '          mode: normal',
  '          backoff:',
  '            initialDelayMs: 300',
  '            maxDelayMs: 400',
].join('\n')

// 自定义线路：桌伴不写重试策略，测试自己塞一份短的退避
function routesFor(url) {
  const yaml = routesYaml(
    {
      entries: [
        {
          id: ROUTE,
          kind: 'custom',
          name: '假服务',
          protocol: 'anthropic',
          baseUrl: url,
          models: [{ id: 'fake-model', name: '假模型' }],
        },
      ],
    },
    { consented: true },
  )
  return yaml.replace('        api: "anthropic-messages"', `        api: "anthropic-messages"\n${FAST}`)
}

// 投影缓存写得勤一点，重试的次数才能马上看见
const CACHE_PATCH = readFileSync(new URL('../../app/dsh/cache.patch.yml', import.meta.url), 'utf8')

function taskOptions(extra) {
  const shared = extra.shared || {}
  return {
    taskId: 'busy',
    workspace: shared.workspace || scratch('sidemate-ws-'),
    lowRoot: shared.lowRoot || scratch('sidemate-low-'),
    apiKey: KEY,
    env: { [envName(ROUTE)]: KEY },
    model: { value: choiceValue(ROUTE, 'fake-model'), effort: null },
    route: ROUTE,
    ...extra,
  }
}

const BUSY_BODY = JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit reached for requests' } })

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('模型忙时的真 dsh', { concurrency: 1 }, () => {
  test('忙三次：自己重试，三次以后照样干完', { timeout: 180_000 }, async () => {
    const events = []
    const fake = await startFake({
      expectKey: KEY,
      respond: (body, nth) => (nth <= 3 ? { kind: 'status', status: 429, body: BUSY_BODY } : { kind: 'text', text: '好了' }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'busy-3',
        prompt: '说一声好了',
        patchTexts: [routesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'done', JSON.stringify(events))
      // 头三次失败，第四次成功
      assert.equal(fake.calls.length, 4)
      assert.equal(events.some(event => event.type === 'reply' && event.text.includes('好了')), true)
      // 重试的次数报上来了，界面上能出「X 秒后再试」
      const retries = events.filter(event => event.type === 'retry')
      assert.ok(retries.length >= 1, JSON.stringify(events.map(event => event.type)))
      // 投影缓存不是每个数都赶得上：报上来的那几次是往上走的
      assert.ok(retries[0].retry >= 1)
      assert.ok(retries.every((one, index) => index === 0 || one.retry > retries[index - 1].retry))
      // 最多几次是 dsh 自己的默认（5 次）
      assert.equal(retries[0].maxRetries, 5)
      // 等几秒是 dsh 自己算的（带抖动，300 起步上下两成）
      assert.ok(retries[0].delayMs >= 200 && retries[0].delayMs <= 400, String(retries[0].delayMs))
    } finally {
      await fake.close()
    }
  })

  test('一直忙：试够了停在这儿，点「接着干」在同一个会话里接着干完', { timeout: 300_000 }, async () => {
    const events = []
    const shared = { workspace: scratch('sidemate-ws-'), lowRoot: scratch('sidemate-low-') }
    const fake = await startFake({
      expectKey: KEY,
      // 头一轮试够了 5 次（1 次 + 5 次重试）还是忙；下一轮接着干就好了
      respond: (body, nth) => (nth <= 6 ? { kind: 'status', status: 429, body: BUSY_BODY } : { kind: 'text', text: '好了' }),
    })
    try {
      const first = runTask(taskOptions({
        taskId: 'busy-20',
        shared,
        prompt: '照范本写一份周报',
        patchTexts: [routesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      }))
      const firstEnd = await first.done
      // 试了 10 次还不行：这轮没干成
      assert.equal(firstEnd.status, 'error', JSON.stringify(events.map(event => event.type)))
      const failure = events.find(event => event.type === 'error')
      assert.equal(failure?.reason, 'busy', JSON.stringify(failure))
      // dsh 的码和 HTTP 状态：不是桌伴自己猜的
      assert.equal(failure?.dshCode, 'RATE_LIMIT', JSON.stringify(failure))
      assert.equal(failure?.status, 429, JSON.stringify(failure))
      // 一轮最多 6 次请求（1 次 + 重试 5 次，dsh 的默认）
      assert.equal(fake.calls.length, 6)
      // 停在这儿的时候重试次数报到了 5
      const retries = events.filter(event => event.type === 'retry')
      assert.ok(retries.length >= 1, JSON.stringify(events.map(event => event.type)))
      assert.ok(Math.max(...retries.map(event => event.retry)) >= 5, JSON.stringify(retries))

      // 点「接着干」：同一个会话，发一句继续的话，不重发原来的活
      const secondEvents = []
      const second = runTask(taskOptions({
        taskId: 'busy-20-next',
        sessionId: first.sessionId,
        prompt: t('continue'),
        // 同一个会话就要用同一个工作区
        shared,
        patchTexts: [routesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => secondEvents.push(event),
      }))
      const secondEnd = await second.done
      assert.equal(secondEnd.status, 'done', JSON.stringify(secondEvents.map(event => event.type)))
      assert.equal(second.sessionId, first.sessionId)
      assert.equal(secondEvents.some(event => event.type === 'reply' && event.text.includes('好了')), true)
      // 第二轮接着第一轮继续：请求里带着上一轮的话，也带着新的那句
      const body = JSON.stringify(fake.calls.at(-1))
      assert.match(body, /照范本写一份周报/)
      assert.match(body, /接着干/)
    } finally {
      await fake.close()
    }
  })

  test('同一把钥匙也不排队：两个活共用一个 dsh、各用各的任务文件夹，同时跑', { timeout: 300_000 }, async () => {
    // 假模型一个都不回：排队的话第二个活连会话都起不来
    const fake = await startFake({ expectKey: KEY, respond: () => ({ kind: 'hang' }) })
    try {
      // 跟桌伴里一样：dsh 的家共用一个，任务文件夹各是各的
      const lowRoot = scratch('sidemate-low-')
      const one = runTask(taskOptions({ taskId: 'par-1', shared: { lowRoot }, prompt: '第一个活', patchTexts: [routesFor(fake.url)] }))
      const two = runTask(taskOptions({ taskId: 'par-2', shared: { lowRoot }, prompt: '第二个活', patchTexts: [routesFor(fake.url)] }))
      const asked = (text) => fake.calls.some((body) => JSON.stringify(body).includes(text))
      for (let i = 0; i < 1_500 && !(asked('第一个活') && asked('第二个活')); i += 1) await new Promise((done) => setTimeout(done, 20))
      assert.ok(asked('第一个活') && asked('第二个活'), '两个活没同时问模型')
      // 一个常驻的 dsh 进程：两个活在它上面各跑各的会话
      assert.equal(one.pid, two.pid, '两个活共用一个 dsh 进程')
      assert.notEqual(one.sessionId, two.sessionId)
      one.cancel()
      two.cancel()
      assert.deepEqual([(await one.done).status, (await two.done).status], ['cancelled', 'cancelled'])
    } finally {
      await fake.close()
    }
  })

})
