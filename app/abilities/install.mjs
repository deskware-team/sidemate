// 「说一句就装能力」的后台：模型只负责写一份**方案**（装什么、从哪下），
// 不许自己下载、不许自己往工作区写脚本；桌伴把方案读出来给界面弹确认卡，
// 用户点了「装上」，桌伴才按方案去下载，下好的东西只放在技能目录里。
// 这里的下载只去两个地址（api.github.com、raw.githubusercontent.com），
// 别的地址一律不发请求；下载有 5 分钟总时限、每个文件最多试 3 次。
// 装不成只说是哪一类（文件过大、技能无效、连接失败……，字在 app/copy 的 skills 那组），
// 哪个文件、哪条规矩、GitHub 回的状态写在 detail 里进日志；连不上时状态另放 raw，接在报错那行后面。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROVENANCE_FILE_NAME, SKILL_NAME_RE, checkSkill, importSkill, removeTree } from './skills.mjs'
import { t } from '../copy/copy.mjs'

// 工作区里模型写方案的地方。
export const PLAN_DIR_NAME = 'pending-plans'
// 方案文件名（放在「pending-plans/<id>/」里）。
export const PLAN_FILE_NAME = 'plan.json'
// 模型自己下的东西落在这个文件夹里：收尾时删掉，不装（没经过用户同意）。
export const PENDING_DIR_NAME = 'pending-skills'

// 装技能只准去这两个地址取东西；别的地址一律不发请求。
export const DOWNLOAD_HOSTS = ['api.github.com', 'raw.githubusercontent.com']
// 一共最多花 5 分钟。
export const DOWNLOAD_BUDGET_MS = 5 * 60 * 1000
// 一个文件最多试 3 次。
export const DOWNLOAD_ATTEMPTS = 3
// 一次请求最多 30 秒。
export const REQUEST_TIMEOUT_MS = 30 * 1000
// 一个技能文件夹的上限：50 个文件、200KB。
const MAX_FILES = 50
const MAX_BYTES = 200 * 1024

// 读工作区里的方案：只看「pending-plans/」下的方案文件，有多个取最新的一个。
// 读不出内容或者方案不合格，都照样返回，好让界面把问题说清楚。
export function readPlan(workspace) {
  const root = planRoot(workspace)
  if (!root) return null
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const found = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    let id = ''
    let file = ''
    if (entry.isDirectory()) {
      id = entry.name
      file = join(full, PLAN_FILE_NAME)
      if (!existsSync(file)) continue
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      id = entry.name.replace(/\.json$/i, '')
      file = full
    } else {
      continue
    }
    let mtime = 0
    try {
      mtime = statSync(file).mtimeMs
    } catch {
      mtime = 0
    }
    found.push({ id, file, mtime })
  }
  if (found.length === 0) return null
  found.sort((a, b) => b.mtime - a.mtime)
  const picked = found[0]
  let raw = null
  try {
    raw = JSON.parse(readFileSync(picked.file, 'utf8'))
  } catch {
    raw = null
  }
  const clean = normalizePlan(picked.id, raw)
  return {
    id: clean.id,
    ok: clean.ok,
    plan: clean.ok ? clean : null,
    problems: clean.problems,
    details: clean.details,
    file: picked.file,
  }
}

// 把方案整理成规规矩矩的一份：来源只认 GitHub 公开仓库，位置不许往上跳。
// 不合格时卡上只写一句「技能无效」（problems），哪几条没过写在 details 里（进日志）。
export function normalizePlan(id, raw) {
  const details = []
  const done = () => ({ ok: details.length === 0, problems: details.length ? [t('skills.invalid')] : [], details, ...out })
  const out = {
    id: '',
    name: '',
    source: '',
    owner: '',
    repo: '',
    ref: '',
    path: '',
    license: '',
    updated: '',
    does: '',
  }
  if (typeof id !== 'string' || !SKILL_NAME_RE.test(id)) {
    details.push('bad id')
  } else {
    out.id = id
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    details.push('unreadable')
    return done()
  }
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  out.name = text(raw.name).slice(0, 80)
  out.license = text(raw.license).slice(0, 80)
  out.updated = text(raw.updated).slice(0, 40)
  out.does = text(raw.does).slice(0, 200)
  const source = text(raw.source)
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/.exec(source)
  if (!match) {
    details.push('source is not a public GitHub repo')
  } else {
    out.owner = match[1]
    out.repo = match[2]
    out.source = `https://github.com/${match[1]}/${match[2]}`
  }
  const ref = text(raw.ref)
  if (ref !== '') {
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(ref) || ref.includes('..')) details.push('bad ref')
    else out.ref = ref
  }
  const path = text(raw.path).replace(/^\/+/, '').replace(/\/+$/, '')
  if (path !== '') {
    const segs = path.split('/')
    if (segs.some((one) => one === '' || one === '.' || one === '..') || !/^[A-Za-z0-9._\-/]+$/.test(path)) {
      details.push('bad path')
    } else {
      out.path = path
    }
  }
  if (out.name === '') details.push('no name')
  if (out.does === '') details.push('no description')
  return done()
}

