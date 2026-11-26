// previewFile（给主进程用的那个）：拿常驻 dsh 发 _sidemate/preview，回包并成对外的形状，
// 错误并成四个码（unavailable / unsupported / unreadable / failed）。
// 这里的 dsh 是假的：一个说 ACP 协议的小程序，按 peer.json 回固定的包或固定的错。

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { previewFile } from '../../app/dsh/index.mjs'

const roots = []
const scratch = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `sidemate-preview-file-${name}-`))
  roots.push(dir)
  return dir
}

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 假的 dsh：initialize 回话；_sidemate/preview 按配置回固定的包（或固定的错），参数记进 preview.jsonl
const PEER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const root = join(__dirname, '..', '..', '..', '..', '..')
const cfg = JSON.parse(readFileSync(join(root, 'peer.json'), 'utf8'))
if (cfg.die) process.exit(1)
let buf = ''
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })
    } else if (msg.method === '_sidemate/preview') {
      appendFileSync(join(root, 'preview.jsonl'), JSON.stringify(msg.params) + '\\n')
      if (cfg.error) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: cfg.error } })
      else send({ jsonrpc: '2.0', id: msg.id, result: cfg.reply })
    } else if (msg.id !== undefined) {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
  }
})
`

function fakePeer(cfg) {
  const root = scratch('peer-')
  mkdirSync(join(root, 'node'), { recursive: true })
  const node = join(root, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  copyFileSync(process.execPath, node)
  const lib = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(lib, 'bin.js'), PEER)
  writeFileSync(join(root, 'peer.json'), JSON.stringify(cfg))
  return root
}

// 起一个假 dsh 跑一条预览：payloadRoot 指到假的那个 dsh，lowRoot 是测试自己的 dsh 家
function preview(cfg, request) {
  return previewFile(request, { payloadRoot: fakePeer(cfg), lowRoot: scratch('low-') })
}

const paramsOf = (payloadRoot) =>
  readFileSync(join(payloadRoot, 'preview.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))

test('pdf：回包并成对外的形状（bytes 不往外承诺）', { timeout: 60_000 }, async () => {
  const root = fakePeer({
    reply: { kind: 'pdf', path: 'C:/tmp/out/通知.pdf', pages: 2, bytes: 66384, missingFonts: ['Courier'] },
  })
  const result = await previewFile({ path: 'C:/docs/通知.docx', kind: 'pdf' }, { payloadRoot: root, lowRoot: scratch('low-') })
  assert.deepEqual(result, { ok: true, kind: 'pdf', path: 'C:/tmp/out/通知.pdf', pages: 2, missingFonts: ['Courier'] })
  // 参数原样发过去
  assert.deepEqual(paramsOf(root), [{ path: 'C:/docs/通知.docx', kind: 'pdf' }])
})

test('images：图片列表带出去，sheet / range / pages / dpi 原样发过去', { timeout: 60_000 }, async () => {
  const root = fakePeer({
    reply: {
      kind: 'images', dir: 'C:/tmp/img', pages: 1, dpi: 144,
      images: [{ file: 'C:/tmp/img/image-0001.png', bytes: 1234, width: 1709, height: 670, page: 1, sheet: '门店客流', range: 'A1:Q20' }],
      missingFonts: [],
    },
  })
  const request = { path: 'C:/docs/门店客流柱状图.xlsx', kind: 'images', sheet: '门店客流', range: 'A1:Q20', pages: [1], dpi: 144 }
  const result = await previewFile(request, { payloadRoot: root, lowRoot: scratch('low-') })
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'images')
  assert.equal(result.missingFonts.length, 0)
  // 文档的总页数带出去（分页文档一页一张图时要靠它算有几页）
  assert.equal(result.pages, 1)
  // dpi 也带出去（100% = 真实大小，CSS 像素 = 图像素 × 96 / dpi）
  assert.equal(result.dpi, 144)
  assert.deepEqual(paramsOf(root), [request])
  const one = result.images[0]
  assert.equal(one.file, 'C:/tmp/img/image-0001.png')
  assert.equal(one.width, 1709)
  assert.equal(one.height, 670)
  assert.equal(one.page, 1)
  assert.equal(one.sheet, '门店客流')
})

test('四个错误码：服务不在 unavailable、不做 unsupported、读不了 unreadable、转换失败 failed', { timeout: 120_000 }, async () => {
  // 服务不在（这个 dsh 没挂 office-kit）
  const unavailable = await preview({ error: 'office kit is not available in this dsh process (mount @deepseek-ai/dsh-office-kit)' }, { path: 'C:/docs/a.docx', kind: 'pdf' })
  assert.deepEqual(unavailable, {
    ok: false,
    code: 'unavailable',
    detail: 'office kit is not available in this dsh process (mount @deepseek-ai/dsh-office-kit)',
  })
  // 不做：kind 不对
  const badKind = await preview({ error: "kind must be 'pdf' or 'images'" }, { path: 'C:/docs/a.docx', kind: 'sheet' })
  assert.equal(badKind.code, 'unsupported', JSON.stringify(badKind))
  assert.equal(badKind.ok, false)
  // 不做：套件说这个格式不支持
  const badFormat = await preview({ error: 'preview failed: unsupported-format: The path must end in doc, docx, xls, xlsx, ppt, or pptx.' }, { path: 'C:/docs/a.txt', kind: 'pdf' })
  assert.equal(badFormat.code, 'unsupported', JSON.stringify(badFormat))
  // 读不了：文件不在
  const unreadable = await preview({ error: 'cannot read the file: C:/docs/没有这份文件.docx' }, { path: 'C:/docs/没有这份文件.docx', kind: 'pdf' })
  assert.equal(unreadable.code, 'unreadable', JSON.stringify(unreadable))
  assert.equal(unreadable.ok, false)
  // 转换失败
  const failed = await preview({ error: 'preview failed: failed: LibreOffice conversion failed.' }, { path: 'C:/docs/a.docx', kind: 'pdf' })
  assert.equal(failed.code, 'failed', JSON.stringify(failed))
  assert.equal(failed.ok, false)
})

test('dsh 起不来：unavailable（不是含糊的崩）', { timeout: 60_000 }, async () => {
  const result = await preview({ die: true }, { path: 'C:/docs/a.docx', kind: 'pdf' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unavailable', JSON.stringify(result))
})
