// 故障用的假模型服务：只听 127.0.0.1，说 Anthropic 那套流式。
// 七种毛病都能装：429 连着来、500 两次后好、503、挂死不回（一直不吭声）、
// 连接断了、坏 JSON、流断在中间、回了个空的。
// 另外一种：先回一个工具调用，工具跑完后才 503（干到一半才断）。

import { createServer } from 'node:http'

function frame(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

// 正常的一轮：先说一句，再收尾
function okBody(text = '好了') {
  return frame({
    type: 'message_start',
    message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'fake-model', usage: { input_tokens: 3, output_tokens: 0 } },
  })
    + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    + frame({ type: 'content_block_stop', index: 0 })
    + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })
    + frame({ type: 'message_stop' })
}

const BUSY_BODY = JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limit reached for requests' } })

// 服务自己出错：503
const SERVER_BODY = JSON.stringify({ error: { type: 'api_error', message: 'service unavailable' } })

// 模型要调一个工具：调完再接着说话（用来试「干到一半才断」）
function toolBody(name = 'read', input = { file_path: 'a.txt' }) {
  return frame({
    type: 'message_start',
    message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'fake-model', usage: { input_tokens: 3, output_tokens: 0 } },
  })
    + frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name, input } })
    + frame({ type: 'content_block_stop', index: 0 })
    + frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } })
    + frame({ type: 'message_stop' })
}

// 回了个空的：模型那边说完了，可是一个字都没有
function emptyBody() {
  return frame({
    type: 'message_start',
    message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'fake-model', usage: { input_tokens: 3, output_tokens: 0 } },
  })
    + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })
    + frame({ type: 'message_stop' })
}

// 智谱那两种忙的响应体：429 里带业务错误码（1302 并发满了、1305 平台过载）
const ZHIPU_BODY = (code) => JSON.stringify({
  error: { code, message: '您的APIKey当前请求并发数超过限制，请稍后再试', param: null, type: 'rate_limit_error' },
})

export function startFakeFailures({ expectKey, mode, zhipuCode = 1302 } = {}) {
  const calls = []
  const sockets = new Set()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = { raw }
      }
      // 钥匙放哪儿都行：Anthropic 那套放 x-api-key，OpenAI 那套放 Authorization
      const given = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (expectKey !== undefined && given !== expectKey) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"error":{"type":"authentication_error","message":"unauthorized"}}')
        return
      }
      // dsh 给会话起名字的那次额外调用：好好回个名字，不算进 calls（毛病只装在干活的请求上）
      if (JSON.stringify(body?.system ?? body?.messages ?? '').includes('concise title')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(okBody('测试任务名'))
        return
      }
      calls.push(body)
      const nth = calls.length
      if (mode === 'busy') {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end(BUSY_BODY)
        return
      }
      if (mode === 'zhipu-busy') {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end(ZHIPU_BODY(zhipuCode))
        return
      }
      if (mode === 'server-error') {
        if (nth <= 2) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end('{"error":{"type":"api_error","message":"Internal server error"}}')
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(okBody())
        return
      }
      if (mode === 'tool-then-unavailable') {
        // 先正常回一个工具调用，工具跑完后下一次请求才 503
        if (nth === 1) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(toolBody())
          return
        }
        if (nth <= 3) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(SERVER_BODY)
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(okBody())
        return
      }
      if (mode === 'unavailable') {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(SERVER_BODY)
        return
      }
      if (mode === 'hang') {
        // 接了话一直不吭声：模型那边一直没回（等 dsh 那边超时）
        return
      }
      if (mode === 'empty') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(emptyBody())
        return
      }
      if (mode === 'drop') {
        // 接了话不说，然后就断了：连接断了
        setTimeout(() => req.socket.destroy(), 200)
        return
      }
      if (mode === 'bad-json') {
        // 回了一份坏 JSON：桌伴读不懂
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"choices": [ {"message": {"content": "坏 JSON"')
        return
      }
      if (mode === 'half-stream') {
        // 说到一半断了
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(frame({
          type: 'message_start',
          message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'fake-model', usage: { input_tokens: 3, output_tokens: 0 } },
        }))
        res.write(frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }))
        res.write(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '说到一半' } }))
        setTimeout(() => req.socket.destroy(), 100)
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(okBody())
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close() {
          for (const socket of sockets) socket.destroy()
          return new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}