// 卡上「从哪来」那句：仓库地址加上版本。
export function planSourceText(plan) {
  if (!plan || typeof plan.owner !== 'string' || plan.owner === '') return ''
  const host = `github.com/${plan.owner}/${plan.repo}`
  return plan.ref ? `${host} · ${plan.ref}` : host
}

// 连不上 GitHub 的几种：都说「连接失败」，GitHub 回的状态放 raw（接在报错那行后面）
const NET_REASONS = ['network', 'rate', 'http', 'timeout', 'budget']

// 装不成：哪一类（message，卡上那行红字的前一句）+ 细节（detail，进日志）+ 连不上时的状态（raw）
export function failure(reason, info = {}) {
  const at = info.path || info.source || ''
  if (NET_REASONS.includes(reason)) {
    const raw = reason === 'timeout' ? 'timeout'
      : reason === 'budget' ? 'download took over 5 minutes'
        : reason === 'network' ? 'network error'
          : `HTTP ${info.status || '?'}`
    return { message: t('probe.network'), raw, detail: `${reason}: ${raw}${at ? ` (${at})` : ''}` }
  }
  if (reason === 'missing' || reason === 'norepo') return { message: t('skills.notFound'), raw: '', detail: `${reason}: ${at}` }
  if (reason === 'big' || reason === 'many' || reason === 'bigrepo') return { message: t('skills.tooBig'), raw: '', detail: `${reason}: ${at || info.count || ''}` }
  if (reason === 'exists') return { message: t('skills.exists'), raw: '', detail: `exists: ${info.id || ''}` }
  // 没有 SKILL.md、仓库里好几个技能、方案或技能本身不合格：「技能无效」，查出来是哪一类就用哪一类
  return { message: info.message || t('skills.invalid'), raw: '', detail: `${reason}: ${info.detail || at}` }
}

// 装不成时 installPlan 回的那一份：卡上用 message 和 raw，日志记 detail
function failed(id, one) {
  return { ok: false, id, message: one.message, raw: one.raw || '', detail: one.detail || '', problems: [one.message] }
}

