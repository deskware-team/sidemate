// 产出卡：模型交稿（present）的那几份写「文件生成」，没交稿但任务文件夹里有文件动了写「文件变动」。
// 产出卡上有「预览」「另存为」，右键菜单里有「在文件夹里显示」。没有「桌伴输出」那一层了。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { t } from '../../app/copy/copy.mjs'

const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

async function until(predicate) {
  for (let i = 0; i < 300 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

// 假壳：这一轮的事件由测试自己发
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-cards-'))
  roots.push(root)
  const ws = join(root, 'ws')
  mkdirSync(ws, { recursive: true })
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const seen = { runs: [], handles: [] }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    extensions: ['.docx', '.md', '.txt', '.pdf'],
    log: () => {},
    onPet: () => {},
    onRecent: () => {},
    history,
    prepareTask: async () => ({ kind: 'files', workspace: ws, copied: [], skipped: [], snapshot: [] }),
    copyMaterials: () => ({ copied: [], skipped: [] }),
    clearWorkspace: () => {},
    runTask: (options) => {
      seen.runs.push(options)
      let finish = null
      const handle = {
        sessionId: 's1',
        cancel() { this.cancelled = true },
        steer: () => Promise.resolve({ ok: true, mode: 'steer' }),
        done: new Promise((resolve) => { finish = resolve }),
        finish: (status = 'done') => finish({ type: 'end', taskId: options.taskId, at: 9, status }),
        // 测试自己发事件（present、artifact 那些）
        emit: (event) => options.onEvent(event),
      }
      seen.handles.push(handle)
      return handle
    },
  })
  return { runner, seen, root, ws }
}

// 交稿的那份文件：写在任务文件夹根目录里
function makeProduct(ws, name) {
  const path = join(ws, name)
  writeFileSync(path, '成品')
  return path
}

test('模型交稿了：卡上写「文件生成」，指的是交的那份', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写个周报' })
  await until(() => h.seen.runs.length === 1)
  const product = makeProduct(h.ws, '本周周报.docx')
  h.seen.handles[0].emit({ type: 'present', files: [{ path: product }] })
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  const card = h.runner.view().blocks.find((one) => one.kind === 'card').card
  assert.equal(card.kind, 'made')
  assert.equal(card.path, product)
  assert.equal(card.name, '本周周报.docx')
  assert.equal(card.label, t('output.made'))
  assert.equal(card.line, '本周周报.docx')
})

test('没交稿，但任务文件夹里有文件动了：卡上写「文件变动」', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写个周报' })
  await until(() => h.seen.runs.length === 1)
  const product = makeProduct(h.ws, '随手记.md')
  h.seen.handles[0].emit({ type: 'artifact', path: product, name: '随手记.md' })
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  const card = h.runner.view().blocks.find((one) => one.kind === 'card').card
  assert.equal(card.kind, 'changed')
  assert.equal(card.path, product)
  assert.equal(card.label, t('output.changed'))
})

test('子目录里的文件也算「文件变动」：成品不只在根目录', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写个周报' })
  await until(() => h.seen.runs.length === 1)
  const inside = join(h.ws, '子目录', '中间.txt')
  mkdirSync(join(h.ws, '子目录'), { recursive: true })
  writeFileSync(inside, '中间')
  h.seen.handles[0].emit({ type: 'artifact', path: inside, name: '中间.txt' })
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  const card = h.runner.view().blocks.find((one) => one.kind === 'card').card
  assert.equal(card.kind, 'changed')
  assert.equal(card.path, inside)
})

test('用户给的副本和过程目录里的文件不算「文件变动」', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写个周报' })
  await until(() => h.seen.runs.length === 1)
  const given = join(h.ws, 'received', '范本.docx')
  const process = join(h.ws, '.sidemate', '脚本.py')
  mkdirSync(join(h.ws, 'received'), { recursive: true })
  mkdirSync(join(h.ws, '.sidemate'), { recursive: true })
  writeFileSync(given, '范本')
  writeFileSync(process, '脚本')
  h.seen.handles[0].emit({ type: 'artifact', path: given, name: '范本.docx' })
  h.seen.handles[0].emit({ type: 'artifact', path: process, name: '脚本.py' })
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  assert.equal(h.runner.view().blocks.some((one) => one.kind === 'card'), false)
})

test('交稿的那份不再另出一张「文件变动」卡', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '写个周报' })
  await until(() => h.seen.runs.length === 1)
  const product = makeProduct(h.ws, '本周周报.docx')
  h.seen.handles[0].emit({ type: 'present', files: [{ path: product }] })
  h.seen.handles[0].emit({ type: 'artifact', path: product, name: '本周周报.docx' })
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  const cards = h.runner.view().blocks.filter((one) => one.kind === 'card')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].card.kind, 'made')
})

test('这一轮什么都没动：不出卡', async () => {
  const h = harness()
  h.runner.act({ type: 'send', text: '聊两句' })
  await until(() => h.seen.runs.length === 1)
  h.seen.handles[0].finish()
  await until(() => h.runner.view().phase === 'done')
  assert.equal(h.runner.view().blocks.some((one) => one.kind === 'card'), false)
})

test('产出卡上有「预览」和「另存为」，右键菜单里有「在文件夹里显示」', () => {
  assert.equal(t('output.saveAs'), '另存为')
  assert.equal(t('output.preview'), '预览')
  assert.equal(t('output.reveal'), '在文件夹里显示')
  assert.equal(t('output.open'), '打开')
  assert.equal(t('output.saveAsMenu'), '另存为…')
})

test('整个 app 里不再有「桌伴输出」这一层', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const seen = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name)
      if (name.isDirectory()) walk(path)
      else if (/\.(mjs|js|cjs|yml)$/.test(name.name)) seen.push(path)
    }
  }
  walk(new URL('../../app', import.meta.url).pathname.replace(/^\//, ''))
  for (const path of seen) {
    assert.equal(readFileSync(path, 'utf8').includes('桌伴输出'), false, path)
  }
})
