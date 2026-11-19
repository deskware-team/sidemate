import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CATCHUP_MS,
  createScheduler,
  dueRuns,
  missedRuns,
} from '../../app/news/schedule.mjs'
import { markMissed } from '../../app/news/missed.mjs'

const HOUR = 60 * 60 * 1000

// 固定在一个本地时刻上，避免测试跟着时区跑偏。
function at(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

const BASE = at(2026, 3, 10, 9, 0)

function clock(start = BASE) {
  let current = start
  return {
    now: () => current,
    advance(ms) {
      current += ms
    },
    set(ms) {
      current = ms
    },
  }
}

function tempFile(name = 'news-schedule.json') {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-news-'))
  return { dir, file: join(dir, name) }
}

function topic(id, atText, extra = {}) {
  return { id, name: `主题 ${id}`, at: atText, enabled: true, ...extra }
}

test('a topic that never ran is due once its time passed today', () => {
  const now = at(2026, 3, 10, 9, 0)
  const due = dueRuns([topic('a', '08:00')], {}, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].topicId, 'a')
  assert.equal(due[0].dueAt, at(2026, 3, 10, 8, 0))
  assert.equal(due[0].date, '2026-03-10')
  // 迟到一个小时：算错过
  assert.equal(due[0].late, true)
})

test('a topic that ran on time is not due again today', () => {
  const now = at(2026, 3, 10, 9, 0)
  const lastRuns = { a: at(2026, 3, 10, 8, 0) }
  assert.deepEqual(dueRuns([topic('a', '08:00')], lastRuns, now), [])
})

test('a topic whose time is still ahead is not due', () => {
  const now = at(2026, 3, 10, 7, 0)
  assert.deepEqual(dueRuns([topic('a', '08:00')], {}, now), [])
  assert.deepEqual(dueRuns([topic('a', '08:00')], { a: at(2026, 3, 9, 8, 0) }, now), [])
})

test('late by less than ten minutes still runs', () => {
  const now = at(2026, 3, 10, 8, 5)
  const due = dueRuns([topic('a', '08:00')], {}, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].late, false)
})

test('a topic missed overnight is due and marked late', () => {
  const now = at(2026, 3, 10, 7, 0)
  const lastRuns = { a: at(2026, 3, 9, 7, 0) }
  const due = dueRuns([topic('a', '08:00')], lastRuns, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 9, 8, 0))
  assert.equal(due[0].date, '2026-03-09')
  assert.equal(due[0].late, true)
})

test('a brand new topic does not backfill earlier days', () => {
  const now = at(2026, 3, 10, 9, 0)
  const due = dueRuns([topic('new', '08:00')], {}, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 10, 8, 0))
})

test('a disabled topic is never due', () => {
  const now = at(2026, 3, 10, 9, 0)
  const disabled = topic('a', '08:00', { enabled: false })
  assert.deepEqual(dueRuns([disabled], {}, now), [])
})

test('due topics are ordered from early to late', () => {
  const now = at(2026, 3, 10, 9, 0)
  const due = dueRuns([topic('late', '08:50'), topic('early', '08:10')], {}, now)
  assert.deepEqual(due.map((item) => item.topicId), ['early', 'late'])
})

test('the times cross midnight', () => {
  const now = at(2026, 3, 10, 23, 45)
  const late = topic('late', '23:30')
  const due = dueRuns([late], {}, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 10, 23, 30))

  const early = at(2026, 3, 11, 0, 15)
  assert.deepEqual(dueRuns([topic('early', '00:30')], {}, early), [])
})

// ————————————————————————— 错过的那些天 —————————————————————————

test('missed runs: the days between the last run and now are recorded', () => {
  const now = at(2026, 3, 10, 9, 0)
  // 上次跑的是三天前
  const missed = missedRuns([topic('a', '08:00')], { a: at(2026, 3, 7, 8, 5) }, now)
  assert.deepEqual(missed.map((one) => one.date), ['2026-03-08', '2026-03-09', '2026-03-10'])
})

test('missed runs: the last ten minutes are not missed, they still run', () => {
  const now = at(2026, 3, 10, 8, 5)
  const missed = missedRuns([topic('a', '08:00')], { a: at(2026, 3, 9, 7, 55) }, now)
  assert.deepEqual(missed.map((one) => one.date), ['2026-03-09'])
})

test('missed runs: a topic that never ran has no missed days', () => {
  const now = at(2026, 3, 10, 9, 0)
  assert.deepEqual(missedRuns([topic('a', '08:00')], {}, now), [])
})

test('missed runs: at most seven days back', () => {
  const now = at(2026, 3, 20, 9, 0)
  // 上次跑的是二十天前：只有最近七天算错过
  const missed = missedRuns([topic('a', '08:00')], { a: at(2026, 3, 1, 8, 5) }, now)
  assert.deepEqual(missed.map((one) => one.date), [
    '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
  ])
})

test('missed runs: days already recorded are not recorded again', () => {
  const now = at(2026, 3, 10, 9, 0)
  const missed = missedRuns([topic('a', '08:00')], { a: at(2026, 3, 7, 8, 5) }, now, { a: ['2026-03-09'] })
  assert.deepEqual(missed.map((one) => one.date), ['2026-03-08', '2026-03-10'])
})

