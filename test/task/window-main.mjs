// 任务窗预览壳：不走 app/main/main.mjs。起一个 484×718 的透明窗（面板 460×680，四周余量给阴影），把十几种画面喂给页面、逐张截图存 SIDEMATE_SHOTS，再在页面上真点一遍，收到的动作连同画面名记进 acts.json。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），具名导入会在链接时就报错；这个文件被 npm test 当测试扫到，必须纯 node 下也不炸。
import electron from 'electron'
const { app, BrowserWindow, ipcMain } = electron
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'
import { createReloadGuard } from '../../app/task/reload-guard.mjs'
import { groupByDay, listParams } from '../../app/task/history-view.mjs'
import { retryWait } from '../../app/task/wait.mjs'
import { errorText } from '../../app/task/codes.mjs'
import { newsScene, NEWS_METER } from './window-news.mjs'
import { pasteScene } from './window-paste.mjs'
import { tagsScene } from './window-tags.mjs'
import { t } from '../../app/copy/copy.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shots = process.env.SIDEMATE_SHOTS
const only10 = process.argv.includes('--only-10')

const FOLDER = 'C:/Users/slow/Desktop/本周材料'
const TPL = FOLDER + '/第三季度工程项目建设进展情况汇报（定稿）.docx'
const MATS = ['三季度工程进度周报表.xlsx', '本周会议纪要.docx', '数据汇总（含三季度完整口径）.xlsx', '上周周报.docx', '各项目负责人沟通记录.docx', '三季度现场照片说明.docx', '口径备注与勘误.docx'].map((n) => FOLDER + '/' + n)
const OUT = 'C:/Users/slow/桌伴/任务/1104-汇成本周周报'
const CARD = OUT + '/本周周报.docx'
// 很长的文件夹名：胶囊不撑破，▾ 还在
const LONG_FOLDER = 'C:/Users/slow/Desktop/' + '很长很长的文件夹名字'.repeat(8)
const LONG = '一二三四五六七八九十'.repeat(12) // 120 个汉字
const OPTS = { root: 'C:/Users/slow/桌伴', recent: ['C:/Users/slow/Desktop/本周材料', 'C:/Users/slow/Desktop/三季度汇报材料', 'C:/Users/slow/Documents/年度总结材料'], preview: { path: FOLDER, count: 3 } }
const RECENT_OPTS = { ...OPTS, recentTasks: [{ dir: 'C:/Users/slow/桌伴/任务/2026-11-05-总结这些形成文献综述', out: 'C:/Users/slow/桌伴/任务/2026-11-05-总结这些形成文献综述', name: '11-05 总结这些形成文献综述', mtime: 1 }], allTasks: 'C:/Users/slow/桌伴/任务' }
const usage = (extra = {}) => ({ at: Date.UTC(2026, 10, 6, 12, 0, 0), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0, ...extra })

// 历史下拉和「全部对话」页用的样例：今天两条、昨天一条、再往前几条，时间跟着真实时钟走
const when = (daysAgo, h, m) => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const HISTORY = [
  { id: '20261111-102400-001', title: '帮我形成文献综述', folder: FOLDER, folderName: '本周材料', kind: 'task', updatedAt: when(0, 10, 24), fileCount: 1, count: 2 },
  { id: '20261111-091000-002', title: '汇成本周周报', folder: 'C:/Users/slow/桌伴/任务/2026-11-10-周报', folderName: '周报', kind: 'task', updatedAt: when(0, 9, 10), fileCount: 1, count: 4 },
  { id: '20261110-164000-003', title: '把访谈记录整理成要点', folder: 'C:/Users/slow/桌伴/任务/2026-11-09-访谈', folderName: '访谈', kind: 'task', updatedAt: when(1, 16, 40), fileCount: 1, count: 2 },
  { id: '20261108-203100-004', title: '这段话怎么改更顺', folder: 'C:/Users/slow/桌伴/任务/2026-11-08-这段话怎么改更顺', folderName: '2026-11-08-这段话怎么改更顺', kind: 'task', updatedAt: when(3, 20, 31), fileCount: 0, count: 2 },
  { id: '20261107-094000-005', title: '写一份客户回访提纲', folder: 'C:/Users/slow/桌伴/任务/2026-11-06-客户', folderName: '客户', kind: 'task', updatedAt: when(4, 9, 40), fileCount: 1, count: 2 },
]

const feed = (state, event) => reduceTask(state, event).state

// 带上八份文件的起点（上周的定稿也只是其中一份，不分范本和材料）
function base() {
  let s = createTask()
  s = feed(s, { type: 'drop', folder: FOLDER, files: MATS })
  s = feed(s, { type: 'drop', files: [TPL] })
  return s
}

function scene2() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'w1' })
  s = feed(s, { type: 'step', taskId: 'w1', step: 'prepare' })
  s = feed(s, { type: 'step', taskId: 'w1', step: 'copy' })
  s = feed(s, { type: 'progress', taskId: 'w1', text: 'read 三季度工程进度周报表.xlsx' })
  s = feed(s, { type: 'progress', taskId: 'w1', text: 'write 本周周报.docx' })
  return toTaskView(s, OPTS)
}

function scene5() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'r1' })
  s = feed(s, { type: 'step', taskId: 'r1', step: 'prepare' })
  s = feed(s, { type: 'step', taskId: 'r1', step: 'copy' })
  s = feed(s, { type: 'progress', taskId: 'r1', text: 'read 三季度工程进度周报表.xlsx' })
  s = feed(s, { type: 'progress', taskId: 'r1', text: 'write 本周周报.docx' })
  s = feed(s, { type: 'output', taskId: 'r1', name: '本周周报.docx', to: OUT + '/本周周报.docx', pages: 12 })
  s = feed(s, { type: 'reply', taskId: 'r1', text: '周报写好了，十二页，格式照上季度的定稿，数字取自三季度进度周报表。' })
  s = feed(s, { type: 'end', taskId: 'r1', status: 'done' })
  return toTaskView(s, OPTS)
}

// 一轮里模型说了两段（中间夹着工具调用）：两个气泡
function sceneTwo() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 't1' })
  s = feed(s, { type: 'reply', taskId: 't1', text: '没有什么工具，我先把七份材料看一遍。' })
  s = feed(s, { type: 'reply', taskId: 't1', text: '看完了：本周新增两条风险，累计口径按上周那版。' })
  s = feed(s, { type: 'end', taskId: 't1', status: 'done' })
  return toTaskView(s, OPTS)
}

