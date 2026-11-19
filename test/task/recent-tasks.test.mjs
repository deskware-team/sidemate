import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recentTasks } from '../../app/task/recent-tasks.mjs'

// 一个任务文件夹：tasks\ 下 14 位数字，成品在任务文件夹根目录，.sidemate\conversation.json 里是那条对话
function task(root, name, title) {
  const dir = join(root, 'tasks', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '产出.docx'), 'x')
  if (title) {
    mkdirSync(join(dir, '.sidemate'), { recursive: true })
    writeFileSync(join(dir, '.sidemate', 'conversation.json'), JSON.stringify({ title }), 'utf8')
  }
  return { dir, out: dir }
}

test('只列有成品的任务文件夹：三个任务按修改时间排序、名字是「日期 标题」', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-recent-'))
  const output = (dir, file = '产出.docx') => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, file), 'x')
    return dir
  }
  const made = [
    task(root, '20261103000000', '旧任务'),
    task(root, '20261105000000', '总结这些形成文献综述'),
    task(root, '20261104000000', '中间任务'),
  ]
  const dirs = made.map((one) => one.dir)
  const outs = made.map((one) => one.out)
  mkdirSync(join(root, 'tasks', '20261102000000'), { recursive: true })
  mkdirSync(join(root, 'tasks', '20261101000000'), { recursive: true })
  const times = [3, 5, 4]
  outs.forEach((out, i) => utimesSync(out, times[i], times[i]))

  const found = recentTasks(root)
  assert.equal(found.length, 3)
  assert.deepEqual(found.map((one) => one.name), [
    '11-05 总结这些形成文献综述',
    '11-04 中间任务',
    '11-03 旧任务',
  ])
  assert.deepEqual(found[0], { dir: dirs[1], out: outs[1], name: '11-05 总结这些形成文献综述', mtime: statSync(outs[1]).mtimeMs })
  assert.ok(found.every((one) => one.mtime > 0))
  assert.deepEqual(recentTasks(join(root, '不存在')), [])
})

test('文件夹名是 14 位数字（20261115121805）：菜单里写「11-15 标题」', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-recent-time-'))
  const made = task(root, '20261115121805', '总结一下这个文件')
  assert.equal(made.dir.endsWith('20261115121805'), true)
  assert.deepEqual(recentTasks(root).map((one) => one.name), ['11-15 总结一下这个文件'])
})

test('任务根目录不存在就为空；单个任务读不了会跳过', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-recent-empty-'))
  assert.deepEqual(recentTasks(root), [])
  mkdirSync(join(root, 'tasks'), { recursive: true })
  const real = { readdirSync, statSync }
  const broken = {
    ...real,
    readdirSync: (dir, options) => {
      if (String(dir).includes('坏任务')) throw new Error('读不了')
      return readdirSync(dir, options)
    },
  }
  for (const name of ['20261105000000-好任务', '20261104000000-坏任务']) {
    const dir = join(root, 'tasks', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.docx'), 'x')
  }
  assert.deepEqual(recentTasks(root, broken).map((one) => one.name), ['20261105000000-好任务'])
})
