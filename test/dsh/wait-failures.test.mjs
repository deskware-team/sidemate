// 五种故障各跑一遍：429 连着来、500 两次后好、连接断了、坏 JSON、流断在中间。
// 错的种类不由桌伴拿英文正则猜：dsh 给出码（turn/end 事件里的 LlmFailure），
// 桌伴照码说停下那句。重试也是 dsh 自己做的（默认最多 5 次、间隔 0.5–10 秒）。

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { choiceValue, routesYaml } from '../../app/dsh/models.mjs'
import { codeOf, stopText } from '../../app/task/codes.mjs'
import { envName } from '../../app/models/keys.mjs'
import { startFakeFailures } from './fake-failures.mjs'

const KEY = 'sidemate-test-key'
const ROUTE = 'c-fake'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

// 测试里把退避调短（真人用的 0.5–10 秒在测试里等不起）：次数和码都不写，照 dsh 默认
const FAST = [
  '        retryPolicy:',
  '          mode: normal',
  '          backoff:',
  '            initialDelayMs: 100',
  '            maxDelayMs: 200',
].join('\n')

const CACHE_PATCH = readFileSync(new URL('../../app/dsh/cache.patch.yml', import.meta.url), 'utf8')

function routesFor(url, timeoutMs) {
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
  let out = yaml.replace('        api: "anthropic-messages"', `        api: "anthropic-messages"\n${FAST}`)
  if (timeoutMs) out = out.replace('        api: "anthropic-messages"', `        api: "anthropic-messages"\n        streamIdleTimeoutMs: ${timeoutMs}`)
  return out
}

function taskOptions(extra) {
  const shared = extra.shared || {}
  return {
    taskId: 'fault',
    workspace: shared.workspace || scratch('sidemate-ws-'),
    lowRoot: shared.lowRoot || scratch('sidemate-low-'),
    apiKey: KEY,
    env: { [envName(ROUTE)]: KEY },
    model: { value: choiceValue(ROUTE, 'fake-model'), effort: null },
    route: ROUTE,
    ...extra,
  }
}

