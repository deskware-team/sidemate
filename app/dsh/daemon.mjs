// 常驻的 dsh 进程：桌伴里只有一个 dsh 进程，任务和新闻都在它上面跑。
//
// 这里管三件事：
// 1. 进程的生命周期：起、停、意外退出后重新起；
// 2. JSON-RPC 的收发：一个进程上跑好几个会话，请求编号只有一份；
// 3. 事件按会话分发：session/update、session/request_permission、重试播报都带着会话号，
//    各回各的那条对话，不串。
//
// 全局配置（模型路线、联网开关、技能开关这些会变的）整份写在 <dsh 家>/cordis.patch.yml：
// dsh 的热加载盯着这个文件，改了整份重写（先写临时文件再改名），正在说的那句用老配置、下一句用新的。
// 起进程的时候插件只装一次（插话、模式、重试播报合在一个插件里），所有会话共用。

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRetryWatcher } from './retry-log.mjs'
import { createStreamWatcher } from './stream-plugin.mjs'
import { isCrashLoop, TAIL_LINES, writeCrashLog } from './crash-log.mjs'
import { appPaths } from '../paths.mjs'

// 桌伴的 package.json（开发时在仓库根，装好后在 resources\app 下）
const APP_PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')

// 读一个 package.json 里的版本号；读不出来就空着
function versionAt(file) {
  try {
    const version = JSON.parse(readFileSync(file, 'utf8'))?.version
    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
}

// dsh 的版本：起进程时第一个参数是 dsh 的 lib/bin.js，它的 package.json 在上一层
function dshVersionOf(launch) {
  const bin = Array.isArray(launch?.args) ? launch.args[0] : ''
  return typeof bin === 'string' && bin ? versionAt(resolve(dirname(bin), '..', 'package.json')) : ''
}

// 崩了以后过多久重起：先让 dsh 把话说完（退出时的输出还没写完），再起新的
const RESTART_DELAY_MS = 200

// 一个 dsh 家（DSH_HOME）一个常驻进程
const daemons = new Map()

// 常驻进程的起法：收掉之后马上补一个新的（不等下一个任务来）。
// 谁是常驻的由 app/dsh/index.mjs 那边标（桌伴自己那个 dsh 家）。
const residentBuilds = new Map()

// 崩过的时间：按 dsh 家记着（换了个进程也还记得：连崩的账不能丢）
const crashTimes = new Map()

// 某个 dsh 家崩过几次（什么时候崩的）
function crashTimesOf(id) {
  const list = crashTimes.get(id)
  return Array.isArray(list) ? list : []
}

// 各家线路的环境变量（钥匙、地址）：一个进程上跑好几个会话，几条线路的钥匙都得在。
// 谁要用哪条线路就把自己的那份记进来，这个进程下次起的时候全带上。
const envCache = new Map()

export function rememberEnv(key, vars) {
  const cur = envCache.get(key) || {}
  for (const [name, value] of Object.entries(vars || {})) {
    if (typeof value === 'string' && value !== '') cur[name] = value
  }
  envCache.set(key, cur)
  return cur
}

export function cachedEnv(key) {
  return { ...(envCache.get(key) || {}) }
}

// 某个 dsh 家的环境整份换掉（钥匙改了、删了）：先清空再记新的
export function replaceEnv(key, vars) {
  envCache.set(key, {})
  return rememberEnv(key, vars)
}

// 桌伴退出时把常驻进程都收掉
export function stopAllDaemons() {
  // 桌伴退出：收掉就完了，不再补新的
  for (const daemon of [...daemons.values()]) daemon.stop('', { respawn: false })
  daemons.clear()
}

// 现在有几个常驻进程（测试里看这个）
export function daemonCount() {
  return daemons.size
}

// 额外的环境变量：各家的模型钥匙都放进来，一个进程里几条线路都能用。
// 桌伴起来时把钥匙交给这里（app/main/main.mjs）。
let envProvider = null

export function setEnvProvider(fn) {
  envProvider = typeof fn === 'function' ? fn : null
}

export function extraEnv() {
  if (!envProvider) return {}
  try {
    const out = envProvider()
    return out && typeof out === 'object' ? out : {}
  } catch {
    return {}
  }
}

// 全局配置文件的路径：<dsh 家>/cordis.patch.yml
export function globalPatchPath(dshHome) {
  return join(dshHome, 'cordis.patch.yml')
}

// 全局配置的内容：热加载那一行 + 各家补丁（后面的盖前面的）
export function buildGlobalPatch(texts) {
  const lines = [
    '# 桌伴的全局配置：dsh 的热加载盯着这个文件，改了整份重写。',
    '- id: hmr',
    '  disabled: false',
    '  config:',
    '    root: []',
  ]
  for (const text of Array.isArray(texts) ? texts : []) {
    const body = typeof text === 'string' ? text.trim() : ''
    if (body === '') continue
    lines.push(body)
  }
  return `${lines.join('\n')}\n`
}

// 整份重写全局配置：先写临时文件再改名。
// dsh 盯着这个文件，写到一半它就重载了，改名才是整份换掉。
// 内容跟现在一样就不写：省得 dsh 白重载一次。
// 这份文件只有设置那边写（app/models/global.mjs 算内容）：任务各写各的会互相覆盖。
export function writeGlobalPatch(dshHome, texts) {
  const path = globalPatchPath(dshHome)
  const content = buildGlobalPatch(texts)
  try {
    mkdirSync(dshHome, { recursive: true })
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      current = ''
    }
    if (current === content) return { path, changed: false }
    const temp = `${path}.new`
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, path)
    return { path, changed: true }
  } catch {
    return { path, changed: false }
  }
}

