import { app, powerMonitor, shell } from 'electron'
import { installEditMenu } from './edit-menu.mjs'
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runUninstallConfirm, wantsUninstallConfirm } from '../uninstall/shell.mjs'
import { abilitiesForTask, abilityFiles, withAbilities } from '../abilities/launch.mjs'
import { begin } from '../byok/shell.mjs'
import { openSettings } from '../settings/shell.mjs'
import { createVault } from '../byok/vault.mjs'
import { applyLoginItem } from './login-item.mjs'
import { islandClick, modelConfigured } from './first-run.mjs'
import { startupPlan } from './startup.mjs'
import { runTask, setAcpRouteProvider, setDaemonEnvProvider, startDaemon, startTempSweep, stopDaemon, writeGlobalConfig, restartDaemon, daemonState } from '../dsh/index.mjs'
import { setGenerator } from '../news/bridge.mjs'
import { createNewsRunner } from '../news/runner.mjs'
import { createScheduler } from '../news/schedule.mjs'
import { issueDir, loadNewsPrefs, loadTopics } from '../news/topics.mjs'
import { newsFile } from '../settings/news.mjs'
import { createHistory } from '../task/history.mjs'
import { startTask } from '../task/shell.mjs'
import { modelFiles } from '../models/files.mjs'
import { acpRoute, globalPatchTexts, searchConfig } from '../models/global.mjs'
import { resolveModel } from '../models/resolve.mjs'
import { setRestartHandlers } from '../models/restart-service.mjs'
import { openKeyring } from '../models/system-crypto.mjs'
import { startPet } from '../pet/shell.mjs'
import { createNewsEntry } from '../pet/news.mjs'
import { appPaths, appRoot, dataPaths, ensureDataDir } from '../paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')

// Electron 的 profile 目录：%LOCALAPPDATA%\sidemate\electron\。
// 目录不存在时问 Electron 要这个路径（app.getPath）本身就会把进程打崩，所以自己算、自己建，
// 建好再 setPath。必须早于单实例锁、早于任何 getPath('userData')。
// 已经有人指到别的地方去了就不覆盖：测试用 SIDEMATE_USER_DATA 指、命令行 --user-data-dir 指、
// 或者别的程序用 app.setPath 指过的，都照它去。
function setupUserData() {
  const dir = appPaths().electron
  // 测试指的地方：照它去
  const injected = String(process.env.SIDEMATE_USER_DATA ?? '').trim()
  if (injected) {
    try {
      app.setPath('userData', injected)
    } catch {
      // 设不了就算了
    }
    return injected
  }
  // 命令行指的地方：Chromium 自己会照它去，别抢
  try {
    if (app.commandLine?.hasSwitch?.('user-data-dir')) return app.commandLine.getSwitchValue('user-data-dir')
  } catch {
    // 问不出来就照默认走
  }
  // 目录建出来再指过去：Chromium 建 profile 时目录不在会直接崩
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // 建不出来也不能耽误桌伴起来（下面 setPath 照样做，Electron 自己会再试）
  }
  try {
    app.setPath('userData', dir)
  } catch {
    // 设不了就照 Electron 自己的默认值走
  }
  return dir
}

// 卸载前那一问（卸载器带 --uninstall-confirm 起的）：只开那个小窗，Electron 目录放临时目录里，
// 不碰桌伴自己的目录（选了删数据的话，这个窗口一关卸载器就要删它）
const uninstallMode = wantsUninstallConfirm(process.argv)
if (uninstallMode) {
  try { app.setPath('userData', join(tmpdir(), 'sidemate-uninstall')) } catch { /* 设不了就照默认走 */ }
} else {
  setupUserData()
}

let pet = null, task = null
// 开机启动那一次（命令行带 --login）：只出小岛，不开任务窗、不播出场、不自己弹首次运行
const plan = startupPlan({ argv: process.argv })
let news = null // 新闻后台：{ generate }
let newsEntry = null // 新闻入口：订阅菜单、未读、已读（app/pet/news.mjs）
let newsHistory = null // 新闻的对话记录：跟任务窗同一个目录，点开某份新闻要按工作区找那条

// 小岛的开场只放一次：模型配好了但开场还没放过（小岛滑下来冒一行），放一次，不弹窗
function playIslandIntro(configured) {
  if (configured !== true) return
  try {
    const vault = createVault({ root: appRoot() })
    if (vault.introPlayed()) return
    vault.markIntro()
    void pet?.playIntro?.()
  } catch {
    // 放不成也不耽误干活
  }
}