// 装上：按方案去下载，下到技能目录里的临时文件夹，查过了再搬进技能目录。
// 只在用户点了确认卡之后才调它。返回值里带一句结论。
export async function installPlan(options = {}) {
  const userDir = typeof options.userDir === 'string' ? options.userDir : ''
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const budgetMs = Number.isFinite(options.budgetMs) ? options.budgetMs : DOWNLOAD_BUDGET_MS
  const clock = typeof options.now === 'function' ? options.now : () => Date.now()
  const clean = normalizePlan(options.id || '', options.plan || {})
  if (!clean.ok) return failed(clean.id, failure('plan', { detail: clean.details.join('; ') }))
  if (userDir === '') return failed(clean.id, failure('missing', { path: 'skill folder' }))
  if (existsSync(join(userDir, clean.id))) return failed(clean.id, failure('exists', { id: clean.id }))
  const started = clock()
  const spent = () => Math.max(0, Math.round((clock() - started) / 1000))
  const left = () => budgetMs - (clock() - started)

  // 1. 先把版本解成提交号：记下来的和装的是同一版
  const resolved = await resolveCommit(clean, { fetchImpl, left, spent })
  if (!resolved.ok && resolved.reason === 'missing') return failed(clean.id, failure('norepo', { source: clean.source }))
  const commit = resolved.ok ? resolved.sha : ''
  // 解不出提交号就照给的版本号下；记下来的时候不写提交号
  const version = commit !== '' ? commit : (clean.ref || 'HEAD')

  // 2. 看这个仓库里有什么
  const listing = await listRepo(clean, { fetchImpl, left, spent }, version)
  if (!listing.ok) return failed(clean.id, failure(listing.reason, { source: clean.source, ...listing }))
  // 3. 找技能文件夹（方案里写了位置就用写的，没写就找带 SKILL.md 的那一个）
  const folder = pickFolder(listing.tree, clean.path)
  if (!folder.ok) return failed(clean.id, failure(folder.reason, { source: clean.source, ...folder }))
  if (folder.files.length > MAX_FILES) return failed(clean.id, failure('many', { count: `${folder.files.length} files > ${MAX_FILES}` }))
  const total = folder.files.reduce((sum, one) => sum + (one.size || 0), 0)
  if (total > MAX_BYTES) return failed(clean.id, failure('big', { path: `${folder.path || '/'} ${total} bytes > ${MAX_BYTES}` }))

  // 4. 一个文件一个文件下。下到技能目录里的临时文件夹，不碰工作区。
  const staging = join(userDir, '.pending', clean.id)
  removeTree(staging)
  mkdirSync(staging, { recursive: true })
  for (const file of folder.files) {
    if (left() <= 0) {
      removeTree(staging)
      return failed(clean.id, failure('budget', { path: file.path }))
    }
    const got = await downloadFile(clean, file.path, { fetchImpl, left, spent }, version)
    if (!got.ok) {
      removeTree(staging)
      return failed(clean.id, failure(got.reason, { ...got, path: file.path }))
    }
    const target = join(staging, ...file.rel.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, got.data)
  }

  // 5. 写一份来历，和装好的技能一起放着：记下从哪一版装的、什么时候装的
  writeFileSync(join(staging, PROVENANCE_FILE_NAME), `${JSON.stringify({
    name: clean.name,
    source: clean.source,
    license: clean.license,
    updated: clean.updated,
    does: clean.does,
    commit,
    installedAt: new Date(clock()).toISOString(),
    by: 'sidemate',
  }, null, 2)}\n`, 'utf8')

  // 6. 查一遍：不合格就不装
  const check = checkSkill(staging, { id: clean.id, ignore: [PROVENANCE_FILE_NAME] })
  if (!check.ok) {
    removeTree(staging)
    return failed(clean.id, failure('bad', { message: check.problems[0], detail: check.details.join('; ') }))
  }
  // 7. 搬进技能目录
  const result = importSkill(staging, userDir)
  removeTree(staging)
  if (!result.ok) return failed(clean.id, failure('bad', { message: result.message || t('skills.readFailed'), detail: result.detail || '' }))
  return {
    ok: true,
    id: clean.id,
    message: t('install.done'),
    problems: [],
    files: folder.files.map((one) => one.rel),
  }
}

// 把版本解成提交号：问 GitHub 的提交接口，拿到那个版本的提交号。
// 解不出来（限流、断了）就照给的版本号下，记下来的时候不写提交号。
async function resolveCommit(plan, ctx) {
  const ref = plan.ref || 'HEAD'
  const url = `https://api.github.com/repos/${plan.owner}/${plan.repo}/commits/${encodeURIComponent(ref)}`
  const res = await request(url, ctx)
  if (!res.ok) return { ok: false, reason: res.reason || 'network', status: res.status }
  const data = await readJson(res.res)
  const sha = data && typeof data.sha === 'string' ? data.sha.trim() : ''
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { ok: false, reason: 'http', status: res.status }
  return { ok: true, sha }
}

