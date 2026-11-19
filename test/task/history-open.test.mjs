// 历史接线的纯函数：记录 → run.mjs 那个 task、记录 → 任务窗要显示的状态。
// 只测拼形状：工作区在不在由 run.mjs 查，这里不碰文件。

import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { restoreState, restoreTask } from '../../app/task/history-open.mjs'
import { reduceTask, toTaskView } from '../../app/task/state.mjs'

const WS = 'C:/桌伴/任务/2026-11-11-写周报'
const OUT = WS

// 一条干完的对话记录：两轮、一份产出、带着接着聊要用的 resume
function record(over = {}) {
  return {
    version: 1,
    id: '20261111-231500-123',
    title: '写周报',
    folder: WS,
    folderName: '2026-11-11-写周报',
    kind: 'task',
    startedAt: 100,
    updatedAt: 400,
    sessionId: 'sess-9',
    model: { entry: '快', model: 'deepseek/chat', effort: 'low' },
    messages: [
      { role: 'me', text: '写一份周报', at: 100 },
      { role: 'it', text: '做好了', at: 200 },
      { role: 'me', text: '再补一段', at: 300 },
      { role: 'it', text: '补好了', at: 400 },
    ],
    files: [{ name: '周报.docx', path: `${OUT}/周报.docx` }],
    resume: {
      place: { kind: 'files', dir: WS },
      files: ['C:/材料/甲.docx'],
      workspace: WS,
      outputDir: OUT,
      copied: [{ from: 'C:/材料/甲.docx', to: `${WS}/甲.docx` }],
      chunks: [{ index: 1, marker: 'S01', text: '华东仓铅笔缺货' }],
    },    ...over,
  }
}

test('restoreTask：工作区、材料副本和会话都拼回来', () => {
  const task = restoreTask(record())
  assert.equal(task.workspace, WS)
  assert.equal(task.sessionId, 'sess-9')
  assert.equal(task.prepared.kind, 'files')
  assert.equal(task.prepared.workspace, WS)
  assert.deepEqual(task.prepared.copied, [{ from: 'C:/材料/甲.docx', to: `${WS}/甲.docx` }])
  // 老记录里还留着的切块字段照旧忽略，不报错
  assert.equal(task.chunks, undefined)
  // 原件的指纹没记：重开后的几轮不核「原件被动过」
  assert.deepEqual(task.prepared.skipped, [])
})

test('restoreTask：新闻的记录标上 news（不是临时工作区），普通任务不标', () => {
  assert.equal(restoreTask(record()).news, false)
  assert.equal(restoreTask(record({ kind: 'news' })).news, true)
})

test('restoreTask：没有 resume、没有工作区都拼不出；缺的东西往保守里拼', () => {
  assert.equal(restoreTask(null), null)
  assert.equal(restoreTask({}), null)
  assert.equal(restoreTask(record({ resume: null })), null)
  assert.equal(restoreTask(record({ resume: {} })), null, 'resume 里没写工作区')

  // 没记会话：当没有，续接时另开一个
  const bare = restoreTask(record({ resume: { ...record().resume, outputDir: '' }, sessionId: null }))
  assert.equal(bare.prepared.outputDir, undefined, '没有产出目录那一层了：成品就留在任务文件夹根目录')
  assert.equal(bare.sessionId, undefined)

  // 老记录里留着切块字段也不报错：那个字段已经没人用了
  assert.equal(restoreTask(record({ resume: { ...record().resume, chunks: [] } })).chunks, undefined)
  assert.equal(restoreTask(record({ resume: { ...record().resume, chunks: null } })).chunks, undefined)

  // 材料副本里坏掉的条目滤掉，不炸
  const copied = restoreTask(record({ resume: { ...record().resume, copied: [{ from: 'C:/材料/甲.docx' }, null, '坏的', { from: 'C:/乙.md', to: `${WS}/乙.md` }] } }))
  assert.deepEqual(copied.prepared.copied, [{ from: 'C:/乙.md', to: `${WS}/乙.md` }])
})

test('restoreState：一来一回重画，产出卡跟在最后那轮后面，phase 是 done', () => {
  const state = restoreState(record())
  assert.equal(state.phase, 'done')
  assert.equal(state.runId, null)
  assert.deepEqual(state.flow.map((one) => [one.kind, one.round]), [
    ['user', 1], ['reply', 1], ['user', 2], ['reply', 2],
  ])
  assert.deepEqual(state.flow.map((one) => one.text), ['写一份周报', '做好了', '再补一段', '补好了'])
  assert.equal(state.cards.length, 1)
  assert.equal(state.cards[0].name, '周报.docx')
  assert.equal(state.cards[0].to, `${OUT}/周报.docx`)
  assert.equal(state.cards[0].round, 2, '产出卡跟在最后一轮后面')
  assert.equal(state.cards[0].old, true)
  assert.equal(state.round, 2)
  assert.equal(state.seq, 1)
  assert.deepEqual(state.place, { kind: 'files', dir: WS })
  assert.deepEqual(state.files, [{ path: 'C:/材料/甲.docx', name: '甲.docx' }])
  assert.deepEqual(state.model, { entry: '快', model: 'deepseek/chat', effort: 'low' })
  assert.equal(state.startedAt, 100)
  assert.equal(state.foreground, false)
  assert.equal(restoreState(record(), { foreground: true }).foreground, true)
})

