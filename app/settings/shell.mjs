// 设置窗：720×560、左边目录、右边内容区。左边目录是「模型」「能力」「新闻」「用量」「显示」「关于」。
// 窗口写法跟 app/byok/shell.mjs 一致：preload、contextIsolation、sandbox，只开一个，已开就 show + focus。
import { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage, screen, shell } from 'electron'
import { t } from '../copy/copy.mjs'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindUsageStore, usageView } from '../usage/index.mjs'
import { loadCatalog, removeEntry, removeModel as removeModelFrom, saveCatalog, stripSecrets } from '../models/catalog.mjs'
import { addKilo } from '../models/catalog.mjs'
import { setDefault } from '../models/catalog.mjs'
import { createConsent } from '../models/consent.mjs'
import { createKeyring, keyBroken, maskKey } from '../models/keys.mjs'
import { GUIDES, isGuideUrl } from '../models/guides.mjs'
import { KILO_ENTRY_ID } from '../models/kilo.mjs'
import { probeDeepseek, probeEndpoint } from '../models/probe.mjs'
import { createVault } from '../byok/vault.mjs'
import { busy as tasksBusy, daemonState, interrupt as interruptTasks, planChange, refreshConfig, restart as restartDaemon, waitHotReload } from '../models/restart-service.mjs'
import { refreshKeyQueue } from '../task/queue.mjs'
import { loginItemOpen, readLoginItem, setLoginItem } from '../main/login-item.mjs'
import { appPaths, appRoot, dataPaths, ensureDataDir } from '../paths.mjs'
import { modelFiles } from '../models/files.mjs'
import { openKeyring } from '../models/system-crypto.mjs'
import { generate as generateNews, nameTopic, openIssue } from '../news/bridge.mjs'
import { onStatusChange as onNewsStatus } from '../news/status.mjs'
import { iconPath } from '../assets/icon.mjs'
import { DOCS, SITE_URL, SOURCE_URL, consentLine, docPath, isSourceUrl } from './about.mjs'
import { addKiloEntry, chooseDefault, guideAction, modelRows, removeCustom, removeKey, removeKilo, removeModel, rowsWarning, setConcurrency } from './models.mjs'
import { dialogPayload, probeInput, testAndSave } from './custom.mjs'
import {
  loadNewsPrefs,
  needsName,
  newsFile,
  newsView as buildNewsView,
  removeNewsTopic,
  saveNewsForm,
  saveNewsPrefs,
  setNewsEnabled,
  setNewsPermission,
} from './news.mjs'
import {
  abilitiesPaths,
  abilitiesView as buildAbilitiesView,
  allowedRepoUrl,
  importUserSkill,
  mcpDialogPayload,
  probeForm,
  removeMcpEntry,
  removeUserSkill,
  saveMcpForm,
  saveTool,
  setMcpEnabled,
  setSkillEnabled,
} from './abilities.mjs'
import { loadMcp, parsePasted } from '../abilities/mcp.mjs'
import { openFreeConsent } from '../consent/shell.mjs'
import { applyZoomWindow, currentDisplay, onDisplay, setIslandScale, setFontScale } from '../main/display.mjs'
import { zoomWindowSize } from '../main/zoom.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
let win = null
let bound = false
let usageStore = null
let keyring = null
// 内容区基准尺寸（CSS 像素）：字号档位放大的是它，超过工作区就贴工作区
const BASE_SIZE = { width: 720, height: 592 }

// 新闻那一页要重画：开始生成、排队、跑完、名字起好了都推一声，页面收到就重新要一遍这一页。
// payload 里带着跑完那次的结果（{ id, ok, message }），页面用它写卡片下面那句交代或红字。
export function newsNotify(payload = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('settings:news-changed', payload)
}
onNewsStatus(() => newsNotify({}))