async function runFault(mode, extra = {}) {
  const events = []
  const fake = await startFakeFailures({ expectKey: KEY, mode })
  const started = Date.now()
  try {
    const end = await runTask(taskOptions({
      taskId: `fault-${mode}`,
      prompt: '说一声好了',
      patchTexts: [routesFor(fake.url, extra.timeoutMs), CACHE_PATCH],
      onEvent: (event) => events.push(event),
      ...extra,
    })).done
    return { end, events, calls: fake.calls.length, seconds: (Date.now() - started) / 1000 }
  } finally {
    await fake.close()
  }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('五种故障', { concurrency: 1 }, () => {
  test('429 连着来：dsh 自己重试 5 次，最后报 RATE_LIMIT 429', { timeout: 120_000 }, async () => {
    const { end, events, calls } = await runFault('busy')
    assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
    const failure = events.find((one) => one.type === 'error')
    assert.equal(failure?.reason, 'busy', JSON.stringify(failure))
    assert.equal(failure?.dshCode, 'RATE_LIMIT', JSON.stringify(failure))
    assert.equal(failure?.status, 429, JSON.stringify(failure))
    assert.equal(codeOf(failure), 'RATE_LIMIT 429')
    assert.equal(stopText(failure, codeOf(failure)), '模型忙，已保存执行进度')
    // 一轮最多 1 次 + 重试 5 次（dsh 的默认）
    assert.equal(calls, 6)
    const retries = events.filter((one) => one.type === 'retry')
    assert.ok(retries.length >= 1)
    assert.ok(Math.max(...retries.map((one) => one.retry)) >= 5)
  })

  test('500 两次后好：自己恢复，这一轮照常干完', { timeout: 120_000 }, async () => {
    const { end, events, calls } = await runFault('server-error')
    assert.equal(end.status, 'done', JSON.stringify(events.map((one) => one.type)))
    assert.equal(calls, 3)
    assert.equal(events.some((one) => one.type === 'reply' && one.text.includes('好了')), true)
  })

  test('连接断了：dsh 说是 TRANSPORT，说「模型连接中断」', { timeout: 120_000 }, async () => {
    const { end, events, calls, seconds } = await runFault('drop')
    assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
    const failure = events.find((one) => one.type === 'error')
    assert.equal(failure?.reason, 'network', JSON.stringify(failure))
    assert.equal(failure?.dshCode, 'TRANSPORT', JSON.stringify(failure))
    assert.equal(codeOf(failure), 'TRANSPORT')
    assert.equal(stopText(failure, codeOf(failure)), '模型连接中断，已保存执行进度')
    // 1 次 + 重试 5 次
    assert.equal(calls, 6)
    assert.ok(seconds < 300, `${seconds} 秒`)
  })

  test('坏 JSON：dsh 当连接断了（TRANSPORT），重试够了才停', { timeout: 120_000 }, async () => {
    const { end, events, calls } = await runFault('bad-json')
    assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
    const failure = events.find((one) => one.type === 'error')
    // dsh 那边把「流没说完」算连接断了（TRANSPORT）
    assert.equal(failure?.dshCode, 'TRANSPORT', JSON.stringify(failure))
    assert.equal(failure?.reason, 'network', JSON.stringify(failure))
    assert.equal(calls, 6)
  })

  test('流断在中间：dsh 说是 TRANSPORT', { timeout: 120_000 }, async () => {
    const { end, events, calls } = await runFault('half-stream')
    assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
    const failure = events.find((one) => one.type === 'error')
    assert.equal(failure?.dshCode, 'TRANSPORT', JSON.stringify(failure))
    assert.equal(failure?.reason, 'network', JSON.stringify(failure))
    assert.equal(calls, 6)
  })

  test('模型一直不回：dsh 说是 TIMEOUT，说「模型响应超时」', { timeout: 120_000 }, async () => {
    const { end, events, calls } = await runFault('hang', { timeoutMs: 1500 })
    assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
    const failure = events.find((one) => one.type === 'error')
    assert.equal(failure?.dshCode, 'TIMEOUT', JSON.stringify(failure))
    assert.equal(failure?.reason, 'noreply', JSON.stringify(failure))
    assert.equal(stopText(failure, codeOf(failure)), '模型响应超时，已保存执行进度')
    assert.equal(calls, 6)
  })

  // 智谱的两种忙：响应体里带业务错误码，桌伴不单说，都算模型忙（RATE_LIMIT 429）
  for (const code of [1302, 1305]) {
    test(`智谱 ${code}：不单说业务码，都算模型忙`, { timeout: 120_000 }, async () => {
      const events = []
      const fake = await startFakeFailures({ expectKey: KEY, mode: 'zhipu-busy', zhipuCode: code })
      try {
        // 智谱走的是 OpenAI 那套格式，假服务就这么说
        const routes = routesYaml(
          {
            entries: [
              {
                id: ROUTE,
                kind: 'custom',
                name: '智谱',
                protocol: 'openai',
                baseUrl: fake.url,
                models: [{ id: 'fake-model', name: '假模型' }],
              },
            ],
          },
          { consented: true },
        )
        const end = await runTask(taskOptions({
          taskId: `zhipu-${code}`,
          prompt: '说一声好了',
          patchTexts: [routes.replace('        api: "openai-completions"', `        api: "openai-completions"\n${FAST}`), CACHE_PATCH],
          onEvent: (event) => events.push(event),
        })).done
        assert.equal(end.status, 'error', JSON.stringify(events.map((one) => one.type)))
        const failure = events.find((one) => one.type === 'error')
        assert.equal(failure?.reason, 'busy', JSON.stringify(failure))
        // 业务错误码不往上带；dsh 的码是 RATE_LIMIT，状态是 429
        assert.equal(failure?.biz, undefined, JSON.stringify(failure))
        assert.equal(failure?.dshCode, 'RATE_LIMIT', JSON.stringify(failure))
        assert.equal(codeOf(failure), 'RATE_LIMIT 429')
      } finally {
        await fake.close()
      }
    })
  }
})
