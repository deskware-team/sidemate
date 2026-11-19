// 看不了图的模型：带着图片 / 扫描件就发不出去（St601，后面的按钮是「去配」或「去选」），去掉或换模型才能发。
// Word / PPT / 有字的 PDF 里夹着图：照常发，只读文字，对话流里出一行 St407。

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createRunner } from '../../app/task/run.mjs'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { unseenPending } from '../../app/task/pending.mjs'
import { t as copy } from '../../app/copy/copy.mjs'
import { zipOf } from '../helpers/office.mjs'

const dir = mkdtempSync(join(tmpdir(), 'sidemate-imggate-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

// 一份真的 png（内容不用真图，认的是后缀）
function png(name) {
  const path = join(dir, name)
  writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex'))
  return path
}

// 一份 docx：正文有字，还夹着一张图（zip 里的 media 目录）
function docxWithImage(name) {
  const path = join(dir, name)
  writeFileSync(path, zipOf({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>',
    'word/media/image1.png': '89504e470d0a1a0a',
  }))
  return path
}

// 一份扫描件 PDF：整份只有一张压缩的图，没有文字层
function scannedPdf(name) {
  const parts = [Buffer.from('%PDF-1.5\n', 'latin1')]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    { dict: '/Type /XObject /Subtype /Image /Width 2 /Height 2 /Filter /FlateDecode', data: deflateSync(Buffer.from('BT /F1 12 Tf fake')) },
    { dict: '/Filter /FlateDecode', data: deflateSync(Buffer.from('q 100 0 0 100 0 0 cm /Im1 Do Q')) },
  ]
  objects.forEach((one, i) => {
    if (typeof one === 'string') parts.push(Buffer.from(`${i + 1} 0 obj ${one} endobj\n`, 'latin1'))
    else parts.push(Buffer.from(`${i + 1} 0 obj << ${one.dict} /Length ${one.data.length} >>\nstream\n`, 'latin1'), one.data, Buffer.from('\nendstream\nendobj\n', 'latin1'))
  })
  parts.push(Buffer.from('trailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'))
  const path = join(dir, name)
  writeFileSync(path, Buffer.concat(parts))
  return path
}

// 假的主进程：模型、拷贝、切块、跑一轮都用假的，只看「发不发得出去」
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-imggate-run-'))
  const ws = join(root, 'ws')
  const seen = { log: [], views: [], run: [], steer: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'x', effort: null }, vendor: '测试通道', free: false }),
    // 现在选的模型看不看得懂图
    visionOf: over.visionOf || (() => false),
    // 配没配能看图的模型
    hasVisionModel: over.hasVisionModel || (() => false),
    extensions: ['.docx', '.pdf', '.png', '.jpg'],
    log: (event, data) => seen.log.push([event, data]),
    onView: (view) => seen.views.push(view),
    prepareTask: (input) => {
      mkdirSync(ws, { recursive: true })
      return {
        kind: 'files', workspace: ws,
        copied: input.paths.map((from) => ({ from, to: join(ws, basename(from)) })),
        skipped: [], snapshot: [],
      }
    },
    copyMaterials: (input) => ({
      copied: input.paths.map((from) => ({ from, to: join(ws, basename(from)) })),
      skipped: [],
    }),
    runTask: (options) => {
      seen.run.push(options)
      return {
        sessionId: 's1',
        cancel() {},
        steer: (text) => { seen.steer.push(text); return { mode: 'steer' } },
        done: over.hang ? new Promise(() => {}) : new Promise((done) => setTimeout(() => done({ type: 'end', taskId: options.taskId, at: 1, status: 'done' }), 5)),
      }
    },
    finishTask: () => ({ snapshot: [], outputs: [] }),
    snapshotWorkspace: () => [],
  })
  return { runner, root, ws, seen }
}

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
// 等这一轮真起起来（机器忙的时候 30ms 不一定够）：最多等 2 秒
async function started(h) {
  for (let i = 0; i < 200 && h.seen.run.length === 0; i += 1) await delay(10)
}