// 长对话：回复一多就能滚了，用来试回车发消息前后的滚动位置
function longScene(count, extra = '') {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'l1' })
  for (let i = 1; i <= count; i += 1) {
    s = feed(s, { type: 'reply', taskId: 'l1', text: `第 ${i} 段回答：这一段是为了把对话流撑长，撑到能滚。` })
  }
  s = feed(s, { type: 'end', taskId: 'l1', status: 'done' })
  if (extra) s = feed(s, { type: 'send', text: extra, runId: 'l2' })
  return toTaskView(s, OPTS)
}

// 回话带 Markdown 的画面：粗体、代码、标题、列表、表格
const FMT_TEXT = '**写完了**，产出是 `中医文献综述.docx`。\n### 结构\n- 一、流派概览\n- 二、病机十九条\n1. 表格 5 张\n| 文件 | 页 |\n| --- | --- |\n| 综述 | 12 |\n<b>这不是粗体</b>'

// 说一句就装技能：待装技能的样子
const INSTALL = {
  id: 'mindmap-skill',
  name: '画思维导图',
  source: 'github.com/某作者/mindmap-skill',
  ref: 'main',
  does: '把提纲画成思维导图，出 PNG 和 SVG',
  ok: true,
  problems: [],
}

// 问装不装：我说的 → 它说的 → 确认卡
function sceneInstall() {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个画思维导图的技能', runId: 'i1' })
  s = feed(s, { type: 'reply', taskId: 'i1', text: '找到一个合适的。装之前先给你看一眼：' })
  s = feed(s, { type: 'install', taskId: 'i1', install: { ...INSTALL } })
  s = feed(s, { type: 'end', taskId: 'i1', status: 'done' })
  return toTaskView(s, OPTS)
}

// 装好了：卡收掉，它说的多一句气泡
function sceneInstalled() {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个画思维导图的技能', runId: 'j1' })
  s = feed(s, { type: 'reply', taskId: 'j1', text: '找到一个合适的。装之前先给你看一眼：' })
  s = feed(s, { type: 'install', taskId: 'j1', install: { ...INSTALL } })
  s = feed(s, { type: 'end', taskId: 'j1', status: 'done' })
  s = feed(s, { type: 'install-done', id: INSTALL.id })
  return toTaskView(s, OPTS)
}

// 查不过的：红字一句「技能无效」，不给「装上」
function sceneInstallBad() {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个画思维导图的技能', runId: 'k1' })
  s = feed(s, { type: 'install', taskId: 'k1', install: { ...INSTALL, ok: false, problems: [t('skills.invalid')] } })
  s = feed(s, { type: 'end', taskId: 'k1', status: 'done' })
  return toTaskView(s, OPTS)
}

// 装的时候连不上 GitHub：卡留着，红字「连接失败 · Si906 错误，HTTP 503」，还能再点
function sceneInstallNet() {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个抓网页标题的技能', runId: 'n1' })
  s = feed(s, { type: 'install', taskId: 'n1', install: { ...INSTALL } })
  s = feed(s, { type: 'end', taskId: 'n1', status: 'done' })
  s = feed(s, { type: 'install-fail', id: INSTALL.id, message: errorText('Si906', 'HTTP 503', t('probe.network')) })
  return toTaskView(s, OPTS)
}

// 干活中：卡还在，三个按钮都灰
function sceneInstallBusy() {
  let s = createTask()
  s = feed(s, { type: 'send', text: '帮我装一个画思维导图的技能', runId: 'm1' })
  s = feed(s, { type: 'install', taskId: 'm1', install: { ...INSTALL } })
  s = feed(s, { type: 'end', taskId: 'm1', status: 'done' })
  s = feed(s, { type: 'send', text: '再找一个', runId: 'm2' })
  return toTaskView(s, OPTS)
}

function sceneFmt() {
  let s = base()
  s = feed(s, { type: 'send', text: '写文献综述', runId: 'f1' })
  s = feed(s, { type: 'reply', taskId: 'f1', text: FMT_TEXT })
  s = feed(s, { type: 'end', taskId: 'f1', status: 'done' })
  return toTaskView(s, OPTS)
}

// 比多一份材料的画面（给「▾」开着时换画面用）
function moreView() {
  let s = base()
  s = feed(s, { type: 'drop', files: [FOLDER + '/补充说明.docx'] })
  return toTaskView(s, OPTS)
}

// 模型忙：等一会儿自己再试的那一行（灰字，底下倒数，右边一个「停下」）。
// 事件照真路径用 retryWait 造（带 head / tail / until），不手写整句：手写的整句会被拆错、字重一遍
function sceneWait() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'b1' })
  s = feed(s, { type: 'step', taskId: 'b1', step: 'prepare' })
  s = feed(s, { type: 'reply', taskId: 'b1', text: '先读这几份文件。' })
  s = feed(s, { type: 'wait', taskId: 'b1', ...retryWait({ delayMs: 20_000, retry: 3, maxRetries: 10, kind: 'busy' }) })
  return toTaskView(s, OPTS)
}

// 试了 10 次还不行：停在这儿，给「接着干」和「换模型」
function scenePaused() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'b2' })
  s = feed(s, { type: 'step', taskId: 'b2', step: 'prepare' })
  s = feed(s, { type: 'reply', taskId: 'b2', text: '先读这几份文件。' })
  s = feed(s, { type: 'error', taskId: 'b2', reason: 'busy', vendor: '智谱' })
  return toTaskView(s, OPTS)
}