export function createDaemon({ build, onLog, keepAlive: keep = false, key = '' } = {}) {
  let keepAlive = keep
  let child = null
  let lastPid = 0
  let launch = null
  let seq = 0
  let buffer = ''
  let dead = false
  let stopping = false
  let stopReason = '' // 为什么收的：'settings' 是桌伴主动收的（重起、换环境）
  let started = null
  let init = null // initialize 的回包：dsh 自己说能不能收图片
  let leases = 0
  let idleTimer = null
  let watcher = null
  let streamWatcher = null
  let pendingRestart = false
  let configStamp = 0 // 热加载刷新的次数：写完配置等它报一声就知道热加载有没有成
  let restartTimer = null
  const stderrTail = [] // dsh 最后说的那些话（stderr）：记崩溃记录时留尾巴
  const pending = new Map()
  const sessions = new Map()
  // 这个 dsh 进程里开着的会话号：进程没了（崩了、重起）就清空
  const loaded = new Set()
  const sinks = new Set()
  // 正在问模型的会话：一个会话同一时间只跑一句
  const busy = new Set()

  // dsh 自己往外说的话（stderr）：每个正在跑的任务都听一份（各自打码、各自记日志）
  const log = (line) => {
    for (const sink of sinks) {
      try {
        sink(line)
      } catch {
        // 记日志的地方坏了不能误事
      }
    }
    try {
      onLog?.(line)
    } catch {
      // 日志坏了不能误事
    }
  }

  // 挂一个听日志的：返回摘掉它的函数
  const addSink = (fn) => {
    if (typeof fn !== 'function') return () => {}
    sinks.add(fn)
    return () => sinks.delete(fn)
  }

  const send = (message) => {
    if (!child || child.exitCode != null) return
    try {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      // 子进程没了就当没发出去
    }
  }

  const request = (method, params) => {
    if (!child || child.exitCode != null) return Promise.reject(new Error('dsh is not running'))
    const id = ++seq
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  // 这个进程的账记在哪个 dsh 家的名下
  const crashKey = () => key || launch?.dshHome || ''

  // dsh 意外退出：记一笔崩溃，正在跑的那几轮标成中断（能接着做），能自动重起就重起
  const crash = (detail = {}) => {
    if (dead || stopping) return
    dead = true
    const at = Date.now()
    const exitCode = detail.exitCode ?? null
    const signal = detail.signal ?? null
    const times = [...crashTimesOf(crashKey()), at]
    crashTimes.set(crashKey(), times)
    // 连崩（5 分钟内崩了 3 次）：不再自动重起，这会儿在跑的和新来的任务都报 Si301
    const loop = isCrashLoop(times, { now: at })
    // 崩的时候在跑的几场：只记编号和状态
    const conversations = [...sessions.keys()].map((id) => ({ id, state: 'running' }))
    writeCrashLog(crashDir(), {
      time: at,
      exitCode,
      signal,
      output: stderrTail.slice(),
      conversations,
      appVersion: versionAt(APP_PACKAGE),
      dshVersion: dshVersionOf(launch),
    })
    for (const { reject } of pending.values()) reject(new Error(`dsh stopped: ${detail.detail || 'exit'}`))
    pending.clear()
    watcher?.stop()
    watcher = null
    streamWatcher?.stop()
    streamWatcher = null
    for (const one of sessions.values()) {
      try {
        one.onCrash?.({ loop, exitCode, signal, detail: detail.detail || 'exit' })
      } catch {
        // 收场的回调出错也不能误事
      }
    }
    sessions.clear()
    loaded.clear()
    // 起了新的以后还能再起：这个进程不算死了
    started = null
    child = null
    if (!loop) scheduleRestart()
  }

  // 崩溃记录放在程序数据目录下的 data\crash\ 里
  const crashDir = () => {
    const home = launch?.home || ''
    return home ? join(appPaths(home).data, 'crash') : ''
  }

  // 自动重起：不等下一个任务来。桌伴自己收掉的进程不算崩，也不会走到这里
  const scheduleRestart = () => {
    if (restartTimer || stopping) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (stopping) return
      start().catch(() => {})
    }, RESTART_DELAY_MS)
    restartTimer.unref?.()
  }

  const onMessage = (message) => {
    // 逐字流的文件先读一把再派这条消息：dsh 那头字先落文件、话后到 ACP，
    // 不先读的话前缀会落到这一段的后面（气泡就串行了）
    streamWatcher?.poll?.()
    if (message.method === 'session/update') {
      const params = message.params || {}
      const one = sessions.get(String(params.sessionId || ''))
      const update = params.update ?? {}
      if (update.sessionUpdate === 'config_option_update') configStamp += 1
      one?.onUpdate?.(update, String(params.sessionId || ''))
      return
    }
    if (message.method === 'session/request_permission') {
      const params = message.params || {}
      const one = sessions.get(String(params.sessionId || ''))
      if (one) {
        one.onPermission?.(message, params)
        return
      }
      // 没人认领的申请：直接拒，别让 dsh 在那儿干等着
      send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'selected', optionId: 'reject-once' } } })
      return
    }
    if (message.method && message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || 'request failed'))
      else waiter.resolve(message.result)
    }
  }

  const start = () => {
    if (started) return started
    // 连崩（5 分钟内崩了 3 次）：不再自动重起，这会儿来的任务报 Si301
    if (isCrashLoop(crashTimesOf(crashKey()), { now: Date.now() })) {
      const error = new Error('dsh keeps crashing')
      error.crashLoop = true
      return Promise.reject(error)
    }
    started = (async () => {
      launch = build()
      // 各家线路的环境变量都在这儿：这个进程上跑好几个会话，几条线路的钥匙都得在
      Object.assign(launch.env, cachedEnv(key))
      mkdirSync(launch.dshHome, { recursive: true })
      mkdirSync(launch.temp, { recursive: true })
      child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
      lastPid = child.pid || 0
      dead = false
      buffer = ''
      init = null
      stderrTail.length = 0
      child.on('error', () => crash({ detail: 'spawn' }))
      // dsh 死了（自己的插件起不来也算）：正在跑的那几轮标成中断，能自动重起就重起
      child.on('exit', (code, signal) => setTimeout(() => crash({ exitCode: code, signal, detail: 'exit' }), RESTART_DELAY_MS))
      child.stdin.on('error', () => {
        // 子进程没了，往里写会报错：写不出去就当没发出去
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.trim()) continue
          const text = line.trim()
          // 最后这些行留着：崩了以后记进崩溃记录
          stderrTail.push(text)
          if (stderrTail.length > TAIL_LINES) stderrTail.shift()
          log(text)
        }
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        buffer += chunk
        let nl
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          try {
            onMessage(JSON.parse(line))
          } catch {
            log(line)
          }
        }
      })
      // 重试播报：所有会话的行都写在这一个文件里，每行带会话号（桌伴按会话分开）
      watcher = createRetryWatcher({
        path: launch.retryFile,
        onEvent: (info) => {
          const one = sessions.get(String(info.sessionId || ''))
          one?.onRetry?.(info)
        },
      })
      // 逐字流：同一个读法，流式文件里每行带会话号，按会话转给这一轮注册的回调
      streamWatcher = createStreamWatcher({
        path: launch.streamFile,
        onEvent: (info) => {
          const one = sessions.get(String(info.sessionId || ''))
          one?.onStream?.(info)
        },
      })
      init = await request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'sidemate', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      })
      return true
    })()
    return started
  }

  // 开一个会话：接着说就 resume，新任务就 new。会话自己的文件夹、自己的模型都在会话里定。
  // 外部工具服务按 ACP 原生做法随 mcpServers 参数传。
  // 这个进程里已经开着的会话（新开的、接回来的）：同一个会话接着说时不再 resume——
  // dsh 对已经开着的会话再 resume 会回「session is already active」。
  const open = async ({ sessionId, cwd, mcpServers } = {}) => {
    await start()
    if (sessionId && loaded.has(String(sessionId))) return { sessionId }
    const servers = Array.isArray(mcpServers) ? mcpServers : []
    const openWith = async (list) => {
      if (sessionId) {
        let resumed
        try {
          resumed = await request('session/resume', { sessionId, cwd, mcpServers: list })
        } catch (error) {
          // 已经开着（比如这个进程里别处接回过）：直接接着用
          if (!/already active/i.test(String(error?.message || ''))) throw error
          loaded.add(String(sessionId))
          return { sessionId }
        }
        const id = resumed?.sessionId || sessionId
        loaded.add(String(id))
        return { sessionId: id, configOptions: resumed?.configOptions }
      }
      const created = await request('session/new', { cwd, mcpServers: list })
      if (created?.sessionId) loaded.add(String(created.sessionId))
      return { sessionId: created?.sessionId, configOptions: created?.configOptions }
    }
    try {
      return await openWith(servers)
    } catch (error) {
      // dsh 拒了这份外部工具服务配置（报错里有 mcpServers）：这一轮不带它再试一次，
      // 跑得起来就跑，跑不起来照原样报错。只重试这一次，别的错不当成配置问题。
      if (servers.length === 0 || !/mcpServers/.test(String(error?.message || ''))) throw error
      const opened = await openWith([])
      return { ...opened, mcpDropped: true }
    }
  }

  const register = (sessionId, handlers) => {
    if (!sessionId) return
    sessions.set(String(sessionId), handlers)
  }

  // 问模型：这个会话同一时间只跑一句。
  // 已经在跑就当忙（不排队）：桌伴那边一轮接一轮地来，真撞上了是哪儿出错了。
  const prompt = async (sessionId, params) => {
    const id = String(sessionId || '')
    if (busy.has(id)) throw new Error('session is busy')
    busy.add(id)
    try {
      return await request('session/prompt', { sessionId, ...params })
    } finally {
      busy.delete(id)
    }
  }

  const unregister = (sessionId) => {
    if (!sessionId) return
    sessions.delete(String(sessionId))
  }

  // 有人正在用这个进程：起任务的时候先占一个，空闲计时器就不动
  const lease = () => {
    leases += 1
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    let released = false
    return () => {
      if (released) return
      released = true
      leases -= 1
      if (leases > 0) return
      // 有人叫过重起：现在没人用了，收掉它（新的常驻进程马上补上）
      if (pendingRestart) {
        pendingRestart = false
        stop('settings')
        return
      }
      // 桌伴自己起的那个进程一直留着：任务都跑完了也不收
      if (keepAlive) return
      // 别的进程（测试里那些）没人用了就收掉：留着白占着
      stop()
    }
  }

  // 桌伴主动收进程（重起、换环境）：还注册着的会话按「设置变化中断」收场。
  // 不是报错、不是崩溃，任务窗里显示「改了模型设置」，用户能点「继续」接着做。
  const interruptSessions = () => {
    for (const one of [...sessions.values()]) {
      try {
        one.onStopped?.({ reason: 'settings' })
      } catch {
        // 收场的回调出错也不能误事
      }
    }
  }

  // 收掉这个进程。reason 是 'settings' 时：桌伴主动收的（重起、换环境），
  // 还在跑的会话按设置变化中断收场。
  const stop = (reason = '', options = {}) => {
    if (stopping) return
    stopping = true
    stopReason = reason
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    watcher?.stop()
    watcher = null
    streamWatcher?.stop()
    streamWatcher = null
    // 桌伴主动收的：还在跑的会话先按设置变化中断收场，再拒掉没回包的请求
    if (reason === 'settings') interruptSessions()
    sessions.clear()
    loaded.clear()
    for (const { reject } of pending.values()) reject(new Error('dsh stopped'))
    pending.clear()
    try {
      child?.stdin?.end()
    } catch {
      // 关不上就硬收
    }
    killChild(child)
    child = null
    dead = true
    // 常驻的：马上补一个新的（不等下一个任务来）
    if (options.respawn !== false) respawnResident(key)
  }

  return {
    // 进程编号：进程收掉了也还记得最后一个（界面上要能说出是哪个进程）
    get pid() { return child?.pid || lastPid || 0 },
    get dead() { return dead },
    // 桌伴自己收掉的（不是崩的）：这样的进程不再捡回来
    get stopped() { return stopping },
    // 为什么收的：'settings' 是桌伴主动收的（重起、换环境）
    get stopReason() { return stopReason },
    // 这一条连接能不能收图片：dsh 自己在 initialize 里说的（看图的模型才说能）
    get images() { return init?.agentCapabilities?.promptCapabilities?.image === true },
    // 热加载刷新的次数：写完配置前后比一下，就知道 dsh 收没收到新配置
    get configStamp() { return configStamp },
    get sessions() { return sessions },
    // 桌伴自己起的那个进程一直留着：任务都跑完了也不收
    hold() { keepAlive = true },
    addSink,
    start,
    open,
    register,
    unregister,
    lease,
    prompt,
    request,
    send,
    stop,
    // 这个进程起的时候带的环境变量：跟别的不一样就得重起（钥匙换了、地址换了）
    // 有人正在用这个进程也一样重起：宁可直接收掉，也不让这一轮拿着旧钥匙去问模型
    ensureEnv(vars) {
      const wanted = Object.entries(vars || {}).filter(([, value]) => typeof value === 'string' && value !== '')
      if (wanted.length === 0) return true
      // 还没起：起的时候就是这个任务的东西（再加上这个 dsh 家账上的），不用重起
      if (!launch) return true
      const current = launch.env || {}
      const same = wanted.every(([name, value]) => current[name] === value)
      if (same) return true
      // 收掉它，下一个任务重新起（新的环境）。
      // 正在用这个进程的那几场按「设置变化中断」收场（不是报错、不是崩溃）
      stop('settings')
      return false
    },
    // 重起这个进程：没人用就当场收掉；有人用就记着，等它闲下来再收。
    // 桌伴主动重起：还在跑的会话按「设置变化中断」收场（不是报错）
    restart() {
      if (leases > 0) pendingRestart = true
      interruptSessions()
      // 刚才那几场中断完可能就闲下来了：当场收掉
      if (leases > 0) return false
      stop('settings')
      return true
    },
  }
}

