// 设置变化要不要重起 dsh 的判断：纯函数，不引 node:、不引 electron，node --test 直接测。
//
// 三种变化热加载做不到，必须重起常驻的 dsh 进程：
// 1. 钥匙新加 / 换了 / 删了：进程的环境变量只在起的时候读一次；
// 2. 「有没有能看图的模型」变了：acp 那一行的模型只在 initialize 时算一次；
// 3. 热加载失败：写完配置老会话没收到 config_option_update。
//
// 删模型另说：dsh 不肯删有会话选过的模型（实测：热加载不生效），所以删之前得先问一句、
// 把用它的会话中断掉；模型清单是桌伴自己的账，界面上不再有这个模型就行。
//
// 快照里只有钥匙的指纹（哈希）和看图模型的名单，不带钥匙原文。

// 一条清单的快照：现在配了什么
// keys：{条目id: 钥匙指纹}；vision：能用（配了钥匙、或者 Kilo 已同意）且看图的模型
export function snapshot({ catalog, keys = {}, consented = false } = {}) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  const out = { keys: {}, vision: [], usable: [], models: {}, routes: [], default: '' }
  for (const [id, hash] of Object.entries(keys || {})) {
    if (typeof hash === 'string' && hash !== '') out.keys[id] = hash
  }
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue
    const list = []
    const allowed = entry.kind === 'kilo' ? consented === true : Boolean(out.keys[entry.id])
    for (const model of Array.isArray(entry.models) ? entry.models : []) {
      if (!model || typeof model.id !== 'string' || !model.id) continue
      list.push(model.id)
      if (!allowed) continue
      out.usable.push(`${entry.id}/${model.id}`)
      if (model.vision === true) out.vision.push(`${entry.id}/${model.id}`)
    }
    out.models[entry.id] = list
    out.routes.push(entry.id)
  }
  out.routes.sort()
  out.vision.sort()
  out.usable.sort()
  const def = catalog?.default
  out.default = def && typeof def.entry === 'string' && typeof def.model === 'string' && def.entry && def.model
    ? `${def.entry}/${def.model}`
    : ''
  return out
}

// 钥匙变了哪些：加了、删了、换了
export function keyChanges(before, after) {
  const a = before?.keys || {}
  const b = after?.keys || {}
  const added = []
  const removed = []
  const changed = []
  for (const id of Object.keys(b).sort()) {
    if (!(id in a)) added.push(id)
    else if (a[id] !== b[id]) changed.push(id)
  }
  for (const id of Object.keys(a).sort()) if (!(id in b)) removed.push(id)
  return { added, removed, changed }
}

// acp 那一行现在用哪个模型：能看图的第一个；没有能看图的就用默认那个（默认那个也得能用）。
// 这一条连接能不能收图片是连接级的（initialize 时算一次）：它变了就得重起 dsh。
export function acpSignature(snap) {
  const vision = Array.isArray(snap?.vision) ? snap.vision : []
  if (vision.length > 0) return vision[0]
  const fallback = snap?.default || ''
  const usable = Array.isArray(snap?.usable) ? snap.usable : []
  return usable.includes(fallback) ? fallback : ''
}

// 看图模型变了哪些：多了一个、或者少了一个
export function visionChanges(before, after) {
  const a = new Set(Array.isArray(before?.vision) ? before.vision : [])
  const b = new Set(Array.isArray(after?.vision) ? after.vision : [])
  const added = [...b].filter((one) => !a.has(one)).sort()
  const removed = [...a].filter((one) => !b.has(one)).sort()
  return { added, removed }
}

// 路线（条目）多了哪些、少了哪些：路线集合变了 dsh 才会报 config_option_update
export function routeChanges(before, after) {
  const a = new Set(Array.isArray(before?.routes) ? before.routes : [])
  const b = new Set(Array.isArray(after?.routes) ? after.routes : [])
  return {
    added: [...b].filter((one) => !a.has(one)).sort(),
    removed: [...a].filter((one) => !b.has(one)).sort(),
  }
}

// 清单里少了哪些模型（删条目、删模型、改模型 id 都算少了旧的）
export function removedChoices(before, after) {
  const a = before?.models || {}
  const b = after?.models || {}
  const out = []
  for (const entry of Object.keys(a)) {
    const was = Array.isArray(a[entry]) ? a[entry] : []
    const now = new Set(Array.isArray(b[entry]) ? b[entry] : [])
    for (const model of was) if (!now.has(model)) out.push(`${entry}/${model}`)
  }
  return out.sort()
}

// 这次变化要不要重起 dsh，要不要先问用户一句。
// busy：现在有任务在跑吗。inUse：正在跑的任务在用哪些模型（'条目/模型'）。
// 返回：
//   action：'none'（照热加载走）、'restart'（保存后重起）、'ask'（先问一句）
//   ask：'restart'（编辑模型会中断已有会话）、'delete'（删除模型会中断正在使用它的任务）
//   interrupt：要中断哪些会话（null = 全部）
//   expectReport：这次改动会不会让 dsh 报一声 config_option_update（只有路线集合变了才会报）
export function planSave({ before, after, busy = false, inUse = [] } = {}) {
  const keys = keyChanges(before, after)
  const vision = visionChanges(before, after)
  const routes = routeChanges(before, after)
  const removed = removedChoices(before, after)
  const used = new Set(Array.isArray(inUse) ? inUse : [])
  const hit = removed.filter((one) => used.has(one))
  const reasons = []
  if (keys.added.length || keys.removed.length || keys.changed.length) reasons.push('key')
  // acp 那一行的模型变了（能不能收图片、连的是哪个模型）：热加载做不到
  if (acpSignature(before) !== acpSignature(after)) reasons.push('vision')
  const needsRestart = reasons.length > 0
  const common = { reasons, keys, vision, routes, removed, hit, interrupt: hit, expectReport: routes.added.length > 0 }
  // 删掉正在用的模型：先问一句，取消了就不删
  if (busy && hit.length > 0) return { action: 'ask', ask: 'delete', ...common }
  if (!needsRestart) return { action: 'none', ask: null, ...common, hit: [], interrupt: [] }
  // 有人正在跑：先问一句，取消了就不保存
  if (busy) return { action: 'ask', ask: 'restart', ...common, hit: [], interrupt: [] }
  return { action: 'restart', ask: null, ...common, hit: [], interrupt: [] }
}