// 看仓库里有什么：只问 GitHub 的目录接口，一次拿整棵树。
// 用提交号去看：装的就是记下来的那一版。
async function listRepo(plan, ctx, version) {
  const ref = version || plan.ref || 'HEAD'
  const url = `https://api.github.com/repos/${plan.owner}/${plan.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  const res = await request(url, ctx)
  if (!res.ok) return res
  const data = await readJson(res.res)
  if (!data || !Array.isArray(data.tree)) {
    return { ok: false, reason: 'http', status: res.status }
  }
  if (data.truncated === true) {
    return { ok: false, reason: 'bigrepo' }
  }
  const tree = data.tree
    .filter((one) => one && typeof one.path === 'string' && one.type === 'blob')
    .map((one) => ({ path: one.path, size: Number(one.size) || 0 }))
  return { ok: true, tree }
}

// 找技能文件夹：方案里写了位置就用写的；没写就找带 SKILL.md 的那一个。
// 有好几个就说不清是哪個，让用户重说。
function pickFolder(tree, path) {
  const all = Array.isArray(tree) ? tree : []
  if (typeof path === 'string' && path !== '') {
    const prefix = folderPrefix(path)
    const files = all.filter((one) => one.path.startsWith(prefix))
    if (files.length === 0) return { ok: false, reason: 'missing', path }
    if (!files.some((one) => one.path === `${prefix}SKILL.md`)) {
      return { ok: false, reason: 'nomd', path: `${prefix}SKILL.md` }
    }
    return {
      ok: true,
      path,
      files: files.map((one) => ({ rel: one.path.slice(prefix.length), size: one.size, path: one.path })),
    }
  }
  const roots = []
  for (const one of all) {
    if (!one.path.endsWith('/SKILL.md') && one.path !== 'SKILL.md') continue
    const dir = one.path === 'SKILL.md' ? '' : one.path.slice(0, -'SKILL.md'.length)
    if (!roots.includes(dir)) roots.push(dir)
  }
  if (roots.length === 0) return { ok: false, reason: 'nomd', path: 'SKILL.md' }
  if (roots.length > 1) {
    return { ok: false, reason: 'ambiguous', detail: roots.map((one) => one || '/').join(', ') }
  }
  const prefix = folderPrefix(roots[0])
  const files = all.filter((one) => one.path.startsWith(prefix))
  return {
    ok: true,
    path: roots[0],
    files: files.map((one) => ({ rel: one.path.slice(prefix.length), size: one.size, path: one.path })),
  }
}

// 拼目录前缀：首尾斜杠都去掉，末尾补一个斜杠；空目录就是空串。
// 不这么拼的话，「子目录/SKILL.md」算出来的前缀会是「子目录//」，树里一个文件都对不上。
function folderPrefix(dir) {
  const trimmed = String(dir || '').replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed === '' ? '' : `${trimmed}/`
}

// 下一个文件：先问 GitHub 的内容接口（回的是 base64），不行再试 raw 地址。
// 一个文件最多试 DOWNLOAD_ATTEMPTS 次，只在两个白名单地址之间换。
async function downloadFile(plan, path, ctx, version) {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const ref = version || plan.ref || 'HEAD'
  const urls = [
    `https://api.github.com/repos/${plan.owner}/${plan.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    `https://raw.githubusercontent.com/${plan.owner}/${plan.repo}/${ref}/${encoded}`,
  ]
  let tries = 0
  let last = { ok: false, reason: 'network' }
  let missing = false
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (ctx.left() <= 0) return { ok: false, reason: 'budget' }
    tries += 1
    const url = urls[attempt % urls.length]
    const res = await request(url, ctx)
    if (!res.ok) {
      last = res
      // 404 是确定的没有这个文件；别的错换另一个地址再试。
      if (res.reason === 'missing') missing = true
      continue
    }
    const data = await readBytes(res.res)
    if (data === null) {
      last = { ok: false, reason: 'http', status: res.status }
      continue
    }
    if (data.tooBig === true || data.size > MAX_BYTES) {
      return { ok: false, reason: 'big', tries, seconds: ctx.spent() }
    }
    return { ok: true, data: data.data, tries, seconds: ctx.spent() }
  }
  return {
    ok: false,
    reason: missing ? 'missing' : (last.reason || 'network'),
    status: last.status,
    tries,
    seconds: ctx.spent(),
  }
}

// 发一次请求：只去白名单里的地址，最多等 REQUEST_TIMEOUT_MS。
async function request(url, ctx) {
  let parsed = null
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'http', status: 0 }
  }
  if (!DOWNLOAD_HOSTS.includes(parsed.hostname)) {
    return { ok: false, reason: 'http', status: 0 }
  }
  const fetchImpl = ctx.fetchImpl
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'network' }
  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
  try {
    const res = await fetchImpl(url, signal ? { signal } : {})
    if (!res || res.ok !== true) {
      const status = Number(res?.status) || 0
      if (status === 404) return { ok: false, reason: 'missing', status }
      if (status === 403 || status === 429) return { ok: false, reason: 'rate', status }
      return { ok: false, reason: 'http', status }
    }
    return { ok: true, res, status: res.status }
  } catch (error) {
    const name = String(error?.name || '')
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'network' }
  }
}

