// 用本机真起服务验「测一下」的三件事：
// 网页不是模型接口、地址写了 http 服务端要 https、上游过载（529）。
// 服务只听 127.0.0.1，整个文件跑完一起关（中途不关，免得端口被下一个服务捡回去）。

import assert from 'node:assert/strict'
import http from 'node:http'
import test, { after } from 'node:test'
import { probeEndpoint } from '../../app/models/probe.mjs'

const KEY = 'kt-http-probe-sample'

// 起一个本机服务，handler 收到 (req, res)
const servers = []

function serve(handler) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, auth: Boolean(req.headers.authorization) })
    handler(req, res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const entry = {
        hits,
        port,
        url: (path = '') => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise((done) => server.close(() => done())),
      }
      servers.push(entry)
      resolve(entry)
    })
  })
}

after(async () => {
  for (const one of servers) await one.close()
})

test('返回 HTML 的网页：200 就照 HTTP 码算通了，不猜错因', async () => {
  const site = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body>你 好，这里是个网页</body></html>')
  })
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: site.url('/v1'),
    key: KEY,
    model: 'side-chat',
  })
  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(result).includes(KEY), false)
})

test('地址写成 http、服务端要 https，说清楚要用 https，而且不跟着跳转走', async () => {
  const site = await serve((req, res) => {
    res.writeHead(301, { location: 'https://upstream.invalid/v1/chat/completions' })
    res.end()
  })
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: site.url('/v1'),
    key: KEY,
    model: 'side-chat',
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'https')
  assert.equal(result.message, '地址无效 · Si105 错误')
  // 只探了一次，没有跟着跳转再发一次
  assert.equal(site.hits.length, 1)
  assert.equal(JSON.stringify(result).includes(KEY), false)
})

test('上游过载（529）说那边忙，不说连不上', async () => {
  const site = await serve((req, res) => {
    res.writeHead(529, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: '1305', message: '该模型当前访问量过大' } }))
  })
  const result = await probeEndpoint({
    protocol: 'openai',
    baseUrl: site.url('/v1'),
    key: KEY,
    model: 'side-chat',
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'busy')
  assert.equal(result.message, '服务繁忙 · Si529 错误，{"error":{"code":"1305","message":"该模型当前访问量过大"}}')
  // 钥匙只发给了用户填的那个地址，没往别处发
  assert.equal(site.hits.every((hit) => hit.url.startsWith('/v1')), true)
})
