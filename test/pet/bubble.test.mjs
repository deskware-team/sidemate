import assert from 'node:assert/strict'
import test from 'node:test'
import { bubbleOf, elapsedText } from '../../app/pet/bubble.mjs'
import { clearHeld, createState, reduce } from '../../app/pet/state.mjs'

test('待命：几句轮换（页面每次张开换一句），没有能点的；当前模型能看图才加「拖个图片试试？」', () => {
  const line = bubbleOf({ mode: 'idle' })
  assert.equal(line.text, '拖个文件试试？')
  assert.deepEqual(line.tips, ['拖个文件试试？', '点我试试？', '右键我试试？'])
  assert.deepEqual(line.actions, [])
  assert.deepEqual(bubbleOf({ mode: 'idle', sees: true }).tips, ['拖个文件试试？', '点我试试？', '右键我试试？', '拖个图片试试？'])
  assert.deepEqual(bubbleOf({ mode: 'idle', sees: false }).tips.includes('拖个图片试试？'), false)
})

test('有新新闻（红点亮着）：停上来冒的那行换成新闻那句', () => {
  const line = bubbleOf({ mode: 'idle', news: true })
  assert.equal(line.text, '新闻好了！')
  assert.deepEqual(line.actions, [])
  assert.equal(line.tips, undefined)
  // 做完了、要你看一眼这些保持状态也一律换成新闻那句：点一下开的是新闻
  assert.equal(bubbleOf({ mode: 'done', news: true }).text, '新闻好了！')
  assert.equal(bubbleOf({ mode: 'fail', news: true, message: '坏了' }).text, '新闻好了！')
})

test('干活中：只说执行中，不冒过程话；后面跟一句跑了多久', () => {
  assert.equal(bubbleOf({ mode: 'work', message: '在看材料 2/5' }).text, '执行中')
  assert.equal(bubbleOf({ mode: 'work' }).text, '执行中')
  assert.equal(bubbleOf({ mode: 'work', message: '看材料 2/5', elapsed: '1 分 20 秒' }).text, '执行中 · 1 分 20 秒')
  assert.equal(elapsedText(0), '0 秒')
  assert.equal(elapsedText(20000), '20 秒')
  assert.equal(elapsedText(80000), '1 分 20 秒')
  // 就算红点在等，也还是执行中那句（活干完才提醒）
  assert.equal(bubbleOf({ mode: 'work', news: true }).text, '执行中')
})

test('干活中在等重试：模型忙，N 秒后重试；倒数到 0 是重新连接中', () => {
  const now = 1_000_000
  assert.equal(bubbleOf({ mode: 'work', wait: now + 37_000, elapsed: '2 分' }, now).text, '模型忙，37 秒后重试')
  assert.equal(bubbleOf({ mode: 'work', wait: now - 1, elapsed: '2 分' }, now).text, '模型忙，重新连接中')
})

test('等重试时照错的种类说：断网说「模型连接中断」，服务出错说「模型服务出错」，跟任务窗那行一样', () => {
  const now = 1_000_000
  assert.equal(bubbleOf({ mode: 'work', wait: now + 37_000, waitKind: 'network' }, now).text, '模型连接中断，37 秒后重试')
  assert.equal(bubbleOf({ mode: 'work', wait: now + 37_000, waitKind: 'server' }, now).text, '模型服务出错，37 秒后重试')
  assert.equal(bubbleOf({ mode: 'work', wait: now + 37_000, waitKind: 'busy' }, now).text, '模型忙，37 秒后重试')
  assert.equal(bubbleOf({ mode: 'work', wait: now - 1, waitKind: 'network' }, now).text, '模型连接中断，重新连接中')
  // 小岛记着种类：任务窗那头的进度事件带过来
  let s = reduce(createState(), { type: 'progress', taskId: 't1', text: '', wait: now + 5_000, waitKind: 'network' }).state
  assert.equal(s.waitKind, 'network')
  assert.equal(bubbleOf(s, now).text, '模型连接中断，5 秒后重试')
  s = reduce(s, { type: 'progress', taskId: 't1', text: '' }).state
  assert.equal(s.wait, undefined)
  assert.equal(s.waitKind, undefined)
})

test('做完了的「打开」只认这一轮自己交出去的：这一轮没交文件就不给「打开」，不沿用上一个任务的', () => {
  let s = reduce(createState(), { type: 'end', taskId: 'a', status: 'done', path: 'C:\\桌伴\\任务\\a\\周报.docx' }).state
  assert.equal(s.artifact, 'C:\\桌伴\\任务\\a\\周报.docx')
  assert.deepEqual(bubbleOf(s).actions, [{ id: 'open', label: '打开文件夹' }])
  // 还没点开小岛，后台另一个纯聊天也做完了：说的是它，没文件就不给「打开」
  s = reduce(s, { type: 'end', taskId: 'b', status: 'done' }).state
  assert.equal(s.taskId, 'b')
  assert.equal(s.artifact, '')
  assert.deepEqual(bubbleOf(s).actions, [])
  // 点开过再来一个纯聊天：一样
  s = clearHeld(s)
  s = reduce(s, { type: 'progress', taskId: 'c', text: '' }).state
  s = reduce(s, { type: 'end', taskId: 'c', status: 'done' }).state
  assert.equal(s.artifact, '')
})