function buildScenes() {
  let q = base()
  q = feed(q, { type: 'send', text: '把材料改成正式口吻', runId: 'q1' })
  q = feed(q, { type: 'step', taskId: 'q1', step: 'prepare' })
  q = feed(q, { type: 'reply', taskId: 'q1', text: '材料三里有两张表：本周、累计。周报的数用哪张？' })
  q = feed(q, { type: 'end', taskId: 'q1', status: 'done' })
  let e = base()
  e = feed(e, { type: 'send', text: '汇成本周周报', runId: 'e1' })
  e = feed(e, { type: 'step', taskId: 'e1', step: 'prepare' })
  e = feed(e, { type: 'step', taskId: 'e1', step: 'copy' })
  e = feed(e, { type: 'error', taskId: 'e1', reason: 'key' })
  let c = createTask()
  c = feed(c, { type: 'send', text: '讲个笑话', runId: 'c1' })
  c = feed(c, { type: 'reply', taskId: 'c1', text: '改稿子最怕的两件事：别人不留底稿，和让自己留底稿。' })
  c = feed(c, { type: 'end', taskId: 'c1', status: 'done' })
  return [
    { name: '1-空的', view: toTaskView(createTask(), OPTS) },
    { name: '2-带了文件还没开始', view: toTaskView(base(), OPTS) },
    { name: '3-干活中', view: scene2() },
    { name: '4-等你回话', view: toTaskView(q, OPTS) },
    { name: '5-做完了', view: scene5() },
    { name: '6-没干成', view: toTaskView(e, OPTS) },
    { name: '7-只聊天', view: toTaskView(c, OPTS) },
    { name: '8-回话带格式', view: sceneFmt() },
    { name: '9-两段回答', view: sceneTwo() },
    { name: '10-新任务', view: toTaskView(base(), OPTS) },
    { name: '问装不装', view: sceneInstall() },
    { name: '装好了', view: sceneInstalled() },
    { name: '历史下拉', view: toTaskView(base(), RECENT_OPTS) },
    { name: '全部对话', view: toTaskView(base(), OPTS) },
    { name: '16-新闻', view: newsScene(OPTS) },
    { name: '20-干活中插一句', view: sceneSteer() },
    { name: '18-模型忙等一等', view: sceneWait() },
    { name: '19-停在这儿', view: scenePaused() },
    { name: '23-原件被改了', view: sceneNotice() },
  ]
}

// 不停工的错：产出照给，输入框上方一行灰字带 ×（提示级）
function sceneNotice() {
  let s = base()
  s = feed(s, { type: 'send', text: '汇成本周周报', runId: 'o1' })
  s = feed(s, { type: 'output', taskId: 'o1', name: '本周周报.docx', to: OUT + '/本周周报.docx', pages: 12 })
  s = feed(s, { type: 'reply', taskId: 'o1', text: '周报写好了。' })
  s = feed(s, { type: 'end', taskId: 'o1', status: 'done' })
  s = feed(s, { type: 'paste', files: [], code: 'Si702' })
  return toTaskView(s, OPTS)
}

// 干活中插一句：插进去的那句话冒成「我说的」气泡，下面一行灰字
function sceneSteer() {
  let s = base()
  s = feed(s, { type: 'send', text: '照上季度的定稿，用这些文件写一份本周周报。', runId: 'n1' })
  s = feed(s, { type: 'progress', taskId: 'n1', text: 'read 材料-库存.csv' })
  s = feed(s, { type: 'steer', id: 'st1', taskId: 'n1', text: '只写销售和库存两块就行' })
  s = feed(s, { type: 'steer-status', id: 'st1', taskId: 'n1', status: 'steer' })
  return toTaskView(s, OPTS)
}

// 每种画面截完图后真点一遍的脚本；返回的值记进 checks
const CLICKS = {
  '1-空的': `(() => { document.querySelector('#input').value = '讲个笑话'; return true })()`,
  '2-带了文件还没开始': `(() => {
    const input = document.querySelector('#input')
    const key = (extra) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, ...extra }))
    input.value = '汇成本周周报'
    key({ shiftKey: true })
    key({ isComposing: true, keyCode: 229, which: 229 })
    const held = input.value
    key({ keyCode: 13, which: 13 })
    document.querySelector('#addfile').click()
    const tags = [...document.querySelectorAll('#tags .tag')]
    tags[0].click()
    const items = [...document.querySelectorAll('#tagmenu button')].map((one) => one.textContent)
    document.querySelectorAll('#tagmenu button')[0].click()
    document.querySelector('#previewbtn').click()
    document.querySelector('#where-btn').click()
    return new Promise((resolve) => setTimeout(() => {
      const row = document.querySelector('#histmenu .hrow[data-id]')
      if (row) row.click()
      resolve({ held, cleared: input.value === '', items })
    }, 250))
  })()`,
  '3-干活中': `(() => {
    const input = document.querySelector('#input')
    input.value = '只写销售和库存两块就行'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    document.querySelector('#stop').click()
    return true
  })()`,
  // 干活中插一句：插进去的那句话、下面那行灰字、输入框没锁
  '20-干活中插一句': `(() => {
    const note = document.querySelector('.steer .snote')
    const bubble = document.querySelector('.steer .user .tx')
    const input = document.querySelector('#input')
    return {
      steerBubble: bubble ? bubble.textContent : '',
      steerNote: note ? note.textContent : '',
      steerSize: note ? getComputedStyle(note).fontSize : '',
      steerColor: note ? getComputedStyle(note).color : '',
      steerPlaceholder: input.placeholder,
      steerLocked: input.disabled,
      steerStopHidden: document.querySelector('#stop').hidden,
    }
  })()`,
  '5-做完了': `(() => {
    const card = [...document.querySelectorAll('.card')].find((el) => el.dataset.path === ${JSON.stringify(OUT + '/本周周报.docx')})
    for (const btn of card.querySelectorAll('.btns button')) btn.click()
    return true
  })()`,
  '6-没干成': `(() => {
    for (const btn of document.querySelectorAll('#banner button')) btn.click()
    return true
  })()`,
  '9-两段回答': `(() => ({ replies: document.querySelectorAll('#flow .reply').length }))()`,
  '10-新任务': `(() => { document.querySelector('#newtask').click(); return true })()`,
  '问装不装': `(() => {
    const btns = [...document.querySelectorAll('.install .ibtns button')]
    for (const btn of btns) btn.click()
    return true
  })()`,
  '历史下拉': `(() => new Promise((resolve) => {
    document.querySelector('#where-btn').click()
    setTimeout(() => {
      const row = document.querySelector('#histmenu .hrow[data-id]')
      if (row) row.click()
      resolve(true)
    }, 250)
  }))()`,
  '全部对话': `(() => { document.querySelector('#allpage .apback').click(); return true })()`,
}

// 拖着文件进窗：整窗一块
const DRAG = `(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['x'], 'x.docx'))
  document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  const zones = [...document.querySelectorAll('#dropmask .zone')]
  const on = zones.map((one) => one.classList.contains('on'))
  zones[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  const lit = zones[0].classList.contains('on')
  // 拖放区上不写字（不再分「当范本」「当材料」）
  const words = document.querySelector('#dropmask').textContent.trim()
  return { zones: zones.length, on, lit, words, hidden: document.querySelector('#dropmask').hidden }
})()`