// 第二个桌伴被双击起来了：把已经在跑的那个叫到前面。还没准备好就什么都不做。
function focusRunning() {
  if (!app.isReady() || !task) return
  try { if (!begin()) task.open() } catch { /* 叫不回来就算了 */ }
}

// 开机启动的登记：打包了才真登记；跟现状一致就不写注册表
function syncLoginItem() {
  try {
    const vault = createVault({ root: appRoot() })
    return applyLoginItem(app, { pref: vault.openAtLogin(), execPath: process.execPath })
  } catch {
    // 登记不了不能耽误桌伴起来
    return null
  }
}

// 新闻后台的日志：一条一行流水，坏了不能误事。
function makeNewsLog(file) {
  return (event, data = {}) => {
    ensureDataDir()
    try { appendFileSync(file, `${JSON.stringify({ t: Date.now(), event, ...data })}\n`) } catch { /* 日志坏了不能误事 */ }
  }
}

// 新闻后台：runner 一份一份地生成，scheduler 到点喊它。
// 主题和整页设置在程序数据目录下的 news.json（跟设置页的「新闻」页同一个文件），
// 生成的文件在 news\<主题id>\<日期>\，上次跑的时间记在 data\news-run.json。
// 每分钟轮一次，电脑睡醒马上再轮一次。
function startNews() {
  const log = makeNewsLog(dataPaths().newsLog)
  const paths = appPaths()
  const root = paths.news
  const topicsFile = newsFile(appRoot())
  const keyring = () => openKeyring()
  // 有没有 DeepSeek 的钥匙：联网搜索靠它
  const deepSeekKey = () => {
    try { return Boolean(keyring().read('deepseek')) } catch { return false }
  }
  const runner = createNewsRunner({
    // 生成的文件都在新闻目录（news\<主题id>\<日期>），不往别处写；
    // 接着问产出的文件交到 news\<主题id>\
    root,
    outputRoot: appRoot(),
    topicsFile,
    runTask,
    // 跟任务窗同一套：先算清用哪个模型（resolveModel），再并上能力（技能开关、外部工具服务）。
    // choice 是要用的条目：新闻这一轮用默认模型（传 null，跟任务窗没选模型时一样）。
    model: (choice) => {
      const ring = keyring()
      const picked = resolveModel({ choice: choice ?? null, files: modelFiles(), keyring: ring })
      return withAbilities(picked, abilitiesForTask({
        files: abilityFiles({ repo, deskRoot: appRoot() }),
        keyring: ring,
        log,
        // 联网搜索要真有 DeepSeek 的钥匙才挂
        hasSearchKey: deepSeekKey(),
      }))
    },
    // 对话记录跟任务窗记在同一个地方（各在任务/新闻自己的文件夹里），「全部对话」里能一起看到
    history: createHistory({ tasksDir: paths.tasks, newsDir: paths.news }),
    log,
    // 跑完了：记一条日志；成功了小岛那边亮红点（生成那边给的对话编号也记下，点开不用再找）
    onDone: (result) => {
      log('done', {
        topicId: result?.topicId ?? '',
        ok: result?.ok === true,
        items: result?.items ?? 0,
        message: result?.message ?? '',
        historyId: result?.historyId ?? '',
      })
      if (result?.ok !== true) return
      newsEntry?.onGenerated({ topicId: result.topicId, date: result.date, historyId: result.historyId })
      syncNewsAlert()
    },
  })
  const scheduler = createScheduler({
    file: dataPaths().newsRun,
    // 错过的那些天记在新闻目录里（主题那一层）
    root: paths.news,
    // 每轮都重读主题文件：改了主题、改了时间点，下一分钟就跟着变
    topics: () => loadTopics(topicsFile),
    run: async (topicId) => {
      const result = await runner.generate(topicId, { reason: 'schedule' })
      if (result && result.ok === false) throw new Error(result.message || 'news failed')
    },
  })
  const tick = () => {
    scheduler.tick()
      .then((state) => { if (state !== 'idle') log('tick', { state }) })
      .catch((error) => log('tick-failed', { error: error?.message || '' }))
  }
  tick()
  const timer = setInterval(tick, 60_000)
  // 电脑睡醒了马上轮一次，别等下一个整分钟
  powerMonitor.on('resume', tick)
  app.on('before-quit', () => clearInterval(timer))
  return runner
}

