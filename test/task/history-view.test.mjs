// 历史界面这头的纯逻辑：下拉列哪几条、当前那一条、整页的行、筛选参数和空状态。

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DROPDOWN_MAX,
  dropdownGroups,
  emptyText,
  groupByDay,
  listParams,
  openFailedText,
  pageGroups,
  timeLabel,
} from '../../app/task/history-view.mjs'

// 2026 年 11 月 11 日中午 12 点
const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime()
const at = (daysAgo, h, m) => {
  const d = new Date(2026, 10, 11, 12, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// 一条列表摘要（history.list 给的那种形状）
const item = (id, over = {}) => ({
  id,
  title: `对话 ${id}`,
  folder: `C:/桌伴/任务/${id}`,
  folderName: `夹 ${id}`,
  kind: 'task',
  updatedAt: at(0, 10, 24),
  fileCount: 0,
  count: 2,
  ...over,
})

test('groupByDay 和 timeLabel 搬过来还是那个行为', () => {
  const groups = groupByDay([
    item('b', { updatedAt: at(0, 10, 0) }),
    item('a', { updatedAt: at(0, 9, 0) }),
    item('c', { updatedAt: at(1, 10, 0) }),
  ], NOW)
  assert.deepEqual(groups.map((g) => g.label), ['今天', '昨天'])
  assert.deepEqual(groups[0].items.map((one) => one.id), ['b', 'a'], '组内从新到旧')

  assert.equal(timeLabel(at(0, 9, 5), NOW), '09:05')
  assert.equal(timeLabel(at(1, 9, 5), NOW), '11-10 09:05')
  assert.equal(timeLabel(new Date(2025, 9, 20, 9, 5, 0).getTime(), NOW), '10-20 09:05')
})

test('下拉：最新最多 8 条，按天分组，每行带时间，当前那条有记号', () => {
  const items = []
  for (let i = 0; i < 6; i += 1) items.push(item(`n${i}`, { updatedAt: at(0, 11, i) }))
  for (let i = 0; i < 3; i += 1) items.push(item(`y${i}`, { updatedAt: at(1, 10 - i, 30) }))
  items.push(item('更早的', { updatedAt: at(3, 9, 0) }))

  const groups = dropdownGroups(items, 'y1', NOW)
  const rows = groups.flatMap((g) => g.rows)
  assert.equal(rows.length, DROPDOWN_MAX, '最多列 8 条')
  assert.equal(rows[0].id, 'n5', '从最新的排起')
  assert.deepEqual(groups.map((g) => g.label), ['今天', '昨天'])
  assert.equal(rows.some((r) => r.id === '更早的'), false, '并不到更早的')
  assert.deepEqual(rows.map((r) => r.now), rows.map((r) => r.id === 'y1'), '只有当前那条带记号')
  assert.equal(rows[0].time, '11:05', '今天的只写时分')
  assert.equal(groups[1].rows[0].time, '11-10 10:30', '别的写日期和时间')
})

test('下拉：乱七八糟的输入也不炸，空的就是没有组', () => {
  assert.deepEqual(dropdownGroups(null, '', NOW), [])
  assert.deepEqual(dropdownGroups([null, {}, { id: 'x' }], 'x', NOW), [], '没时间的成不了组')
  assert.deepEqual(dropdownGroups([{ id: 'x', updatedAt: at(0, 9, 0) }], 'x', NOW).flatMap((g) => g.rows.map((r) => r.id)), ['x'])
})

test('整页的行：任务右边写文件夹和时间两截（不用「·」连），新闻订阅写「N 条」', () => {
  const groups = pageGroups([
    item('a', { updatedAt: at(0, 10, 24), folderName: '项目资料' }),
    item('b', { kind: 'news', count: 6, updatedAt: at(0, 10, 24), title: '11-11 的新闻' }),
    item('c', { updatedAt: at(1, 16, 40), folderName: '' }),
  ], NOW)
  assert.deepEqual(groups.map((g) => g.label), ['今天', '昨天'])
  const [news, task, bare] = [groups[0].rows[1], groups[0].rows[0], groups[1].rows[0]]
  assert.deepEqual(task.meta, ['项目资料', '10:24'], '任务的右边是文件夹、时间两截')
  assert.deepEqual(news.meta, ['6 条'], '新闻订阅的右边是条数')
  assert.deepEqual(bare.meta, ['11-10 16:40'], '没记文件夹名的只写时间')
})

test('新闻订阅数不出条数时写时间，不写消息条数', () => {
  const groups = pageGroups([
    item('n1', { kind: 'news', count: null, updatedAt: at(0, 10, 24) }),
    item('n2', { kind: 'news', count: undefined, updatedAt: at(1, 9, 5) }),
    item('n3', { kind: 'news', count: 0, updatedAt: at(2, 8, 0) }),
    item('n4', { kind: 'news', count: 5, updatedAt: at(0, 7, 0) }),
  ], NOW)
  const rows = groups.flatMap((g) => g.rows)
  assert.deepEqual(rows.find((r) => r.id === 'n1').meta, ['10:24'], '数不出来写时间')
  assert.deepEqual(rows.find((r) => r.id === 'n2').meta, ['11-10 09:05'], '没有条数写时间')
  assert.deepEqual(rows.find((r) => r.id === 'n3').meta, ['11-09 08:00'], '零条也写时间')
  assert.deepEqual(rows.find((r) => r.id === 'n4').meta, ['5 条'], '数得出写条数')
})

test('筛选参数：输入框的尾巴去掉，不认的类型都当不限', () => {
  assert.deepEqual(listParams({ query: '  周报 ', kind: 'task' }), { query: '周报', kind: 'task' })
  assert.deepEqual(listParams({ query: '', kind: 'news' }), { query: '', kind: 'news' })
  assert.deepEqual(listParams({ query: '', kind: '全部' }), { query: '', kind: null })
  assert.deepEqual(listParams(), { query: '', kind: null })
})

test('空状态：筛新闻订阅空着是一句，其余无结果是一句', () => {
  assert.equal(emptyText({ kind: 'news' }), '无新闻订阅')
  assert.equal(emptyText({ kind: 'news', query: '周报' }), '无结果', '搜了没中还是无结果')
  assert.equal(emptyText({ kind: 'task' }), '无结果')
  assert.equal(emptyText({}), '无结果')
})

test('打不开一条对话：对方说了原因就用它的，没说就说带 Si902 码的那句', () => {
  assert.equal(openFailedText('没装成：出了点问题。'), '没装成：出了点问题。')
  assert.equal(openFailedText(''), '对话打开失败 · Si902 错误')
  assert.equal(openFailedText(null), '对话打开失败 · Si902 错误')
})