// 不带 preload 的窗里点一遍、拖一遍：console 里不该有 error
const NOBRIDGE = `(() => {
  document.querySelector('#send').click()
  document.querySelector('#previewbtn').click()
  document.querySelector('#where-btn').click()
  document.querySelector('#newtask').click()
  document.querySelector('#addfile').click()
  const input = document.querySelector('#input')
  input.value = 'abc'
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  const dt = new DataTransfer()
  dt.items.add(new File(['x'], 'x.docx'))
  document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  return true
})()`

const SCENE11 = '11-输入框120字'

// 界面上那几样东西的位置和样子：靠右、照排、红字只给两处
const DESIGN = `(() => {
  const flow = document.querySelector('#flow')
  const box = flow.getBoundingClientRect()
  const at = (sel) => document.querySelector(sel)
  const rect = (sel) => { const el = at(sel); return el ? el.getBoundingClientRect() : null }
  const user = rect('.user')
  const reply = rect('.reply')
  const ava = rect('.them .ava')
  const md = at('.reply .md')
  const card = at('.card')
  const working = at('.working')
  const tail = at('.reply .tail')
  const err = at('#banner.block')
  return {
    userRight: user ? Math.round(box.right - user.right) : -1,
    replyLeft: reply ? Math.round(reply.left - box.left) : -1,
    ava: ava ? { w: Math.round(ava.width), h: Math.round(ava.height), before: reply ? Math.round(reply.left - ava.right) : -1 } : null,
    working: working ? working.textContent : '',
    replies: document.querySelectorAll('#flow .reply').length,
    tail: tail ? tail.textContent : '',
    tailColor: tail ? getComputedStyle(tail).color : '',
    err: err ? err.querySelector('.btext').textContent : '',
    errColor: err ? getComputedStyle(err).color : '',
    md: md ? { h: md.querySelectorAll('h3,h4,h5,h6').length, ul: md.querySelectorAll('ul').length, table: md.querySelectorAll('table').length, stars: md.textContent.includes('*') } : null,
    card: card ? { icon: !!card.querySelector('svg'), buttons: card.querySelectorAll('.btns button').length, line: card.querySelector('.sub').textContent, name: card.querySelector('.nm').textContent } : null,
  }
})()`

// 模型忙时的两种样子：等一会儿再试的那一行、停在这儿的那一块
const BUSY = `(() => {
  const wait = document.querySelector('.wait')
  const err = document.querySelector('#banner.block')
  const secs = document.querySelector('.wsecs')
  const row = (el) => el ? { text: el.textContent, color: getComputedStyle(el).color, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null
  return {
    wait: wait ? { text: wait.textContent, color: getComputedStyle(wait).color, buttons: [...wait.querySelectorAll('.btns button')].map((one) => one.textContent), secs: secs ? secs.textContent : '' } : null,
    waitRow: row(wait),
    err: err ? { text: err.textContent, color: getComputedStyle(err).color, buttons: [...err.querySelectorAll('.btns button')].map((one) => one.textContent), primary: [...err.querySelectorAll('.btns button')].some((one) => one.classList.contains('primary')) } : null,
    working: document.querySelector('.working') ? document.querySelector('.working').textContent : '',
  }
})()`

// 截某些图之前先点一下
const PRE = {}

// 装不装确认卡的尺寸：内边距、圆角、三行标签宽 56、行间距 10、两个按钮的宽高
const INSTALL_METER = `(() => {
  const card = document.querySelector('.install')
  if (!card) return null
  const style = getComputedStyle(card)
  const row = card.querySelector('.irow')
  const key = row.querySelector('.k')
  const val = row.querySelector('.v')
  const size = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } }
  return {
    pad: {
      t: Math.round(parseFloat(style.paddingTop)), r: Math.round(parseFloat(style.paddingRight)),
      b: Math.round(parseFloat(style.paddingBottom)), l: Math.round(parseFloat(style.paddingLeft)),
    },
    radius: style.borderRadius,
    labelW: Math.round(key.getBoundingClientRect().width),
    rowGap: Math.round(val.getBoundingClientRect().left - key.getBoundingClientRect().right),
    rows: card.querySelectorAll('.irow').length,
    title: card.querySelector('.ititle').textContent,
    labels: [...card.querySelectorAll('.irow .k')].map((one) => one.textContent),
    // 来源那行：仓库和版本各一截，两截之间的空白（px）
    from: [...card.querySelectorAll('.irow')[1].querySelectorAll('.v > span')].map((one) => one.textContent),
    fromGap: (() => {
      const [a, b] = card.querySelectorAll('.irow')[1].querySelectorAll('.v > span')
      return a && b ? Math.round(b.getBoundingClientRect().left - a.getBoundingClientRect().right) : null
    })(),
    yes: card.querySelector('.yes') ? size(card.querySelector('.yes')) : null,
    no: size(card.querySelector('.no')),
    buttons: card.querySelectorAll('.ibtns button').length,
    red: card.querySelectorAll('.irow .bad').length,
  }
})()`

// 查不过的：没有「装上」，只剩两个，问题用红字
const INSTALL_BAD = `(() => {
  const card = document.querySelector('.install')
  return {
    yes: !!card.querySelector('.yes'),
    buttons: card.querySelectorAll('.ibtns button').length,
    bad: card.querySelectorAll('.irow .bad').length,
    badText: [...card.querySelectorAll('.irow .bad')].map((one) => one.textContent),
  }
})()`

// 装好了：卡没了，最后一句它说的气泡
const INSTALLED = `(() => {
  const replies = [...document.querySelectorAll('#flow .reply')]
  return { card: !!document.querySelector('#flow .install'), last: replies.length ? replies[replies.length - 1].textContent : '' }
})()`

// 装的时候连不上：卡上只有那一行是红字
const INSTALL_RED = `(() => {
  const bad = [...document.querySelectorAll('.install .irow .bad')].map((one) => one.textContent)
  return { count: bad.length, bad, color: getComputedStyle(document.querySelector('.install .irow .bad')).color }
})()`

// 干活中：两个按钮都灰
const INSTALL_GREY = `(() => {
  const btns = [...document.querySelectorAll('.install .ibtns button')]
  return { count: btns.length, all: btns.every((one) => one.disabled), labels: btns.map((one) => one.textContent) }
})()`