// 新闻的对话记录：跟任务窗同一套（扫任务文件夹和新闻的每一期），按内部日期目录找那一条
function newsHistoryList(folder) {
  newsHistory ??= createHistory({ tasksDir: appPaths().tasks, newsDir: appPaths().news })
  try {
    return newsHistory.list({ kind: 'news', folder })
  } catch {
    return []
  }
}

// 设置那边改了（模型清单、能力开关、同意状态）：整份重写 dsh 的全局配置。
// dsh 的热加载盯着 <dsh 家>\cordis.patch.yml：正在说的那句用老配置，下一句用新的，不用重启进程。
// 这份文件只有这里写：任务各写各的会互相覆盖。
function refreshGlobalConfig() {
  try {
    const ring = openKeyring()
    const abilities = abilitiesForTask({
      files: abilityFiles({ repo, deskRoot: appRoot() }),
      keyring: ring,
      log: () => {},
    })
    const texts = globalPatchTexts({
      files: modelFiles(),
      keyring: ring,
      abilityTexts: abilities?.patchTexts,
      search: searchConfig(),
    })
    return writeGlobalConfig(texts)
  } catch {
    // 写不动就照旧：dsh 起来时照老配置起
  }
}

// 设置改了就把全局配置重写一遍：看那几个文件的时间戳，变了就重写（整份换掉）。
function watchGlobalConfig() {
  const files = modelFiles()
  const paths = [files.catalog, files.consent, files.ability, files.mcp]
  const stamp = (path) => {
    try {
      const info = statSync(path)
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return ''
    }
  }
  let last = paths.map(stamp).join('|')
  const timer = setInterval(() => {
    const now = paths.map(stamp).join('|')
    if (now === last) return
    last = now
    refreshGlobalConfig()
  }, 2000)
  if (typeof timer.unref === 'function') timer.unref()
  app.on('before-quit', () => clearInterval(timer))
}

// 小岛的红点要不要亮：有没看的新闻，且整页设置里「好了说一声」没关
function syncNewsAlert() {
  if (!newsEntry || !pet) return
  const on = newsEntry.hasUnread() && loadNewsPrefs(newsFile(appRoot())).notify !== false
  pet.newsAlert(on)
}

// 打开一份新闻的对话：任务窗先垂下来，再切到那条对话。
// 切成了才算看过（已读记到 新闻-已读.json，红点跟着算）；干活中也能开，正在跑的那条留在后台接着跑。
// 对话记录找不到就退一步打开内部那个日期文件夹，别让用户点了个空。
function openNewsIssue(issue) {
  if (!issue || !newsEntry) return
  const dir = issueDir(appPaths().news, { id: issue.topicId }, issue.date)
  task?.open()
  const id = issue.historyId || newsHistoryList(dir)[0]?.id || ''
  let seen = false
  if (id) seen = task?.openHistory?.(id)?.ok === true
  else { void shell.openPath(dir); seen = true }
  if (seen) newsEntry.markRead(issue.topicId, issue.date)
  syncNewsAlert()
}

