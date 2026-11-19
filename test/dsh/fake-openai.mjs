// 本机假服务：说 OpenAI 那套（POST /chat/completions 的 SSE）。
// 用来复现「模型发来的工具调用没有编号」：有的 provider 在过载时会发一个空的 id。

import { createServer } from 'node:http'

function frame(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function chunk(delta, finish = null) {
  return {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

// 工具调用那一段：id 可以故意不给（provider 少给了）
function toolChunk(call) {
  const toolCall = { index: 0, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) } }
  if (call.id !== undefined) toolCall.id = call.id
  return chunk({ tool_calls: [toolCall] })
}

function bodyFor(step) {
  let body = ''
  if (step.kind === 'tool') {
    body += frame(toolChunk(step))
    body += frame(chunk({}, step.finish ?? 'tool_calls'))
  } else {
    body += frame(chunk({ content: step.text ?? '好了' }))
    body += frame(chunk({}, step.finish ?? 'stop'))
  }
  body += frame({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-model',
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
  })
  return `${body}data: [DONE]\n\n`
}

export function startFakeOpenAI({ respond, expectKey } = {}) {
  const calls = []
  const sockets = new Set()
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = { raw }
      }
      if (expectKey !== undefined) {
        const header = String(req.headers.authorization || '')
        const key = header.startsWith('Bearer ') ? header.slice(7) : ''
        if (key !== expectKey) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end('{"error":{"type":"authentication_error","message":"unauthorized"}}')
          return
        }
      }
      // dsh 给会话起名字的那次额外调用：回个名字，不算进 calls
      if (JSON.stringify(body?.messages ?? []).includes('concise title')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.end(bodyFor({ kind: 'text', text: '测试任务名' }))
        return
      }
      calls.push(body)
      const step = respond?.(body, calls.length) ?? { kind: 'text', text: '好了' }
      if (step.kind === 'hang') return
      if (step.kind === 'status') {
        res.writeHead(step.status, { 'content-type': 'application/json' })
        res.end(step.body ?? '{"error":{"type":"api_error","message":"no"}}')
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.end(bodyFor(step))
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
