import assert from 'node:assert/strict'
import test from 'node:test'
import { groupRecords, isScratch, parseScores, revealMarkdown, reviewHtml, sheetText } from '../../../tools/office-ab/lib.mjs'
import { TASK_ORDER } from '../../../tools/office-ab/tasks.mjs'

const records = [
  { code: 'KS', arm: 'A', task: 'word', taskTitle: '会议通知', ms: 55024, tokens: { input: 7046, output: 4947, cacheRead: 86016 }, deliverables: ['通知.docx'], scratch: ['.sidemate/build.py'], previews: [{ file: '通知.docx-1.png', ok: true }] },
  { code: 'MK', arm: 'B', task: 'word', taskTitle: '会议通知', ms: 146799, tokens: { input: 23405, output: 15913, cacheRead: 644864 }, deliverables: ['通知.docx'], scratch: [], previews: [{ file: '通知.docx-1.png', ok: true }] },
  { code: 'BB', arm: 'A', task: 'word', taskTitle: '会议通知', ms: 38125, tokens: { input: 1000, output: 1000, cacheRead: 0 }, deliverables: ['通知.docx'], scratch: [], previews: [] },
  { code: 'NE', arm: 'B', task: 'ppt', taskTitle: '经营汇报 PPT', ms: 159924, tokens: { input: 2000, output: 2000, cacheRead: 0 }, deliverables: ['汇报.pptx'], scratch: [], previews: [{ file: '汇报.pptx-1.png', ok: true }] },
  { code: 'PY', arm: 'A', task: 'ppt', taskTitle: '经营汇报 PPT', ms: 228774, tokens: { input: 3000, output: 3000, cacheRead: 0 }, deliverables: ['汇报.pptx'], scratch: [], previews: [{ file: '汇报.pptx-1.png', ok: true }] },
  { code: 'GT', arm: 'B', task: 'excel', taskTitle: '门店对比表', ms: 237549, tokens: { input: 4000, output: 4000, cacheRead: 0 }, deliverables: ['对比.xlsx'], scratch: [], previews: [{ file: '对比.xlsx-1.png', ok: true }] },
  { code: 'JR', arm: 'A', task: 'excel', taskTitle: '门店对比表', ms: 104593, tokens: { input: 5000, output: 5000, cacheRead: 0 }, deliverables: ['对比.xlsx'], scratch: [], previews: [{ file: '对比.xlsx-1.png', ok: true }] },
]

test('打乱后同一任务的编号都在，顺序变了', () => {
  const groups = groupRecords(records, () => 0.5, TASK_ORDER)
  assert.deepEqual(groups.map((one) => one.task), ['word', 'ppt', 'excel'])
  for (const group of groups) {
    const codes = group.items.map((one) => one.code)
    assert.equal(codes.length, records.filter((one) => one.task === group.task).length)
    for (const one of records.filter((item) => item.task === group.task)) assert.ok(codes.includes(one.code))
  }
  // 组内打乱：至少有一组的顺序和原始记录不一样
  const changed = groups.some((group) => group.items.map((one) => one.code).join() !== records.filter((one) => one.task === group.task).map((one) => one.code).join())
  assert.ok(changed)
})

test('打分表只有编号和任务，不露组别', () => {
  const sheet = sheetText(records, () => 0.5, TASK_ORDER)
  assert.match(sheet, /\| 编号 \| 任务 \| 评分\(1-5\) \| 备注 \|/)
  for (const one of records) assert.ok(sheet.includes(`| ${one.code} |`))
  assert.ok(!/\bA\b|\bB\b/.test(sheet.split('\n').slice(2).join('\n')))
})

test('盲评页不含 . 开头的中间文件，也不露组别', () => {
  const html = reviewHtml(records, () => 0.5, TASK_ORDER, { word: '给了一份会议要点 txt' })
  assert.ok(!html.includes('.sidemate'))
  assert.ok(!html.includes('build.py'))
  for (const one of records) assert.ok(html.includes(`data-code="${one.code}"`))
  assert.ok(html.includes('会议要点 txt'))
  assert.ok(!/arm|组别/.test(html))
})

test('中间文件不进 review：预视图里 . 开头的 PNG 也不放', () => {
  const html = reviewHtml([{ ...records[0], previews: [{ file: '.sidemate_check_recalc.xlsx-1.png', ok: true }] }], () => 0.5, TASK_ORDER, {})
  assert.ok(!html.includes('.sidemate_check_recalc'))
})

test('isScratch 看路径里任何一段 . 开头', () => {
  assert.equal(isScratch('.sidemate/build.py'), true)
  assert.equal(isScratch('.sidemate_check_recalc.xlsx'), true)
  assert.equal(isScratch('通知.docx'), false)
  assert.equal(isScratch('子目录/通知.docx'), false)
})

test('评分文件按「编号 分数 备注」读', () => {
  const scores = parseScores('PL 4\nMK 5 很好\n\n坏行\n')
  assert.equal(scores.get('PL').score, 4)
  assert.equal(scores.get('MK').score, 5)
  assert.equal(scores.get('MK').note, '很好')
  assert.equal(scores.has('坏行'), false)
})

test('揭底表的平均分、用时、token 对', () => {
  const scores = new Map([
    ['KS', { score: 5 }], ['MK', { score: 5 }], ['BB', { score: 4 }],
    ['NE', { score: 3 }], ['PY', { score: 4 }],
    ['GT', { score: 2 }], ['JR', { score: 2 }],
  ])
  const md = revealMarkdown(records, scores, TASK_ORDER)
  // Word A 两条：平均分 (5 + 4) / 2 = 4.5，平均用时 (55024 + 38125) / 2 / 1000 ≈ 47 秒
  assert.match(md, /\| 会议通知 \| A \| 2 \| 4\.50 \| 47 \| 6997 \|/)
  assert.match(md, /\| 会议通知 \| B \| 1 \| 5\.00 \| 147 \|/)
  // Excel B 只有一条：237.5 秒 → 238
  assert.match(md, /\| 门店对比表 \| B \| 1 \| 2\.00 \| 238 \| 8000 \|/)
  // 合计：A 分 = (5 + 4 + 4 + 2) / 4 = 3.75，B 分 = (5 + 3 + 2) / 3 = 3.33
  assert.match(md, /\| 全部任务 \| A \| 4 \| 3\.75 \|/)
  assert.match(md, /\| 全部任务 \| B \| 3 \| 3\.33 \|/)
})
