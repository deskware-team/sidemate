// 设置窗的「显示」那一页（真窗口）：没设 SIDEMATE_DISPLAY 就跳过，平时 npm test 不拉起 Electron。
// 做法照 test/byok/screen.test.mjs：用调试端口连上设置窗那一页，点开「显示」，
// 量两行档位按钮（几颗、点开区多大、选中的那颗什么颜色）、抄底下一行提示，
// 再截一张整页的图存 SIDEMATE_SHOTS（对稿用）。截完自己退出去。

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

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

// 截一张整页的图：走调试端口的 Page.captureScreenshot（不用 Electron 那个会抖的整屏截法）
function shoot(ws) {
  return new Promise((resolve, reject) => {
    const id = 2
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

test('设置窗的「显示」页：两行档位按钮、提示行、截图', { skip: process.env.SIDEMATE_DISPLAY ? false : 'set SIDEMATE_DISPLAY=1', timeout: 120_000 }, async () => {
  const lab = mkdtempSync(path.join(tmpdir(), 'sidemate-display-'))
  const home = path.join(lab, 'home')
  mkdirSync(home)
  // 隔离的 LOCALAPPDATA：程序数据（%LOCALAPPDATA%\sidemate）跟着走，不碰真用户目录
  const local = path.join(lab, 'local')
  mkdirSync(local)
  const shots = process.env.SIDEMATE_SHOTS || path.join(lab, 'shots')
  const port = 9336
  const electron = createRequire(path.join(root, 'package.json'))('electron')
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, '--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(lab, 'user')}`], {
    cwd: root,
    env: { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: local, SIDEMATE_OPEN: 'settings', SIDEMATE_PET_STILL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const sockets = []
  try {
    // 等设置窗那一页出来（目录里有 #menu 的是设置窗，首次运行那页是 #about）
    let settings = null
    for (let i = 0; i < 60 && !settings; i++) {
      await sleep(300)
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()).catch(() => [])
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

    // 目录里有「显示」，在「用量」和「关于」之间
    const menu = await evaluate(settings, `JSON.stringify([...document.querySelectorAll('#menu .item')].map((n) => n.textContent.trim()))`)
    const names = JSON.parse(menu)
    assert.equal(names.includes('显示'), true, names.join(' '))
    assert.ok(names.indexOf('显示') > names.indexOf('用量') && names.indexOf('显示') < names.indexOf('关于'), names.join(' '))

    // 点开「显示」那一页
    await evaluate(settings, `document.querySelector('[data-page="display"]').click()`)
    await sleep(500)
    const page = JSON.parse(await evaluate(settings, `JSON.stringify({
      hidden: document.querySelector('#page-display').hidden,
      title: document.querySelector('#page-display h1').textContent,
      font: [...document.querySelectorAll('#font-seg .seg-btn')].map((n) => n.textContent),
      island: [...document.querySelectorAll('#island-seg .seg-btn')].map((n) => n.textContent),
      hint: document.querySelector('#display-hint'),
      note: document.querySelector('.display-note'),
    })`))
    assert.equal(page.hidden, false, '「显示」那一页没露出来')
    assert.equal(page.title, '显示')
    assert.deepEqual(page.font, ['小', '标准', '大', '特大'])
    assert.deepEqual(page.island, ['小', '标准', '大'])
    // 说明小字和快捷键提示都删了：页面上不摆
    assert.equal(page.hint, null, '没有快捷键提示那一行')
    assert.equal(page.note, null, '两行下面没有说明小字')

    // 版式：选中的那颗深底白字，其余白底灰边；点击区至少 44×28
    const look = JSON.parse(await evaluate(settings, `JSON.stringify({
      on: (() => { const n = document.querySelector('#font-seg .seg-btn.on'); const s = getComputedStyle(n); return { bg: s.backgroundColor, color: s.color, w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height } })(),
      off: (() => { const n = document.querySelector('#font-seg .seg-btn:not(.on)'); const s = getComputedStyle(n); return { bg: s.backgroundColor, border: s.borderTopWidth } })(),
    })`))
    assert.equal(look.on.bg, 'rgb(34, 32, 28)', `选中的那颗底色是 ${look.on.bg}`)
    assert.equal(look.on.color, 'rgb(255, 255, 255)', `选中的那颗字色是 ${look.on.color}`)
    assert.ok(look.on.w >= 44 && look.on.h >= 28, `点击区只有 ${look.on.w}×${look.on.h}`)
    assert.equal(look.off.bg, 'rgb(255, 255, 255)', `没选中的那颗底色是 ${look.off.bg}`)

    // 对稿：标题 18、行名 14/500、白卡边线圆角
    const spec = JSON.parse(await evaluate(settings, `JSON.stringify({
      h1: getComputedStyle(document.querySelector('#page-display h1')).fontSize,
      title: getComputedStyle(document.querySelector('.display-title')).fontSize,
      titleWeight: getComputedStyle(document.querySelector('.display-title')).fontWeight,
      cardBorder: getComputedStyle(document.querySelector('#display-card')).borderTopWidth,
      cardBorderColor: getComputedStyle(document.querySelector('#display-card')).borderTopColor,
      cardRadius: getComputedStyle(document.querySelector('#display-card')).borderTopLeftRadius,
    })`))
    assert.equal(spec.h1, '18px')
    assert.equal(spec.title, '14px')
    assert.equal(spec.titleWeight, '500')
    assert.equal(spec.cardBorder, '1px')
    assert.equal(spec.cardBorderColor, 'rgb(227, 222, 211)')
    assert.equal(spec.cardRadius, '8px')

    // 对稿（尺寸）：白卡 516 宽、两行一样高、按钮组贴卡内右边 16
    const geo = JSON.parse(await evaluate(settings, `JSON.stringify((() => {
      const card = document.querySelector('#display-card').getBoundingClientRect()
      const rows = [...document.querySelectorAll('.display-row')].map((n) => n.getBoundingClientRect().height)
      const seg = document.querySelector('#font-seg').getBoundingClientRect()
      return { cardW: card.width, rows, segRight: card.right - seg.right }
    })())`))
    assert.ok(Math.abs(geo.cardW - 516) <= 1, `白卡宽 ${geo.cardW}，不是 516`)
    assert.ok(geo.rows.every((one) => Math.abs(one - geo.rows[0]) <= 1), `两行不一样高：${geo.rows.join('、')}`)
    assert.ok(geo.rows[0] >= 40 && geo.rows[0] <= 60, `两行高 ${geo.rows[0]}，不在 40 到 60 之间`)
    assert.ok(Math.abs(geo.segRight - 16) <= 1, `按钮组离卡右边 ${geo.segRight}，不是 16`)

    // 截一张「显示」页的图，存到工作区外（对稿用：这时候字号还是标准，窗口就是 720×560）
    mkdirSync(shots, { recursive: true })
    const file = path.join(shots, '设置-显示页.png')
    writeFileSync(file, await shoot(settings))
    assert.equal(existsSync(file), true, '截图没存下来')

    // 键盘：Tab 能到那几颗，左右方向键能切（切完档位写回设置.json）
    await evaluate(settings, `document.querySelector('#font-seg .seg-btn').focus()`)
    await evaluate(settings, `document.querySelector('#font-seg').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
    await sleep(600)
    const after = JSON.parse(await evaluate(settings, `JSON.stringify({
      on: document.querySelector('#font-seg .seg-btn.on').textContent,
      focused: document.activeElement.textContent,
    })`))
    assert.equal(after.on, '大', `方向键以后选中的是 ${after.on}`)
    const saved = JSON.parse(await evaluate(settings, `window.settings.zoom().then((v) => JSON.stringify(v))`))
    assert.equal(saved.fontScale, 1.15, `设置.json 里写的字号是 ${saved.fontScale}`)
  } finally {
    for (const ws of sockets) ws.close()
    child.kill()
    await sleep(300)
    rmSync(lab, { recursive: true, force: true })
  }
})
