// 重试和报错交给 dsh：桌伴不写重试策略，也不拿英文正则猜错种类。
// dsh 自己按它的码重试（默认：最多 5 次、间隔 0.5–10 秒、空回复也重试），
// 最后那次失败的码、HTTP 状态、原文由重试插件从 turn/end 事件里带来（app/dsh/retry-plugin.mjs）。
// 这里跑真 dsh + 本机假服务：数重试次数、看等待行用哪一句、看最后那一行显示成什么。

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { choiceValue, routesYaml } from '../../app/dsh/models.mjs'
import { KILO_BASE_URL, KILO_MODEL_ID } from '../../app/models/kilo.mjs'
import { codeOf, stopText } from '../../app/task/codes.mjs'
import { codeTail } from '../../app/copy/line.mjs'
import { waitInfo } from '../../app/task/wait.mjs'
import { envName } from '../../app/models/keys.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-test-key'
const ROUTE = 'c-fake'
// 这一轮用户说的话：每次发给模型的请求里都只该出现一遍
const PROMPT = '说一声好了'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 测试里把退避调短（真人用的 0.5–10 秒在测试里等不起）。
// 次数和重试的码都不写：用 dsh 自己的默认（最多 5 次、那五个码）。
const FAST = [
  '        retryPolicy:',
  '          mode: normal',
  '          backoff:',
  '            initialDelayMs: 100',
  '            maxDelayMs: 200',
].join('\n')

const CACHE_PATCH = readFileSync(new URL('../../app/dsh/cache.patch.yml', import.meta.url), 'utf8')

// 自定义线路：桌伴不写重试策略，测试自己塞一份短的退避（次数照 dsh 默认）
function routesFor(url, extra = '') {
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
  return yaml.replace('        api: "anthropic-messages"', `        api: "anthropic-messages"\n${extra}`)
}

// Kilo 那条线路：桌伴给的那份策略里限流不重试，这儿别再塞别的
function kiloRoutesFor(url) {
  const yaml = routesYaml(
    {
      entries: [
        {
          id: 'kilo',
          kind: 'free',
          name: 'Kilo 模型',
          baseUrl: url,
          models: [{ id: 'fake-model', name: '假模型' }],
        },
      ],
    },
    { consented: true },
  )
  // Kilo 的地址是代码里写死的常量，清单改不了；测试要指到本机假服务，就把常量换掉
  return yaml.replace(KILO_BASE_URL, url)
}

function taskOptions(extra) {
  return {
    taskId: 'kind',
    workspace: scratch('sidemate-ws-'),
    lowRoot: scratch('sidemate-low-'),
    apiKey: KEY,
    env: { [envName(ROUTE)]: KEY },
    model: { value: choiceValue(ROUTE, 'fake-model'), effort: null },
    route: ROUTE,
    ...extra,
  }
}

const BUSY_BODY = JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit reached for requests' } })

// 用户那句话在这次请求里出现了几遍
function timesOf(body, text) {
  return JSON.stringify(body?.messages ?? []).split(text).length - 1
}

