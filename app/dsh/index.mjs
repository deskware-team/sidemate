import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasChoice, pickEffort } from './models.mjs'
import { maskSecrets } from './secrets.mjs'
import { reasonForDsh, statusOf } from '../task/codes.mjs'
import { writeAgentsGuide } from './agents-guide.mjs'
import { failText, progressText } from './progress.mjs'
import { phaseOfUpdate, createPhaseEmitter } from './phase.mjs'
import { createPulse } from './pulse.mjs'
import { readTokenUsage, sleep, usageCaughtUp } from './usage.mjs'
import { readTitle } from './title.mjs'
import { runtimeCarrier } from './proc.mjs'
import { RETRY_FILE_ENV, writeRetryPlugin } from './retry-plugin.mjs'
import { STREAM_FILE_ENV, createLiveReplies, writeStreamPlugin } from './stream-plugin.mjs'
import { MODE_METHOD, QUIET_TITLE_METHOD, STEER_METHOD, plainLogText, writeSteerPlugin } from './steer-plugin.mjs'
import { createFileWatcher } from './artifacts.mjs'
import { previewInDaemon } from './preview.mjs'
import { patchFiles } from './patches.mjs'
export { patchFiles }
import { fileBlocks, fileLink, presentedFiles } from './prompt-files.mjs'
import { createPermissionDesk, permissionReason, permissionTarget } from './permission.mjs'
import { keyEnv, redact, routeOf, secretList } from './secrets.mjs'
import { startSweep, sweepPending } from './temp-sweep.mjs'
import { appPaths, appRoot } from '../paths.mjs'
import { daemonFor, daemonOf, extraEnv, rememberEnv, replaceEnv, restartDaemon as restartDaemonFor, setEnvProvider, setResidentBuild, stopAllDaemons, writeGlobalPatch } from './daemon.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')

// 模型多久不吐字、工具多久跑不完都由 dsh 自己管（流空闲时限、工具时限，到了它自己重试）。
// 桌伴不另外掐表；静了多久界面上自己说（./pulse.mjs）。
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic'
const USAGE_WAIT_MS = 3_000
// 头一轮收尾时 dsh 起名字那次调用可能还在路上（跟干活那次同时发的）：最多再等这么久，
// 杀了 dsh 它就再也不起了（只有第一句话会起名字）
const TITLE_WAIT_MS = 2_000
// 起来时收拾临时目录（./temp-sweep.mjs）最多等这么久：真卡住了也不能让活一直起不来。
// 等不到就照起：收拾只删放了一天以上的，新起的 dsh 刚建的东西本来也碰不到
const SWEEP_WAIT_MS = 10_000
// dsh 最后那次失败（码、HTTP 状态、原文）是插件写来的一行，桌伴这边隔一会儿才读到：
// 最多等这么久就当没有（报错还是报，只是没有 dsh 的码）
const FAILURE_WAIT_MS = 2_000
// 刚保存的设置还没热加载完时，切模型会报「不认这个模型选项」：等它把模型选项刷新一遍再试一次，最多等这么久。
const MODEL_WAIT_MS = 10_000

const KEEP_ENV = [
  'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL', 'TZ',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
  'USERNAME', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE',
]

const ZERO = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

// 桌伴给 dsh 用的那一层根（默认程序数据根）：dsh 的家、临时目录、全局说明都在它下面
function dshRootOf(options) {
  return options.lowRoot ?? appRoot()
}

export function payloadLayout(root = join(repo, 'payload')) {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  return {
    root,
    node: join(root, 'node', nodeName),
    dsh: join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    python: join(root, 'python'),
  }
}

function keptEnv() {
  const env = {}
  for (const name of KEEP_ENV) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return env
}

// 模型写的脚本里直接敲 python：dsh 起 PowerShell / Python 时 PATH 原样往下传，
// 不改的话找到的是用户机器上自己装的 Python（没有 python-docx 这些），或者应用商店那个空壳。
// 随包 Python 排最前面（Windows 上连它的 Scripts），原来的 PATH 接在后面。
// dsh 自己的 load_workspace_dependencies 给的是绝对路径，不看 PATH。
// py 启动器管不了：它只认装在系统里的 Python，所以干活规矩里让模型用 python（rules.patch.yml）。
function scriptPath(pythonRoot) {
  const dirs = process.platform === 'win32' ? [pythonRoot, join(pythonRoot, 'Scripts')] : [join(pythonRoot, 'bin')]
  if (process.env.PATH) dirs.push(process.env.PATH)
  return dirs.join(delimiter)
}

// 桌伴起来时收拾一次 dsh 的临时目录（./temp-sweep.mjs）。不等它：不耽误桌伴起来、小岛出来。
export function startTempSweep() {
  return startSweep({ dir: appPaths().temp })
}

// 桌伴退出时把常驻的 dsh 进程收掉。
export function stopDaemon() {
  stopAllDaemons()
}

