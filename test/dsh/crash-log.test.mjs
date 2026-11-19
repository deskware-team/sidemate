// dsh 崩溃记录：写一份 JSON 到目录里，输出打码、对话只留编号和状态、只留最近 20 份；
// 连崩判定：最近 5 分钟里崩了 3 次就算连崩（停下报 Si301）。

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CRASH_LOOP_CODE,
  KEEP,
  LOOP_COUNT,
  LOOP_WINDOW_MS,
  TAIL_LINES,
  crashFileName,
  isCrashLoop,
  tailLines,
  writeCrashLog,
} from '../../app/dsh/crash-log.mjs'
import { maskSecrets } from '../../app/dsh/secrets.mjs'

const roots = []

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-crash-'))
  roots.push(root)
  return root
}

test('写一份崩溃记录：时间、退出码和信号、输出、对话、版本都在', () => {
  const dir = join(scratch(), 'crash')
  const path = writeCrashLog(dir, {
    time: Date.parse('2026-11-16T19:30:42.123Z'),
    exitCode: 3,
    signal: null,
    output: ['第一行', '第二行'],
    conversations: [{ id: 'c-1', state: 'running' }],
    appVersion: '0.3.0',
    dshVersion: '0.2.1-rc.5',
  })
  assert.ok(path, '应该写得出文件')
  assert.ok(existsSync(path))
  const one = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(one.exitCode, 3)
  assert.equal(one.signal, null)
  assert.deepEqual(one.output, ['第一行', '第二行'])
  assert.deepEqual(one.conversations, [{ id: 'c-1', state: 'running' }])
  assert.equal(one.appVersion, '0.3.0')
  assert.equal(one.dshVersion, '0.2.1-rc.5')
  assert.ok(one.time, '要记时间')
})

test('文件名带时间：crash-年月日-时分秒-毫秒.json', () => {
  const dir = scratch()
  const path = writeCrashLog(dir, { output: ['x'] })
  const name = path.slice(path.lastIndexOf('\\') + 1).replace(/^.*\//, '')
  assert.match(name, /^crash-\d{8}-\d{6}-\d{3}\.json$/)
  const when = new Date(2026, 10, 16, 19, 30, 42, 123) // 本地时间
  assert.equal(crashFileName(when.getTime()), 'crash-20261116-193042-123.json')
})

test('对话只记编号和状态：别的字段一律丢掉', () => {
  const dir = scratch()
  const path = writeCrashLog(dir, {
    conversations: [
      { id: 'c-9', state: 'running', title: '不该记的标题', files: ['a.txt'], text: '对话内容' },
      { id: 'c-10', state: 'idle', content: '也不该记' },
    ],
  })
  const one = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(one.conversations, [
    { id: 'c-9', state: 'running' },
    { id: 'c-10', state: 'idle' },
  ])
  assert.ok(!readFileSync(path, 'utf8').includes('不该记的标题'))
  assert.ok(!readFileSync(path, 'utf8').includes('对话内容'))
})

test('输出里的密钥打码：sk-…、Bearer …、长串字母数字都盖掉', () => {
  const dir = scratch()
  const path = writeCrashLog(dir, {
    output: [
      '用了 sk-abcdef1234567890 跑',
      'Authorization: Bearer abcdef1234567890ZZZZ',
      'api_key=sk-zzzzzzzzzzzzzzzz',
      '这一串很长 abcdefghijklmnopqrstuvwxyz0123456789 尾巴',
    ],
  })
  const text = readFileSync(path, 'utf8')
  assert.ok(!text.includes('sk-abcdef1234567890'), 'sk- 密钥不能进文件')
  assert.ok(!text.includes('abcdef1234567890ZZZZ'), 'Bearer 后面那串不能进文件')
  assert.ok(!text.includes('sk-zzzzzzzzzzzzzzzz'), 'api_key= 后面那串不能进文件')
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz0123456789'), '长串字母数字不能进文件')
  assert.ok(text.includes('***'), '打码后要留个记号')
})

test('打码函数自己也是盖掉的', () => {
  assert.equal(maskSecrets('sk-abcdef123456'), '***')
  assert.ok(!maskSecrets('Bearer abcdef123456').includes('abcdef123456'))
  assert.ok(!maskSecrets('key: abcdefghijklmnopqrstuvwxyz0123456789').includes('abcdefghijklmnopqrstuvwxyz0123456789'))
  assert.equal(maskSecrets('普通的一行话'), '普通的一行话')
})

test('输出只留最后 200 行', () => {
  const lines = []
  for (let i = 1; i <= 500; i += 1) lines.push(`第 ${i} 行`)
  const tail = tailLines(lines)
  assert.equal(tail.length, TAIL_LINES)
  assert.equal(tail[0], '第 301 行')
  assert.equal(tail[tail.length - 1], '第 500 行')

  const dir = scratch()
  const path = writeCrashLog(dir, { output: lines })
  const one = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(one.output.length, TAIL_LINES)
  assert.equal(one.output[0], '第 301 行')
})

test('输出给一整段文字也行：照样截到 200 行', () => {
  const text = Array.from({ length: 250 }, (_, i) => `行 ${i}`).join('\n')
  const tail = tailLines(text)
  assert.equal(tail.length, TAIL_LINES)
  assert.equal(tail[0], '行 50')
})

test('只留最近 20 份，多的删最旧的', () => {
  const dir = scratch()
  const base = Date.parse('2026-11-16T10:00:00.000Z')
  for (let i = 0; i < KEEP + 5; i += 1) {
    writeCrashLog(dir, { time: base + i * 1000, output: [`第 ${i} 份`] })
  }
  const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  assert.equal(names.length, KEEP)
  const oldest = JSON.parse(readFileSync(join(dir, names[0]), 'utf8'))
  assert.equal(oldest.output[0], `第 5 份`, '最旧的 5 份应该被删掉')
})

test('目录不存在就建；写失败不抛错', () => {
  const root = scratch()
  const dir = join(root, '还没有', 'crash')
  const path = writeCrashLog(dir, { output: ['x'] })
  assert.ok(path && existsSync(path))

  // 目录位置被一个文件占着：写不了也不许抛错
  const bad = join(root, '占位')
  writeFileSync(bad, 'x')
  assert.equal(writeCrashLog(join(bad, 'crash'), { output: ['x'] }), null)
  assert.equal(writeCrashLog('', { output: ['x'] }), null)
})

test('连崩判定：最近 5 分钟里崩 3 次算连崩', () => {
  const now = Date.parse('2026-11-16T19:30:00.000Z')
  assert.equal(isCrashLoop([now - 1000, now - 2000, now - 3000], { now }), true)
  assert.equal(isCrashLoop([now - 1000, now - 2000], { now }), false)
  // 第三次早于 5 分钟窗口：不算
  assert.equal(isCrashLoop([now - 1000, now - 2000, now - (LOOP_WINDOW_MS + 1000)], { now }), false)
  // 正好卡在 5 分钟那条线上：算在窗口里
  assert.equal(isCrashLoop([now - 1000, now - 2000, now - LOOP_WINDOW_MS], { now }), true)
  assert.equal(isCrashLoop([], { now }), false)
  assert.equal(LOOP_COUNT, 3)
  assert.equal(LOOP_WINDOW_MS, 5 * 60 * 1000)
  assert.equal(CRASH_LOOP_CODE, 'Si301')
})

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
