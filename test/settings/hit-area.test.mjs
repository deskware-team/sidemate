// 设置窗「点击区域」真窗口体检：六页加一个弹窗，把每个能点的东西量一遍。
//
// 做法：起开发版（electron .），用调试端口连上设置窗那一页，一页一页点开，
// 在页面里跑 hit-area-audit.mjs 那段体检脚本，列出每个能点的：
//   视觉矩形（看得见的那块）、点击矩形（真能按响的那块）、光标、尺寸；
// 照卡上四条标准标出不合格的。截图和表写到 SIDEMATE_SHOTS / SIDEMATE_HIT_OUT。
//
// 平时 npm test 不拉起 Electron：没设 SIDEMATE_SETTINGS 就跳过。
//   set SIDEMATE_SETTINGS=1 && node --test test/settings/hit-area.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AUDIT_SOURCE, toTable } from './hit-area-audit.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

function evaluate(ws, source) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6)
    // 调试端口偶尔会卡住，别把整个测试吊死：超时就报错
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error('量页面超时（20s）：' + source.slice(0, 60)))
    }, 20_000)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else if (message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text)))
      else resolve(message.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: source, returnByValue: true, awaitPromise: true } }))
  })
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const timer = setTimeout(() => reject(new Error('连调试端口超时（10s）')), 10_000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws) }, { once: true })
    ws.addEventListener('error', (err) => { clearTimeout(timer); reject(err) }, { once: true })
  })
}

function shoot(ws) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(Buffer.from(message.result.data, 'base64'))
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })
}