// 桌伴起来时把常驻的 dsh 进程起起来（临时目录收拾完再起）。
// 这个进程一直留着：任务和新闻都在它上面跑。
export function startDaemon() {
  const home = appRoot()
  const dshHome = join(home, 'dsh')
  // 常驻进程怎么起：收掉之后（重起、换环境）照这个补一个新的，不用等下一个任务
  const build = () => {
    // 现在的钥匙（设置那边刚改的）记到这个 dsh 家的账上：起进程时用它
    const current = extraEnv()
    if (Object.keys(current).length > 0) replaceEnv(dshHome, current)
    return dshLaunch({ lowRoot: home, taskId: 'daemon' })
  }
  setResidentBuild(dshHome, build)
  const daemon = daemonFor(dshHome, build, { resident: true })
  daemon.hold()
  return daemon.start().catch(() => null)
}

// 各家的模型钥匙交给常驻进程：一个进程上跑好几个会话，几条线路的钥匙都得在。
export function setDaemonEnvProvider(fn) {
  setEnvProvider(fn)
}

// 设置里改了模型或开关：整份重写 dsh 的全局配置，不用重启 dsh
// （dsh 的热加载盯着那个文件：正在说的那句用老配置、下一句用新的）。
export function writeGlobalConfig(texts) {
  const dshHome = join(appRoot(), 'dsh')
  return writeGlobalPatch(dshHome, texts)
}

// 重起常驻的 dsh 进程：钥匙换了、看图模型变了、热加载没成的时候用。
// 没人用就当场收掉（新的常驻进程马上补上，带新的环境）；有人用就等它闲下来再收。
export function restartDaemon() {
  const dshHome = join(appRoot(), 'dsh')
  // 还没有常驻进程：直接起一个
  if (!daemonOf(dshHome)) {
    void startDaemon()
    return true
  }
  return restartDaemonFor(dshHome)
}

// 常驻进程现在的样子：有没有开着会话、热加载刷过几次（写完配置等它报一声）
export function daemonState() {
  const daemon = daemonOf(join(appRoot(), 'dsh'))
  if (!daemon) return { running: false, sessions: 0, configStamp: 0 }
  return { running: daemon.dead !== true, sessions: daemon.sessions?.size ?? 0, configStamp: daemon.configStamp }
}

// 预览一个文件（Word / PPT / Excel → PDF 或 PNG）：交给常驻 dsh 里的 Office 套件服务，回包形状见 ./preview.mjs。
export function previewFile(request = {}, options = {}) {
  const home = options.lowRoot ?? appRoot()
  return previewInDaemon(request, { ...options, lowRoot: home, launch: () => dshLaunch({ ...options, lowRoot: home }) })
}

// acp 那一行的模型：已配好的模型里第一个能看图的；没有就默认模型。
// 这一条连接能不能收图片是连接级的（dsh-acp 在 initialize 时按这一行算一次），
// 桌伴里只有一条连接，所以这一行在起进程时定好，不跟着一轮任务变。
// 规则本身在 app/models/global.mjs（照模型清单里的看图标记判断），桌伴把结果交给这里。
let acpRouteProvider = null

export function setAcpRouteProvider(fn) {
  acpRouteProvider = typeof fn === 'function' ? fn : null
}

export function acpRoute() {
  try {
    const one = acpRouteProvider?.()
    if (one && typeof one.provider === 'string' && one.provider && typeof one.model === 'string' && one.model) return one
  } catch {
    // 算不出来就照原来那行
  }
  return null
}