// 设置窗的日志：界面上报错只说是哪一类（文件过大、配置错误……），哪个文件、哪条规矩没过记在这里。
// 跟 task.log 放在一起（程序数据目录 data\ 下的 settings.log），不写密钥。
function log(event, data = {}) {
  ensureDataDir()
  try { appendFileSync(dataPaths().settingsLog, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`) } catch { /* 日志坏了不能误事 */ }
}

// 没成的时候把细节记一笔，结果原样交回页面
function noted(event, back, extra = {}) {
  if (back && back.ok !== true) log(event, { message: back.message || '', detail: back.detail || '', ...extra })
  return back
}

// 照抄 app/byok/shell.mjs 的 systemCrypto：加解密都走系统的 safeStorage
function systemCrypto() {
  return {
    available: () => {
      try { return safeStorage.isEncryptionAvailable() } catch { return false }
    },
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buf) => safeStorage.decryptString(buf),
  }
}

// 钥匙跟清单、能力那几份文件在一起，第一次用到才建
function modelKeyring() {
  if (!keyring) {
    const files = modelFiles()
    keyring = createKeyring({ files: { catalog: files.catalog, mcp: files.mcp }, crypto: systemCrypto() })
  }
  return keyring
}

function windowOptions() {
  const size = zoomWindowSize({ ...BASE_SIZE, scale: currentDisplay().fontScale, workArea: screen.getPrimaryDisplay().workArea })
  return {
    width: size.width,
    height: size.height,
    useContentSize: true,
    center: true,
    // 不要系统标题栏：页面顶上 32 高那一条拖窗口，右上角自己画圆形关闭按钮（高度里已经算上这一条）
    frame: false,
    show: false,
    resizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f1e8',
    title: t('nav.title'),
    icon: iconPath,
    webPreferences: {
      preload: join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

function open(page) {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow(windowOptions())
  // 字号跟着设置走；Ctrl 滚轮那路缩放关掉，只认四档
  applyZoomWindow(win, { ...BASE_SIZE, scale: currentDisplay().fontScale })
  // 尺寸定下来以后摆到屏幕正中
  win.center()
  win.once('ready-to-show', () => win.show())
  win.loadFile(join(dir, 'page.html'), { query: { page } })
}

// 同意记录和模型清单都在用户桌伴根目录下，路径从 files.mjs 拿
function consentStore() {
  return createConsent({ file: modelFiles().consent })
}

function defaultIsFree() {
  return loadCatalog(modelFiles().catalog).default?.entry === KILO_ENTRY_ID
}

function consentText() {
  return consentLine(consentStore().status(), { defaultIsFree: defaultIsFree() })
}

function readDoc(name) {
  const one = DOCS.find((doc) => doc.name === name)
  if (!one) return { ok: false, title: '', text: '' }
  const path = docPath(one.name, { packaged: app.isPackaged, appPath: app.getAppPath(), execPath: process.execPath })
  try {
    return { ok: true, title: one.title, text: readFileSync(path, 'utf8') }
  } catch {
    return { ok: false, title: one.title, text: '' }
  }
}

// 页面说「确认过了」：照旧做，不问
function confirmed(options) {
  return options && typeof options === 'object' && options.confirmed === true
}

// 这次改动要不要重起 dsh：有人正在跑就先问一句。
// 返回 { plan, ask }：ask 不是空就说明要先问用户一句（还没保存）
function askBefore(change, isConfirmed) {
  const { plan } = planChange(modelFiles(), modelKeyring(), change)
  if (plan.action !== 'ask' || isConfirmed === true) return { plan, ask: null }
  const text = plan.ask === 'delete' ? t('modelPage.deleteAsk') : t('modelPage.restartAsk')
  return { plan, ask: { kind: plan.ask, text, stage: 'before' } }
}

// 保存完了：整份重写全局配置（dsh 的热加载盯着那个文件）。
// 要重起就中断正在跑的会话、重起常驻进程；删模型只停用它的那些。
// 热加载没成（开着会话却一直没收到刷新）也走重起这条路。
async function afterSave(plan) {
  const before = daemonState().configStamp
  const written = refreshConfig()
  if (plan.hit.length > 0) interruptTasks(plan.hit)
  else if (plan.reasons.length > 0) interruptTasks(null)
  if (plan.reasons.length > 0) {
    restartDaemon()
    return { ask: null }
  }
  if (written?.changed !== true) return { ask: null }
  // 只在「加了新路线」的时候等那一声：实测 dsh 只在路线集合变了的时候报 config_option_update，
  // 改参数、加模型它不报（但热加载照样生效，下一句就用新配置）。
  if (plan.expectReport !== true) return { ask: null }
  const hot = await waitHotReload(before, 10_000)
  if (hot.ok) return { ask: null }
  // 有人正在跑：先问一句，取消了就不重起（新配置等下次重起生效）
  if (tasksBusy()) return { ask: { kind: 'restart', text: t('modelPage.restartAsk'), stage: 'after' } }
  interruptTasks(null)
  restartDaemon()
  return { ask: null }
}

function bind() {
  if (bound) return
  bound = true
  // 字号档位变了（设置页、任务窗 Ctrl 加减都算）：开着的设置窗立刻变
  onDisplay(({ fontScale }) => applyZoomWindow(win, { ...BASE_SIZE, scale: fontScale }))
  // 显示页那两组档位：读当前值、点了存下去（开着的窗都跟着变）
  ipcMain.handle('settings:zoom', () => currentDisplay())
  ipcMain.handle('settings:zoom-set', (_event, kind, value) => {
    if (kind === 'island') setIslandScale(value)
    else if (kind === 'font') setFontScale(value)
    return currentDisplay()
  })
  // 用量记录跟 byok 那份是同一个文件（都在程序数据目录 data\ 下）
  usageStore = bindUsageStore(dataPaths().dir)
  ipcMain.handle('settings:usage', () => usageView(usageStore ? usageStore.read() : []))
  ipcMain.handle('settings:about', () => ({
    version: app.getVersion(),
    docs: DOCS,
    line: consentText(),
    site: SITE_URL,
  }))
  ipcMain.handle('settings:doc', (_event, name) => readDoc(name))
  ipcMain.handle('settings:withdraw', () => {
    consentStore().withdraw()
    return consentText()
  })
  ipcMain.handle('settings:open-source', () => {
    if (isSourceUrl(SOURCE_URL)) shell.openExternal(SOURCE_URL)
  })
  ipcMain.handle('settings:open-site', () => {
    if (typeof SITE_URL === 'string' && SITE_URL) shell.openExternal(SITE_URL)
  })
  // 开机启动：开关显示系统里实际的状态（任务管理器里禁了就是关）；不是打包版就看偏好
  function loginItemView() {
    const pref = createVault({ root: appRoot() }).openAtLogin()
    if (app.isPackaged !== true) return { open: pref === undefined ? true : pref, packaged: false }
    const state = readLoginItem(app, { execPath: process.execPath })
    return { open: loginItemOpen(state), packaged: true }
  }
  ipcMain.handle('settings:login-item', () => loginItemView())
  ipcMain.handle('settings:login-item-toggle', (_event, on) => {
    const want = on === true
    // 存偏好 + 重新登记
    createVault({ root: appRoot() }).setOpenAtLogin(want)
    setLoginItem(app, { openAtLogin: want, execPath: process.execPath })
    return loginItemView()
  })
  // 模型页：每次都现读清单、同意和钥匙状态，页面只管摆上去
  function modelsView() {
    const files = modelFiles()
    return {
      // 给页面的清单不带密文（密文存在 model.json 里，不出主进程）
      catalog: stripSecrets(loadCatalog(files.catalog)),
      hasKey: (id) => modelKeyring().has(id),
      brokenKey: (id) => keyBroken(modelKeyring(), id),
      // 存着的密钥在界面上只露头尾四个
      maskedKey: (id) => maskKey(modelKeyring().read(id)),
      consent: consentStore().status(),
    }
  }
  function modelsAnswer(ok, message) {
    const rows = modelRows(modelsView())
    return { ok, message, rows, warning: rowsWarning(rows) }
  }
  ipcMain.handle('settings:models', () => modelsAnswer(true, ''))
  // Kilo 那行的「使用须知」：没同意过先弹同意弹窗，同意过了直接看条款全文。
  // 弹窗结束后回一份最新的模型页数据，让页面重画那一行。
  ipcMain.handle('settings:kilo-consent', async () => {
    const kilo = modelRows(modelsView()).find((row) => row.id === KILO_ENTRY_ID)
    const action = guideAction(kilo)
    if (action === 'doc') {
      return { ...modelsAnswer(true, ''), action, agreed: true }
    }
    const parent = win && !win.isDestroyed() ? win : undefined
    await openFreeConsent({ parent })
    const answer = modelsAnswer(true, '')
    const agreed = answer.rows.some((row) => row.id === KILO_ENTRY_ID && row.agreed === true)
    return { ...answer, action, agreed }
  })
  ipcMain.handle('settings:choose-default', async (_event, id, options) => {
    const files = modelFiles()
    const catalog = loadCatalog(files.catalog)
    const entry = (catalog.entries || []).find((one) => one && one.id === id)
    const model = entry && (entry.models || [])[0]
    if (entry && model) {
      // 换默认模型：acp 那一行（能不能收图片）跟着变的话，得重起 dsh
      const picked = setDefault(catalog, { entry: id, model: model.id, effort: null })
      if (picked.ok) {
        const guard = askBefore({ catalog: picked.catalog }, confirmed(options))
        if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
        const back = chooseDefault(files, id, modelsView())
        const after = await afterSave(guard.plan)
        return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
      }
    }
    return chooseDefault(files, id, modelsView())
  })
  // 先测钥匙，通了才存；钥匙原文只到这里，不回传页面、不进日志
  ipcMain.handle('settings:deepseek-save', async (_event, key, options) => {
    const text = String(key ?? '')
    const probed = await probeDeepseek({ key: text })
    if (!probed.ok) return modelsAnswer(false, probed.message)
    // 钥匙换了：常驻的 dsh 进程只在起的时候读一次环境变量，得重起
    const guard = askBefore({ keys: { deepseek: text } }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    const saved = modelKeyring().save('deepseek', text)
    if (!saved.ok) return modelsAnswer(false, saved.message)
    const after = await afterSave(guard.plan)
    return { ...modelsAnswer(true, probed.message), ...(after.ask ? { ask: after.ask } : {}) }
  })
  ipcMain.handle('settings:remove-key', async (_event, id, options) => {
    const guard = askBefore({ keys: { [String(id)]: null } }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    const back = removeKey(modelFiles(), modelKeyring(), id, modelsView())
    const after = await afterSave(guard.plan)
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  ipcMain.handle('settings:remove-custom', async (_event, id, options) => {
    const files = modelFiles()
    const removed = removeEntry(loadCatalog(files.catalog), String(id))
    if (!removed.ok) return modelsAnswer(false, removed.errors[0])
    // 删条目：连这把钥匙一起没了；正在用它的任务会被打断
    const guard = askBefore({ catalog: removed.catalog, keys: { [String(id)]: null }, deleting: true }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    const back = removeCustom(files, modelKeyring(), id, modelsView())
    const after = await afterSave(guard.plan)
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  // 删一个模型（条目留着）：正在用它的任务会被打断
  ipcMain.handle('settings:remove-model', async (_event, entryId, modelId, options) => {
    const files = modelFiles()
    const removed = removeModelFrom(loadCatalog(files.catalog), String(entryId), String(modelId))
    if (!removed.ok) return modelsAnswer(false, removed.errors[0])
    const guard = askBefore({ catalog: removed.catalog, deleting: true }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    saveCatalog(files.catalog, removed.catalog)
    const back = modelsAnswer(true, '')
    const after = await afterSave(guard.plan)
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  // 删 Kilo：条目和用户对使用须知的两个同意一起撤掉
  ipcMain.handle('settings:remove-kilo', async (_event, options) => {
    const files = modelFiles()
    const removed = removeEntry(loadCatalog(files.catalog), KILO_ENTRY_ID)
    if (!removed.ok) return modelsAnswer(false, removed.errors[0])
    const guard = askBefore({ catalog: removed.catalog, consented: false, deleting: true }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    const back = removeKilo(files, modelsView())
    const after = await afterSave(guard.plan)
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  // 加回 Kilo：地址和模型照代码常量写
  ipcMain.handle('settings:add-kilo', async (_event, options) => {
    const files = modelFiles()
    const added = addKiloTo(loadCatalog(files.catalog))
    if (!added.ok) return modelsAnswer(false, added.errors[0])
    const guard = askBefore({ catalog: added.catalog }, confirmed(options))
    if (guard.ask) return { ...modelsAnswer(true, ''), ask: guard.ask }
    const back = addKiloEntry(files, modelsView())
    const after = await afterSave(guard.plan)
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  // 改一把密钥的并发上限：0 表示不限
  ipcMain.handle('settings:concurrency', (_event, id, value) => {
    const back = setConcurrency(modelFiles(), id, value, modelsView())
    // 上限改了：排着的那些立刻能上
    refreshKeyQueue()
    return back
  })
  // 热加载没成、用户点了「继续保存」：现在就重起常驻的 dsh
  ipcMain.handle('settings:restart', () => {
    interruptTasks(null)
    restartDaemon()
    return modelsAnswer(true, '')
  })
  // 密钥获取教程：只放行 guides.mjs 表里的官方地址；传 zhipu 就开智谱那篇
  ipcMain.handle('settings:open-guide', (_event, which) => {
    const guide = which === 'zhipu' ? GUIDES.zhipu : GUIDES.deepseek
    const url = guide.docs.url
    if (isGuideUrl(url)) shell.openExternal(url)
  })
  // 「加一个自定义模型」弹窗：打开要的表单、只测不存的探针、测试并保存
  // 改已有条目时带上「存过密钥没有」（只说是非，不给密钥）：密钥框的占位字照它写
  ipcMain.handle('settings:custom-form', (_event, id, options) => {
    const payload = dialogPayload(loadCatalog(modelFiles().catalog), id, options)
    let hasKey = false
    try { hasKey = Boolean(id) && modelKeyring().has(String(id)) } catch { hasKey = false }
    return payload && typeof payload === 'object' ? { ...payload, hasKey } : payload
  })
  ipcMain.handle('settings:probe', async (_event, form) => probeEndpoint(probeInput(form, modelKeyring())))
  // 「加一个自定义模型」弹窗：存之前算一下这次改动要不要重起 dsh，
  // 有人正在跑就先问用户一句（问过了就照旧存）
  ipcMain.handle('settings:save-custom', async (_event, form, options) => {
    const isConfirmed = confirmed(options)
    let plan = null
    const back = await testAndSave(modelFiles(), modelKeyring(), form, {
      probe: probeEndpoint,
      guard: async (change) => {
        const got = planChange(modelFiles(), modelKeyring(), change)
        plan = got.plan
        if (plan.action !== 'ask' || isConfirmed === true) return null
        const text = plan.ask === 'delete' ? t('modelPage.deleteAsk') : t('modelPage.restartAsk')
        return { ask: { kind: plan.ask, text, stage: 'before' } }
      },
    })
    if (back.ask) return back
    if (back.ok !== true) return noted('custom-save-failed', back)
    const after = await afterSave(plan || { reasons: [], hit: [] })
    return { ...back, ...(after.ask ? { ask: after.ask } : {}) }
  })
  // 新闻页：主题清单在程序数据目录下的 news.json，跟模型清单不是一个文件
  function hasDeepseekKey() {
    try {
      return openKeyring().has('deepseek')
    } catch {
      return false
    }
  }
  // 有没有开着的外部工具服务：搜索工具靠它
  function hasSearchTool() {
    try {
      return loadMcp(abilitiesPaths().mcpFile).some((one) => one && one.enabled !== false)
    } catch {
      return false
    }
  }
  // 新闻页：能不能生成只看有没有 DeepSeek 密钥（新闻只认它自带的联网搜索）
  function newsPage(extra = {}) {
    const view = buildNewsView(newsFile(), { hasKey: hasDeepseekKey(), hasSearchTool: hasSearchTool() })
    return { ...view, ...extra }
  }
  ipcMain.handle('settings:news-list', () => newsPage())
  // 存一张卡：想看什么、频率和时间都走这一个（页面上停笔 600ms 或失焦才调）；没有 id 就是新建。
  // 那句话变了：名字先按本地规则顶上，后台再问模型要一个（回来会推 settings:news-changed）
  ipcMain.handle('settings:news-save', (_event, form) => {
    const back = saveNewsForm(newsFile(), form)
    if (back.ok && back.topic && needsName(back.topic)) nameTopic(back.topic.id)
    return newsPage({ ok: back.ok, message: back.message, errors: back.errors, savedId: back.topic?.id || '' })
  })
  // 删一张卡：页面上先问过了；只删订阅，已经生成的那几期不动
  ipcMain.handle('settings:news-remove', (_event, id) => {
    const back = removeNewsTopic(newsFile(), id)
    return newsPage({ ok: back.ok, message: back.message, errors: back.errors })
  })
  // 「立即生成」：交给新闻后台就回来，不等它跑完。正在生成 / 排队中 / 跑完了都由
  // settings:news-changed 推过来（页面收到就重新要一遍这一页）；失败那句红字跟着跑完那次推过来。
  ipcMain.handle('settings:news-generate', (_event, topicId) => {
    const id = String(topicId ?? '')
    void generateNews(id).then((result) => {
      if (result?.ok === true) newsNotify({ id, ok: true, message: String(result.message || '') })
      else newsNotify({ id, ok: false, message: String(result?.message || '') })
    })
    return newsPage()
  })
  // 「看看」：打开这个主题今天那一份（跟右键菜单点开走同一条路）
  ipcMain.handle('settings:news-look', (_event, id, date) => {
    openIssue(id, date)
    return { ok: true }
  })
  ipcMain.handle('settings:news-toggle', (_event, id, enabled) => {
    const back = setNewsEnabled(newsFile(), id, enabled === true)
    return newsPage({ ok: back.ok, message: back.message, errors: back.errors })
  })
  // 权限开关：开 = allow，关 = deny（默认）
  ipcMain.handle('settings:news-permission', (_event, allowed) => {
    const back = setNewsPermission(newsFile(), allowed === true)
    return newsPage({ ok: back.ok, message: back.message, errors: back.errors })
  })
  // 整页那两项设置：错过补不补、好了说不说
  ipcMain.handle('settings:news-prefs', (_event, prefs) => {
    if (prefs === undefined || prefs === null) {
      return { ok: true, prefs: loadNewsPrefs(newsFile()), errors: [] }
    }
    const back = saveNewsPrefs(newsFile(), prefs)
    return { ok: back.ok, prefs: back.prefs, errors: back.errors, message: back.message || '' }
  })
  // 能力页：技能、联网搜索、MCP 都在程序数据目录下的 ability.json、mcp.json 和 skills\
  function abilitiesPage(extra = {}) {
    return {
      ...buildAbilitiesView(abilitiesPaths(), {
        hasKey: hasDeepseekKey(),
        records: usageStore ? usageStore.read() : [],
      }),
      ...extra,
    }
  }
  ipcMain.handle('settings:abilities-list', () => abilitiesPage())
  ipcMain.handle('settings:abilities-skill-toggle', (_event, source, id, on) => {
    setSkillEnabled(abilitiesPaths().stateFile, source, id, on === true)
    return abilitiesPage()
  })
  // 「＋ 导入技能」：先弹「选文件夹… / 选 .zip…」小菜单，选完再开系统选文件框，交给导入检查
  ipcMain.handle('settings:abilities-import', async () => {
    const parent = win && !win.isDestroyed() ? win : null
    if (!parent) return { canceled: true, ok: false, problems: [] }
    const kind = await new Promise((resolve) => {
      let done = false
      const finish = (value) => {
        if (!done) {
          done = true
          resolve(value)
        }
      }
      Menu.buildFromTemplate([
        { label: t('skills.pickFolder'), click: () => finish('dir') },
        { label: t('skills.pickZip'), click: () => finish('zip') },
      ]).popup({ window: parent, callback: () => finish('') })
    })
    if (!kind) return { canceled: true, ok: false, problems: [] }
    const picked = kind === 'dir'
      ? await dialog.showOpenDialog(parent, { title: t('skills.pickFolderTitle'), properties: ['openDirectory'] })
      : await dialog.showOpenDialog(parent, {
          title: t('skills.pickZipTitle'),
          properties: ['openFile'],
          filters: [{ name: t('skills.zipFilter'), extensions: ['zip'] }],
        })
    const from = picked.filePaths && picked.filePaths[0]
    if (!from) return { canceled: true, ok: false, problems: [] }
    const back = importUserSkill(abilitiesPaths().userDir, from, abilitiesPaths().stateFile)
    // 本机的 cpSync 遇上中文目的路径会报成功但没拷连去，导入完核一眼再报给页面
    const landed = back.ok === true && existsSync(join(abilitiesPaths().userDir, back.id))
    const lost = back.ok === true && !landed
    const result = {
      ...back,
      ok: landed,
      problems: lost ? [t('skills.readFailed')] : back.problems,
      detail: lost ? `copy reported ok but ${back.id} is missing` : back.detail,
    }
    noted('skill-import-failed', result, { id: back.id || '' })
    return { ...result, canceled: false, view: abilitiesPage() }
  })
  ipcMain.handle('settings:abilities-skill-remove', (_event, id) => {
    const back = noted('skill-remove-failed', removeUserSkill(abilitiesPaths().userDir, id))
    return { ...back, view: abilitiesPage() }
  })
  // 联网搜索、读网页、本地网络这几个开关只存状态（能力.json 的 tools 字段）
  ipcMain.handle('settings:abilities-tool-toggle', (_event, tool, on) => {
    const back = saveTool(abilitiesPaths().stateFile, tool, on === true)
    return abilitiesPage({ ok: back.ok })
  })
  ipcMain.handle('settings:abilities-mcp-toggle', (_event, id, on) => {
    setMcpEnabled(abilitiesPaths().mcpFile, id, on === true)
    return abilitiesPage()
  })
  // 「加一个 MCP」弹窗要的那份：表单和有没有旧钥匙（只说是非，不给钥匙）
  ipcMain.handle('settings:abilities-mcp-form', (_event, id) =>
    mcpDialogPayload(abilitiesPaths().mcpFile, id, modelKeyring()))
  ipcMain.handle('settings:abilities-parse', (_event, text) => {
    const back = parsePasted(String(text ?? ''))
    if (back.problems.length) log('mcp-paste-problems', { detail: back.problems.map((one) => one.detail).join('; ') })
    return back
  })
  // 「测一下」：钥匙原文只在这一下 IPC 和探针里，不回页面、不进日志
  ipcMain.handle('settings:abilities-probe', async (_event, form) => {
    const back = await probeForm(form, modelKeyring())
    if (back.ok !== true) log('mcp-probe-failed', { kind: back.kind || '', code: back.code || '', status: back.status || 0 })
    return {
      ok: back.ok === true,
      tools: (Array.isArray(back.tools) ? back.tools : []).map((one) => (one && typeof one === 'object' ? String(one.name ?? '') : '')),
      message: String(back.message ?? ''),
    }
  })
  ipcMain.handle('settings:abilities-mcp-save', (_event, form, test) => {
    const back = noted('mcp-save-failed', saveMcpForm(abilitiesPaths().mcpFile, form, test, modelKeyring()))
    return { ...back, view: abilitiesPage() }
  })
  ipcMain.handle('settings:abilities-mcp-remove', (_event, id) => {
    const back = removeMcpEntry(abilitiesPaths().mcpFile, id, modelKeyring())
    return { ...back, view: abilitiesPage() }
  })
  // 「打开文件夹」：把技能目录打开给用户看（他自己往里放技能文件）
  ipcMain.handle('settings:abilities-open-folder', () => {
    const dir = abilitiesPaths().userDir
    try { mkdirSync(dir, { recursive: true }) } catch { /* 建不了就交给打开 */ }
    void shell.openPath(dir)
    return { ok: true }
  })
  // 第二行里的仓库地址：用系统浏览器打开。只放行 GitHub 仓库的地址，别的地址不开
  ipcMain.handle('settings:abilities-open-repo', (_event, url) => {
    const target = allowedRepoUrl(url)
    if (target === '') return { ok: false, message: t('abilities.repoOnly') }
    shell.openExternal(target)
    return { ok: true }
  })
}

export function openSettings(page = 'models') {
  bind()
  open(page)
}
