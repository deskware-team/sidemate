// 钥匙不进日志、不进环境变量：外部工具服务的钥匙随会话参数走，
// 打码名单里要算上它，环境变量表里不许有它。

import assert from 'node:assert/strict'
import test from 'node:test'
import { keyEnv, redact, secretList } from '../../app/dsh/secrets.mjs'

const HEADER_KEY = 'sidemate-secrets-header'
const QUERY_KEY = 'sidemate-secrets-query'

const servers = [
  { type: 'http', name: 'github', url: 'https://g.example/mcp', headers: [{ name: 'Authorization', value: HEADER_KEY }] },
  { type: 'http', name: 'search', url: `https://s.example/mcp?api_key=${encodeURIComponent(QUERY_KEY)}`, headers: [] },
]

test('secretList：外部工具服务的钥匙算进打码名单', () => {
  const list = secretList({ apiKey: 'sidemate-secrets-model', mcpSecrets: [HEADER_KEY, QUERY_KEY] })
  assert.equal(list.includes(HEADER_KEY), true, JSON.stringify(list))
  assert.equal(list.includes(QUERY_KEY), true, JSON.stringify(list))
  assert.equal(list.includes('sidemate-secrets-model'), true)
})

test('secretList：没有外部工具服务时名单照旧', () => {
  assert.deepEqual(secretList({ apiKey: 'a' }), ['a'])
  assert.deepEqual(secretList({}), [])
  assert.deepEqual(secretList({ mcpServers: [{ type: 'http', name: 'x', url: 'https://x.example/mcp', headers: [] }] }), [])
})

test('secretList：网址里的参数值不算钥匙', () => {
  // 用户自己配的地址里带着 format=json 这种参数值，它不是钥匙，不能盖掉模型话里的 json
  const list = secretList({ mcpSecrets: ['sidemate-secrets-only'] })
  assert.equal(list.includes('json'), false, JSON.stringify(list))
  assert.deepEqual(secretList({ mcpServers: [{ type: 'http', name: 'x', url: 'https://x.example/mcp?format=json&key=XYZ', headers: [] }] }), [])
})

test('redact：外部工具服务的钥匙在文字里换成 ***', () => {
  const list = secretList({ mcpSecrets: [HEADER_KEY, QUERY_KEY] })
  const text = redact(`请求头 ${HEADER_KEY} 网址 ${QUERY_KEY}`, list)
  assert.equal(text.includes(HEADER_KEY), false, text)
  assert.equal(text.includes(QUERY_KEY), false, text)
})

test('redact：正常的字和参数值不被盖，钥匙被盖', () => {
  const list = secretList({ mcpSecrets: ['XYZ'] })
  const text = redact('这段是 json，v=1，钥匙 XYZ 在这里', list)
  assert.equal(text.includes('json'), true, text)
  assert.equal(text.includes('v=1'), true, text)
  assert.equal(text.includes('XYZ'), false, text)
  assert.equal(text.includes('***'), true, text)
})

test('keyEnv：外部工具服务的钥匙不进环境变量', () => {
  const env = keyEnv({
    SIDEMATE_KEY_C_A: 'model-key',
    SIDEMATE_MCP_KEY_GITHUB: 'mcp-key',
    SIDEMATE_MCP_GITHUB: 'old-key',
  })
  assert.deepEqual(env, { SIDEMATE_KEY_C_A: 'model-key' })
})
