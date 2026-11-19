// 干活中拖进来、贴进来的文件：不再悄悄扔掉，挂在输入框上当待发的，
// 跟下一句（或者插进去的那句）一起发出去——跟开工前拖进来一样。界面上不另说一句。

import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'
import { createRunner } from '../../app/task/run.mjs'
import { createHistory } from '../../app/task/history.mjs'
import { t } from '../../app/copy/copy.mjs'

const roots = []
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

test.after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

async function until(predicate) {
  for (let i = 0; i < 300 && !predicate(); i += 1) await delay(5)
  assert.ok(predicate(), 'condition not reached')
}

// 假壳：一轮由测试自己收尾；拷文件真拷进工作区，切块只记一笔
function harness(over = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-attach-'))
  roots.push(root)
  const ws = join(root, 'ws')
  const history = createHistory({ tasksDir: root, newsDir: join(root, 'news') })
  const seen = { runs: [], feed: [], copyMore: [], steer: [], handles: [] }
  const copy = (from) => {
    mkdirSync(ws, { recursive: true })
    const to = join(ws, basename(from))
    copyFileSync(from, to)
    return { from, to }
  }
  const runner = createRunner({
    root: () => join(root, '桌伴'),
    model: () => ({ ok: true, apiKey: 'k', env: {}, patchTexts: [], model: { value: 'm', effort: null }, vendor: 'v', free: false }),
    extensions: ['.docx', '.md', '.txt', '.pdf'],
    log: () => {},
    onPet: () => {},
    onRecent: () => {},
    history,
    // over.gate：建任务文件夹那一步先卡住（还在「准备文件中」，dsh 还没起来）
    prepareTask: async (input) => {
      if (over.gate) await over.gate
      return {
        kind: 'files', workspace: ws,
        copied: input.paths.map(copy), skipped: [], snapshot: [],
      }
    },
    copyMaterials: (input) => {
      seen.copyMore.push(input.paths.slice())
      const copied = input.paths.map(copy)
      return { copied, skipped: [] }
    },
    snapshotWorkspace: () => [],
    finishTask: () => ({ snapshot: [], outputs: [] }),
    deliverOutput: (input) => ({ to: input.name, name: input.name, locked: false }),
    clearWorkspace: () => {},
    runTask: (options) => {
      seen.runs.push(options)
      let finish = null
      const handle = {
        sessionId: 's1',
        cancel() { this.cancelled = true },
        steer: (text, files) => { seen.steer.push({ text, files: files || [] }); return Promise.resolve({ ok: true, mode: over.mode || 'steer' }) },
        done: new Promise((resolve) => { finish = resolve }),
        finish: (status = 'done') => finish({ type: 'end', taskId: options.taskId, at: 9, status }),
      }
      seen.handles.push(handle)
      return handle
    },
  })
  const write = (name, text = 'x') => {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
    return file
  }
  // 这一轮收尾，等它真做完
  const finish = async () => {
    const before = seen.runs.length
    seen.handles[before - 1].finish()
    await until(() => runner.view().phase === 'done')
  }
  return { runner, seen, history, root, ws, write, finish }
}

// 这一轮交给模型的文件（资源链接）：名字
const sentNames = (run) => (run.files || []).map((one) => one.name)

