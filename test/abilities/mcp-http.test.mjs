// 用本机真起服务验外部工具服务的报错：只说是哪一类（连接失败），码跟在后面；网址不进报错（就在弹窗那一格里）。
// 服务只听 127.0.0.1，跑完一起关。

import assert from 'node:assert/strict'
import http from 'node:http'
import test, { after } from 'node:test'
import { probeMcp } from '../../app/abilities/mcp.mjs'

const KEY = 'kt-mcp-http-sample'
const servers = []

function serve(handler) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url })
    handler(req, res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      const entry = {
        hits,
        port,
        url: (path = '/mcp') => `http://127.0.0.1:${port}${path}`,
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

test('指着网页：那边回的不是这个工具服务，说「连接失败」，码是设置自己的 Si110', async () => {
  const site = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body>这是个网页</body></html>')
  })
  const result = await probeMcp({ url: site.url(), auth: { kind: 'none', name: '' } })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'other')
  assert.equal(result.message, '连接失败 · Si110 错误')
  assert.equal(JSON.stringify(result).includes(KEY), false)
})

test('端口没人听：说「连接失败」，码是 Si601', async () => {
  // 起一个服务再关掉，留下一个没人监听的端口
  const site = await serve((req, res) => res.end('ok'))
  const url = site.url()
  await site.close()
  const result = await probeMcp({ url, auth: { kind: 'none', name: '' } })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'network')
  assert.equal(result.message, '连接失败 · Si601 错误')
})