test('restoreState：拼出来的状态直接能画：顶栏是那个文件夹，卡在最下面', () => {
  const view = toTaskView(restoreState(record()), { root: 'C:/桌伴' })
  assert.equal(view.phase, 'done')
  assert.equal(view.top.path.title, WS)
  assert.equal(view.top.path.open, WS)
  assert.equal(view.input.mode, 'continue', '能接着说')
  const last = view.blocks[view.blocks.length - 1]
  assert.equal(last.kind, 'card')
  assert.equal(last.card.name, '周报.docx')
})

test('restoreState：老记录分开记的范本和材料还能打开：拼成一列文件，范本排在前面，同一份只留一个', () => {
  const state = restoreState(record({
    resume: {
      place: { kind: 'folder', dir: 'C:/材料夹' },
      template: 'C:/材料夹/范本.docx',
      materials: ['C:/材料夹/甲.md', 'C:/材料夹/乙.md'],
      workspace: WS,
      outputDir: '',
      copied: [],
      chunks: null,
    },
  }))
  assert.deepEqual(state.place, { kind: 'folder', dir: 'C:/材料夹' })
  assert.deepEqual(state.files, [
    { path: 'C:/材料夹/范本.docx', name: '范本.docx' },
    { path: 'C:/材料夹/甲.md', name: '甲.md' },
    { path: 'C:/材料夹/乙.md', name: '乙.md' },
  ])
  assert.equal('template' in state, false)
  assert.equal('materials' in state, false)
  // 画出来就是三个小签，没有范本的记号
  assert.deepEqual(toTaskView(state).tags.map((one) => one.name), ['范本.docx', '甲.md', '乙.md'])
  // 老记录里范本也在材料里（或者重复）：只留一个；坏的条目滤掉
  const { files: _files, ...oldResume } = record().resume
  const twice = restoreState(record({ resume: { ...oldResume, template: 'C:/材料/甲.docx', materials: ['C:/材料/甲.docx', null, 3, 'C:/材料/乙.md'] } }))
  assert.deepEqual(twice.files.map((one) => one.name), ['甲.docx', '乙.md'])
  // 老记录只有范本、没有材料
  const onlyTpl = restoreState(record({ resume: { ...oldResume, template: 'C:/材料/范本.docx', materials: undefined } }))
  assert.deepEqual(onlyTpl.files.map((one) => one.name), ['范本.docx'])
  // 新记录记的 files 优先
  const both = restoreState(record({ resume: { ...record().resume, files: ['C:/新/甲.md'], template: 'C:/旧/范本.docx', materials: ['C:/旧/乙.md'] } }))
  assert.deepEqual(both.files.map((one) => one.path), ['C:/新/甲.md'])
  // 老记录打开后接着说：一列文件照常带上
  const next = reduceTask(state, { type: 'send', text: '再补一段', runId: 'h1' })
  assert.deepEqual(next.start.files, ['C:/材料夹/范本.docx', 'C:/材料夹/甲.md', 'C:/材料夹/乙.md'])
})

test('restoreState：老记录和坏记录也不炸', () => {
  const none = restoreState(null)
  assert.equal(none.phase, 'done')
  assert.deepEqual(none.flow, [])
  assert.deepEqual(none.cards, [])
  assert.deepEqual(none.place, { kind: 'files', dir: '' })
  assert.equal(none.model, null)

  // 空消息跳过；开头就是它说的也归到第一轮；没路径的产出不出卡
  const odd = restoreState({
    messages: [{ role: 'it', text: '先说了一句' }, { role: 'me', text: '   ' }, { role: 'me', text: '干活' }],
    files: [{ name: '没路径' }, { path: `${OUT}/二稿.docx` }],
  })
  assert.deepEqual(odd.flow.map((one) => [one.kind, one.round]), [['reply', 1], ['user', 1]])
  assert.deepEqual(odd.cards.map((one) => one.name), ['二稿.docx'])

  // 模型形状不对就当没选；地点不认的当随手
  const bad = restoreState({ model: { entry: '快' }, resume: { place: { kind: '别的', dir: 5 }, workspace: WS } })
  assert.equal(bad.model, null)
  assert.deepEqual(bad.place, { kind: 'files', dir: '' })
})