test('干活中拖进来：挂成小签，这一轮照常跑；发下一句时拷进工作区，只把新的这份跟这句一起发', async () => {
  const h = harness()
  const first = h.write('甲.md')
  const second = h.write('乙.md')
  h.runner.drop([first, second])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  const late = h.write('丙.md')
  h.runner.drop([late])
  let view = h.runner.view()
  assert.equal(view.phase, 'working', '这一轮照常跑')
  assert.equal(h.seen.runs.length, 1, '不另起一轮')
  // 挂上了：新的那个没锁（还能去掉），这一轮带着的锁着
  assert.deepEqual(view.tags.map((one) => [one.name, one.lock]), [['甲.md', true], ['乙.md', true], ['丙.md', false]])
  // 不另说一句：对话流里没多一行
  assert.equal(view.flow.some((one) => one.kind === 'note'), false)
  await h.finish()
  h.runner.act({ type: 'send', text: '把丙也加进去' })
  await until(() => h.seen.runs.length === 2)
  // 拷进同一个工作区；同一个会话里模型早看过甲和乙，只告诉它新加的丙，旧文件不再切块重发
  assert.deepEqual(h.seen.copyMore, [[late]])
  assert.equal(h.seen.runs[1].prompt, '把丙也加进去')
  assert.deepEqual(sentNames(h.seen.runs[1]), ['丙.md'], '新加的那份当资源链接给模型')
  assert.equal(h.seen.runs[1].sessionId, 's1', '接着同一个会话')
  // 这一句的气泡里带着这几份
  const mine = h.runner.view().blocks.filter((one) => one.kind === 'user').at(-1)
  assert.deepEqual(mine.files.map((one) => one.name), ['甲.md', '乙.md', '丙.md'])
  await h.finish()
})

test('干活中贴进来的长文字、图：一样挂上，跟下一句一起发', async () => {
  const h = harness()
  h.runner.drop([h.write('甲.md'), h.write('乙.md')])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  h.runner.pasteText('字'.repeat(3000))
  const view = h.runner.view()
  assert.equal(view.phase, 'working')
  assert.deepEqual(view.tags.at(-1).name, '贴的文字-1.md')
  assert.equal(view.tags.at(-1).lock, false)
  await h.finish()
  h.runner.act({ type: 'send', text: '再参考这段' })
  await until(() => h.seen.runs.length === 2)
  assert.deepEqual(h.seen.copyMore.map((list) => list.map((one) => basename(one))), [['贴的文字-1.md']])
  assert.equal(h.seen.runs[1].prompt, '再参考这段')
  assert.deepEqual(sentNames(h.seen.runs[1]), ['贴的文字-1.md'])
  await h.finish()
})

test('干活中挂上的又去掉：下一句不带它', async () => {
  const h = harness()
  h.runner.drop([h.write('甲.md'), h.write('乙.md')])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  const late = h.write('丙.md')
  h.runner.drop([late])
  // 这一轮带着的去不掉；挂上的能去
  h.runner.act({ type: 'remove', path: join(h.root, '甲.md') })
  assert.equal(h.runner.view().tags.length, 3)
  h.runner.act({ type: 'remove', path: late })
  assert.deepEqual(h.runner.view().tags.map((one) => one.name), ['甲.md', '乙.md'])
  await h.finish()
  h.runner.act({ type: 'send', text: '接着写' })
  await until(() => h.seen.runs.length === 2)
  assert.deepEqual(h.seen.copyMore, [], '没新文件要拷')
  await h.finish()
})

test('干活中插一句：挂上的文件跟这句一起发——拷进工作区、话里列出文件名、气泡里摆小块、记进历史', async () => {
  const h = harness()
  h.runner.drop([h.write('甲.md'), h.write('乙.md')])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  const late = h.write('丙.md')
  h.runner.drop([late])
  h.runner.act({ type: 'steer', text: '丙里有新数，用上' })
  await until(() => h.seen.steer.length === 1)
  // 先拷进工作区，模型照链接去找
  assert.deepEqual(h.seen.copyMore, [[late]])
  assert.equal(h.seen.steer[0].text, '丙里有新数，用上')
  assert.deepEqual(h.seen.steer[0].files.map((one) => one.name), ['丙.md'])
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'steer'))
  const view = h.runner.view()
  const bubble = view.blocks.find((one) => one.kind === 'steer')
  assert.deepEqual(bubble.files.map((one) => [one.name, one.path]), [['丙.md', join(h.ws, '丙.md')]])
  // 发出去了：小签锁住
  assert.deepEqual(view.tags.map((one) => [one.name, one.lock]), [['甲.md', true], ['乙.md', true], ['丙.md', true]])
  // 插的话连同文件进历史
  const record = h.history.get(h.history.list({})[0].id)
  const said = record.messages.filter((one) => one.role === 'me').at(-1)
  assert.equal(said.text, '丙里有新数，用上')
  assert.deepEqual(said.files.map((one) => one.name), ['丙.md'])
  await h.finish()
  // 下一句：丙插话时已经告诉过模型了，不再拷、不再列、不重新切块
  h.runner.act({ type: 'send', text: '再补一段' })
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.copyMore.length, 1, '同一份不再拷')
  assert.equal(h.seen.runs[1].prompt, '再补一段')
  await h.finish()
})