// 等待行：那一行的字（用的哪条状态码看字就知道）
const waitText = (kind) => waitInfo(1000, 1, 5, Date.now(), { kind }).text

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('重试和报错交给 dsh', { concurrency: 1 }, () => {
  test('429：dsh 自己重试 5 次，最后报「模型忙 · RATE_LIMIT 429」', { timeout: 300_000 }, async () => {
    const events = []
    const fake = await startFake({
      expectKey: KEY,
      respond: () => ({ kind: 'status', status: 429, body: BUSY_BODY }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'kind-busy',
        prompt: PROMPT,
        patchTexts: [routesFor(fake.url, FAST), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
      const failure = events.find((one) => one.type === 'error')
      // dsh 的码和 HTTP 状态：不是桌伴自己猜的
      assert.equal(failure?.dshCode, 'RATE_LIMIT', JSON.stringify(failure))
      assert.equal(failure?.status, 429, JSON.stringify(failure))
      assert.equal(failure?.reason, 'busy', JSON.stringify(failure))
      // 1 次 + 重试 5 次（dsh 的默认）
      assert.equal(fake.calls.length, 6)
      const retries = events.filter((one) => one.type === 'retry')
      assert.equal(retries.length, 5, JSON.stringify(retries.map((one) => one.retry)))
      assert.deepEqual(retries.map((one) => one.retry), [1, 2, 3, 4, 5])
      assert.equal(retries[0].kind, 'busy')
      assert.equal(retries[0].maxRetries, 5)
      // 重试是 dsh 自己重发那一次模型请求：用户那句话每次都只出现一遍
      for (const body of fake.calls) assert.equal(timesOf(body, PROMPT), 1, JSON.stringify(body).slice(0, 200))
      // 等待行：模型忙
      assert.equal(waitText('busy'), '模型忙，1 秒后自动重试（第 1 次，最多 5 次）')
      // 最后那一行：停下那句 · dsh 码 HTTP 状态，原文
      const code = codeOf(failure)
      assert.equal(code, 'RATE_LIMIT 429')
      assert.equal(stopText(failure, code), '模型忙，已保存执行进度')
      assert.match(codeTail(code, failure.raw), /^· RATE_LIMIT 429，/)
    } finally {
      await fake.close()
    }
  })

  test('空回复：dsh 也重试（默认的码里有它），最后报「模型请求失败 · EMPTY_RESPONSE」', { timeout: 300_000 }, async () => {
    const events = []
    const fake = await startFake({
      expectKey: KEY,
      // 回了个空的：说完了，可是一个字都没有
      respond: () => ({ kind: 'text', chunks: [] }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'kind-empty',
        prompt: PROMPT,
        patchTexts: [routesFor(fake.url, FAST), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
      const failure = events.find((one) => one.type === 'error')
      assert.equal(failure?.dshCode, 'EMPTY_RESPONSE', JSON.stringify(failure))
      assert.equal(failure?.reason, 'server', JSON.stringify(failure))
      // 空回复也重试：1 次 + 重试 5 次
      assert.equal(fake.calls.length, 6)
      assert.equal(events.filter((one) => one.type === 'retry').length, 5)
      const code = codeOf(failure)
      assert.equal(code, 'EMPTY_RESPONSE')
      assert.equal(stopText(failure, code), '模型请求失败，已保存执行进度')
      assert.match(codeTail(code, failure.raw), /^· EMPTY_RESPONSE，/)
    } finally {
      await fake.close()
    }
  })

  test('Kilo 那条线路：限流不重试，直接报「模型忙 · RATE_LIMIT 429」', { timeout: 300_000 }, async () => {
    const events = []
    const fake = await startFake({
      respond: () => ({ kind: 'status', status: 429, body: BUSY_BODY }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'kind-kilo',
        prompt: PROMPT,
        model: { value: choiceValue('kilo', KILO_MODEL_ID), effort: null },
        route: 'kilo',
        // 不起名字：起名那次请求也走这条线路，会算进请求数里
        title: false,
        patchTexts: [kiloRoutesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
      const failure = events.find((one) => one.type === 'error')
      assert.equal(failure?.dshCode, 'RATE_LIMIT', JSON.stringify(failure))
      assert.equal(failure?.status, 429, JSON.stringify(failure))
      // 限流不重试：就一次
      assert.equal(fake.calls.length, 1)
      assert.equal(events.some((one) => one.type === 'retry'), false)
      const code = codeOf(failure)
      assert.equal(code, 'RATE_LIMIT 429')
      assert.equal(stopText(failure, code), '模型忙，已保存执行进度')
    } finally {
      await fake.close()
    }
  })

  test('Kilo 那条线路：别的错照 dsh 默认，重试 5 次', { timeout: 300_000 }, async () => {
    const events = []
    const fake = await startFake({
      respond: () => ({ kind: 'status', status: 500, body: JSON.stringify({ error: { type: 'api_error', message: 'Internal server error' } }) }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'kind-kilo-500',
        prompt: PROMPT,
        model: { value: choiceValue('kilo', KILO_MODEL_ID), effort: null },
        route: 'kilo',
        title: false,
        // 不塞短的退避：这里走的就是 dsh 的默认（间隔 0.5–10 秒）
        patchTexts: [kiloRoutesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
      const failure = events.find((one) => one.type === 'error')
      assert.equal(failure?.dshCode, 'SERVER', JSON.stringify(failure))
      assert.equal(failure?.status, 500, JSON.stringify(failure))
      // 只改了限流那个码：次数还是 dsh 的默认（5 次）
      assert.equal(fake.calls.length, 6)
      assert.equal(events.filter((one) => one.type === 'retry').length, 5)
      const code = codeOf(failure)
      assert.equal(code, 'SERVER 500')
      assert.equal(stopText(failure, code), '模型请求失败，已保存执行进度')
    } finally {
      await fake.close()
    }
  })

  test('Kilo 那条线路：401 不是用户的钥匙不对，说「模型请求失败」', { timeout: 300_000 }, async () => {
    const events = []
    const fake = await startFake({
      respond: () => ({ kind: 'status', status: 401, body: JSON.stringify({ error: { type: 'authentication_error', message: 'Invalid API key' } }) }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'kind-kilo-401',
        prompt: PROMPT,
        model: { value: choiceValue('kilo', KILO_MODEL_ID), effort: null },
        route: 'kilo',
        title: false,
        patchTexts: [kiloRoutesFor(fake.url), CACHE_PATCH],
        onEvent: (event) => events.push(event),
      })).done
      assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
      const failure = events.find((one) => one.type === 'error')
      assert.equal(failure?.dshCode, 'AUTH', JSON.stringify(failure))
      assert.equal(failure?.status, 401, JSON.stringify(failure))
      assert.equal(failure?.route, 'kilo', JSON.stringify(failure))
      const code = codeOf(failure)
      assert.equal(code, 'AUTH 401')
      // Kilo 那条线路的 401：不说「密钥无效」，说「模型请求失败」
      assert.equal(stopText(failure, code), '模型请求失败，已保存执行进度')
    } finally {
      await fake.close()
    }
  })
})