async function main() {
  if (!shots) throw new Error('SIDEMATE_SHOTS 未设置')
  mkdirSync(shots, { recursive: true })
  let current = null
  let readyResolve = null
  let readyCount = 0
  const readyOnce = new Promise((resolve) => { readyResolve = resolve })
  const acts = []
  const layout = {}
  const checks = { overlap: {}, menu: {}, flow: {}, sizes: {}, design: {}, install: {}, hits: {} }
  let sendReply = null // 主进程收到「发送」后回的那个视图
  ipcMain.handle('task:ready', () => { readyCount += 1; readyResolve(); return current ? current.view : null })
  ipcMain.on('task:act', (_event, action) => {
    acts.push({ scene: current ? current.name : '', action })
    if (action.type === 'send' && sendReply) {
      current = { name: current ? current.name : '', view: sendReply }
      win.webContents.send('task:view', sendReply)
    }
  })
  ipcMain.on('task:drop', (_event, payload) => { acts.push({ scene: current ? current.name : '', action: { type: 'drop', ...payload } }) })
  // 历史下拉和「全部对话」页：样例数据，搜和筛照真逻辑走一遍
  ipcMain.handle('task:history-list', (_event, payload) => {
    const want = listParams(payload || {})
    const q = want.query.toLowerCase()
    const items = HISTORY.filter((one) =>
      (want.kind ? one.kind === want.kind : true)
      && (q ? one.title.toLowerCase().includes(q) || String(one.folderName).toLowerCase().includes(q) : true))
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return { items, groups: groupByDay(items) }
  })
  // 点开一条时记下 id：测试好断言主进程真收到了 task:history-open
  ipcMain.handle('task:history-open', (_event, payload) => {
    checks.historyOpen = payload && payload.id ? payload.id : ''
    return { ok: true, message: '' }
  })

  const win = new BrowserWindow({
    width: 484, height: 718, show: false,
    webPreferences: { preload: join(root, 'app', 'task', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  await win.loadFile(join(root, 'app', 'task', 'task.html'))
  await Promise.race([readyOnce, sleep(5_000)])
  win.show()
  const w = win.webContents
  // 露脸：页面第一帧是收起状态，壳说一声才垂下来（照 app/task/shell.mjs）
  w.send('task:anim', 'in')
  await sleep(400)
  const settle = () => w.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const overflow = '(() => { const de = document.documentElement; return { x: de.scrollWidth - de.clientWidth, y: de.scrollHeight - de.clientHeight } })()'
  const push = async (name, view) => { current = { name, view }; w.send('task:view', view); await settle() }
  // 截图等画面稳：capturePage 可能拿到合成器的旧帧，连着两次一样且跟上一次的画面不同才存
  const shot = async (stale) => {
    let prev = (await w.capturePage()).toPNG()
    for (let i = 0; i < 15; i++) {
      await sleep(120)
      const next = (await w.capturePage()).toPNG()
      if (next.equals(prev) && !next.equals(stale)) return next
      prev = next
    }
    return prev
  }
  const show = async (name, view) => {
    const stale = (await w.capturePage()).toPNG()
    await push(name, view)
    // 历史下拉：点「▾」弹开，拿到列表再截；截完收起来，别压着后面的画面
    if (name === '历史下拉') {
      await w.executeJavaScript('document.querySelector("#where-btn").click()')
      await sleep(300)
    }
    // 全部对话：点开下拉再点「看全部…」，整页换出来截；截完退回对话
    if (name === '全部对话') {
      const openAll = `(() => new Promise((resolve) => {
        document.querySelector("#where-btn").click()
        setTimeout(() => {
          const all = document.querySelector("#histmenu .hall")
          if (all) all.click()
          resolve(true)
        }, 250)
      }))()`
      await w.executeJavaScript(openAll)
      await sleep(350)
    }
    if (PRE[name]) await w.executeJavaScript(PRE[name])
    layout[name] = await w.executeJavaScript(overflow)
    // 看得见的字里不许露出没填的 {变量}；看得见的按钮不许是空的（没字、没图标、没提示）
    checks.blank = checks.blank || {}
    checks.blank[name] = await w.executeJavaScript(`(() => {
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      const vars = (document.body.innerText.match(/\\{[A-Za-z][A-Za-z0-9]*\\}/g) || [])
      const empty = [...document.querySelectorAll('button')].filter((b) => shown(b) && !b.textContent.trim() && !b.querySelector('svg, img') && !b.title).map((b) => b.id || b.className)
      return { vars, empty }
    })()`)
    writeFileSync(join(shots, `${name}.png`), await shot(stale))
    if (name === '历史下拉') await w.executeJavaScript('document.querySelector("#where-btn").click()')
    // 全部对话：没有「所有文件夹 ▾」，分段和搜索还在；搜文件夹名能搜到那条
    if (name === '全部对话') {
      checks.allpage = await w.executeJavaScript(`(() => {
        const seg = document.querySelector('#allpage .apseg')
        const search = document.querySelector('#allpage .apsearch')
        const sr = seg.getBoundingClientRect(), qr = search.getBoundingClientRect()
        return {
          folderFilter: document.querySelectorAll('#allpage .apfolder, #allpage .appop').length,
          segCount: document.querySelectorAll('#allpage .apseg button').length,
          placeholder: document.querySelector('#allpage .apsearch input').placeholder,
          segLeft: Math.round(sr.left), segWidth: Math.round(sr.width),
          searchLeft: Math.round(qr.left), searchWidth: Math.round(qr.width),
        }
      })()`)
      await w.executeJavaScript(`(() => {
        const input = document.querySelector('#allpage .apsearch input')
        input.value = '本周材料'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      await sleep(500)
      checks.allpage.folderSearchRows = await w.executeJavaScript(`document.querySelectorAll('#allpage .aplist .hrow').length`)
      checks.allpage.folderSearchTitles = await w.executeJavaScript(`[...document.querySelectorAll('#allpage .aplist .hrow .htitle')].map((one) => one.textContent)`)
    }
    if (name === '全部对话') await w.executeJavaScript('document.querySelector("#allpage .apback").click()')
  }

  if (only10) {
    await show('10-做完了-1.5x', scene5())
    await sleep(150)
    app.exit(0)
    return
  }

  const scenes = buildScenes()
  const ready = scenes[1].view
  const working = scenes[2].view
  for (const one of scenes) await show(one.name, one.view)

  // 新闻那一页：标题解成粗体、条间细线、来源小字（料和重置的脚本在 window-news.mjs）
  await push('样子-新闻', newsScene(OPTS))
  checks.news = await w.executeJavaScript(NEWS_METER)

  // 贴图片和长文字：剪贴板放 PNG 和 3000 字，在输入框上贴（料和量的脚本在 window-paste.mjs）
  checks.paste = await pasteScene({ w, show, settle, opts: OPTS })
  checks.tags = await tagsScene({ w, show, settle, opts: OPTS }) // 小签行：七份文件（脚本在 window-tags.mjs）

  // 第 1 条：输入框 120 个汉字，#send 和 #input 两个矩形的交集该是 0；两种窗、两个按钮字都量
  const overlapJS = (sel) => `(() => {
    const a = document.querySelector('#input').getBoundingClientRect(), b = document.querySelector('${sel}').getBoundingClientRect()
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    return { area: Math.round(x * y), btn: document.querySelector('${sel}').textContent }
  })()`
  const stale11 = (await w.capturePage()).toPNG()
  await push(SCENE11, ready)
  await w.executeJavaScript(`(() => {
    const input = document.querySelector('#input')
    input.value = ${JSON.stringify(LONG)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await settle()
  layout[SCENE11] = await w.executeJavaScript(overflow)
  writeFileSync(join(shots, `${SCENE11}.png`), await shot(stale11))
  checks.overlap['484x718-send'] = await w.executeJavaScript(overlapJS('#send'))
  await push(SCENE11, working)
  checks.overlap['484x718-stop'] = await w.executeJavaScript(overlapJS('#stop'))

  // 第 2 条：顶栏 48、小签行 38；输入胶囊收起 42、展开 ≥ 100。下面的过渡要真渲染才走得到，先把窗抬到顶上，免得被别的窗遮住、渲染器挂起重看旧帧
  win.moveTop()
  const sizesJS = `(() => {
    const h = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : -1 }
    return { top: h('#top'), tags: h('#tagrow'), box: h('#inputwrap'), tagHidden: document.querySelector('#tagrow').hidden }
  })()`
  await push('尺寸', ready)
  checks.sizes.withFiles = await w.executeJavaScript(sizesJS)
  await push('尺寸', toTaskView(createTask(), OPTS))
  // 收起那条得先清掉输入性内容再失焦，胶囊才收得回去；收起有 160ms 过渡，逼一次提交再等它走完
  await w.executeJavaScript(`(() => { const input = document.querySelector('#input'); input.value = ''; input.blur(); return true })()`)
  await w.executeJavaScript('document.querySelector("#inputwrap").getBoundingClientRect().height')
  await sleep(300)
  checks.sizes.empty = await w.executeJavaScript(sizesJS)

  // 第 2 条 b：输入胶囊展开 / 收起的过渡：两种状态圆角都 20、底边不动、发送钮贴框右下角不挪窝、展开途中真在走
  const boxShape = `(() => {
    const box = document.querySelector('#inputwrap')
    const send = document.querySelector('#send')
    const r = box.getBoundingClientRect(), s = send.getBoundingClientRect()
    return {
      radius: getComputedStyle(box).borderRadius, h: Math.round(r.height), bottom: Math.round(r.bottom),
      db: Math.round(r.bottom - s.bottom), dr: Math.round(r.right - s.right),
    }
  })()`
  checks.inputAnim = {}
  checks.inputAnim.fold = await w.executeJavaScript(boxShape)
  const nudge = () => w.executeJavaScript('document.querySelector("#inputwrap").getBoundingClientRect().height')
  await w.executeJavaScript(`(() => { const input = document.querySelector('#input'); input.value = '量一下展开收起'; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await nudge() // 逼一次样式提交，过渡的钟走起来（窗被遮住时帧会节流，不逼并给下一步量到旧值）
  await sleep(60) // 展开走 200ms：这时该在半路上
  checks.inputAnim.mid = await w.executeJavaScript(boxShape)
  await sleep(300)
  checks.inputAnim.open = await w.executeJavaScript(boxShape)
  // 收回去：清掉字再失焦
  await w.executeJavaScript(`(() => { const input = document.querySelector('#input'); input.value = ''; input.focus(); input.blur(); return true })()`)
  await nudge()
  await sleep(300)
  checks.inputAnim.fold2 = await w.executeJavaScript(boxShape)

  // 第 3 条 a：「▾」开着时来新视图不收；干活中「看全部…」也能点（那条在后台接着跑），下拉还开着
  const menuHidden = () => w.executeJavaScript('document.querySelector("#histmenu").hidden')
  const seeAllDisabled = () => w.executeJavaScript('document.querySelector("#histmenu .hall").disabled')
  await push('菜单-留开', ready)
  await w.executeJavaScript('document.querySelector("#where-btn").click()')
  await sleep(300)
  checks.menu.opened = await menuHidden()
  checks.menu.seeAll = await seeAllDisabled()
  await push('菜单-留开', ready)
  checks.menu.same = await menuHidden()
  await push('菜单-留开', moreView())
  checks.menu.extra = await menuHidden()
  await push('菜单-留开', working)
  checks.menu.busy = await seeAllDisabled()
  checks.menu.stillOpen = await menuHidden()
  await w.executeJavaScript('document.querySelector("#where-btn").click()')

  // 第 3 条 b：每 50 ms 连推同一个视图，真按鼠标只该收到一条动作
  const centerOf = (expr) => w.executeJavaScript(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const pushClick = async (name, view, expr) => {
    await push(name, view)
    const pt = await centerOf(expr)
    const before = acts.length
    const timer = setInterval(() => w.send('task:view', view), 50)
    w.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    await sleep(150)
    w.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left' })
    await sleep(120)
    clearInterval(timer)
    await settle()
    return acts.slice(before).map((one) => one.action)
  }
  const openBtn = `document.querySelector(${JSON.stringify(`.card[data-path="${CARD}"] .btns button`)})`
  checks.openClicks = await pushClick('连推-做完了', scene5(), openBtn)
  checks.stopClicks = await pushClick('连推-干活中', working, 'document.querySelector("#stop")')

  // 点击区域（真鼠标）：胶囊整块（左缘内 4px、正中、右缘内 4px）都弹历史下拉、都不发 preview-folder；右边「预览」的小图标才发 preview-folder；搜框上缘内 2px 点进输入、右键小签弹出菜单
  const ptAt = (expr, fx, fy) => w.executeJavaScript(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: Math.round(r.left + (${fx})), y: Math.round(r.top + (${fy})) } })()`)
  const realClick = async (pt, button = 'left') => {
    w.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button, clickCount: 1 })
    await sleep(80)
    w.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button })
    await sleep(150)
  }
  const closeMenu = async () => {
    await w.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'); await sleep(150)
  }
  await push('点击区', ready)
  // 胶囊整块：三个位置都弹历史下拉，都不发 preview-folder
  checks.hits.capsule = {}
  for (const [name, fx] of [['left', 4], ['mid', 'r.width / 2'], ['right', 'r.width - 4']]) {
    await closeMenu()
    const before = acts.length
    await realClick(await ptAt('document.querySelector("#where-btn")', fx, 16))
    checks.hits.capsule[name] = {
      menu: await w.executeJavaScript('document.querySelector("#histmenu").hidden'),
      acts: acts.slice(before).map((one) => one.action),
      shadow: await w.executeJavaScript('getComputedStyle(document.querySelector("#where-btn")).boxShadow'),
    }
  }
  await closeMenu()
  // 右边的小图标才发 preview-folder
  const openBefore = acts.length
  await realClick(await ptAt('document.querySelector("#previewbtn")', 'r.width / 2', 'r.height / 2'))
  checks.hits.previewbtn = acts.slice(openBefore).map((one) => one.action)
  // 胶囊的样子：宽 ≥ 120、高 32；五点打点都落在按钮自己身上
  const CAPSULE_BOX = `(() => { const r = document.querySelector('#where-btn').getBoundingClientRect()
    const c = document.querySelector('#where-caret').getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), caretW: Math.round(c.width), caretRight: Math.round(c.right), right: Math.round(r.right) } })()`
  const HIT_POINTS = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]]
    return pts.map(([x, y]) => { const hit = document.elementFromPoint(Math.round(x), Math.round(y)); return hit ? (hit.id || hit.tagName) : '' }) })()`
  checks.hits.capsuleBox = await w.executeJavaScript(CAPSULE_BOX)
  checks.hits.capsuleHit = await w.executeJavaScript(HIT_POINTS('#where-btn'))
  checks.hits.openHit = await w.executeJavaScript(HIT_POINTS('#previewbtn'))
  // 很长的文件夹名：胶囊不超 240，▾ 还在
  const longView = JSON.parse(JSON.stringify(scene5()))
  longView.top.path = { text: LONG_FOLDER, title: LONG_FOLDER, open: LONG_FOLDER }
  await push('长名字', longView)
  checks.hits.longBox = await w.executeJavaScript(CAPSULE_BOX)
  await push('点击区', ready)
  await realClick(await ptAt('document.querySelector("#where-btn")', 'r.width - 4', 16))
  checks.hits.menuOpen = await w.executeJavaScript('document.querySelector("#histmenu").hidden')
  // 点搜框上缘前先把焦点搁在 body 上，不然开下拉时自动聚的焦点会让这条测了个寂寞
  await w.executeJavaScript('document.activeElement.blur()')
  await realClick(await ptAt('document.querySelector("#histmenu .hsearch")', 153, 2))
  checks.hits.searchFocus = await w.executeJavaScript('(() => { const box = document.querySelector("#histmenu .hsearch"); return box.contains(document.activeElement) })()')
  await w.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await realClick(await ptAt('document.querySelector("#tags .tag")', 24, 12), 'right')
  checks.hits.tagMenu = await w.executeJavaScript('document.querySelector("#tagmenu").hidden')
  await w.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')

  // 第 3 条 d：空任务展开后左下角「＋ 文件」：看得见、至少 44×28 的点击区整块都是它（中心 + 四角内缩 3px）、鼠标变手；收起的胶囊里没有它（稿里收起只有字和发送钮）；真点一下发出 add 动作
  const addfileMeter = `(() => {
    const btn = document.querySelector('#addfile')
    const r = btn.getBoundingClientRect()
    const hit = (x, y) => { const el = document.elementFromPoint(x, y); return el === btn || btn.contains(el) }
    return {
      text: btn.textContent.trim(), hidden: btn.hidden,
      w: Math.round(r.width), h: Math.round(r.height),
      cursor: getComputedStyle(btn).cursor,
      center: hit(r.left + r.width / 2, r.top + r.height / 2),
      corners: [
        hit(r.left + 3, r.top + 3), hit(r.right - 3, r.top + 3),
        hit(r.right - 3, r.bottom - 3), hit(r.left + 3, r.bottom - 3),
      ],
    }
  })()`
  await push('加文件', toTaskView(createTask(), OPTS))
  await w.executeJavaScript('document.querySelector("#inputwrap").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))')
  await sleep(350) // 展开走 200ms、小签行再晚 60ms 淡入，等它走完再量
  checks.addfile = {}
  checks.addfile.open = await w.executeJavaScript(addfileMeter)
  const addBefore = acts.length
  await realClick(await ptAt('document.querySelector("#addfile")', 'r.width / 2', 'r.height / 2'))
  checks.addfileActs = acts.slice(addBefore).map((one) => one.action)
  // 点完焦点离了输入框，胶囊自己收回去；这时量收起的样子
  await w.executeJavaScript('(() => { const input = document.querySelector("#input"); input.value = \'\'; input.blur(); return true })()')
  await sleep(300)
  checks.addfile.fold = await w.executeJavaScript(addfileMeter)

  // 第 4 条：出卡那一帧在 MutationObserver 回调里量流末；底段高不超窗高 45%
  const frameAt = async () => {
    await push('流末', scene2())
    await w.executeJavaScript(`(() => {
      const f = document.querySelector('#flow')
      window.__gap = null
      new MutationObserver(() => { window.__gap = f.scrollHeight - f.scrollTop - f.clientHeight }).observe(f, { childList: true, subtree: true })
      return true
    })()`)
    await push('流末', scene5())
    return w.executeJavaScript('(() => { const f = document.querySelector("#flow"); return { gap: window.__gap, scroll: f.scrollHeight > f.clientHeight } })()')
  }
  checks.flow['484x718'] = await frameAt()

  // 第 5 条：拖着文件进窗，整窗分两块
  await push('拖着文件进窗', ready)
  checks.drag = await w.executeJavaScript(DRAG)
  await settle()
  writeFileSync(join(shots, '12-拖着文件进窗.png'), await w.capturePage().then((one) => one.toPNG()))

  // 第 6 条：界面上那几样东西的位置和样子
  await push('样子-做完了', scene5())
  checks.design.done = await w.executeJavaScript(DESIGN)
  await push('样子-回话带格式', sceneFmt())
  checks.design.fmt = await w.executeJavaScript(DESIGN)
  const askView = buildScenes()[3].view
  await push('样子-等你回话', askView)
  checks.design.ask = await w.executeJavaScript(DESIGN)
  const errView = buildScenes()[5].view
  await push('样子-没干成', errView)
  checks.design.fail = await w.executeJavaScript(DESIGN)
  await push('样子-干活中', working)
  checks.design.work = await w.executeJavaScript(DESIGN)
  // 模型忙时的两种样子
  await push('样子-模型忙等一等', sceneWait())
  checks.design.wait = await w.executeJavaScript(BUSY)
  await push('样子-停在这儿', scenePaused())
  checks.design.paused = await w.executeJavaScript(BUSY)
  // 提示级：灰字一行、带 ×，点 × 发 dismiss
  await push('样子-提示', sceneNotice())
  checks.design.notice = await w.executeJavaScript(`(() => {
    const el = document.querySelector('#banner')
    const x = el.querySelector('.x')
    const out = { level: el.className, hidden: el.hidden, text: el.querySelector('.btext').textContent, color: getComputedStyle(el).color, x: !!x, xTitle: x ? x.title : '' }
    if (x) x.click()
    return out
  })()`)
  await sleep(150)
  checks.design.noticeActs = acts.filter((one) => one.scene === '样子-提示').map((one) => one.action)

  // 第 6 条 c：装不装确认卡照稿量：内边距 12/14、标签宽 56、行间距 10、按钮尺寸
  await push('样子-问装不装', sceneInstall())
  checks.install.ask = await w.executeJavaScript(INSTALL_METER)
  await push('样子-查不过', sceneInstallBad())
  checks.install.bad = await w.executeJavaScript(INSTALL_BAD)
  await push('样子-连不上', sceneInstallNet())
  checks.install.red = await w.executeJavaScript(INSTALL_RED)
  await push('样子-干活中带卡', sceneInstallBusy())
  checks.install.grey = await w.executeJavaScript(INSTALL_GREY)
  await push('样子-装好了', sceneInstalled())
  checks.install.installed = await w.executeJavaScript(INSTALLED)

  // 第 7 条：回车发消息 → 滚到底；用户自己往上翻着看 → 来了新内容不硬拽
  const scrollJS = '(() => { const f = document.querySelector("#flow"); return { top: Math.round(f.scrollTop), height: f.scrollHeight, client: f.clientHeight } })()'
  const grab = async (name) => {
    await sleep(300)
    await settle()
    writeFileSync(join(shots, `${name}.png`), await w.capturePage().then((one) => one.toPNG()))
  }
  const toTop = '(() => { const f = document.querySelector("#flow"); f.scrollTop = 0; f.dispatchEvent(new Event("scroll")); return true })()'
  // 长对话要够长：翻到顶也离底超过 80（滚动的 GAP），「来了新内容不硬拽」那条路才轮得到走；0.3 对稿后窗变高、气泡收紧，26 段才够长
  const longBefore = longScene(26)
  const longAfter = longScene(26, '再补一段')
  await push('长对话', longBefore)
  await w.executeJavaScript(toTop)
  await settle()
  const topBefore = await w.executeJavaScript(scrollJS)
  await grab('13-发消息前')
  sendReply = longAfter
  await w.executeJavaScript(`(() => {
    const input = document.querySelector('#input')
    input.value = '再补一段'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    return true
  })()`)
  await sleep(400)
  await settle()
  const topAfter = await w.executeJavaScript(scrollJS)
  await grab('14-发消息后')
  checks.scroll = { before: topBefore, after: topAfter }
  sendReply = null

  // 用户自己往上翻着看：来了新内容不硬拽，右下角露「↓ 有新消息」
  await push('长对话-用户往上翻', longBefore)
  await w.executeJavaScript(toTop)
  await settle()
  const keptBefore = await w.executeJavaScript(scrollJS)
  await push('长对话-来了新内容', longAfter)
  await settle()
  const keptAfter = await w.executeJavaScript(scrollJS)
  const label = await w.executeJavaScript('document.querySelector("#latest").textContent')
  await grab('15-往上翻来新内容')
  checks.scrollKeep = { before: keptBefore, after: keptAfter, label }

  // 每种画面点一遍，收到的动作连同画面名记下来
  const clickChecks = {}
  for (const one of scenes) {
    const script = CLICKS[one.name]
    if (!script) continue
    await push(one.name, one.view)
    const back = await w.executeJavaScript(script)
    if (back && typeof back === 'object') Object.assign(clickChecks, back)
    await sleep(120)
  }

  // 第 6 条：不带 preload 的窗里点一遍、拖一遍，console 里 0 条 error
  const logs = []
  const bare = new BrowserWindow({ width: 484, height: 718, show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  bare.webContents.on('console-message', (_event, level, message) => { logs.push({ level, message }) })
  await bare.loadFile(join(root, 'app', 'task', 'task.html'))
  await bare.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await bare.webContents.executeJavaScript(NOBRIDGE)
  await sleep(250)
  checks.noPreload = { errors: logs.filter((one) => one.level === 3 || one.level === 'error' || /uncaught/i.test(one.message)).length, logs }
  bare.destroy()

  // 渲染进程崩了：页面自己回来，还是崩之前那个视图（10 秒内）
  const crashGuard = createReloadGuard()
  const crashes = []
  win.webContents.on('render-process-gone', (_event, details) => {
    const plan = crashGuard.gone({ reason: details.reason, exitCode: details.exitCode })
    crashes.push({ reason: details.reason, exitCode: details.exitCode, reload: plan.reload, count: plan.count })
    if (plan.reload) win.webContents.loadFile(join(root, 'app', 'task', 'task.html'))
  })
  const flowJS = '(() => { const items = document.querySelectorAll("#flow > div"); return { count: items.length, first: items[0] ? items[0].textContent : "" } })()'
  await push('崩之前', scene5())
  const before = await w.executeJavaScript(flowJS)
  const readyBefore = readyCount
  w.forcefullyCrashRenderer()
  let back = false
  for (let i = 0; i < 100 && !back; i += 1) {
    await sleep(100)
    if (readyCount > readyBefore) back = true
  }
  let after = null
  for (let i = 0; i < 50; i += 1) {
    try { after = await w.executeJavaScript(flowJS) } catch { after = null }
    if (after && after.count > 0) break
    await sleep(100)
  }
  checks.crash = { readyBefore, readyAfter: readyCount, back, before, after, crashes }

  writeFileSync(join(shots, 'acts.json'), JSON.stringify({ acts, checks: clickChecks, layout }, null, 2) + '\n')
  writeFileSync(join(shots, 'checks.json'), JSON.stringify(checks, null, 2) + '\n')
  await sleep(150)
  app.exit(0)
}

// 只在 Electron 里起窗；纯 node（npm test 把本文件当测试扫）下什么都不做，退出码 0
if (process.versions.electron) {
  app.whenReady().then(() => main().catch((error) => { console.error(error); app.exit(1) }))
}