// 起常驻的 dsh 进程：桌伴里只有一个 dsh 进程，任务和新闻都在它上面跑。
// 插件（插话、模式、重试播报）起进程时只装一次；会变的配置（模型路线、联网、技能开关）
// 整份写在 <dsh 家>/cordis.patch.yml，dsh 的热加载盯着这个文件。
export function dshLaunch(options) {
  const layout = payloadLayout(options.payloadRoot)
  const home = dshRootOf(options)
  const dshHome = join(home, 'dsh')
  const temp = options.tempDir ?? join(home, 'temp')
  // 重试播报的文件：一个常驻进程一份，所有会话的行都带会话号
  const retryFile = join(temp, 'retry-daemon.log')
  const streamFile = join(temp, 'stream-daemon.log')
  try {
    mkdirSync(temp, { recursive: true })
    for (const stale of [retryFile, streamFile]) rmSync(stale, { force: true })
  } catch {
    // 目录写不动：这一轮没有重试播报（模型照样跑，只是等待行不出）
  }
  // dsh 默认还会扫用户自己的 ~/.agents（技能目录和 AGENTS.md）。指到桌伴自己的 agents 目录，
  // 用户装给别的 AI 工具用的东西就进不来。起进程前确保它存在，并写一份桌伴自己的 AGENTS.md。
  const agentsHome = join(home, 'agents')
  mkdirSync(agentsHome, { recursive: true })
  writeAgentsGuide(agentsHome)
  const env = {
    ...keptEnv(),
    PATH: scriptPath(layout.python),
    // 随包 Python 在 PowerShell 5.1 的管道里默认按 GBK 输出，中文全是乱码。盖住用户机器上可能有的同名变量。
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    DEEPSEEK_BASE_URL: options.baseUrl ?? DEFAULT_BASE_URL,
    DSH_HOME: dshHome,
    DSH_AGENTS_HOME: agentsHome,
    DSH_PRIMARY_RUNTIME: runtimeCarrier(layout.python, join(home, 'runtime')),
    // skillDir 是对比工具（tools/office-ab）用来换技能目录的：给了就用它，没给照旧用仓库里的。
    DSH_SKILL_DIR: options.skillDir ?? join(repo, 'app', 'skills'),
    // 用户自己的技能放程序数据目录下的 skills\。目录还没有时 dsh 只当它是空的（缺目录是合法的空状态），不报错。
    DSH_USER_SKILL_DIR: appPaths(home).skills,
    TEMP: temp,
    TMP: temp,
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_TELEMETRY_DISABLED: '1',
    // dsh 自己重试的时候，那个小插件把每次重试（种类、第几次、等几秒）写到这个文件，
    // 桌伴一行一行读（见 app/dsh/retry-plugin.mjs）。
    [RETRY_FILE_ENV]: retryFile,
    // 逐字流的小插件把每个文字增量一行一行写进这个文件（见 app/dsh/stream-plugin.mjs）。
    [STREAM_FILE_ENV]: streamFile,
  }
  // 钥匙只在真有的时候才进环境：空值完全不设，不放假值。
  if (typeof options.apiKey === 'string' && options.apiKey !== '') env.DEEPSEEK_API_KEY = options.apiKey
  Object.assign(env, keyEnv(options.env))
  // 一个进程上跑好几个会话，各家线路的钥匙都得在：桌伴把全部钥匙交给这里（app/main/main.mjs）。
  for (const [name, value] of Object.entries(extraEnv())) {
    if (typeof value === 'string' && value !== '') env[name] = value
  }
  // 插话用的插件：起进程前按 payload 的实际位置写一份到用户目录下，补丁挂在最后（后面的盖前面的）。
  // 写不动（目录不可写）就当没有插话功能：这一轮照常跑。
  // 插件起不来就是程序崩溃（Si301），不偷偷去掉它重起。
  // 插件行的模型：桌伴自己那条规则算出来的那一个（能看图的第一个；没有就默认模型）。
  // 算不出来就用原来那行。
  const acp = acpRoute() ?? { provider: options.steerProvider, model: options.steerModel }
  const steer = writeSteerPlugin({
    home,
    payloadRoot: layout.root,
    config: { provider: acp?.provider, model: acp?.model },
  })
  // 重试播报的插件：源码现在生成，写进用户目录下的 patches/，跟插话插件一个路子。
  // 写不动就当没有播报：这一轮照常跑，等待行只是不出。
  const retry = writeRetryPlugin({ home })
  const stream = writeStreamPlugin({ home })
  const patches = []
  if (steer) patches.push(writeOne(home, 'sidemate-steer.patch.yml', steer.patchText))
  if (retry) patches.push(writeOne(home, 'sidemate-retry.patch.yml', retry.patchText))
  if (stream) patches.push(writeOne(home, 'sidemate-stream.patch.yml', stream.patchText))
  return {
    command: options.node || layout.node,
    args: [layout.dsh, '--profile', 'acp', ...patchFiles().flatMap(file => ['--patch', file]), ...patches.flatMap(file => ['--patch', file])],
    env,
    cwd: home,
    home,
    dshHome,
    agentsHome,
    temp,
    patches,
    steer,
    retry,
    retryFile,
    streamFile,
    logPath: join(home, 'logs', `${String(options.taskId ?? 'task').replace(/[^\w.-]+/g, '_')}.log`),
  }
}

// 全局配置：模型路线、联网、技能开关这些会变的，整份写进 dsh 的家。
// dsh 的热加载盯着那个文件，改了整份重写。

// 一份补丁写成一个文件（名字固定：常驻进程只装一次）
function writeOne(home, name, text) {
  mkdirSync(join(home, 'patches'), { recursive: true })
  const path = join(home, 'patches', name)
  writeFileSync(path, text, 'utf8')
  return path
}

// 起一轮 dsh。起来时那次收拾还没完就先等它（最多 SWEEP_WAIT_MS），免得新起的 dsh 的东西赶上被收拾；
// handle 先交出去：等的这一会儿点停下照样管用，插话照样排队。
  // options.patchTexts（这一轮带来的模型路线那些）不写全局配置：那份文件只有设置那边写，
