// 用户给的文件是当资源链接发给 dsh 的（不是把名字拼进话里）；
// 模型交稿（present）的那几份，桌伴照工具参数收下，成品卡写「文件生成」。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const KEY = 'sidemate-present-key'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 模型那边看到的话（ACP 把资源链接投成这一段字）
function userText(body) {
  const parts = []
  for (const message of body?.messages || []) {
    if (message?.role !== 'user') continue
    const content = message?.content
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const block of content) if (typeof block?.text === 'string') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

test('用户给的文件当资源链接发给模型：话里只有链接，不再拼文件名', { timeout: 120_000 }, async () => {
  const workspace = scratch('sidemate-present-ws-')
  const lowRoot = scratch('sidemate-present-low-')
  const given = join(workspace, 'received', '范本.md')
  mkdirSync(join(workspace, 'received'), { recursive: true })
  writeFileSync(given, '# 范本\n', 'utf8')
  let seen = ''
  const fake = await startFake({
    expectKey: KEY,
    respond: (body) => {
      seen = userText(body)
      return { kind: 'text', text: '好的' }
    },
  })
  const events = []
  try {
    const end = await runTask({
      taskId: 'present-files',
      apiKey: KEY,
      prompt: '照着范本写一份',
      workspace,
      lowRoot,
      baseUrl: fake.url,
      files: [{ path: given }],
      onEvent: (event) => events.push(event),
    }).done
    assert.equal(end.status, 'done', JSON.stringify(events))
    // 模型那边看到的是资源链接：名字是任务文件夹里的相对路径，uri 是本机文件的地址
    assert.ok(seen.includes('resource_link'), seen.slice(0, 800))
    assert.ok(seen.includes('received/范本.md'), seen.slice(0, 800))
    assert.ok(seen.includes('file:///'), seen.slice(0, 800))
  } finally {
    await fake.close()
  }
})

test('模型没交稿但写了文件：桌伴收到这一轮动过的文件（出「文件变动」卡）', { timeout: 120_000 }, async () => {
  const workspace = scratch('sidemate-present3-ws-')
  const lowRoot = scratch('sidemate-present3-low-')
  let step = 0
  const fake = await startFake({
    expectKey: KEY,
    respond: () => {
      step += 1
      if (step === 1) {
        return { kind: 'tool', name: 'write', input: { file_path: join(workspace, '随手记.md'), content: '随手写的' } }
      }
      return { kind: 'text', text: '写好了' }
    },
  })
  const events = []
  try {
    const end = await runTask({
      taskId: 'present-changed',
      apiKey: KEY,
      prompt: '随手记一下',
      workspace,
      lowRoot,
      baseUrl: fake.url,
      onEvent: (event) => events.push(event),
    }).done
    assert.equal(end.status, 'done', JSON.stringify(events))
    // 没交稿：没有 present 事件
    assert.equal(events.some((one) => one.type === 'present'), false, JSON.stringify(events.map((one) => one.type)))
    // 写了文件：收场时报出这一轮动过的文件
    const artifacts = events.filter((one) => one.type === 'artifact')
    assert.equal(artifacts.length, 1, JSON.stringify(events.map((one) => one.type)))
    assert.equal(artifacts[0].path, join(workspace, '随手记.md'))
  } finally {
    await fake.close()
  }
})

test('什么都没写：没有交稿也没有动过的文件（不出卡）', { timeout: 120_000 }, async () => {
  const workspace = scratch('sidemate-present4-ws-')
  const lowRoot = scratch('sidemate-present4-low-')
  const fake = await startFake({
    expectKey: KEY,
    respond: () => ({ kind: 'text', text: '聊两句' }),
  })
  const events = []
  try {
    const end = await runTask({
      taskId: 'present-none',
      apiKey: KEY,
      prompt: '聊聊',
      workspace,
      lowRoot,
      baseUrl: fake.url,
      onEvent: (event) => events.push(event),
    }).done
    assert.equal(end.status, 'done', JSON.stringify(events))
    assert.equal(events.some((one) => one.type === 'present'), false)
    assert.equal(events.some((one) => one.type === 'artifact'), false, JSON.stringify(events.map((one) => one.type)))
  } finally {
    await fake.close()
  }
})

test('模型调用 present 交稿：桌伴收到那几份成品', { timeout: 120_000 }, async () => {
  const workspace = scratch('sidemate-present2-ws-')
  const lowRoot = scratch('sidemate-present2-low-')
  const product = join(workspace, '本周周报.docx')
  writeFileSync(product, '成品', 'utf8')
  let step = 0
  const fake = await startFake({
    expectKey: KEY,
    respond: () => {
      step += 1
      if (step === 1) return { kind: 'tool', name: 'present', input: { files: [{ path: '本周周报.docx', description: '给用户看的' }] } }
      return { kind: 'text', text: '交完了' }
    },
  })
  const events = []
  try {
    const end = await runTask({
      taskId: 'present-tool',
      apiKey: KEY,
      prompt: '写一份周报',
      workspace,
      lowRoot,
      baseUrl: fake.url,
      onEvent: (event) => events.push(event),
    }).done
    assert.equal(end.status, 'done', JSON.stringify(events))
    const presented = events.filter((one) => one.type === 'present')
    assert.equal(presented.length, 1, JSON.stringify(events.map((one) => one.type)))
    assert.equal(presented[0].files[0].path, '本周周报.docx')
    assert.equal(presented[0].files[0].description, '给用户看的')
  } finally {
    await fake.close()
  }
})
