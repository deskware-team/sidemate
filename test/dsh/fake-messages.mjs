import { createServer } from 'node:http'

function frame(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function messageStream({ id = 'm', usage, blocks, stop }) {
  const counts = usage ?? { input_tokens: 3, output_tokens: 2 }
  const stopReason = stop ?? (blocks.some(block => block.type === 'tool') ? 'tool_use' : 'end_turn')
  let body = frame({
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'deepseek-flash',
      usage: { ...counts, output_tokens: 0 },
    },
  })
  blocks.forEach((block, index) => {
    if (block.type === 'tool') {
      body += frame({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} },
      })
    } else {
      body += frame({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      }) + frame({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text ?? '' },
      })
    }
    body += frame({ type: 'content_block_stop', index })
  })
  body += frame({
    type: 'message_delta',
    delta: { stop_reason: stopReason },
    usage: { output_tokens: counts.output_tokens },
  }) + frame({ type: 'message_stop' })
  return body
}

function blocksFor(step, nth) {
  if (Array.isArray(step.blocks)) {
    return step.blocks.map((block, index) => (
      block.type === 'tool' ? { ...block, id: block.id ?? `tool-${nth}-${index}` } : block
    ))
  }
  if (step.kind === 'tool') {
    return [{ type: 'tool', name: step.name, input: step.input, id: step.id ?? `tool-${nth}` }]
  }
  const texts = step.chunks ?? [step.text]
  return texts.map(text => ({ type: 'text', text }))
}

function bodyFor(step, nth) {
  if (step.kind !== 'text' && step.kind !== 'tool' && step.kind !== 'script') return ''
  const usage = step.usage ?? (step.kind === 'tool'
    ? { input_tokens: 5, output_tokens: 4 }
    : { input_tokens: 3, output_tokens: 2 })
  return messageStream({
    id: step.kind === 'tool' ? (step.messageId ?? 'm') : (step.id ?? 'm'),
    usage,
    blocks: blocksFor(step, nth),
    stop: step.stop,
  })
}

function isSearch(body) {
  return Array.isArray(body?.tools) && body.tools.some(tool => tool?.type === 'web_search_20250305')
}

// rc.3 的搜索走 DeepSeek 的 Search API：dsh 往 {searchBaseURL}/search 发一个 POST，
// 回 {"results":[{url,title,snippet}]}。请求头是 Authorization: Bearer 钥匙。
function isSearchApi(url) {
  return String(url ?? '').split('?')[0].endsWith('/search')
}

const SEARCH_API_BODY = JSON.stringify({
  results: [{ url: 'https://example.com/a', title: '资料', snippet: '一段摘要' }],
})

const SEARCH_BODY = JSON.stringify({
  content: [{
    type: 'web_search_tool_result',
    content: [{ type: 'web_search_result', url: 'https://example.com/a', title: '资料' }],
  }],
})

// dsh 给会话起名字的那次额外调用：系统提示是它自己的那几句英文
function isTitle(body) {
  return JSON.stringify(body?.system ?? '').includes('concise title')
}

// title：起名字那次回什么（不算进 calls，剧本照旧只看干活的那几次请求）
export function startFake({ respond, expectKey, title = '测试任务名' } = {}) {
  const calls = []
  const titles = []
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
      const bearer = String(req.headers['authorization'] ?? '')
      const keyed = req.headers['x-api-key'] === expectKey || bearer === `Bearer ${expectKey}`
      if (expectKey !== undefined && !keyed) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"error":{"type":"authentication_error","message":"unauthorized"}}')
        return
      }
      // Search API 的请求不算干活那几次请求：不让它占掉剧本的步数。
      if (isSearchApi(req.url)) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(SEARCH_API_BODY)
        return
      }
      if (isSearch(body)) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(SEARCH_BODY)
        return
      }
      if (isTitle(body)) {
        titles.push(body)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.end(messageStream({ id: 'title', usage: { input_tokens: 1, output_tokens: 1 }, blocks: [{ type: 'text', text: title }] }))
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
      res.end(bodyFor(step, calls.length))
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
        titles,
        close() {
          for (const socket of sockets) socket.destroy()
          return new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}
