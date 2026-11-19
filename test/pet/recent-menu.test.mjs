import assert from 'node:assert/strict'
import test from 'node:test'
import { petMenuTemplate } from '../../app/pet/menu.mjs'
import { recentMenuTemplate } from '../../app/task/recent-tasks.mjs'

test('宠右键最近的文件夹：文件夹和任务两组，中间分隔，最后全部任务', () => {
  const opened = []
  const menu = recentMenuTemplate(
    [{ dir: 'C:/材料', name: '材料' }],
    [{ dir: 'C:/桌伴/任务/2026-11-05-写周报', out: 'C:/桌伴/任务/2026-11-05-写周报', name: '11-05 写周报', mtime: 1 }],
    'C:/桌伴/任务',
    { openFolder: (path) => opened.push(['folder', path]), openTask: (path) => opened.push(['task', path]), openAll: (path) => opened.push(['all', path]) },
  )
  assert.equal(menu.label, '最近')
  assert.deepEqual(menu.submenu.map((one) => one.label || one.type), ['材料', 'separator', '11-05 写周报', 'separator', '全部任务'])
  menu.submenu[0].click()
  menu.submenu[2].click()
  menu.submenu[4].click()
  assert.deepEqual(opened, [
    ['folder', 'C:/材料'],
    ['task', 'C:/桌伴/任务/2026-11-05-写周报'],
    ['all', 'C:/桌伴/任务'],
  ])
})

test('宠右键最近的文件夹：两组都空只有灰的还没有；全部任务目录存在时仍可打开', () => {
  assert.deepEqual(recentMenuTemplate([], [], '').submenu, [{ label: '（空）', enabled: false }])
  const withAll = recentMenuTemplate([], [], 'C:/桌伴/任务')
  assert.deepEqual(withAll.submenu.map((one) => one.label || one.type), ['（空）', 'separator', '全部任务'])
  assert.equal(withAll.submenu[0].enabled, false)
})

// 右键菜单：新闻订阅最前，新任务、最近的文件夹跟在后面
test('整个右键菜单的 label 顺序：新闻订阅、新任务、最近、设置、置顶、分隔、退出', () => {
  const template = petMenuTemplate({
    recent: recentMenuTemplate([], [], ''),
    news: { label: '新闻订阅', submenu: [] },
    onTop: true,
  })
  assert.deepEqual(
    template.map((one) => one.label || one.type),
    ['新闻订阅', '新任务', '最近', '设置', '置顶', 'separator', '退出'],
  )
})
