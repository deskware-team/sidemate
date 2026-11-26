// 小岛竖直居中：真窗口测试的主进程入口（electron 直接跑这个文件，不跑 app/）。
//
// 起一个跟 app/pet/shell.mjs 一样的小岛窗（透明无边框，尺寸按小岛大小那档算），
// 量两遍：
// 1. 页面里小条 / 眼睛 / 字的 getBoundingClientRect（DOM 量）；
// 2. 截一张图，按像素量：看得见的墨色小条有多高、眼睛那一带像素带的中心、
//    字那一带像素带的中心。
// 结果写进 SIDEMATE_PET_RESULT 指的 json，截图写进 SIDEMATE_PET_SHOTS 目录。
// 量完自己 app.quit()，不等人来收。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），
// 名义导入会在链接时就报错；这个文件会被 node --test 当测试扫到，纯 node 下不能炸。
import electron from 'electron'
const { app, BrowserWindow, ipcMain } = electron
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { BASE, layoutFor } from '../../app/pet/layout.mjs'
import { applyFont, bubbleBoxWidth, theme } from '../../app/pet/theme.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

// 小岛大小那档（0.85 / 1 / 1.25）
const scale = Number(process.env.SIDEMATE_PET_SCALE || '1') || 1
const resultFile = process.env.SIDEMATE_PET_RESULT
const shotsDir = process.env.SIDEMATE_PET_SHOTS || join(root, '..', 'm03-shots')
const text = process.env.SIDEMATE_PET_TEXT || '写好了！点击查看'

// 墨色小条 #1f1d1a，眼睛 #f5f1e8，字 #efe9df
const INK = [31, 29, 26]

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

// 最小 PNG 解码（8 位，RGB 或 RGGA，不隔行）：Electron 截的图就是这个格式
function decodePng(buffer) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 6
  let bitDepth = 8
  const idat = []
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('隔行的 PNG 解不了')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`只支持 8 位深度的 PNG（这个是 ${bitDepth}）`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`只支持 RGB/RGBA 的 PNG（这个是 colorType ${colorType}）`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let value = line[i]
      if (filter === 1) value = (value + a) & 255
      else if (filter === 2) value = (value + b) & 255
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      line[i] = value
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

// 按像素量三条带：墨色小条、眼睛那一带、字那一带（位置用 DIP）
// 眼睛和字都是浅色，靠横向范围分开：眼睛在表情区里，字在文字区里
function bands(png, dpr, limits) {
  const { width, height, data } = png
  const ink = { top: null, bottom: null }
  const eye = { top: null, bottom: null }
  const text = { top: null, bottom: null }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const dipX = x / dpr
      if (Math.abs(r - INK[0]) < 26 && Math.abs(g - INK[1]) < 26 && Math.abs(b - INK[2]) < 26) {
        if (ink.top === null) ink.top = y
        ink.bottom = y
        continue
      }
      if (r > 200 && g > 195 && b > 185) {
        // 眼睛：表情区里那两只（收着的时候在 x 46、66，张开时往左挪到 18、38）
        if (dipX < limits.eyeLimit) {
          if (eye.top === null) eye.top = y
          eye.bottom = y
        }
        // 字：文字区（x 从 eyeZone + 空 + 边距起）
        if (limits.textFrom !== null && dipX >= limits.textFrom) {
          if (text.top === null) text.top = y
          text.bottom = y
        }
      }
    }
  }
  const dip = (value) => (value === null ? null : Math.round((value / dpr) * 1000) / 1000)
  const center = (band) => (band.top === null ? null : dip((band.top + band.bottom) / 2))
  return {
    inkTop: dip(ink.top),
    inkBottom: dip(ink.bottom),
    inkHeight: ink.top === null ? null : dip(ink.bottom - ink.top + 1),
    inkCenter: center(ink),
    eyeTop: dip(eye.top),
    eyeBottom: dip(eye.bottom),
    eyeCenter: center(eye),
    textTop: dip(text.top),
    textBottom: dip(text.bottom),
    textCenter: center(text),
  }
}

