// 任务窗小签行的场景（被 window-main.mjs 调用，纯 node 下只 import 不炸）：
// 七份文件：收着的时候只摆前三个、后面收进「+N」；点开「+N」全部摆出来换行摆，最后一个是「收起」。
// 量：小签上没有范本那种记号、展开后七个签都看得见、「收起」在最后，
// 还有小签行上沿那条的高度（收着 46、展开两行 78 = 上下各 10 + 小签 26 + 行距 6）。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径，具名导入会在链接时就报错
import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'

const FOLDER = 'C:/Users/slow/Desktop/本周材料'
const TPL = FOLDER + '/上周周报.docx'
const MATS = ['材料-客服.xlsx', '材料-库存.csv', '材料-生产.docx', '材料-市场.pdf', '材料-销售.md', '材料-渠道.pptx'].map((n) => FOLDER + '/' + n)

// 量小签行上沿那条（#tagrow）：多高、摆了几行
const STRIP = `(() => {
  const row = document.querySelector('#tagrow')
  const list = document.querySelector('#tags')
  const kids = [...list.children]
  const rows = []
  for (const el of kids) {
    const r = el.getBoundingClientRect()
    const center = r.top + r.height / 2
    const hit = rows.find((one) => Math.abs(one - center) <= 2)
    if (hit === undefined) rows.push(center)
  }
  return {
    strip: Math.round(row.getBoundingClientRect().height),
    rows: rows.length,
    listH: Math.round(list.getBoundingClientRect().height),
  }
})()`

// 收着的时候量：第一个签、有没有记号，还有「+N」的提示
const COLLAPSED_METER = `(() => {
  const list = document.querySelector('#tags')
  const tag = list.querySelector('.tag')
  const more = list.querySelector('.more')
  if (!tag) return null
  const tr = tag.getBoundingClientRect()
  return {
    tags: [...list.querySelectorAll('.tag')].filter((el) => !el.classList.contains('more') && !el.classList.contains('collapse')).length,
    more: more ? more.textContent : '',
    moreTitle: more ? more.title : '',
    moreBox: more ? { w: Math.round(more.getBoundingClientRect().width), h: Math.round(more.getBoundingClientRect().height) } : null,
    moreTag: more ? more.tagName : '',
    moreTab: more ? more.tabIndex : -1,
    moreVisible: more ? (() => {
      const mr = more.getBoundingClientRect(), lr = list.getBoundingClientRect()
      return mr.right <= lr.right + 1 && mr.width > 0
    })() : false,
    tagH: Math.round(tr.height),
    flowH: Math.round(document.querySelector('#flowwrap').getBoundingClientRect().height),
    first: tag.querySelector('.nm') ? tag.querySelector('.nm').textContent : '',
    marks: list.querySelectorAll('.mark, .tag.template').length,
  }
})()`

// 展开的时候量：七个签都看得见、「收起」在最后
const EXPANDED_METER = `(() => {
  const list = document.querySelector('#tags')
  const all = [...list.children]
  const tags = all.filter((el) => !el.classList.contains('more') && !el.classList.contains('collapse'))
  const lr = list.getBoundingClientRect()
  const visible = tags.every((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1
  })
  const last = all[all.length - 1]
  return {
    count: tags.length,
    visible,
    names: tags.map((el) => (el.querySelector('.nm') ? el.querySelector('.nm').textContent : '')),
    lastClass: last ? last.className : '',
    lastText: last ? last.textContent : '',
    scroll: { h: list.scrollHeight, c: list.clientHeight },
    strip: Math.round(document.querySelector('#tagrow').getBoundingClientRect().height),
    flowH: Math.round(document.querySelector('#flowwrap').getBoundingClientRect().height),
  }
})()`

// 混排的行：往第一行里塞一个高 38 的签（贴的图那种），看这一行的小签中线是不是重合
const MIXED_METER = `(() => {
  const list = document.querySelector('#tags')
  const before = [...list.children]
  const tall = document.createElement('button')
  tall.type = 'button'
  tall.className = 'tag image'
  const nm = document.createElement('span')
  nm.className = 'nm'
  nm.textContent = '贴的图-1.png'
  tall.append(nm)
  list.insertBefore(tall, before[1])
  const first = [...list.children].slice(0, 2)
  const centers = first.map((el) => {
    const r = el.getBoundingClientRect()
    return Math.round(r.top + r.height / 2)
  })
  const heights = first.map((el) => Math.round(el.getBoundingClientRect().height))
  list.removeChild(tall)
  return { centers, heights }
})()`

export async function tagsScene({ w, show, settle, opts }) {
  let state = createTask()
  state = reduceTask(state, { type: 'drop', files: [TPL] }).state
  state = reduceTask(state, { type: 'drop', files: MATS }).state
  const view = toTaskView(state, opts)
  w.send('task:view', view)
  await settle()
  const checks = {}
  checks.collapsed = await w.executeJavaScript(COLLAPSED_METER)
  checks.strip = await w.executeJavaScript(STRIP)
  await show('21-小签收着', view)
  // 键盘能开：「+N」Tab 得到、回车按得动（真按键盘，不是点）
  await w.executeJavaScript('document.querySelector("#tags .more").focus()')
  await w.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  await w.sendInputEvent({ type: 'char', keyCode: 'Enter' })
  await w.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await settle()
  checks.keyboard = await w.executeJavaScript('!!document.querySelector("#tags .collapse")')
  if (!checks.keyboard) {
    // 回车没触发就退回点一下（有些环境不发键盘事件）
    await w.executeJavaScript('document.querySelector("#tags .more") && document.querySelector("#tags .more").click()')
    await settle()
  }
  checks.expanded = await w.executeJavaScript(EXPANDED_METER)
  checks.stripExpanded = await w.executeJavaScript(STRIP)
  // 混排：贴的图 / 贴的长文字那种高 38 的签跟 26 的签摆一行，上沿要对齐（中心线重合）
  checks.mixed = await w.executeJavaScript(MIXED_METER)
  // 展开的时候也这么对齐：插一个高 38 的签进去，同一行里 26 和 38 的中线还是重合
  checks.mixedExpanded = await w.executeJavaScript(MIXED_METER)
  await show('22-小签展开', view)
  return checks
}