// 摆一份有东西的数据：模型、技能、MCP、新闻主题都来一条，各页才有行可量
async function seed(local) {
  const { addCustom, loadCatalog, saveCatalog, setDefault } = await import(pathToFileURL(path.join(root, 'app/models/catalog.mjs')).href)
  const { saveTopics } = await import(pathToFileURL(path.join(root, 'app/news/topics.mjs')).href)
  const { mkdirSync: mk } = await import('node:fs')
  // 程序数据根：%LOCALAPPDATA%\sidemate
  const desk = path.join(local, 'sidemate')
  mk(path.join(desk, 'skills', '周报写法'), { recursive: true })
  writeFileSync(path.join(desk, 'skills', '周报写法', 'SKILL.md'), '---\nname: 周报写法\ndescription: 按部门格式写周报\n---\n')
  mk(path.join(desk, 'data'), { recursive: true })
  writeFileSync(path.join(desk, 'data', 'settings.json'), JSON.stringify({ introPlayed: true }))
  const catalogFile = path.join(desk, 'model.json')
  const added = addCustom(loadCatalog(catalogFile), { preset: 'zhipu' })
  saveCatalog(catalogFile, setDefault(added.catalog, { entry: added.id, model: 'glm-4.7-flash', effort: null }).catalog)
  saveTopics(path.join(desk, 'news.json'), [{ id: 't-ai', name: 'AI 行业', want: '大模型的新进展', at: '23:59', days: 'daily', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' }])
  writeFileSync(path.join(desk, 'ability.json'), JSON.stringify({ tools: { search: true, fetch: true } }))
  writeFileSync(path.join(desk, 'mcp.json'), JSON.stringify({
    mcp: [{ id: 'mcp-demo', name: '示例搜索', url: 'https://search.example.com/mcp', auth: { kind: 'none', name: '' }, enabled: true }],
    mcpStatus: {},
  }))
}

const PAGES = ['models', 'caps', 'news', 'usage', 'display', 'about']

test('设置窗每一页的点击区域：看着能点的都要点得中，点区至少 32×32', { skip: process.env.SIDEMATE_SETTINGS ? false : 'set SIDEMATE_SETTINGS=1', timeout: 240_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-hit-'))
  const home = path.join(lab, 'home')
  // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
  const local = path.join(lab, 'local')
  mkdirSync(home, { recursive: true })
  mkdirSync(local, { recursive: true })
  const out = process.env.SIDEMATE_HIT_OUT || path.join(lab, 'out')
  const shots = process.env.SIDEMATE_SHOTS || path.join(lab, 'shots')
  mkdirSync(out, { recursive: true })
  mkdirSync(shots, { recursive: true })
  await seed(local)
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  // 端口挑一段冷清的：别的会话也在跑 electron，撞上了会连到别人那边去
  const port = 9700 + Math.floor(Math.random() * 90)
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(lab, 'user')}`], {
    cwd: root,
    env: { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: local, SIDEMATE_OPEN: 'settings', SIDEMATE_PET_STILL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const sockets = []
  const pages = {}
  try {
    let settings = null
    for (let i = 0; i < 80 && !settings; i++) {
      await sleep(300)
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
      if (!Array.isArray(list)) continue
      for (const target of list.filter((item) => item.type === 'page' && item.url.includes('page.html'))) {
        const ws = await connect(target)
        sockets.push(ws)
        const isSettings = await evaluate(ws, `!!document.querySelector('#menu')`)
        if (isSettings) {
          settings = ws
          break
        }
      }
    }
    assert.ok(settings, `没找到设置窗那一页：${stderr}`)

    // 六页：每页先量顶上，再滚到底量一次，两次合起来才算这一页
    for (const page of PAGES) {
      await evaluate(settings, `document.querySelector('[data-page="${page}"]').click()`)
      await sleep(700)
      const top = await evaluate(settings, AUDIT_SOURCE)
      await evaluate(settings, `(() => { const c = document.querySelector('#content'); if (c) c.scrollTop = c.scrollHeight })()`)
      await sleep(400)
      const bottom = await evaluate(settings, AUDIT_SOURCE)
      await evaluate(settings, `(() => { const c = document.querySelector('#content'); if (c) c.scrollTop = 0 })()`)
      await sleep(300)
      const rows = [...top.rows]
      for (const row of bottom.rows) {
        const same = rows.find((one) => one.el === row.el && one.text === row.text)
        if (!same) rows.push(row)
        else if (row.issues.length) same.issues = [...new Set([...same.issues, ...row.issues])]
      }
      pages[page] = { rows, radiusNotes: [...new Set([...(top.radiusNotes || []), ...(bottom.radiusNotes || [])])] }
      writeFileSync(path.join(shots, `设置-${page}.png`), await shoot(settings))
    }

    // 一个弹窗：加一个自定义模型（新闻页 0.4 起没有弹窗了，只有一张卡片）
    await evaluate(settings, `document.querySelector('[data-page="models"]').click()`)
    await sleep(500)
    await evaluate(settings, `document.querySelector('#models-add').click()`)
    await sleep(900)
    pages['弹窗-自定义模型'] = await evaluate(settings, AUDIT_SOURCE)
    writeFileSync(path.join(shots, '设置-弹窗-自定义模型.png'), await shoot(settings))
    await evaluate(settings, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(400)

    // 表和原始结果
    writeFileSync(path.join(out, 'hit-area.json'), JSON.stringify(pages, null, 2))
    writeFileSync(path.join(out, 'hit-area.md'), toTable(pages))
    const bad = []
    for (const [name, result] of Object.entries(pages)) {
      for (const row of result.rows) {
        if (row.issues.length) bad.push(`${name} ${row.el} ${row.text}：${row.issues.join('；')}`)
      }
      for (const note of result.radiusNotes || []) bad.push(`${name} ${note}`)
    }
    writeFileSync(path.join(out, 'hit-area-bad.txt'), bad.join('\n') + '\n')
    assert.equal(bad.length, 0, `不合格 ${bad.length} 条：\n` + bad.join('\n'))
  } finally {
    for (const ws of sockets) ws.close()
    child.kill()
    await sleep(500)
    rmSync(lab, { recursive: true, force: true })
  }
})
