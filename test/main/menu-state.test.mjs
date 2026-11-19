// 右键菜单开着没有：开着时任务窗、小岛不往最前面提（不然会盖住菜单）。
// 「思考」二级菜单是挂在外面的另一层：按下去不能当成点了外面把菜单收掉。
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { menuOpen, trackMenu } from '../../app/main/menu-state.mjs'

test('菜单弹出到收起之间算开着；两个菜单叠着开也数得对', () => {
  const a = trackMenu(new EventEmitter())
  const b = trackMenu(new EventEmitter())
  assert.equal(menuOpen(), false)
  a.emit('menu-will-show')
  assert.equal(menuOpen(), true)
  b.emit('menu-will-show')
  a.emit('menu-will-close')
  assert.equal(menuOpen(), true, '还有一个开着')
  b.emit('menu-will-close')
  assert.equal(menuOpen(), false)
  b.emit('menu-will-close')
  assert.equal(menuOpen(), false, '多收一次不会变成负数')
  a.emit('menu-will-show')
  assert.equal(menuOpen(), true, '多收那一次没把计数弄乱')
  a.emit('menu-will-close')
  // 不是菜单的东西：原样还回去，不炸
  assert.equal(trackMenu(null), null)
})

test('任务窗、小岛往前提之前先看菜单开没开；小岛菜单和编辑菜单都登记', () => {
  const task = readFileSync(new URL('../../app/task/shell.mjs', import.meta.url), 'utf8')
  assert.match(task, /function keepAbove\(\) \{[\s\S]*?if \(menuOpen\(\)\) return/)
  assert.match(task, /function raiseAbove\(\) \{\s*if \(!win \|\| win\.isDestroyed\(\) \|\| menuOpen\(\)\) return false/)
  const pet = readFileSync(new URL('../../app/pet/shell.mjs', import.meta.url), 'utf8')
  assert.match(pet, /trackMenu\(Menu\.buildFromTemplate\(petMenuTemplate\(/)
  assert.match(pet, /raiseWindow: \(\) => \{ if \(!menuOpen\(\)\) pet\.moveTop\(\) \}/)
  const edit = readFileSync(new URL('../../app/main/edit-menu.mjs', import.meta.url), 'utf8')
  assert.match(edit, /trackMenu\(api\.Menu\.buildFromTemplate\(menu\)\)/)
})

test('换模型菜单：按在「思考」二级菜单上不算点外面', () => {
  const page = readFileSync(new URL('../../app/task/task.js', import.meta.url), 'utf8')
  assert.match(page, /modelsMenu\.sub\.contains\(event\.target\)/)
})