test('要你看一眼、做完了、没干成：定稿的几句，能点的照旧', () => {
  assert.equal(bubbleOf({ mode: 'look', message: '第三节要不要再短一点？' }).text, '需要关注！')
  const done = bubbleOf({ mode: 'done', artifact: '综述.docx' })
  assert.equal(done.text, '做完了！')
  assert.deepEqual(done.actions, [{ id: 'open', label: '打开文件夹' }])
  // 没有产出文件：「打开」不显示
  assert.deepEqual(bubbleOf({ mode: 'done' }).actions, [])
  const fail = bubbleOf({ mode: 'fail', message: 'DeepSeek 余额不够' })
  assert.equal(fail.text, '出错了！')
  assert.deepEqual(fail.actions, [{ id: 'settings', label: '去设置' }])
})

test('有任务在等确认：小岛冒的那一行是「等你确认」', () => {
  assert.equal(bubbleOf({ mode: 'confirm', message: '等你确认' }).text, '等你确认')
  assert.equal(bubbleOf({ mode: 'confirm' }).text, '等你确认')
})

test('小岛记着：在等重试的倒数、现在的模型看不看得了图（换状态不丢）', () => {
  let s = reduce(createState(), { type: 'sees', sees: true }).state
  assert.equal(s.mode, 'idle')
  assert.equal(s.sees, true)
  s = reduce(s, { type: 'progress', taskId: 't1', text: '', wait: 1234 }).state
  assert.equal(s.mode, 'work')
  assert.equal(s.wait, 1234)
  assert.equal(s.sees, true)
  // 重试起来了：不带 wait 的那一声，倒数就没了
  s = reduce(s, { type: 'progress', taskId: 't1', text: '' }).state
  assert.equal(s.wait, undefined)
  s = reduce(s, { type: 'end', taskId: 't1', status: 'done' }).state
  assert.equal(s.sees, true)
  assert.equal(clearHeld(s).sees, true)
  assert.equal(reduce(s, { type: 'end', taskId: 't1', status: 'cancelled' }).state.sees, true)
  // 换了个看不了图的模型：跟着变
  assert.equal(reduce(s, { type: 'sees', sees: false }).state.sees, false)
})

test('两个以上任务同时在跑：执行中 · N 个任务（一个的时候照旧说跑了多久）', () => {
  assert.equal(bubbleOf({ mode: 'work', running: 2, elapsed: '1 分 20 秒' }).text, '执行中 · 2 个任务')
  assert.equal(bubbleOf({ mode: 'work', running: 3, wait: Date.now() + 9_000 }).text, '执行中 · 3 个任务')
  assert.equal(bubbleOf({ mode: 'work', running: 1, elapsed: '20 秒' }).text, '执行中 · 20 秒')
  // 有一个做完了还没看：说的是它，不是还在跑的那几个
  assert.equal(bubbleOf({ mode: 'done', running: 2 }).text, '做完了！')
})

test('小岛说的是最近做完（没干成、在问你）的那个：别的任务的动静不顶掉它', () => {
  let s = reduce(createState(), { type: 'running', count: 2 }).state
  assert.equal(s.mode, 'work')
  assert.equal(s.running, 2)
  s = reduce(s, { type: 'progress', taskId: 'a', text: '' }).state
  s = reduce(s, { type: 'progress', taskId: 'b', text: '' }).state
  // a 在后台做完了：笑眼，b 接着干的动静不顶掉它
  const done = reduce(s, { type: 'end', taskId: 'a', status: 'done' })
  assert.equal(done.notify, true)
  s = done.state
  s = reduce(s, { type: 'running', count: 1 }).state
  for (const event of [
    { type: 'progress', taskId: 'b', text: '' },
    { type: 'usage', taskId: 'b' },
    { type: 'end', taskId: 'b', status: 'cancelled' },
    { type: 'running', count: 1 },
  ]) s = reduce(s, event).state
  assert.equal(s.mode, 'done')
  assert.equal(s.taskId, 'a')
  // b 也没干成：换成最近这个
  s = reduce(s, { type: 'error', taskId: 'b', message: '坏了' }).state
  assert.equal(s.mode, 'fail')
  assert.equal(s.taskId, 'b')
  // 点开小岛：还有在跑的就是干活中，没有就回待命
  assert.equal(clearHeld({ ...s, running: 1 }).mode, 'work')
  assert.equal(clearHeld({ ...s, running: 0 }).mode, 'idle')
  // 都停了：干活中回待命
  let w = reduce(createState(), { type: 'running', count: 1 }).state
  w = reduce(w, { type: 'running', count: 0 }).state
  assert.equal(w.mode, 'idle')
  assert.equal(w.running, 0)
  // 一个停下了、另一个还在跑：干活中
  let x = reduce(createState(), { type: 'running', count: 2 }).state
  x = reduce(x, { type: 'progress', taskId: 'c', text: '' }).state
  x = reduce(x, { type: 'end', taskId: 'c', status: 'cancelled' }).state
  assert.equal(x.mode, 'work')
})