test('1 看不了图的模型带着 png：输入框上方是 St601，发送钮灰着', () => {
  const s = reduceTask(createTask(), { type: 'drop', files: ['C:/材料/发票.png'] }).state
  const v = toTaskView(s, { unseen: (files) => files.map((one) => one.name), hasVision: () => false })
  assert.equal(v.remind.text, copy('St601'))
  assert.equal(v.remind.block, true)
  assert.equal(v.input.canSend, false)
  // 配了能看图的模型、只是没选它：还是 St601 这一句，按钮换成「去选」
  const pick = toTaskView(s, { unseen: (files) => files.map((one) => one.name), hasVision: () => true })
  assert.equal(pick.remind.text, copy('St601'))
  assert.equal(pick.remind.action, 'models')
  assert.equal(pick.input.canSend, false)
  // 这几份不在了：能发
  const none = toTaskView(s, { unseen: () => [] })
  assert.equal(none.remind, null)
  assert.equal(none.input.canSend, true)
})

test('2 带着 png 发不出去：去掉图就能发', async () => {
  const h = harness()
  const pic = png('发票.png')
  h.runner.drop([pic])
  let v = h.runner.view()
  assert.equal(v.phase, 'ready')
  assert.equal(v.remind.text, copy('St601'))
  assert.equal(v.input.canSend, false)
  h.runner.act({ type: 'send', text: '把这张发票录进去' })
  assert.equal(h.runner.view().phase, 'ready') // 没发出去
  assert.equal(h.seen.run.length, 0)
  // 去掉那一张图：能发了
  h.runner.act({ type: 'remove', path: pic })
  v = h.runner.view()
  assert.equal(v.remind, null)
  assert.equal(v.input.canSend, true)
  h.runner.act({ type: 'send', text: '把这张发票录进去' })
  assert.equal(h.runner.view().phase, 'working')
  await started(h)
  assert.equal(h.seen.run.length, 1)
})

test('3 换成能看图的模型（deepseek-flash 那样）：带着 png 也能发', async () => {
  const h = harness({ visionOf: () => true })
  h.runner.drop([png('照片.png')])
  const v = h.runner.view()
  assert.equal(v.remind, null)
  assert.equal(v.input.canSend, true)
  h.runner.act({ type: 'send', text: '看看这张' })
  assert.equal(h.runner.view().phase, 'working')
  await started(h)
  assert.equal(h.seen.run.length, 1)
})

test('4 扫描件 PDF 一样发不出去', () => {
  const h = harness()
  h.runner.drop([scannedPdf('扫描件.pdf')])
  const v = h.runner.view()
  assert.equal(v.remind.text, copy('St601'))
  assert.equal(v.input.canSend, false)
  h.runner.act({ type: 'send', text: '读一下' })
  assert.equal(h.runner.view().phase, 'ready')
  assert.equal(h.seen.run.length, 0)
})

test('5 有字的 docx 里夹着图：照常发，只读文字，出一行 St407', async () => {
  const h = harness()
  h.runner.drop([docxWithImage('周报.docx')])
  const v = h.runner.view()
  assert.equal(v.remind, null)
  assert.equal(v.input.canSend, true)
  h.runner.act({ type: 'send', text: '把周报理一理' })
  assert.equal(h.runner.view().phase, 'working')
  await started(h)
  const notes = h.runner.view().flow.filter((one) => one.kind === 'note').map((one) => one.text)
  assert.ok(notes.includes(copy('St407')), `对话流里没有 St407：${JSON.stringify(notes)}`)
})

test('6 干活中插话带图：一样拦', async () => {
  // 干活中贴进来的图：挂在输入框上还没发出去，随下一句或插的那句一起发
  const working = reduceTask(createTask(), { type: 'send', text: '先干着', runId: 'r1' }).state
  const withPic = reduceTask(working, { type: 'paste', files: [{ path: 'C:/材料/插进来的.png', name: '插进来的.png', kind: 'image' }] }).state
  assert.equal(withPic.phase, 'working')
  // 现在的模型看不了图：这几份带着就发不出去
  assert.deepEqual(unseenPending(withPic, { sees: () => false }).map((one) => one.name), ['插进来的.png'])
  const v = toTaskView(withPic, { unseen: (files) => files.map((one) => one.name), hasVision: () => false })
  assert.equal(v.remind.text, copy('St601'))
  assert.equal(v.input.canSend, false) // 回车也发不出去
  // 能看图的模型：这几份不算拦
  assert.deepEqual(unseenPending(withPic, { sees: () => true }), [])
})
