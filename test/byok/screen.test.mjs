// 首次运行和设置窗。没设 SIDEMATE_BYOK 就跳过，平时 npm test 不拉起 Electron。
// Linux：xvfb-run -a -s "-screen 0 1280x800x24" env SIDEMATE_BYOK=1 node --test test/byok/screen.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { t } from '../../app/copy/copy.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

function evaluate(ws, source) {
  return new Promise((resolve, reject) => {
    const id = 1
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: source, returnByValue: true, awaitPromise: true } }))
  })
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
}

test('first run picks a model, settings live in their own window', { skip: process.env.SIDEMATE_BYOK ? false : 'set SIDEMATE_BYOK=1', timeout: 60_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-byok-screen-'))
  const home = path.join(lab, 'home')
  mkdirSync(home)
  // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
  const local = path.join(lab, 'local')
  mkdirSync(local)
  const port = 9334
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(lab, 'user')}`], {
    cwd: root,
    env: { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: local, SIDEMATE_OPEN: 'settings', SIDEMATE_PET_STILL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const pages = async () => {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
    return list.filter((item) => item.type === 'page')
  }
  const sockets = []
  try {
    let list = []
    for (let i = 0; i < 50; i++) {
      list = await pages().catch(() => [])
      if (list.filter((item) => item.url.includes('page.html')).length >= 2) break
      await sleep(200)
    }
    const urls = list.map((item) => item.url)
    assert.equal(urls.some((url) => url.includes('task.html')), false, urls.join(' '))
    const targets = list.filter((item) => item.url.includes('page.html'))
    assert.equal(targets.length >= 2, true, stderr || urls.join(' '))
    let wizard
    let settings
    for (const target of targets) {
      const ws = await connect(target)
      sockets.push(ws)
      let kind = ''
      for (let i = 0; i < 25 && !kind; i++) {
        kind = await evaluate(ws, `document.querySelectorAll('#lines p').length >= 3 ? 'wizard' : (document.querySelector('#menu') ? 'settings' : '')`)
        if (!kind) await sleep(100)
      }
      if (kind === 'wizard') wizard = ws
      if (kind === 'settings') settings = ws
    }
    assert.ok(wizard, 'no first-run page')
    assert.ok(settings, 'no settings page')
    // 第一步：「关于桌伴」一个标题、三句话
    assert.equal(await evaluate(wizard, `document.querySelector('#about > h1').textContent`), t('firstRun.aboutTitle'))
    const about = JSON.parse(await evaluate(wizard, `JSON.stringify([...document.querySelectorAll('#lines p')].map((item) => item.textContent))`))
    assert.deepEqual(about, [t('firstRun.about1'), t('firstRun.about2'), t('firstRun.about3')])
    // 「开始」在右下角，右边跟那三句对齐
    const align = JSON.parse(await evaluate(wizard, `JSON.stringify({
      start: document.querySelector('#start').getBoundingClientRect().right,
      lines: document.querySelector('#lines').getBoundingClientRect().right,
    })`))
    assert.equal(Math.abs(align.start - align.lines) <= 1, true, JSON.stringify(align))
    const body = await evaluate(wizard, 'document.body.innerText')
    assert.equal(/terminal|git|patch|mcp|token/i.test(body), false)
    await evaluate(wizard, `document.querySelector('#start').click()`)
    // 第二步：先选一个模型
    assert.equal(await evaluate(wizard, `document.querySelector('#model').hidden`), false)
    assert.equal(await evaluate(wizard, `document.querySelector('#model > h1').textContent`), '选择模型')
    assert.equal(await evaluate(wizard, `document.querySelector('#recommend-badge').textContent`), '推荐')
    assert.equal(await evaluate(wizard, `document.querySelector('#deepseek-key').placeholder`), '贴上 DeepSeek 密钥')
    // 钥匙空着：测一下点不了，也不进第三步
    assert.equal(await evaluate(wizard, `document.querySelector('#deepseek-test').disabled`), true)
    assert.equal(await evaluate(wizard, `document.querySelector('#intro').hidden`), true)
    // 其他方式三块
    const others = JSON.parse(await evaluate(wizard, `JSON.stringify([...document.querySelectorAll('#others .other')].map((item) => item.textContent))`))
    assert.deepEqual(others, ['GLM 模型›', '自定义模型›', 'Kilo 模型›'])
    // 版式：字号、底色、边线、圆角
    const look = JSON.parse(await evaluate(wizard, `JSON.stringify({
      h1: getComputedStyle(document.querySelector('#model > h1')).fontSize,
      badge: getComputedStyle(document.querySelector('#recommend-badge')).color,
      card: getComputedStyle(document.querySelector('#recommend')).borderRadius,
      cardBorder: getComputedStyle(document.querySelector('#recommend')).borderTopWidth,
      cardBg: getComputedStyle(document.querySelector('#recommend')).backgroundColor,
      tile: getComputedStyle(document.querySelector('#others .other')).height,
      tileRadius: getComputedStyle(document.querySelector('#others .other')).borderRadius,
    })`))
    assert.equal(look.h1, '22px')
    assert.equal(look.badge, 'rgb(197, 58, 34)')
    assert.equal(look.card, '10px')
    assert.equal(look.cardBorder, '1.5px')
    assert.equal(look.cardBg, 'rgb(255, 255, 255)')
    assert.equal(look.tile, '52px')
    assert.equal(look.tileRadius, '8px')
    // 智谱二级页：返回、教程入口、钥匙框、用它开始
    await evaluate(wizard, `document.querySelector('#to-zhipu').click()`)
    assert.equal(await evaluate(wizard, `document.querySelector('#zhipu').hidden`), false)
    assert.equal(await evaluate(wizard, `document.querySelector('#zhipu-key').placeholder`), '贴上 GLM 密钥')
    assert.equal(await evaluate(wizard, `document.querySelector('#zhipu-start').disabled`), true)
    assert.equal(await evaluate(wizard, `document.querySelector('#zhipu-test').textContent`), '测试')
    assert.equal(await evaluate(wizard, `document.querySelector('#zhipu-test').disabled`), true)
    assert.equal(await evaluate(wizard, `getComputedStyle(document.querySelector('#zhipu h1')).fontSize`), '20px')
    await evaluate(wizard, `document.querySelector('#zhipu-back').click()`)
    assert.equal(await evaluate(wizard, `document.querySelector('#model').hidden`), false)
    // 教程小页：DeepSeek 那篇，编号步骤，带链接的那步能开官方页面
    await evaluate(wizard, `document.querySelector('#deepseek-guide').click()`)
    for (let i = 0; i < 20 && await evaluate(wizard, `document.querySelector('#guide-title').textContent`) === ''; i++) await sleep(50)
    assert.equal(await evaluate(wizard, `document.querySelector('#guide-title').textContent`), '获取 DeepSeek 密钥')
    assert.equal(await evaluate(wizard, `document.querySelectorAll('#guide-steps li').length`), 5)
    assert.equal(await evaluate(wizard, `document.querySelectorAll('#guide-steps .link').length > 0`), true)
    // 编号圆点 20 见方，返回行旁边不摆小字
    assert.equal(await evaluate(wizard, `getComputedStyle(document.querySelector('#guide-steps li'), '::before').width`), '20px')
    assert.equal(await evaluate(wizard, `document.querySelector('#guide .back-hint') === null`), true)
    await evaluate(wizard, `document.querySelector('#guide-back').click()`)
    assert.equal(await evaluate(wizard, `document.querySelector('#model').hidden`), false)
    // 界面上不出现禁区词
    const wizardBody = await evaluate(wizard, 'document.body.innerText')
    assert.equal(/terminal|git|patch|mcp|token/i.test(wizardBody), false)
    // 设置在自己的窗口里，不挂在首次运行窗上
    assert.equal(await evaluate(wizard, `document.querySelector('#settings') === null`), true)
    const settingsBody = await evaluate(settings, 'document.body.innerText')
    assert.equal(settingsBody.includes('模型'), true)
    // 设置窗归别的卡管，它的「能力」那一页本来就摆着 MCP 的字样，
    // 本卡只查其余几个禁区词。
    assert.equal(/terminal|git|patch|token/i.test(settingsBody), false)
    if (stderr.includes('Error')) console.log(stderr.slice(-2000))
  } finally {
    for (const ws of sockets) ws.close()
    child.kill()
    await sleep(200)
    rmSync(lab, { recursive: true, force: true })
  }
})
