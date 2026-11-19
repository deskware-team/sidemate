import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { t } from '../copy/copy.mjs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTRO_HINT } from './copy.mjs'
import { createVault } from './vault.mjs'
import { appRoot } from '../paths.mjs'
import { firstStep, guideView, modelConfigured, needFirstRun, saveDeepseek, saveKilo, saveZhipu } from './first.mjs'
import { playIntroOnce } from '../pet/intro.mjs'
import { openSettings } from '../settings/shell.mjs'
import { testAndSave } from '../settings/custom.mjs'
import { openFreeConsent } from '../consent/shell.mjs'
import { GUIDES, isGuideUrl } from '../models/guides.mjs'
import { modelFiles } from '../models/files.mjs'
import { openKeyring } from '../models/system-crypto.mjs'
import { probeDeepseek, probeEndpoint } from '../models/probe.mjs'
import { resolveModel } from '../models/resolve.mjs'
import { iconPath } from '../assets/icon.mjs'
import { applyZoomWindow, currentDisplay, onDisplay } from '../main/display.mjs'
import { zoomWindowSize } from '../main/zoom.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
let vault
let playIntro = async () => {}
let bound = false
let firstWin
// 内容区基准尺寸（CSS 像素）：字号档位放大的是它，超过工作区就贴工作区
const BASE_SIZE = { width: 560, height: 410 }

function useVault() {
  if (!vault) vault = createVault({ root: appRoot() })
  return vault
}

// 默认模型配好了没有：只认钥匙串里的 DeepSeek 钥匙（key.bin 不认）。
function modelReady() {
  return modelConfigured(resolveModel({ files: modelFiles(), keyring: openKeyring() }))
}

function windowOptions() {
  const size = zoomWindowSize({ ...BASE_SIZE, scale: currentDisplay().fontScale, workArea: screen.getPrimaryDisplay().workArea })
  return {
    // 内容区 560 宽；页面内容 409 高，教程页文字多一行，留到 410（字号档位放大）
    width: size.width,
    height: size.height,
    useContentSize: true,
    center: true,
    // 不要系统标题栏：页面顶上那一条拖窗口，右上角自己画圆形关闭按钮
    frame: false,
    show: false,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    title: t('firstRun.titlebar'),
    icon: iconPath,
    webPreferences: {
      preload: join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

function open() {
  if (firstWin && !firstWin.isDestroyed()) {
    firstWin.show()
    firstWin.focus()
    return
  }
  firstWin = new BrowserWindow(windowOptions())
  // 字号跟着设置走；Ctrl 滚轮那路缩放关掉，只认四档
  applyZoomWindow(firstWin, { ...BASE_SIZE, scale: currentDisplay().fontScale })
  // 尺寸定下来以后摆到屏幕正中
  firstWin.center()
  firstWin.once('ready-to-show', () => firstWin.show())
  firstWin.loadFile(join(dir, 'page.html'), { query: { view: 'first' } })
}

function bind() {
  if (bound) return
  bound = true
  // 字号档位变了：开着的首次运行窗立刻变
  onDisplay(({ fontScale }) => applyZoomWindow(firstWin, { ...BASE_SIZE, scale: fontScale }))
  ipcMain.handle('byok:boot', () => {
    const store = useVault()
    const ready = modelReady()
    return {
      hint: INTRO_HINT,
      step: firstStep({ ready, introPlayed: store.introPlayed() }),
    }
  })
  // DeepSeek：先测后存，钥匙只在主进程过手，不回传页面
  ipcMain.handle('byok:save-deepseek', (_event, key) =>
    saveDeepseek({ files: modelFiles(), keyring: openKeyring(), key, probe: probeDeepseek }),
  )
  // 智谱：测试并保存一条自定义条目，再把默认换到 glm-4.7-flash
  ipcMain.handle('byok:save-zhipu', (_event, key) =>
    saveZhipu({ files: modelFiles(), keyring: openKeyring(), key, test: testAndSave, probe: probeEndpoint }),
  )
  // Kilo 模型：先看说明，同意写盘成功才把条目加回去、把默认换过去；不同意就留在原地
  ipcMain.handle('byok:free', async () => {
    const agreed = await openFreeConsent({ parent: firstWin })
    if (!agreed) return { ok: false }
    return saveKilo(modelFiles())
  })
  // 「配好了」：设置里选的默认模型能用才算数。没配好只说「配置未完成」：
  // 用户选的是自定义，默认还停在 DeepSeek 时，不能回一句「DeepSeek 密钥未填写」
  ipcMain.handle('byok:check-custom', () => {
    const resolved = resolveModel({ files: modelFiles(), keyring: openKeyring() })
    return resolved.ok === true ? { ok: true } : { ok: false, message: t('firstRun.customNotReady') }
  })
  // 密钥获取教程：文字来自 guides.mjs，链接打开前再过一遍 isGuideUrl
  ipcMain.handle('byok:guide', (_event, which) =>
    guideView(which === 'zhipu' ? GUIDES.zhipu : GUIDES.deepseek),
  )
  ipcMain.handle('byok:open-url', (_event, url) => {
    if (isGuideUrl(url)) shell.openExternal(url)
  })
  ipcMain.handle('byok:open-settings', () => openSettings('models'))
  ipcMain.handle('byok:intro', async () => {
    const store = useVault()
    // 只放这一次：放过就记着，不再来一遍
    const played = store.introPlayed()
    store.markIntro()
    await playIntroOnce(played, playIntro)
    return INTRO_HINT
  })
  ipcMain.handle('byok:close', () => {
    if (firstWin && !firstWin.isDestroyed()) firstWin.close()
  })
}

export function begin(options = {}) {
  if (options.playIntro) playIntro = options.playIntro
  bind()
  const store = useVault()
  if (!needFirstRun({ ready: modelReady(), introPlayed: store.introPlayed() })) return false
  open()
  return true
}
