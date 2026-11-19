// 设置那边「这次改动要不要重起 dsh」这摊事：主进程的一份。
// 判断的规则是纯函数（./restart.mjs）；这里负责读现在的配置、算钥匙指纹、
// 把「问一句」「中断会话」「重起进程」这些动作交给主进程接进来的那些口子。

import { createHash } from 'node:crypto'
import { createConsent } from './consent.mjs'
import { loadCatalog } from './catalog.mjs'
import { planSave, snapshot } from './restart.mjs'

// 主进程接进来的那些口子：有没有任务在跑、在用哪些模型、中断它们、重起进程、写全局配置
const handlers = {
  busy: () => false,
  inUse: () => [],
  interrupt: () => 0,
  restart: () => false,
  refresh: () => ({ changed: false }),
  daemonState: () => ({ running: false, sessions: 0, configStamp: 0 }),
}

export function setRestartHandlers(next) {
  Object.assign(handlers, next && typeof next === 'object' ? next : {})
}

// 钥匙的指纹：哈希，不留原文（快照里只有它）
export function keyFingerprint(key) {
  const text = String(key ?? '')
  if (!text) return ''
  return createHash('sha256').update(text).digest('hex')
}

// 现在的快照：清单、每把钥匙的指纹、同意状态
export function currentSnapshot(files, keyring) {
  const catalog = loadCatalog(files?.catalog)
  const keys = {}
  const ids = Array.isArray(catalog?.entries) ? catalog.entries.map((one) => one?.id).filter(Boolean) : []
  for (const id of ids) {
    let value = ''
    try {
      value = keyring?.read?.(id) || ''
    } catch {
      value = ''
    }
    const hash = keyFingerprint(value)
    if (hash) keys[id] = hash
  }
  const consented = createConsent({ file: files?.consent }).status().agreed === true
  return snapshot({ catalog, keys, consented })
}

// 这次改动会不会让 dsh 得重起：改了哪些钥匙、清单换成什么样。
// change：{ keys: {条目id: 新钥匙（null = 删掉）}, catalog: 新的清单, deleting: 是不是在删东西 }
export function planChange(files, keyring, change = {}) {
  const before = currentSnapshot(files, keyring)
  const catalog = change.catalog || loadCatalog(files?.catalog)
  const keys = { ...before.keys }
  for (const [id, value] of Object.entries(change.keys || {})) {
    if (value === null || value === undefined || value === '') delete keys[id]
    else keys[id] = keyFingerprint(value)
  }
  const consented = change.consented === undefined
    ? createConsent({ file: files?.consent }).status().agreed === true
    : change.consented === true
  const after = snapshot({ catalog, keys, consented })
  const busy = handlers.busy() === true
  // 正在跑的任务在用哪些模型：删东西之前要知道有没有人在用
  const inUse = handlers.inUse() || []
  return { before, after, plan: planSave({ before, after, busy, inUse }) }
}

// 写完配置以后等热加载：开着会话的进程收到 config_option_update 就算成了。
// 没有会话就没什么可等（下一个任务起进程时自然用新配置）。
export async function waitHotReload(beforeStamp, limitMs = 10_000) {
  const state = handlers.daemonState() || {}
  if (state.sessions === 0) return { ok: true, waited: false }
  const started = Date.now()
  while (Date.now() - started < limitMs) {
    const now = handlers.daemonState() || {}
    if ((now.configStamp ?? 0) > (beforeStamp ?? 0)) return { ok: true, waited: true }
    await new Promise((done) => setTimeout(done, 400))
  }
  return { ok: false, waited: true }
}

// 中断正在跑的会话：给了名单只停这些，不给就全停
export function interrupt(choices) {
  try {
    return handlers.interrupt(choices) || 0
  } catch {
    return 0
  }
}

// 重起常驻的 dsh 进程
export function restart() {
  try {
    return handlers.restart() === true
  } catch {
    return false
  }
}

// 把全局配置整份重写一遍（热加载盯着那个文件）
export function refreshConfig() {
  try {
    return handlers.refresh() || { changed: false }
  } catch {
    return { changed: false }
  }
}

// 有没有任务在跑
export function busy() {
  try {
    return handlers.busy() === true
  } catch {
    return false
  }
}

// 常驻进程现在的样子：有没有开着会话、热加载刷过几次
export function daemonState() {
  try {
    return handlers.daemonState() || { running: false, sessions: 0, configStamp: 0 }
  } catch {
    return { running: false, sessions: 0, configStamp: 0 }
  }
}