// 两个任务同时跑的时候各写各的会互相覆盖。线路、联网、技能开关都在全局配置里。
export function runTask(options = {}) {
  const gate = sweepPending()
  if (!gate) return startRun(options)
  let real = null
  let cancelled = false
  let resolveDone
  const done = new Promise(resolve => { resolveDone = resolve })
  // 计时器 unref：收拾早就完了的时候，别让它拖着进程不退
  const cap = new Promise(resolve => setTimeout(resolve, options.sweepWaitMs ?? SWEEP_WAIT_MS).unref())
  const waited = Promise.race([gate, cap])
  void waited.then(() => {
    if (cancelled) return
    real = startRun(options)
    real.done.then(resolveDone)
  })
  return {
    get pid() { return real?.pid },
    get sessionId() { return real ? real.sessionId : options.sessionId },
    get logPath() { return real?.logPath ?? '' },
    done,
    cancel() {
      if (real) return real.cancel()
      if (cancelled) return
      cancelled = true
      const end = { type: 'end', taskId: options.taskId, at: Date.now(), status: 'cancelled' }
      options.onEvent?.(end)
      resolveDone(end)
    },
    steer: (text, files) => (real ? real.steer(text, files) : Promise.resolve({ ok: false, mode: 'queue' })),
    // 权限申请回话：真的 dsh 起来了就转给它，还没起来就当没回（用户点了不会卡死）
    answerPermission: (id, decision) => (real ? real.answerPermission(id, decision) : Promise.resolve({ ok: false })),
  }
}

