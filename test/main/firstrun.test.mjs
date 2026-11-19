// 真启动一次：用户目录是全新的空目录（连 %USERPROFILE%\AppData\Roaming 都没有）时，
// 用户数据目录建不出来时 Electron 会 0x80000003 崩掉，所以要先建。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import { t } from '../../app/copy/copy.mjs'

// 小岛窗口的标题写在 app/copy 里（按 T156 改过），这里跟着取，别写死
const ISLAND_TITLE = t('island.title')

// 找一个没人占的端口
function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer()
    srv.on('error', fail)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => ok(port))
    })
  })
}

async function waitForIsland(port, child, limitMs) {
  const until = Date.now() + limitMs
  while (Date.now() < until) {
    if (child.exitCode !== null) return { ok: false, why: `主进程先退了，退出码 0x${(child.exitCode >>> 0).toString(16).padStart(8, '0')}` }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const island = list.find((t) => t.type === 'page' && String(t.url).includes('pet/pet.html'))
      // 小岛窗口的标题是页面起来以后才写上的，等它写上再算数
      if (island && island.title === ISLAND_TITLE) return { ok: true, title: island.title }
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: false, why: '等了 45 秒还没看见小岛' }
}

// 试一次：全新空用户目录里真启动一次，看小岛出不出来。跑完把进程和临时目录都收干净。
async function tryOnce() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-firstrun-'))
  const up = join(root, 'USERPROFILE')
  const home = join(root, 'HOME')
  const roaming = join(root, 'APPDATA')
  const local = join(root, 'LOCALAPPDATA')
  // 只建这四个空目录，不建 %USERPROFILE%\AppData\Roaming —— 跟「新装一台机器」一样
  for (const dir of [up, home, roaming, local]) mkdirSync(dir, { recursive: true })

  const port = await freePort()
  let child
  try {
    child = spawn(electronPath, [resolve('.'), `--remote-debugging-port=${port}`], {
      env: { ...process.env, USERPROFILE: up, HOME: home, APPDATA: roaming, LOCALAPPDATA: local },
      stdio: 'ignore',
    })
  } catch (err) {
    // Electron 刚装好、exe 还被占着（杀毒软件在扫）时 spawn 直接抛 EBUSY：这一次算没试成，歇一会儿再试
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* 删不掉留给系统清 */ }
    return { ok: false, busy: true, why: `Electron 起不来：${(err && err.code) || err}` }
  }
  try {
    return await waitForIsland(port, child, 45_000)
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    // 等进程真的退了再删临时目录，不然文件还被占着
    await new Promise((r) => {
      const timer = setTimeout(r, 8000)
      child.once('exit', () => { clearTimeout(timer); r() })
    })
    // 临时目录删不掉（Electron 刚退、文件还被占着）不算测试失败，别盖住真正的失败原因
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch (err) {
      console.warn(`临时目录 ${root} 删不掉：${err && err.message}`)
    }
  }
}

// 机器慢的时候第一次启动会超时（拉 Electron、装用户目录都赶上了）。这是环境慢，不是产品坏，
// 所以重试几次；每次都从全新的空用户目录起。
const ATTEMPTS = 3

test('第一次启动：用户目录是全新的空目录时，桌伴也能起来、小岛也出现', { timeout: 300_000 }, async () => {
  let last = { ok: false, why: '一次都没试成' }
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    last = await tryOnce()
    if (last.ok) break
    // 试完一次歇一下再试，别让上一轮残留的进程跟下一轮抢；exe 被占着时多歇一会儿
    await new Promise((r) => setTimeout(r, last.busy ? 10_000 : 2000))
  }
  assert.equal(last.ok, true, `试了 ${ATTEMPTS} 次都不行：${last.why}`)
  assert.equal(last.title, ISLAND_TITLE)
})
