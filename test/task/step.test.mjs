// 干活时那一句：翻成状态行上的「xxx中」、状态行的样子、换得太快不闪。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTask, materialName, reduceTask, stepLine, toTaskView } from '../../app/task/state.mjs'

// 状态行那一行：只说在干什么（text），不带计时
function workingRow(state) {
  const view = toTaskView(state)
  const row = view.blocks.find((one) => one.kind === 'working')
  return row || null
}

test('翻成「xxx中」：查资料、网页、准备写文件', () => {
  assert.equal(stepLine('search'), '搜索中')
  assert.equal(stepLine('web'), '浏览网页中')
  assert.equal(stepLine('prepare'), '准备写文件中')
  // 认不出在干什么：执行中
  assert.equal(stepLine('work'), '执行中')
})

test('读材料念文件名（读《…》中），写文件、处理都不念', () => {
  assert.equal(stepLine('read 市场.pdf'), '读《市场.pdf》中')
  assert.equal(stepLine('read 市场.pdf'), '读《市场.pdf》中')
  // 路径不留：只写文件名
  assert.equal(stepLine('read C:\\Users\\me\\市场.pdf'), '读《市场.pdf》中')
  assert.equal(stepLine('read /home/me/材料/报表.docx'), '读《报表.docx》中')
  // 写什么都是写文件中
  assert.equal(stepLine('write 周报.docx'), '写文件中')
  assert.equal(stepLine('write 表.xlsx'), '写文件中')
  assert.equal(stepLine('write 笔记.md'), '写文件中')
  // 用别的工具：处理中
  assert.equal(stepLine('tool 市场.pdf'), '处理中')
  // 看图：查看图片中
  assert.equal(stepLine('read 截图.png'), '查看图片中')
  assert.equal(stepLine('read 图.jpg'), '查看图片中')
})

test('读《文件名》中：名字太长中间用…，后缀留着', () => {
  const line = stepLine('read 二〇二六年第三季度华东区域各门店销售与库存明细汇总表.xlsx')
  assert.match(line, /^读《.+…+.+\.xlsx》中$/)
  assert.ok(line.length < '读《二〇二六年第三季度华东区域各门店销售与库存明细汇总表.xlsx》中'.length, line)
  assert.ok(line.startsWith('读《二〇二六'), line)
})

test('脚本、技能名不念', () => {
  assert.equal(stepLine('write check_docx.py'), '写文件中')
  assert.equal(stepLine('read compile_docx.py'), '读文件中')
  assert.equal(stepLine('write patch_font.js'), '写文件中')
  // 技能名、工具名（没有后缀的）：处理中
  assert.equal(stepLine('tool sidemate-writing'), '处理中')
})

test('工具名、命令不露出来；翻不出来就是空', () => {
  assert.equal(stepLine('tool python scripts/ocr.py'), '')
  assert.equal(stepLine('bash -c "npm run build"'), '')
  assert.equal(stepLine('powershell.exe -File C:\\x.ps1'), '')
  assert.equal(stepLine(''), '')
  assert.equal(stepLine(undefined), '')
  assert.equal(stepLine('准备好了'), '')
})

test('读文件念文件名，图片说查看图片，写文件不念名字', () => {
  assert.equal(stepLine('read received\\市场.md'), '读《市场.md》中')
  assert.equal(stepLine('read C:\\Users\\me\\任务\\received\\会议纪要.docx'), '读《会议纪要.docx》中')
  assert.equal(stepLine('read received/截图.png'), '查看图片中')
  assert.equal(stepLine('write 市场.md'), '写文件中')
})

test('念给用户的名字：去掉引号，只留文件名', () => {
  assert.equal(materialName('C:\\ws\\received\\市场.md'), '市场.md')
  assert.equal(materialName('「市场.pdf」'), '市场.pdf')
  assert.equal(materialName('市场.pdf'), '市场.pdf')
  assert.equal(materialName(''), '')
})

test('状态行：状态直接写在干什么，不带计时', () => {
  let s = reduceTask(createTask(), { type: 'send', text: '照材料写周报', runId: 'r1' }).state
  // 刚开跑：等待模型响应
  assert.equal(workingRow(s).text, '等待模型响应')
  assert.equal('since' in workingRow(s), false)
  // 壳那一步：拷文件
  s = reduceTask(s, { type: 'step', step: 'copy', taskId: 'r1', at: 1000 }).state
  assert.equal(workingRow(s).text, '准备文件中')
  // 模型调工具：直接写在干什么
  s = reduceTask(s, { type: 'progress', text: 'read 市场.pdf', taskId: 'r1', at: 6000 }).state
  assert.equal(workingRow(s).text, '读《市场.pdf》中')
})

test('状态行：翻不出来就照旧', () => {
  let s = reduceTask(createTask(), { type: 'send', text: '写周报', runId: 'r2' }).state
  s = reduceTask(s, { type: 'progress', text: 'bash -c npm run build', taskId: 'r2', at: 1000 }).state
  assert.equal(workingRow(s).text, '等待模型响应')
})

test('状态行：换得太快不闪（至少站 1.5 秒）', () => {
  let s = reduceTask(createTask(), { type: 'send', text: '写周报', runId: 'r3' }).state
  s = reduceTask(s, { type: 'progress', text: 'write 周报.docx', taskId: 'r3', at: 1000 }).state
  assert.equal(workingRow(s).text, '写文件中')
  // 一秒后就想换：先不换，还是原来那句
  s = reduceTask(s, { type: 'progress', text: 'read 市场.pdf', taskId: 'r3', at: 2000 }).state
  assert.equal(workingRow(s).text, '写文件中')
  // 站够 1.5 秒以后才换
  s = reduceTask(s, { type: 'progress', text: 'read 市场.pdf', taskId: 'r3', at: 2600 }).state
  assert.equal(workingRow(s).text, '读《市场.pdf》中')
})

test('状态行：等重试的那一行替换状态行，小岛照旧是干活中', () => {
  let s = reduceTask(createTask(), { type: 'send', text: '写周报', runId: 'r4' }).state
  s = reduceTask(s, { type: 'progress', text: 'write 周报.docx', taskId: 'r4', at: 1000 }).state
  assert.equal(s.step, '写文件中')
  const waited = reduceTask(s, { type: 'wait', taskId: 'r4', vendor: '智谱', seconds: 20, retry: 1, max: 10 })
  assert.equal(waited.pet, 'work')
  const view = toTaskView(waited.state)
  assert.equal(view.blocks.some((one) => one.kind === 'working'), false)
  assert.equal(view.blocks.some((one) => one.kind === 'wait'), true)
})

test('新的一轮从零开始：那句话不留在下一轮', () => {
  let s = reduceTask(createTask(), { type: 'send', text: '写周报', runId: 'r5' }).state
  s = reduceTask(s, { type: 'progress', text: 'write 周报.docx', taskId: 'r5', at: 1000 }).state
  assert.equal(s.step, '写文件中')
  const stopped = reduceTask(s, { type: 'end', taskId: 'r5', status: 'cancelled' }).state
  const again = reduceTask(stopped, { type: 'send', text: '换个方向', runId: 'r6' }).state
  assert.equal(again.step, '')
  assert.equal(workingRow(again).text, '等待模型响应')
})
