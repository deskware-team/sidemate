// 桌伴起来时收拾 LocalLow\桌伴\temp：
// 只删每轮 dsh 留下的那几种、整个条目放了一天以上的；dsh-acl-locks 这种共用的一律不碰；
// 收拾完之前起的 dsh 先等着。
// 路径照真的样子带「桌伴」两个字：随包 / 系统 node 24.13.0 的 fs.rmSync 碰上中文路径会静默删不掉，这里要真删掉才算过。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after, describe } from 'node:test'
import { payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { STALE_MS, isLeftover, newestMtime, startSweep, sweepPending, sweepTemp } from '../../app/dsh/temp-sweep.mjs'
import { startFake } from './fake-messages.mjs'

const roots = []
const NOW = Date.now()
const OLD = new Date(NOW - STALE_MS - 60_000)
const FRESH = new Date(NOW - 60_000)
const KEY = 'sidemate-sweep-key'
const layout = payloadLayout()

function scratch(prefix = 'sidemate-sweep-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function tempDir() {
  const dir = join(scratch(), 'LocalLow', '桌伴', 'temp')
  mkdirSync(dir, { recursive: true })
  return dir
}

// 建一个文件，连同它往上到 top 的每一层目录都改成 when（往里写会刷新目录的时间，所以最后统一改）
function file(top, rel, when) {
  const path = join(top, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '1')
  for (let cur = path; cur.length >= top.length; cur = dirname(cur)) utimesSync(cur, when, when)
}

function age(top, rel, when) {
  utimesSync(join(top, rel), when, when)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 可以手动放行的「收拾」：测「收拾完之前起的 dsh 先等着」
function slowSweep() {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const run = startSweep({}, () => gate)
  return { release: () => { release({ removed: [] }); return run }, run }
}

function launchOptions(extra) {
  return {
    taskId: 'sweep-gate',
    workspace: scratch('sidemate-sweep-ws-'),
    lowRoot: scratch('sidemate-sweep-low-'),
    apiKey: KEY,
    prompt: '说一声好了',
    node: process.execPath,
    ...extra,
  }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('收拾 dsh 的临时目录', { concurrency: 1 }, () => {
  test('认得的只有每轮 dsh 留下的那几种和自己的重试播报', () => {
    for (const name of ['dsh-subprocess-QHJO1a', 'dsh-spill-mcwIwS', 'dsh-acl-skill-1qWNLt', 'dsh-GoOvzt', 'dsh-E3WL9N', 'retry-run-1.log']) {
      assert.equal(isLeftover(name), true, name)
    }
    for (const name of ['dsh-acl-locks', 'dsh-caches', 'dsh-workspace-changes-Ab12Cd', 'libreoffice-kit-Ab12Cd', 'tmp1234.txt', 'retry-run-1.txt']) {
      assert.equal(isLeftover(name), false, name)
    }
  })

  test('放了一天以上的那几种删掉（连里面带中文名的），刚起的、不认得的留着', async () => {
    const dir = tempDir()
    file(dir, 'dsh-acl-skill-AbC123/SKILL.md', OLD)
    file(dir, 'dsh-x7Yz9Q/子目录/周报草稿.txt', OLD)
    file(dir, 'dsh-subprocess-QHJO1a/stdout.log', OLD)
    file(dir, 'retry-task-1.log', OLD)
    file(dir, 'dsh-spill-NewOne/out.log', FRESH)
    file(dir, 'retry-task-2.log', FRESH)
    file(dir, 'libreoffice-kit-Ab12Cd/a.tmp', OLD)
    file(dir, '模型脚本的临时文件.txt', OLD)

    const out = await sweepTemp({ dir, now: NOW })

    assert.deepEqual(out.removed.sort(), ['dsh-acl-skill-AbC123', 'dsh-subprocess-QHJO1a', 'dsh-x7Yz9Q', 'retry-task-1.log'])
    assert.deepEqual(out.kept.sort(), ['dsh-spill-NewOne', 'retry-task-2.log'])
    assert.deepEqual(out.skipped.sort(), ['libreoffice-kit-Ab12Cd', '模型脚本的临时文件.txt'])
    assert.deepEqual(out.failed, [])
    assert.deepEqual(readdirSync(dir).sort(), ['dsh-spill-NewOne', 'libreoffice-kit-Ab12Cd', 'retry-task-2.log', '模型脚本的临时文件.txt'])
  })

  test('dsh-acl-locks 再旧也不碰：几个 dsh 共用的锁', async () => {
    const dir = tempDir()
    file(dir, 'dsh-acl-locks/0123456789abcdef.lock', OLD)
    const out = await sweepTemp({ dir, now: NOW + 365 * STALE_MS })
    assert.deepEqual(out.removed, [])
    assert.deepEqual(out.skipped, ['dsh-acl-locks'])
    assert.equal(existsSync(join(dir, 'dsh-acl-locks', '0123456789abcdef.lock')), true)
  })

  test('新旧看里面最新的那个：目录自己旧、深处有个刚写的文件，留着', async () => {
    const dir = tempDir()
    file(dir, 'dsh-spill-Deep01/a/b/c/out.log', OLD)
    age(dir, 'dsh-spill-Deep01/a/b/c/out.log', FRESH)
    assert.ok((await newestMtime(join(dir, 'dsh-spill-Deep01'))) >= FRESH.getTime() - 1000)
    const out = await sweepTemp({ dir, now: NOW })
    assert.deepEqual(out.kept, ['dsh-spill-Deep01'])
    assert.equal(existsSync(join(dir, 'dsh-spill-Deep01', 'a', 'b', 'c', 'out.log')), true)
  })

  test('走不完（太深、太多）就当它还新，留着', async () => {
    const dir = tempDir()
    file(dir, 'dsh-spill-TooDp1/1/2/3/4/5/6/7/8/x.log', OLD)
    const many = join(dir, 'dsh-spill-Many01')
    mkdirSync(many)
    for (let i = 0; i < 520; i += 1) writeFileSync(join(many, `f${i}.log`), '1')
    for (let i = 0; i < 520; i += 1) age(many, `f${i}.log`, OLD)
    age(dir, 'dsh-spill-Many01', OLD)
    assert.equal(await newestMtime(join(dir, 'dsh-spill-TooDp1')), Infinity)
    assert.equal(await newestMtime(many), Infinity)
    const out = await sweepTemp({ dir, now: NOW })
    assert.deepEqual(out.kept.sort(), ['dsh-spill-Many01', 'dsh-spill-TooDp1'])
    assert.deepEqual(out.removed, [])
  })

  test('还没有 temp 目录：什么都不做，不报错', async () => {
    const dir = join(tempDir(), '没有这个')
    const out = await sweepTemp({ dir, now: NOW })
    assert.deepEqual(out, { removed: [], kept: [], skipped: [], failed: [] })
    assert.equal(existsSync(dir), false)
  })

  test('收拾的时候起 dsh：先等着，收拾完才起', async () => {
    const sweep = slowSweep()
    const events = []
    // payload 指到一个空目录：起得来的话 dsh 马上就报错收场，这里只看它是不是等到放行以后才起
    const handle = runTask(launchOptions({ payloadRoot: scratch(), onEvent: (event) => events.push(event.type) }))
    await sleep(400)
    assert.equal(sweepPending(), sweep.run)
    assert.equal(handle.pid, undefined)
    assert.deepEqual(events, [])
    await sweep.release()
    const end = await handle.done
    assert.equal(sweepPending(), null)
    assert.equal(end.type, 'end')
    assert.ok(events.length > 0, '放行以后该起了')
  })

  test('收拾的时候点停下：不用等，马上停；放行以后也不再起', async () => {
    const sweep = slowSweep()
    const events = []
    const handle = runTask(launchOptions({ payloadRoot: scratch(), onEvent: (event) => events.push(event.type) }))
    assert.deepEqual(await handle.steer('再加一句'), { ok: false, mode: 'queue' })
    handle.cancel()
    const end = await handle.done
    assert.equal(end.status, 'cancelled')
    await sweep.release()
    await sleep(400)
    assert.deepEqual(events, ['end'])
    assert.equal(handle.pid, undefined)
  })

  test('收拾卡住了：最多等 sweepWaitMs，到点照起', async () => {
    const sweep = slowSweep()
    try {
      const events = []
      const started = Date.now()
      const handle = runTask(launchOptions({ payloadRoot: scratch(), sweepWaitMs: 300, onEvent: (event) => events.push(event.type) }))
      const end = await handle.done
      assert.equal(end.type, 'end')
      assert.ok(Date.now() - started >= 250, `${Date.now() - started} ms`)
      assert.ok(events.includes('end'))
    } finally {
      await sweep.release()
    }
  })

  test('真 dsh：收拾的时候起的那一轮，放行之前一个请求都没发、temp 里没建东西，放行以后照常干完', { timeout: 120_000 }, async (t) => {
    if (!existsSync(layout.dsh)) {
      t.skip('dsh payload is not linked under ./payload')
      return
    }
    const fake = await startFake({ expectKey: KEY })
    const sweep = slowSweep()
    try {
      const options = launchOptions({ baseUrl: fake.url })
      const handle = runTask(options)
      await sleep(1500)
      assert.equal(fake.calls.length, 0)
      assert.equal(existsSync(join(options.lowRoot, 'temp')), false)
      await sweep.release()
      const end = await handle.done
      assert.equal(end.status, 'done')
      assert.ok(fake.calls.length >= 1)
    } finally {
      await sweep.release()
      await fake.close()
    }
  })
})