function startRun(options = {}) {
  const taskId = options.taskId
  const secrets = secretList(options)
  let settled = false
  let resolveDone
  const done = new Promise(resolve => { resolveDone = resolve })
  let watcher = null // 这一轮动过的文件（./artifacts.mjs）
  let sessionId = options.sessionId
  let logPath = ''
  let dshHome = ''
  let searches = 0
  let lastFailure = null // dsh 最后那次模型请求失败：码、HTTP 状态、原文（重试插件从 turn/end 带来的）
  let failureWaiter = null // 等那一行的人
  let lastConfigOptions = null // 这个会话最近一次的模型选项（热加载完了 dsh 会报一声）
  let configStamp = 0 // 模型选项刷新的次数：等的时候只认新来的那一次
  let configWaiter = null // 等模型选项刷新的人
  let titled = '' // dsh 起好的任务名：报过一次就不再报同一个
  // 模型这一轮正在说的这一段话：每开始用一次工具（tool_call）就收住，当一个独立的
  // 气泡发出去；收场时最后一段（没有工具调用就是全部）也照这么发。
  let replyText = ''
  // 工具调用编号 → 工具名：工具失败时要说出是哪个工具没调通
  const toolNames = new Map()
  let daemon = null
  let release = null
  let offSink = null
  let pidValue = 0
  // 新闻那一轮（title: false）：权限申请桌伴直接回拒绝，名字用不上
  const news = options.title === false
  const handle = {
    // 常驻进程的编号：dsh 还没起来时是空的。起来了就一直记着（进程收掉了也还记得）
    get pid() {
      const now = daemon?.pid || 0
      if (now) pidValue = now
      return pidValue
    },
    sessionId,
    logPath: '',
    done,
    cancel(note = '') {
      if (settled) return
      perms.cancel()
      // 停下是 session/cancel，不是杀进程：别的会话还在这个进程上跑。
      // session/cancel 是通知（不带 id）：按请求发的话 dsh 回「method not found」，那一轮停不下来。
      if (sessionId && daemon) daemon.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
      writeLog('cancel')
      finish('cancelled', null, note)
    },
    steer: (text, files) => steerText(text, files),
    // 权限申请回话：允许一次 / 本任务都允许 / 拒绝
    answerPermission: (id, decision) => perms.answer(id, decision),
  }

  const emit = (event) => {
    const full = { taskId, at: Date.now(), ...event }
    options.onEvent?.(full)
    return full
  }
  const pulse = createPulse({ emit, quietMs: options.quietMs, tickMs: options.pulseTickMs }) // 状态行上「模型在不在动」（./pulse.mjs）
  // 阶段（在读、在写、在想）：变了才发（./phase.mjs）
  const emitPhase = createPhaseEmitter(emit)
  const live = createLiveReplies({ emit, redact: (text) => redact(text, secrets), news }) // 逐字流的前缀 reply（./stream-plugin.mjs）

  // 模型那边失败了：dsh 的码、HTTP 状态和报错原文（打码）带出去，
  // 壳照 dsh 的码挑停下那句、显示那一行（app/task/codes.mjs）
  const failureOf = (reason, detail, failure) => ({
    reason,
    detail,
    raw: maskSecrets(redact(failure?.message || detail, secrets)),
    dshCode: failure?.code || '',
    status: statusOf(failure, detail),
    route: routeOf(options),
  })

  // 等 dsh 最后那次失败的码：插件写来的一行，桌伴这边过一会儿才读得到
  const waitFailure = (limitMs = FAILURE_WAIT_MS) => {
    if (lastFailure) return Promise.resolve(lastFailure)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        failureWaiter = null
        resolve(null)
      }, limitMs)
      failureWaiter = (info) => {
        clearTimeout(timer)
        resolve(info)
      }
    })
  }

  const writeLog = (line) => {
    const safe = redact(line, secrets)
    options.onLog?.(safe)
    if (!logPath) return
    try {
      appendFileSync(logPath, `${safe}\n`)
    } catch {
      // a full disk must not take the shell down
    }
  }

  const send = (message) => daemon?.send(message)

  const request = (method, params) => {
    if (!daemon) return Promise.reject(new Error('dsh is not running'))
    return daemon.request(method, params)
  }

  // 权限申请那张桌：申请收下，用户点了再回（逻辑在 ./permission.mjs）
  const perms = createPermissionDesk({
    send,
    request,
    writeLog,
    workspace: options.workspace,
    news,
    onAsk: (info) => emit({ type: 'permission', ...info }),
  })

  // 收场时最后一段照这么发：流式已经发过一模一样整段的就不重复
  const flushReply = () => {
    const text = redact(replyText, secrets)
    replyText = ''
    if (text.trim() && !live.already(text)) emit({ type: 'reply', text })
  }

  // 这一轮动过的文件：收场时报出去（任务文件夹根目录下的才算产出，见 ./session.mjs）
  const publishFiles = () => {
    for (const one of watcher?.changed() || []) emit({ type: 'artifact', path: one.path, name: one.name })
  }

  let endEvent
  const finish = (status, failure, note = '') => {
    if (settled) return
    settled = true
    perms.cancel()
    pulse.stop()
    live.stop()
    if (sessionId) daemon?.unregister(sessionId)
    void (async () => {
      try {
        flushReply()
        if (status !== 'cancelled') publishFiles()
        if (status === 'done') await emitUsage()
        if (status === 'done') await waitTitle()
        emitTitle()
        if (failure) {
          writeLog(failure.detail || failure.reason)
          // 原文只有模型那边回的才带
          const { detail: _detail, ...said } = failure
          emit({ type: 'error', ...said, raw: said.raw || '' })
        }
        endEvent = emit({ type: 'end', status, ...(note ? { note } : {}) })
      } catch (error) {
        writeLog(error?.message || 'finish')
        if (!endEvent) endEvent = emit({ type: 'end', status: 'error' })
      }
      // 这一轮彻底收完才放常驻进程（起名那次调用可能还在路上，收早了名字就没了）
      offSink?.()
      offSink = null
      release?.()
      release = null
      resolveDone(endEvent)
    })()
  }

  // 头一轮（新会话）做完了名字还没起好：等一小会儿
  async function waitTitle() {
    if (news || options.sessionId || titled || !dshHome || !sessionId) return
    const limit = options.titleWaitMs ?? TITLE_WAIT_MS
    const started = Date.now()
    while (!readTitle(dshHome, sessionId) && Date.now() - started < limit) await sleep(100)
  }

  // dsh 给这个会话起好名字了：报一次（壳拿去换掉先占位的那个名字）。dsh 只是截了第一句的开头时不算（./title.mjs）
  function emitTitle() {
    if (news || !dshHome || !sessionId) return
    const text = readTitle(dshHome, sessionId)
    if (!text || text === titled) return
    titled = text
    emit({ type: 'title', text: redact(text, secrets) })
  }

  async function emitUsage() {
    if (handle.omitUsage) return
    const startTurn = handle.usageTurn ?? 0
    const base = handle.usageBase ?? ZERO
    const started = Date.now()
    const limit = options.usageWaitMs ?? USAGE_WAIT_MS
    let rows = readTokenUsage(dshHome, sessionId)
    while (!usageCaughtUp(rows, startTurn) && Date.now() - started < limit) {
      await sleep(40)
      rows = readTokenUsage(dshHome, sessionId)
    }
    const waited = Date.now() - started
    const val = rows?.token
    const caught = usageCaughtUp(rows, startTurn)
    if (!val?.totals || (!caught && (val?.last?.turn ?? 0) <= startTurn)) {
      writeLog(`usage unread searches ${searches}`)
      return
    }
    if (caught) writeLog(`usage caught up ${waited}ms`)
    else writeLog(`usage stale ${waited}ms step ${val.last.step}`)
    const totals = val.totals
    emit({
      type: 'usage',
      inputTokens: totals.uncachedInputTokens - base.uncachedInputTokens,
      outputTokens: totals.outputTokens - base.outputTokens,
      cacheReadTokens: totals.cacheReadTokens - base.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens - base.cacheWriteTokens,
      searches,
    })
  }

  const onUpdate = (update) => {
    pulse.update(update)
    // 模型这一会儿在干什么：在读、在写、在想
    emitPhase(phaseOfUpdate(update))
    // dsh 那边模型选项变了（配置整份重写之后它会报一声）：界面上那个模型下拉跟着换
    if (update.sessionUpdate === 'config_option_update') {
      lastConfigOptions = update.configOptions ?? null
      configStamp += 1
      configWaiter?.(lastConfigOptions)
      emit({ type: 'config-options', options: lastConfigOptions })
      return
    }
    if (update.sessionUpdate === 'agent_thought_chunk') {
      writeLog(`thought ${(update.content?.text || '').length}`)
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      replyText += update.content.text || ''
      live.settle(update.content.text || '')
      return
    }
    if (update.sessionUpdate === 'usage_update') {
      // 这里不回话：这段话到收住（tool_call）或收场时才发
      writeLog(`usage_update ${JSON.stringify({ used: update.used, size: update.size, cost: update.cost ?? null })}`)
      // 模型每说完一段看一眼名字起好没有：长任务不用等到收尾才换上
      if (!titled) emitTitle()
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      // 这一段话收住了：当一个独立的气泡发出去（流式发过的用结算整段校准，没发过的补发一次），
      // 然后换新气泡；新闻那一轮不发（cut 里看）
      live.cut(replyText)
      replyText = ''
      if (update.title === 'web_search') searches += 1
      // 模型交稿了：这几份是成品（卡上写「文件生成」）
      if (update.title === 'present') {
        const files = presentedFiles(update.rawInput)
        if (files.length) emit({ type: 'present', files })
      }
      // 工具调用次数：壳那边要数模型到底动没动手
      if (update.toolCallId) toolNames.set(update.toolCallId, { name: update.title || '', input: update.rawInput })
      emit({ type: 'tool-call', name: update.title || '' })
    } else if (update.sessionUpdate === 'tool_call_update') {
      // 工具调用失败：说一句，别让模型自己降级成「我只能看工作区」
      if (update.status === 'failed') {
        const one = toolNames.get(update.toolCallId)
        // dsh 回给模型的那句错（记日志用，截短、去掉密钥）
        const error = redact(failText(update), secrets).slice(0, 300)
        emit({ type: 'tool-failed', name: one ? one.name : '', input: one ? one.input : null, error })
      }
    }
    const text = redact(progressText(update), secrets)
    if (text) emit({ type: 'progress', text })
  }

  // dsh 问一声要权限：不自动拒，转给任务窗，用户点了再回（新闻那一轮直接拒）
  const onPermission = (message, params) => {
    const toolCallId = params?.toolCall?.toolCallId ?? ''
    const one = toolNames.get(toolCallId)
    const askedSession = params?.sessionId || sessionId || ''
    writeLog(`permission asked ${toolCallId}`)
    perms.ask({
      requestId: message.id,
      sessionId: askedSession,
      toolCallId,
      tool: one?.name || '',
      target: permissionTarget(one?.input),
      justification: permissionReason(one?.input),
    })
  }

  // dsh 自己重试：它把每次重试（种类、第几次、等几秒）一行一行写在一个文件里，
  // 每一行带着会话号，这里按会话分开，出了等待行。
  const onRetry = (info) => {
    if (info.kind === 'failure') {
      lastFailure = { code: info.code, status: info.status, message: info.detail }
      const waiter = failureWaiter
      failureWaiter = null
      waiter?.(lastFailure)
      return
    }
    // 重试那一行：种类、第几次、等几秒（原文不带出去，那是失败那一行的）
    emit({ type: 'retry', kind: info.kind, code: info.code, retry: info.retry, maxRetries: info.maxRetries, delayMs: info.delayMs })
  }

  // 还没起 dsh 就停了（桌伴自己的错，没有原文）：extra 里是码和停工那句要的变量
  const failNow = (reason, extra = {}) => {
    const at = Date.now()
    const error = { type: 'error', taskId, at, reason, ...extra }
    const end = { type: 'end', taskId, at, status: 'error' }
    options.onEvent?.(error)
    options.onEvent?.(end)
    resolveDone(end)
    return { cancel() {}, steer: () => Promise.resolve({ ok: false, mode: 'none' }), answerPermission: () => Promise.resolve({ ok: false }), done, pid: undefined, sessionId: undefined, logPath: '' }
  }

  if (!taskId || !options.workspace || !options.prompt) return failNow('other')
  if (!isAbsolute(options.workspace)) return failNow('other')
  // 钥匙和选好的模型至少有一样：都没有就没法问模型（没配密钥，Si101）。
  if (!options.apiKey && !options.model) return failNow('key', { code: 'Si101', vars: { vendor: options.vendor || 'DeepSeek' } })

  const home = dshRootOf(options)
  dshHome = join(home, 'dsh')
  logPath = join(home, 'logs', `${String(taskId).replace(/[^\w.-]+/g, '_')}.log`)
  handle.logPath = logPath
  // 全局配置（模型路线、联网、技能开关）不在这儿写：那份文件只有设置那边写，
  // 两个任务同时跑的时候各写各的会互相覆盖（另一条线路就没了）。
  try {
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(join(home, 'logs'), { recursive: true })
    mkdirSync(options.workspace, { recursive: true })
  } catch {
    return failNow('crash')
  }
  watcher = createFileWatcher(options.workspace)
  writeLog(`start ${taskId}`)

  // 常驻的 dsh 进程：一个 dsh 家一个进程，任务和新闻都在它上面跑。
  // 这个进程要带的钥匙、地址：都记在这一个 dsh 家的账上（一个进程上跑好几个会话，几条线路都得能用）
  const envVars = keyEnv(options.env)
  if (typeof options.apiKey === 'string' && options.apiKey !== '') envVars.DEEPSEEK_API_KEY = options.apiKey
  if (typeof options.baseUrl === 'string' && options.baseUrl !== '') envVars.DEEPSEEK_BASE_URL = options.baseUrl
  rememberEnv(dshHome, envVars)
  // 桌伴自己那个 dsh 家的进程是常驻的：任务跑完不收它，收掉之后马上补一个新的
  const resident = dshHome === join(appRoot(), 'dsh')
  daemon = daemonFor(dshHome, () => dshLaunch({ ...options, lowRoot: home }), { resident })
  // 钥匙或地址跟这个进程起的时候不一样：收掉它（正在跑的那几场按设置变化中断收场），重新起（新的环境）
  if (!daemon.ensureEnv(envVars)) daemon = daemonFor(dshHome, () => dshLaunch({ ...options, lowRoot: home }), { resident })
  release = daemon.lease()
  // dsh 自己说的话也进这一轮的日志（各自打码）
  offSink = daemon.addSink((line) => writeLog(line))

  // 干活中途插一句：插进这一轮的下一步（下一步就听到）；插不进去就排队，等这一轮干完再发。
  // 插话带的那几份文件：跟开工时一样，用资源链接给模型。
  async function steerText(text, files) {
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return { ok: false, mode: 'none' }
    if (settled || !sessionId) return { ok: false, mode: 'queue' }
    const links = (Array.isArray(files) ? files : [])
      .filter((one) => one && typeof one.path === 'string' && one.path)
      .map((one) => fileLink(options.workspace, one.path))
    try {
      const res = await request(STEER_METHOD, { sessionId, text: body, files: links })
      if (res && res.accepted === true) {
        writeLog('steer accepted')
        return { ok: true, mode: 'steer' }
      }
      writeLog('steer rejected')
    } catch (error) {
      writeLog(`steer rejected ${plainLogText(error?.message)}`)
    }
    return { ok: false, mode: 'queue' }
  }

  const doneProxy = new Promise(resolve => {
    const prior = resolveDone
    resolveDone = (value) => {
      prior(value ?? endEvent)
      resolve(value ?? endEvent)
    }
  })
  handle.done = doneProxy

  // 会话里切模型：模型选项以回包为准，不在选项里就不发 prompt；思考档位只在切完后的回包还提供时才发。
  // 回 false 表示这轮已经按 model 报错收场，别再往下问。
  async function switchModel(offered) {
    const wanted = options.model
    if (offered !== undefined && !hasChoice(offered, wanted.value)) {
      writeLog(`model not offered ${wanted.value}`)
      finish('error', { reason: 'model', detail: 'model not offered' })
      return false
    }
    const switched = await setModelOption(wanted.value)
    writeLog(`model ${wanted.value}`)
    if (wanted.effort && pickEffort(switched?.configOptions, wanted.effort) != null) {
      await request('session/set_config_option', { sessionId, configId: 'reasoning_effort', value: wanted.effort })
      writeLog(`effort ${wanted.effort}`)
    }
    return true
  }

  // 切模型：刚保存的设置还没热加载完时，dsh 会说这个模型选项它不认。
  // 那就等它把模型选项刷新一遍（最多 MODEL_WAIT_MS）再试一次；还不行就照原来的错走。
  async function setModelOption(value) {
    const before = configStamp
    try {
      return await request('session/set_config_option', { sessionId, configId: 'model', value })
    } catch (error) {
      if (!/unknown model option/i.test(String(error?.message || ''))) throw error
      writeLog('model option unknown')
      const updated = await waitConfigOptions(MODEL_WAIT_MS, before)
      if (!updated) throw error
      writeLog('model option retry')
      return await request('session/set_config_option', { sessionId, configId: 'model', value })
    }
  }

  // 等这个会话的模型选项刷新（热加载完了 dsh 会报一声 config_option_update）：
  // 只认等的时候新来的那一次（之前刷过的那个不算）。
  const waitConfigOptions = (limitMs, before) => {
    if (configStamp > before) return Promise.resolve(lastConfigOptions)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        configWaiter = null
        resolve(null)
      }, limitMs)
      timer.unref?.()
      configWaiter = (options) => {
        clearTimeout(timer)
        configWaiter = null
        resolve(options)
      }
    })
  }

  ;(async () => {
    try {
      // dsh 还没起好时来的任务排着等：起进程、握手、开会话都在这个 await 后面
      await daemon.start()
      pidValue = daemon.pid || 0
      // 这一条连接能不能收图片：dsh 自己说的（看图的模型才说能）
      const images = daemon.images === true
      if (images) writeLog('images on')
      if (settled) return
      const opened = await daemon.open({ sessionId: options.sessionId, cwd: options.workspace, mcpServers: options.mcpServers })
      // 外部工具服务的配置 dsh 不认：这一轮没带它，照常跑，任务窗里说一句
      if (opened.mcpDropped) emit({ type: 'mcp-config-failed' })
      sessionId = opened.sessionId
      handle.sessionId = sessionId
      if (settled) return
      // 这个会话的事件都回这条对话：更新、权限申请、重试播报、进程断了
      // dsh 意外退出：这一轮标成「已中断」（不报错，用户点「继续」接着做）；
      // 连崩（5 分钟内崩了 3 次）算程序崩溃，报 Si301
      daemon.register(sessionId, {
        onUpdate,
        onPermission,
        onRetry,
        onStream: live.frame,
        onCrash: (detail) => {
          if (detail?.loop) finish('error', { reason: 'crash', detail: detail.detail || 'exit' })
          else finish('interrupted')
        },
        // 桌伴主动收进程（重起、换环境）：这一轮按「设置变化中断」收场（能接着做）
        onStopped: () => finish('cancelled', null, 'settings'),
      })
      // 新闻那一轮用不上名字：把名字钉住，dsh 就不会为它多发那一次起名的请求
      if (news) {
        try {
          await request(QUIET_TITLE_METHOD, { sessionId, title: 'sidemate' })
        } catch (error) {
          writeLog(`quiet title failed ${plainLogText(error?.message)}`)
        }
      }
      // 主题的自动配置权限选了「允许」：这个会话切成完全访问（跟权限卡「本任务都允许」同一条路），
      // 切完不来权限申请。切不动就照旧：权限申请还是一律拒绝。
      if (options.fullAccess === true) {
        try {
          await request(MODE_METHOD, { sessionId, mode: 'danger-full-access' })
          writeLog('sandbox full access')
        } catch (error) {
          writeLog(`sandbox switch failed ${plainLogText(error?.message)}`)
        }
      }
      if (options.model) {
        const ok = await switchModel(opened.configOptions)
        if (!ok || settled) return
      }
      const prior = readTokenUsage(dshHome, sessionId)
      if (options.sessionId && (prior === undefined || prior.token === undefined)) {
        writeLog('usage baseline unread')
        handle.omitUsage = true
      } else {
        // 起点轮号看边界那行：上一轮最后一步重试过时 tokenUsage.last 是空的，用它会把上一轮收尾当这一轮。
        handle.usageTurn = prior?.boundary?.lastTurn ?? 0
        handle.usageBase = prior?.token?.totals ?? ZERO
      }
      // 一轮就发一次：重试由 dsh 自己来（它只重发那一次模型请求，
      // 用户那句话不会在会话里叠多遍——见 app/dsh/models.mjs 那段说明）。
      // dsh 每重试一次就往播报文件里写一行，桌伴照着出等待行。
      pulse.prompt()
      try {
        // 这一轮给模型的话：正文 + 用户给的文件（资源链接；看图的模型再带上图片本身）
        const prompt = [{ type: 'text', text: options.prompt }]
        for (const one of fileBlocks(options.workspace, options.files, { images: images && options.vision === true })) prompt.push(one)
        const result = await daemon.prompt(sessionId, { prompt })
        if (settled) return
        finish(result?.stopReason === 'cancelled' ? 'cancelled' : 'done')
      } catch (error) {
        if (settled) return
        // 桌伴主动收的进程（重起、换环境）：不是报错，按设置变化中断收场
        if (daemon?.stopped === true) {
          finish('cancelled', null, daemon?.stopReason === 'settings' ? 'settings' : '')
          return
        }
        const detail = error?.message || ''
        // 这一轮最后那次失败：dsh 的码、HTTP 状态、原文（插件从 turn/end 事件带来的）
        const failure = await waitFailure()
        // dsh 给了码就照码分（app/task/codes.mjs 的 reasonForDsh）；
        // 没给（没等到 turn/end 那条）就当模型请求自己挂了
        const reason = failure ? reasonForDsh(failure.code, failure.status, routeOf(options)) : 'server'
        writeLog(`failed ${failure?.code || reason}`)
        finish('error', failureOf(reason, detail, failure))
      }
    } catch (error) {
      if (settled) return
      // 桌伴主动收的进程（重起、换环境）：不是报错，按设置变化中断收场
      if (daemon?.stopped === true) {
        finish('cancelled', null, daemon?.stopReason === 'settings' ? 'settings' : '')
        return
      }
      // 这儿是起会话、开模型那些地方出的错：还没跟模型说过话，没有 dsh 的码
      const detail = error?.message || ''
      // dsh 自己没了（崩了、连崩不再重起）：算程序崩溃（Si301）
      const reason = error?.crashLoop === true || daemon?.dead ? 'crash' : 'other'
      finish('error', failureOf(reason, detail, null))
    }
  })()

  return handle
}