function killChild(child) {
  const pid = child?.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      // 同步收：收完文件锁就松了，调用方（测试收临时目录）不用等
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      // 收不掉就算了
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 已经没了
    }
  }
}

// 按 dsh 家取常驻进程：没有就起一个。
// 崩过的那个还捡回来接着用：崩过的账（连崩几次）和自动重起都在它身上。
// options.resident：这个 dsh 家的进程是常驻的（任务跑完不收它；
// 收掉之后马上补一个新的）。桌伴自己那个 dsh 家是常驻的。
export function daemonFor(key, build, options = {}) {
  const existing = daemons.get(key)
  if (existing && !existing.stopped) {
    if (options.resident === true) markResident(key, existing, build)
    return existing
  }
  const daemon = createDaemon({ build, key, ...options })
  daemons.set(key, daemon)
  if (options.resident === true) markResident(key, daemon, build)
  return daemon
}

// 标成常驻：任务跑完不收它；记下它怎么起（收掉之后照这个补一个新的）
function markResident(key, daemon, build) {
  daemon.hold()
  if (!residentBuilds.has(key) && typeof build === 'function') residentBuilds.set(key, build)
}

// 某个 dsh 家的常驻进程怎么起（桌伴自己那边登记的）：收掉之后补一个新的用这个
export function setResidentBuild(key, build) {
  if (typeof build === 'function') residentBuilds.set(key, build)
}

// 收掉之后马上补一个新的常驻进程：还是常驻的（任务跑完不收它）
function respawnResident(key) {
  const build = residentBuilds.get(key)
  if (!build) return null
  const daemon = daemonFor(key, build, { resident: true })
  void daemon.start().catch(() => null)
  return daemon
}

// 收掉某个 dsh 家的常驻进程
export function stopDaemon(key) {
  const daemon = daemons.get(key)
  if (!daemon) return
  daemon.stop()
  daemons.delete(key)
}

// 重起某个 dsh 家的常驻进程：没人用就当场收掉（下一个任务重新起，带新的环境）；
// 有人用就记着，等它闲下来再收。收掉没有就当已经重起过了。
export function restartDaemon(key) {
  const daemon = daemons.get(key)
  if (!daemon) return false
  return daemon.restart()
}

// 某个 dsh 家的常驻进程（没有就 undefined）
export function daemonOf(key) {
  return daemons.get(key)
}