// 页面里量一遍：哪个形状是看得见的眼睛，就量哪个
const MEASURE = `(() => {
  const rect = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
  }
  const shown = (sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const s = getComputedStyle(el)
      if (s.display === 'none' || s.opacity === '0') continue
      return el
    }
    return null
  }
  // 眼睛：每只一个 g（translate+scale）里一个椭圆，笑眼是细线；量看得见的那个
  const eye = shown('#eye-l .pupil') || shown('#eye-l .lid')
  return {
    inner: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    scene: document.body.dataset.scene || '',
    mode: document.body.dataset.mode || '',
    bubble: document.body.dataset.bubble || '',
    strip: rect(document.getElementById('strip')),
    eyes: rect(document.getElementById('eyes')),
    eye: rect(eye),
    text: rect(document.getElementById('bubble-text')),
  }
})()`

async function measure(win, label, limits, dpr) {
  const dom = await win.webContents.executeJavaScript(MEASURE)
  // 截屏走 devtools 协议：capturePage 在这台机器的合成器上报 UnknownVizError
  const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' })
  const buffer = Buffer.from(shot.data, 'base64')
  const png = decodePng(buffer)
  mkdirSync(shotsDir, { recursive: true })
  const file = join(shotsDir, `${label}.png`)
  writeFileSync(file, buffer)
  const pixels = bands(png, dpr, limits)
  return { label, dom, pixels, png: { width: png.width, height: png.height }, shot: file }
}

async function main() {
  applyFont(BASE.font * scale)
  const win = new BrowserWindow({
    width: theme.island, height: theme.height,
    x: 60, y: 60,
    frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: true, backgroundColor: '#00000000',
    webPreferences: {
      preload: join(root, 'app/pet/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  let measured = 0
  ipcMain.handle('pet:ready', () => ({
    still: true, // 不跑动画，量的是静止的那一帧
    font: theme.font,
    mode: 'idle',
    message: '',
    scene: 'strip',
    news: false,
    bubble: { text: '', actions: [] },
  }))
  ipcMain.on('pet:measure', (_event, payload) => {
    measured = Math.round(Number(payload?.width ?? payload) || 0)
    // 页面量出那行字有多宽 → 窗口照着拉长（跟壳里一样）
    win.setBounds({ ...win.getBounds(), width: bubbleBoxWidth(measured) })
  })

  await win.loadFile(join(root, 'app/pet/pet.html'))
  win.webContents.debugger.attach('1.3')
  await sleep(400)
  const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio')
  // 横向范围：收着的时候眼睛在整条正中，张开时在左边表情区里；字在文字区里
  const box = layoutFor(theme.font)
  const unit = box.island / 112
  const stripLimits = { eyeLimit: 74 * unit, textFrom: null }
  const expandedLimits = { eyeLimit: 46 * unit, textFrom: box.eyeZone + box.zoneGap + box.textPad - 2 }

  const results = []
  // 1. 收着的小条（待命）
  results.push(await measure(win, `strip-scale${scale}-dpr${dpr}`, stripLimits, dpr))

  // 2. 冒一行字（待命）
  win.webContents.send('pet:bubble', { text, actions: [] })
  win.webContents.send('pet:scene', { scene: 'expanded' })
  await sleep(500)
  results.push(await measure(win, `expanded-scale${scale}-dpr${dpr}`, expandedLimits, dpr))

  // 3. 冒一行字（干活中）
  win.webContents.send('pet:state', { mode: 'work', message: '正在工作' })
  win.webContents.send('pet:bubble', { text: '正在工作 · 32 秒', actions: [] })
  await sleep(500)
  results.push(await measure(win, `work-scale${scale}-dpr${dpr}`, expandedLimits, dpr))

  // 4. 收成细线：墨色只画那根线那么高，下面透明
  //    （窗照样被 Windows 垫高，铺满整窗就是顶上挂一块黑）
  win.setBounds({ ...win.getBounds(), width: theme.lineWidth, height: theme.lineHeight })
  win.webContents.send('pet:scene', { scene: 'line' })
  await sleep(500)
  results.push(await measure(win, `line-scale${scale}-dpr${dpr}`, { eyeLimit: 0, textFrom: null }, dpr))

  const out = {
    scale,
    dpr,
    theme: {
      island: theme.island,
      height: theme.height,
      font: theme.font,
      lineWidth: theme.lineWidth,
      lineHeight: theme.lineHeight,
    },
    contentBounds: win.getContentBounds(),
    results,
  }
  try { writeFileSync(resultFile, `${JSON.stringify(out, null, 2)}\n`) } catch { /* 写不进就算了 */ }
  console.log(JSON.stringify(out))
  app.quit()
}

if (process.versions.electron) {
  app.whenReady().then(() => main().catch((error) => { console.error(error); app.exit(1) }))
}