test('干活中没挂文件就插话：话原样发，不多一行', async () => {
  const h = harness()
  h.runner.drop([h.write('甲.md'), h.write('乙.md')])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  h.runner.act({ type: 'steer', text: '短一点' })
  await until(() => h.seen.steer.length === 1)
  assert.equal(h.seen.steer[0].text, '短一点')
  assert.deepEqual(h.seen.steer[0].files, [])
  assert.deepEqual(h.seen.copyMore, [])
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer'))
  assert.deepEqual(h.runner.view().blocks.find((one) => one.kind === 'steer').files, [])
  await h.finish()
})

test('干活中拖进文件再插一句，插话改成排队：这一轮做完发出去的那句后面带着文件那一行，气泡里不带', async () => {
  const h = harness({ mode: 'queue' })
  h.runner.drop([h.write('甲.md'), h.write('乙.md')])
  h.runner.act({ type: 'send', text: '汇成周报' })
  await until(() => h.seen.runs.length === 1)
  const late = h.write('补充数据.md')
  h.runner.drop([late])
  h.runner.act({ type: 'steer', text: '也参考这个表' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'queue'))
  // 文件已经拷进工作区了
  assert.deepEqual(h.seen.copyMore, [[late]])
  // 这一轮做完（排队的那句马上接着发，等不到「做完了」那一刻）
  h.seen.handles[0].finish()
  // 自动发出去的那句：文件跟着一起给模型（资源链接）
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].prompt, '也参考这个表')
  assert.deepEqual(sentNames(h.seen.runs[1]), ['补充数据.md'])
  assert.equal(h.seen.runs[1].sessionId, 's1')
  // 气泡上只有用户打的那句
  const mine = h.runner.view().blocks.filter((one) => one.kind === 'user').at(-1)
  assert.equal(mine.text, '也参考这个表')
  h.seen.handles[1].finish()
  await until(() => h.runner.view().phase === 'done')
})

test('还在准备文件（dsh 还没起来）时插一句：照样冒气泡、记成排队，这一轮做完自动发出去', async () => {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ gate })
  h.runner.drop([h.write('扫描件.pdf')])
  h.runner.act({ type: 'send', text: '把这份整理一下' })
  await until(() => h.runner.view().phase === 'working')
  h.runner.act({ type: 'steer', text: '只要表格那一页' })
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer'))
  const bubble = h.runner.view().blocks.find((one) => one.kind === 'steer')
  assert.equal(bubble.text, '只要表格那一页')
  await until(() => h.runner.view().blocks.some((one) => one.kind === 'steer' && one.status === 'queue'))
  assert.equal(h.seen.runs.length, 0, 'dsh 还没起来')
  release()
  await until(() => h.seen.runs.length === 1)
  h.seen.handles[0].finish()
  await until(() => h.seen.runs.length === 2)
  assert.equal(h.seen.runs[1].prompt, '只要表格那一页')
  assert.equal(h.seen.runs[1].sessionId, 's1')
  // 那时对话记录还没开：发出去的时候补记上，重新打开也看得到
  const record = h.history.get(h.history.list({})[0].id)
  assert.deepEqual(record.messages.filter((one) => one.role === 'me').map((one) => one.text), ['把这份整理一下', '只要表格那一页'])
  h.seen.handles[1].finish()
  await until(() => h.runner.view().phase === 'done')
})
