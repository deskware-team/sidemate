// 重试策略：桌伴不写了，交给 dsh 自己。
// dsh-llm-retry 的默认是「正常」模式——最多 5 次、间隔 0.5–10 秒、抖动 0.1，
// 空回复（EMPTY_RESPONSE）也重试；重试的码是那五个：
// EMPTY_RESPONSE、RATE_LIMIT、SERVER、TIMEOUT、TRANSPORT。
// 只有 Kilo 那条线路单独一份：限流（RATE_LIMIT）不重试——那边排队限流，等一会儿再来也一样。

import assert from 'node:assert/strict'
import test from 'node:test'
import { noDeepseekYaml, providerOf, routesYaml, singleRequestYaml } from '../../app/dsh/models.mjs'

const CATALOG = {
  entries: [
    {
      id: 'kilo',
      kind: 'free',
      name: 'Kilo 模型',
      baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
      models: [{ id: 'kilo-auto/free', name: 'Kilo 模型' }],
    },
    {
      id: 'zhipu',
      kind: 'custom',
      name: '智谱',
      protocol: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: [{ id: 'glm-4.7-flash', name: 'GLM-4.7-Flash' }],
    },
  ],
}

// 一段配置里的 retryPolicy（缩进跟着所在位置走）；没有就 null
function policyOf(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*retryPolicy:\s*$/.test(line))
  if (start < 0) return null
  const indent = lines[start].match(/^\s*/)[0]
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue
    if (!line.startsWith(`${indent}  `)) break
    body.push(line.trim())
  }
  return body
}

test('自定义线路不写重试策略：照 dsh 自己的默认', () => {
  const yaml = routesYaml(CATALOG, { consented: true })
  const custom = yaml.slice(yaml.indexOf('zhipu:'))
  assert.equal(policyOf(custom), null, '自定义线路不该带 retryPolicy')
})

test('Kilo 那条线路单独一份：限流不重试，其它照 dsh 默认', () => {
  const yaml = routesYaml(CATALOG, { consented: true })
  const free = yaml.slice(yaml.indexOf('kilo:'))
  const body = policyOf(free)
  assert.ok(body, 'Kilo 那条线路带一份 retryPolicy')
  const text = body.join('\n')
  assert.match(text, /^mode: normal$/m)
  assert.match(text, /^retryableCodes:$/m)
  // dsh 默认的五个码，去掉限流那个
  for (const code of ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT']) {
    assert.match(text, new RegExp(`^- ${code}$`, 'm'))
  }
  assert.equal(text.includes('RATE_LIMIT'), false, '限流不重试')
  // 次数和间隔都不写：用 dsh 自己的默认（最多 5 次、0.5–10 秒）
  assert.equal(/maxRetries/.test(text), false)
  assert.equal(/backoff/.test(text), false)
})

test('DeepSeek 那份补丁只有手写目录，没有重试策略', () => {
  const yaml = noDeepseekYaml()
  assert.ok(yaml.includes('- id: llm-deepseek'))
  assert.ok(yaml.includes('    models:'))
  assert.equal(yaml.includes('retryPolicy'), false)
})

test('没同意 Kilo 模型使用须知的时候，路线里只有自定义那几条', () => {
  const yaml = routesYaml(CATALOG, { consented: false })
  assert.equal(yaml.includes('kilo:'), false)
  assert.equal(policyOf(yaml), null)
})

test('同时只能 1 个请求的模型：子智能体关掉', () => {
  const text = singleRequestYaml()
  assert.match(text, /- id: tool-subagent\n {2}disabled: true/)
  assert.match(text, /- id: tool-subagent-fork\n {2}disabled: true/)
})

test('路线名：Kilo 那条线路是 kilo，DeepSeek 是 deepseek-official，自定义用自己的 id', () => {
  assert.equal(providerOf('free'), 'kilo')
  assert.equal(providerOf('deepseek'), 'deepseek-official')
  assert.equal(providerOf('zhipu'), 'zhipu')
})