test('missed runs: known is per topic, one topic recorded does not silence another', () => {
  const now = at(2026, 3, 10, 9, 0)
  const topics = [topic('a', '08:00'), topic('b', '08:00')]
  const missed = missedRuns(topics, { a: at(2026, 3, 7, 8, 5), b: at(2026, 3, 7, 8, 5) }, now, { a: ['2026-03-09'] })
  const byTopic = (id) => missed.filter((one) => one.topicId === id).map((one) => one.date)
  assert.deepEqual(byTopic('a'), ['2026-03-08', '2026-03-10'])
  assert.deepEqual(byTopic('b'), ['2026-03-08', '2026-03-09', '2026-03-10'])
})

test('missed runs: a disabled topic is never missed', () => {
  const now = at(2026, 3, 10, 9, 0)
  const off = topic('a', '08:00', { enabled: false })
  assert.deepEqual(missedRuns([off], { a: at(2026, 3, 7, 8, 5) }, now), [])
})

// ————————————————————————— 后台 —————————————————————————

test('only the first due topic runs in one tick', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock()
    const ran = []
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async (id) => ran.push(id),
      topics: [topic('late', '08:55'), topic('early', '08:52')],
    })
    assert.equal(await scheduler.tick(), 'ran')
    assert.equal(ran.length, 1)
    assert.equal(ran[0], 'early')
    assert.equal(scheduler.lastRuns().early, BASE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second tick while one runs says busy', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock()
    let release = null
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async () => {
        await gate
      },
      topics: [topic('a', '08:55')],
    })
    const first = scheduler.tick()
    assert.equal(await scheduler.tick(), 'busy')
    release()
    assert.equal(await first, 'ran')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failure counts as run for today: no automatic retry', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock()
    let attempts = 0
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async () => {
        attempts += 1
        throw new Error('生成失败')
      },
      topics: [topic('a', '08:55')],
    })
    assert.equal(await scheduler.tick(), 'failed')
    assert.equal(attempts, 1)
    // 失败也记「跑过」：当天不再自己重跑
    assert.notDeepEqual(scheduler.lastRuns(), {})
    assert.equal(await scheduler.tick(), 'idle')
    assert.equal(attempts, 1)
    time.advance(HOUR + 1000)
    assert.equal(await scheduler.tick(), 'idle')
    assert.equal(attempts, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a topic added after its time today is not marked missed: it starts from the next time', async () => {
  const { dir, file } = tempFile()
  try {
    const root = join(dir, 'news')
    const ran = []
    // 晚上 7 点加了一个早上 8 点的主题
    const time = clock(at(2026, 3, 10, 19, 0))
    const scheduler = createScheduler({
      file,
      root,
      now: time.now,
      run: async (id) => { ran.push(id) },
      topics: [topic('a', '08:00')],
    })
    assert.equal(await scheduler.tick(), 'idle')
    assert.deepEqual(ran, [], '早过了的那一次不补跑')
    assert.deepEqual(scheduler.missed(), {}, '主题那会儿还不在，不算错过')
    // 第二天 8 点照常跑
    time.set(at(2026, 3, 11, 8, 0))
    assert.equal(await scheduler.tick(), 'ran')
    assert.deepEqual(ran, ['a'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an idle scheduler says idle', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 7, 0))
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async () => {},
      topics: [topic('a', '08:00')],
    })
    assert.equal(await scheduler.tick(), 'idle')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a broken file counts as empty', async () => {
  const { dir, file } = tempFile()
  try {
    writeFileSync(file, 'not json at all', 'utf8')
    const time = clock()
    const ran = []
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async (id) => ran.push(id),
      topics: [topic('a', '08:55')],
    })
    assert.deepEqual(scheduler.lastRuns(), {})
    assert.equal(await scheduler.tick(), 'ran')
    assert.deepEqual(ran, ['a'])
    assert.equal(scheduler.lastRuns().a, BASE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the last runs are written to disk and read back', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock()
    const scheduler = createScheduler({
      file,
      now: time.now,
      run: async () => {},
      topics: [topic('a', '08:55')],
    })
    await scheduler.tick()
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.version, 1)
    assert.equal(saved.lastRuns.a, BASE)
    const other = createScheduler({
      file,
      now: time.now,
      run: async () => {},
      topics: [topic('a', '08:55')],
    })
    assert.equal(other.lastRuns().a, BASE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the catch-up window is ten minutes', () => {
  assert.equal(CATCHUP_MS, 10 * 60 * 1000)
})

// ————————————————————————— 错过的不补跑 —————————————————————————