if (uninstallMode) runUninstallConfirm()
else if (!app.requestSingleInstanceLock()) app.quit()
else {
  // 全局右键编辑菜单：输入框、选中的字、链接都能弹中文菜单
  installEditMenu()
  app.on('second-instance', (_event, argv) => {
    // 开机启动又起了一个：已经在跑的那个什么都不用做
    if (Array.isArray(argv) && argv.includes('--login')) return
    focusRunning()
  })
  app.whenReady().then(() => {
    // dsh 每轮干完留下的临时目录：起来时收拾一次。
    // 收拾完再起常驻的 dsh 进程（一个进程跑所有任务和新闻）。
    // 全局配置（模型路线、联网、技能开关）先写好：dsh 起来时照这份配置起。
    refreshGlobalConfig()
    watchGlobalConfig()
    // acp 那一行的模型：已配好的模型里第一个能看图的；没有就默认模型。
    // 这一条连接能不能收图片是连接级的，所以常驻进程起的时候就得定好。
    setAcpRouteProvider(() => acpRoute({ files: modelFiles(), keyring: openKeyring() }))
    void startTempSweep().then(() => { void startDaemon() })
    // 各家线路的模型钥匙交给常驻进程：一个进程上跑好几个会话，几条线路的钥匙都得在。
    // 外部工具服务（mcp- 开头的那些）不进环境变量：它们的钥匙随建会话的参数走。
    setDaemonEnvProvider(() => {
      const out = {}
      try {
        const ring = openKeyring()
        const deepseek = ring.read('deepseek')
        if (deepseek) out.DEEPSEEK_API_KEY = deepseek
        Object.assign(out, ring.env(ring.list().filter((id) => !String(id).startsWith('mcp-'))))
      } catch {
        // 读不出来就当没有钥匙：这一轮按没配密钥算
      }
      return out
    })
    task = startTask({
      onPet: (event) => pet?.ingest(event),
      // 任务窗到前台了：小岛那三种状态收回去，回待命
      onOpen: () => pet?.clearHeld?.(),
      anchor: () => pet?.anchor?.(),
      // 任务窗收起来了：小岛再说一遍层级
      onHidden: () => pet?.refreshTop?.(),
    })
    // 设置那边改了模型/钥匙：要不要重起 dsh、要不要先问用户一句，由那边算
    // （规则在 app/models/restart.mjs，这里只把桌伴这头的动作接进去）
    setRestartHandlers({
      busy: () => task?.busy?.() === true,
      inUse: () => task?.inUse?.() ?? [],
      interrupt: (choices) => task?.interrupt?.(choices) ?? 0,
      restart: () => restartDaemon(),
      refresh: () => refreshGlobalConfig(),
      daemonState: () => daemonState(),
    })
    newsEntry = createNewsEntry({ root: () => appRoot(), low: () => appPaths().news, topicsFile: () => newsFile(appRoot()) })
    pet = startPet({
      // 任务窗出来以后，小岛再说一遍层级
      openTask: (detail) => {
        task.open(detail)
        pet?.refreshTop?.()
        // 小岛抢了层级，任务窗再抢回来：任务窗在小岛上面（点小岛还是能收回去）
        task.raiseAbove?.()
      },
      // 小岛点了：没配过模型的新用户走首次运行（贴钥匙）；配过的照常开任务窗。
      // detail：小岛停在做完了 / 要你看一眼 / 没干成时带着那一轮的 taskId，任务窗打开就切到那条对话
      toggleTask: (detail) => {
        const configured = modelConfigured(resolveModel({ files: modelFiles(), keyring: openKeyring() }))
        const route = islandClick({ configured, login: plan.login })
        if (route === 'first-run' && begin({ playIntro: () => pet.playIntro() })) return 'opened'
        playIslandIntro(configured)
        return task.toggle(detail)
      },
      openSettings,
      recent: task.recent,
      // 新闻入口：菜单数据在这边现算；红点亮不亮看用户手头忙不忙；点一下开最新那份
      news: newsEntry,
      isBusy: () => task?.busy?.() === true,
      openNews: (pick) => {
        // 菜单点的是某一天（topicId + date），红点点的开最新那份；都换成整份信息再去开
        const issue = pick?.topicId
          ? newsEntry.issueOf(pick.topicId, String(pick.date ?? '')) ?? pick
          : pick ?? newsEntry.latest()
        openNewsIssue(issue)
      },
      // 小岛的「保持在最前」：任务窗跟着
      setTaskTop: (value) => task.setOnTop(value),
      // 小岛被叫回最前时：任务窗跟着到前面
      raiseTask: () => task.raise?.(),
      // 小岛改了大小、或者被拖走了：任务窗跟着重摆到小岛正下方（缝 0）
      relayoutTask: () => task.relayout?.(),
    })
    news = startNews()
    // 设置页「现在生成」走这个口子：后台起来了，把生成的办法交给桥
    setGenerator((id) => news.generate(id, { reason: 'now' }))
    // 之前生成好还没看的：开机红点也亮着，再眨两下让人看见
    syncNewsAlert()
    if (process.env.SIDEMATE_OPEN === 'settings') openSettings()
    // 开机启动的登记：打包了才真登记
    syncLoginItem()
    // 开机启动那次只出小岛：不开任务窗、不播出场、不自己弹首次运行
    if (plan.firstRun && !begin({ playIntro: () => pet.playIntro() })) task.open()
  })
}

app.on('window-all-closed', () => {})

// 桌伴退出时把常驻的 dsh 进程收掉
app.on('before-quit', () => {
  stopDaemon()
})