// 读 JSON：读不出来当空。
async function readJson(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

// 读内容：GitHub 的内容接口回 base64，raw 接口回原文件。
async function readBytes(res) {
  const type = String(res.headers?.get?.('content-type') || '')
  try {
    if (type.includes('application/json')) {
      const data = await res.json()
      if (!data || typeof data !== 'object') return null
      // 内容接口对大文件不回正文（encoding 不是 base64）：这种直接算太大。
      if (data.encoding !== 'base64' || typeof data.content !== 'string') {
        return { data: Buffer.alloc(0), size: Number(data.size) || 0, tooBig: true }
      }
      const buf = Buffer.from(data.content.replace(/\s+/g, ''), 'base64')
      return { data: buf, size: buf.length, tooBig: false }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return { data: buf, size: buf.length, tooBig: false }
  } catch {
    return null
  }
}

// 删掉方案：装完了或者不装了，工作区里不留这份方案。
export function dropPlan(workspace, id) {
  if (typeof workspace !== 'string' || workspace === '') return { ok: false, message: t('installPlan.workspaceBad') }
  if (typeof id !== 'string' || !SKILL_NAME_RE.test(id)) return { ok: false, message: t('installPlan.badName') }
  const root = planRoot(workspace)
  if (!root) return { ok: false, message: t('installPlan.noPlan') }
  const dir = join(root, id)
  if (!existsSync(dir)) {
    const file = join(root, `${id}.json`)
    if (!existsSync(file)) return { ok: false, message: t('installPlan.noSuchPlan') }
    try {
      writeFileSync(file, '')
    } catch {
      /* 删不掉就留着，不报错 */
    }
    return { ok: true, message: t('installPlan.dropped', { id }) }
  }
  if (!removeTree(dir) || existsSync(dir)) {
    return { ok: false, message: t('installPlan.notRemoved') }
  }
  // 方案文件夹空了就连文件夹一起收掉，工作区里不留空壳
  try {
    if (readdirSync(root).length === 0) removeTree(root)
  } catch {
    /* 收不掉就算了，不报错 */
  }
  return { ok: true, message: t('installPlan.dropped', { id }) }
}

// 找工作区里模型自己下的东西：只看「pending-skills/」下带 SKILL.md 的文件夹，有多个取最新的。
export function findPending(workspace) {
  const root = pendingRoot(workspace)
  if (!root) return null
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'SKILL.md'))) continue
    let mtime = 0
    try {
      mtime = statSync(dir).mtimeMs
    } catch {
      mtime = 0
    }
    candidates.push({ id: entry.name, dir, mtime })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  const picked = candidates[0]
  return {
    id: picked.id,
    dir: picked.dir,
  }
}

// 删掉模型自己下的东西：没经过用户同意的，不留在工作区。
export function dropPending(workspace, id) {
  if (typeof workspace !== 'string' || workspace === '') return { ok: false, message: t('installPlan.workspaceBad') }
  if (typeof id !== 'string' || !SKILL_NAME_RE.test(id)) {
    return { ok: false, message: t('installPlan.badName'), problems: [t('installPlan.badName')] }
  }
  const root = pendingRoot(workspace)
  if (!root) return { ok: false, message: t('installPlan.noPending'), problems: [t('installPlan.noPending')] }
  const dir = join(root, id)
  if (!existsSync(dir)) {
    return { ok: false, message: t('installPlan.noSuchPending'), problems: [t('installPlan.noSuchPending')] }
  }
  if (!removeTree(dir) || existsSync(dir)) {
    return { ok: false, message: t('installPlan.notRemoved'), problems: [t('installPlan.notRemoved')] }
  }
  return { ok: true, message: t('installPlan.deleted', { id }), problems: [] }
}

// 方案所在的文件夹。
function planRoot(workspace) {
  if (typeof workspace !== 'string' || workspace === '') return ''
  return join(workspace, PLAN_DIR_NAME)
}

// 模型自己下的东西所在的文件夹。
function pendingRoot(workspace) {
  if (typeof workspace !== 'string' || workspace === '') return ''
  return join(workspace, PENDING_DIR_NAME)
}