test('late by more than ten minutes: it does not run, it is recorded as missed', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 9, 0))
    const ran = []
    const scheduler = createScheduler({
      file,
      now: time.now,
      root: dir,
      run: async (id) => ran.push(id),
      topics: [topic('a', '08:00')],
    })
    // 昨天 8 点照常跑过；今天 8 点桌伴没开着，9 点才起来
    scheduler.markRan('a', at(2026, 3, 9, 8, 0))
    assert.equal(await scheduler.tick(), 'missed')
    assert.deepEqual(ran, [], '没跑')
    assert.deepEqual(scheduler.missed().a, ['2026-03-10'])
    // 记号往前推了：下一轮不再重复记
    assert.equal(await scheduler.tick(), 'idle')
    assert.deepEqual(scheduler.missed().a, ['2026-03-10'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('late by less than ten minutes: it runs', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 8, 5))
    const ran = []
    const scheduler = createScheduler({
      file,
      now: time.now,
      root: dir,
      run: async (id) => ran.push(id),
      topics: [topic('a', '08:00')],
    })
    assert.equal(await scheduler.tick(), 'ran')
    assert.deepEqual(ran, ['a'])
    assert.deepEqual(scheduler.missed(), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the days missed while the app was closed are recorded on the first tick', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 9, 0))
    const ran = []
    const scheduler = createScheduler({
      file,
      now: time.now,
      root: dir,
      run: async (id) => ran.push(id),
      topics: [topic('a', '08:00')],
    })
    // 上次跑是三天前：那天之后该跑的几次都错过了
    scheduler.markRan('a', at(2026, 3, 7, 8, 5))
    assert.equal(await scheduler.tick(), 'missed')
    assert.deepEqual(ran, [], '错过的不补跑')
    assert.deepEqual(scheduler.missed().a, ['2026-03-10', '2026-03-09', '2026-03-08'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two topics missed on the same day: both are recorded', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 9, 0))
    const scheduler = createScheduler({
      file,
      now: time.now,
      root: dir,
      run: async () => {},
      topics: [topic('a', '08:00'), topic('b', '08:00')],
    })
    scheduler.markRan('a', at(2026, 3, 7, 8, 5))
    scheduler.markRan('b', at(2026, 3, 7, 8, 5))
    await scheduler.tick()
    const missed = scheduler.missed()
    assert.ok(missed.a.includes('2026-03-10'), '主题 a 记下了')
    assert.ok(missed.b.includes('2026-03-10'), '主题 b 也记下了')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('one topic recorded a day does not stop another topic recording it', async () => {
  const { dir, file } = tempFile()
  try {
    const time = clock(at(2026, 3, 10, 9, 0))
    const scheduler = createScheduler({
      file,
      now: time.now,
      root: dir,
      run: async () => {},
      topics: [topic('a', '08:00'), topic('b', '08:00')],
    })
    scheduler.markRan('a', at(2026, 3, 7, 8, 5))
    scheduler.markRan('b', at(2026, 3, 7, 8, 5))
    // 主题 a 已经记过 3-09
    markMissed(dir, { id: 'a' }, '2026-03-09')
    await scheduler.tick()
    const missed = scheduler.missed()
    assert.deepEqual(missed.a, ['2026-03-10', '2026-03-09', '2026-03-08'])
    assert.ok(missed.b.includes('2026-03-09'), '主题 b 自己记下了 3-09')
    assert.ok(missed.b.includes('2026-03-10'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ————————————————————————— 隔几天跑一次 —————————————————————————

test('工作日的主题：周六到点不跑', () => {
  const now = at(2026, 3, 14, 10, 0)
  const target = topic('a', '09:00', { days: 'weekdays' })
  assert.equal(dueRuns([target], {}, now).length, 0)
})

test('工作日的主题：周一还没到点也不跑', () => {
  const now = at(2026, 3, 16, 8, 0)
  const target = topic('a', '09:00', { days: 'weekdays' })
  assert.equal(dueRuns([target], {}, now).length, 0)
})

test('工作日的主题：周一早上不补周五那一次', () => {
  const now = at(2026, 3, 16, 8, 0)
  const target = topic('a', '09:00', { days: 'weekdays' })
  // 上次跑的是周四，周五那次没跑：周一早上只说周五那次错过了
  const due = dueRuns([target], { a: at(2026, 3, 12, 9, 0) }, now)
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 13, 9, 0))
  assert.equal(due[0].date, '2026-03-13')
  assert.equal(due[0].late, true)
})

test('工作日的主题：周五跑过了，周一早上不再补', () => {
  const now = at(2026, 3, 16, 8, 0)
  const target = topic('a', '09:00', { days: 'weekdays' })
  const due = dueRuns([target], { a: at(2026, 3, 13, 9, 0) }, now)
  assert.equal(due.length, 0)
})

test('每周一的主题：只有周一跑', () => {
  const target = topic('a', '09:00', { days: 'monday' })
  // 周三到点不跑。
  assert.equal(dueRuns([target], {}, at(2026, 3, 11, 10, 0)).length, 0)
  // 周一到点跑。
  const due = dueRuns([target], {}, at(2026, 3, 16, 10, 0))
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 16, 9, 0))
})

test('每天的主题：周末照跑', () => {
  const target = topic('a', '09:00')
  const due = dueRuns([target], {}, at(2026, 3, 14, 10, 0))
  assert.equal(due.length, 1)
  assert.equal(due[0].dueAt, at(2026, 3, 14, 9, 0))
})
