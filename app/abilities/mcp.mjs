// 外部工具服务（MCP）：条目存取、粘贴解析、「测一下」和交给 dsh 干活用的配置。
// 两种：网址型（http，钥匙放请求头或网址参数）和本机程序型（stdio，钥匙放进它自己的一个环境变量）。
// 钥匙加密后直接存在 mcp.json 里对应的那一条上（app/models/keys.mjs 管怎么存），
// 干活时随会话参数交给 dsh；配置文件的明文里不放钥匙，也不进桌伴和 dsh 进程的环境变量。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { t } from '../copy/copy.mjs'
import { errorLineText } from '../copy/line.mjs'
import { basename, delimiter, dirname, extname, isAbsolute, join } from 'node:path'

// id 跟钥匙串同一套规则（小写字母、数字、连字符），加 mcp- 前缀；
// 总长压在 32 以内，剥掉前缀后还能直接当 dsh 里的服务名用。
const ID_RE = /^mcp-[a-z0-9][a-z0-9-]{0,27}$/
const TRANSPORTS = ['http', 'stdio']
// 网址型：钥匙放请求头（header）/ 网址参数（query）；本机程序型：放进一个环境变量（env）；都不用就是 none
const AUTH_KINDS = ['none', 'header', 'query', 'env']
// 请求头和网址参数的名字只认这套安全字符，别让怪名字混进请求
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
// 环境变量名：字母或下划线开头，后面字母数字下划线
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
// 环境变量里这几种名字算钥匙（粘贴配置时挑出来单独加密存）
const SECRET_ENV_RE = /KEY|TOKEN|SECRET|PASSWORD/i
// 本机程序的参数：最多这么多个、每个最长这么多字
const MAX_ARGS = 50
const MAX_ARG_LENGTH = 1000
// 只认 https 地址；本机调试用的 http://localhost 和 http://127.0.0.1 放行
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i
// 网址参数里这几个名字算钥匙
const QUERY_KEYS = ['key', 'token', 'api_key']
// 「测一下」失败的几句，各配一个 Si 码：显示成「前一句 · Si 码 错误」，前一句只说密钥无效 / 地址无效 / 连接失败，
// 不带网址（网址就在弹窗那一格里）。
// 能复用的码不另起：钥匙不对用 Si401、地址不对用 Si404、连不上用 Si601；
// 那边自己回了 HTTP 码又说不清是哪儿，就用它回的那个码（Si500 这样）；都没有才用 Si110。
const FAIL_CODES = { key: 'Si401', address: 'Si404', network: 'Si601', other: 'Si110' }
const FAIL_STOPS = { key: t('stops.mcpKey'), address: t('stops.mcpAddress'), network: t('stops.mcpDown'), other: t('stops.mcpOther') }
// 本机程序找不到（不是完整路径、按 PATH 也找不到）
const NO_COMMAND_MESSAGE = errorLineText(t('stops.mcpNoCommand'), 'Si109')

function httpsOnly(url) {
  if (typeof url !== 'string' || url === '') return false
  if (/^https:\/\//i.test(url)) return true
  return LOCAL_HTTP.test(url)
}

// 收敛钥匙的放法：不用 / 请求头 / 网址参数 / 环境变量，名字跟着放法走
function normalizeAuth(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (!AUTH_KINDS.includes(src.kind)) return null
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  return { kind: src.kind, name: src.kind === 'none' ? '' : name }
}

// 本机程序的参数：只收字符串
function normalizeArgs(raw) {
  return Array.isArray(raw) ? raw.filter((one) => typeof one === 'string') : []
}

// 本机程序的普通环境变量（不是钥匙的那些）：{ 名字: 值 }，只收字符串
function normalizeEnv(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const [name, value] of Object.entries(src)) {
    if (typeof value === 'string') out[name] = value
  }
  return out
}

// 只留认识的几个字段：手工编辑夹带进来的字段（包括钥匙）一概不收。
// sealed 是我们自己的密文字段（钥匙串写的），原样留着。
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null
  const auth = normalizeAuth(raw.auth)
  // 本机程序型带 transport: 'stdio' 和程序那几项；网址型不写 transport（老条目就是这个样子）
  const entry = raw.transport === 'stdio'
    ? {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name.trim() : '',
        transport: 'stdio',
        command: typeof raw.command === 'string' ? raw.command.trim() : '',
        args: normalizeArgs(raw.args),
        env: normalizeEnv(raw.env),
        auth: auth ?? { kind: 'none', name: '' },
        enabled: raw.enabled !== false,
      }
    : {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name.trim() : '',
        url: typeof raw.url === 'string' ? raw.url.trim() : '',
        auth: auth ?? { kind: 'none', name: '' },
        enabled: raw.enabled !== false,
      }
  if (typeof raw.sealed === 'string' && raw.sealed !== '') entry.sealed = raw.sealed
  return entry
}

// 本机程序那几项哪儿不合格：程序得是完整路径，参数、环境变量名得像样，钥匙只能放环境变量
function stdioProblems(entry, bad) {
  const command = typeof entry.command === 'string' ? entry.command.trim() : ''
  if (command === '' || !isAbsolute(command)) bad(NO_COMMAND_MESSAGE, `command is not an absolute path: ${command}`)
  const args = Array.isArray(entry.args) ? entry.args : []
  if (args.length > MAX_ARGS || args.some((one) => typeof one !== 'string' || one.length > MAX_ARG_LENGTH || one.includes('\0'))) {
    bad(t('common.badConfig'), 'bad args')
  }
  const env = entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env) ? entry.env : {}
  for (const [name, value] of Object.entries(env)) {
    if (!ENV_NAME_RE.test(name) || typeof value !== 'string' || value.includes('\0')) bad(t('common.badConfig'), `bad env: ${name}`)
  }
  const auth = normalizeAuth(entry.auth)
  if (!auth) bad(t('common.badConfig'), 'unknown auth kind')
  else if (auth.kind !== 'none' && auth.kind !== 'env') bad(t('common.badConfig'), `local program auth must be env: ${auth.kind}`)
  else if (auth.kind === 'env' && !ENV_NAME_RE.test(auth.name)) bad(t('common.badName'), `bad env name: ${auth.name}`)
}

// 一条哪儿不合格：[{ text, detail }]。界面只说那几类（名称不合规、网址格式错误、网址参数含密钥、
// 找不到程序，别的都是配置错误），哪条规矩没过的英文短句（detail）进日志
function entryProblems(entry) {
  if (!entry || typeof entry !== 'object') return [{ text: t('common.badConfig'), detail: 'entry is not an object' }]
  const out = []
  const bad = (text, detail) => out.push({ text, detail })
  if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) bad(t('common.badConfig'), `bad id: ${entry.id}`)
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (name.length < 1 || name.length > 20) bad(t('common.badName'), 'name length not 1-20')
  if (entry.transport === 'stdio') {
    stdioProblems(entry, bad)
    return out
  }
  if (!httpsOnly(entry.url)) bad(t('common.badUrl'), 'url is not https')
  const auth = normalizeAuth(entry.auth)
  if (!auth) bad(t('common.badConfig'), 'unknown auth kind')
  else if (auth.kind === 'env') bad(t('common.badConfig'), 'url service auth cannot be env')
  else if (auth.kind !== 'none' && !NAME_RE.test(auth.name)) bad(t('common.badName'), `bad auth name: ${auth.name}`)
  // 网址参数里直接带钥匙的不收：钥匙要单独填，加密存
  if (httpsOnly(entry.url)) {
    try {
      const parsed = new URL(entry.url)
      const leaked = [...parsed.searchParams.keys()].some((key) => QUERY_KEYS.includes(key.toLowerCase()))
      if (leaked) bad(t('mcp.badLeakedKey'), 'key in url query')
    } catch {
      bad(t('common.badUrl'), 'url does not parse')
    }
  }
  return out
}

// 校验一条，返回中文错误数组（去重），空数组就是没问题
export function validateEntry(entry) {
  return [...new Set(entryProblems(entry).map((one) => one.text))]
}

// 校验没过时那几条的细节，一行（进日志）
export function entryDetail(entry) {
  return entryProblems(entry).map((one) => one.detail).join('; ')
}

function readWhole(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

// 读条目：文件缺了、坏了、没写 mcp 字段都回空数组。
// 密文（sealed）不往外带：这份列表要进界面。
export function loadMcp(file) {
  const raw = readWhole(file)
  const list = Array.isArray(raw.mcp) ? raw.mcp : []
  const out = []
  for (const item of list) {
    const entry = normalizeEntry(item)
    if (!entry) continue
    const { sealed, ...plain } = entry
    out.push(plain)
  }
  return out
}

// 存条目：每条先过校验，有一条不过就抛错不写盘；
// 只动 mcp 字段，同一个文件里别的字段原样留着；先写临时文件再改名顶上。
// 盘上已有的密文（sealed）留着：条目里没带密文时不能把它抹掉。
export function saveMcp(file, entries) {
  const list = Array.isArray(entries) ? entries : []
  const clean = []
  for (const entry of list) {
    const errors = validateEntry(entry)
    if (errors.length > 0) throw new Error(`${errors[0]}: ${entryDetail(entry)}`)
    clean.push(normalizeEntry(entry))
  }
  const raw = readWhole(file)
  const kept = sealedOnDisk(file)
  raw.mcp = clean.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    if (entry.sealed !== undefined && entry.sealed !== '') return entry
    const old = kept.get(entry.id)
    return old ? { ...entry, sealed: old } : entry
  })
  const tmp = `${file}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

// 盘上每一条已有的密文：id → 密文
function sealedOnDisk(file) {
  const out = new Map()
  const raw = readWhole(file)
  const list = Array.isArray(raw.mcp) ? raw.mcp : []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string') continue
    if (typeof entry.sealed === 'string' && entry.sealed !== '') out.set(entry.id, entry.sealed)
  }
  return out
}

// 名字变 id 的底子：GitHub 工具 → mcp-github；纯中文名字起不出英文短名，就排号
function idBase(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return slug ? `mcp-${slug}` : 'mcp-1'
}

// 重名就往后排：mcp-github、mcp-github-2……总长不超过 32
function nextId(entries, base) {
  const taken = new Set(entries.map((entry) => (entry && typeof entry === 'object' ? entry.id : null)))
  const cap = (text) => {
    const cut = text.slice(0, 32).replace(/-+$/, '')
    return cut || 'mcp-1'
  }
  let id = cap(base)
  if (!taken.has(id)) return id
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    id = cap(`${base.slice(0, 32 - suffix.length)}${suffix}`)
    if (!taken.has(id)) return id
  }
}

// 本机程序的完整路径：给的是完整路径就看它在不在；只给了名字（npx、uvx 这种）就按 PATH 找，
// Windows 上没写后缀时按 PATHEXT 试 .exe / .cmd 这些。带目录的相对路径不认（不知道相对谁）。
// 找不到回空串。
export function resolveCommand(command, env = process.env) {
  const text = typeof command === 'string' ? command.trim() : ''
  if (text === '') return ''
  const isFile = (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }
  if (isAbsolute(text)) return isFile(text) ? text : ''
  if (text.includes('/') || text.includes('\\')) return ''
  const pathText = env?.PATH ?? env?.Path ?? ''
  const dirs = String(pathText).split(delimiter).map((one) => one.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
  const exts = process.platform === 'win32' && extname(text) === ''
    ? String(env?.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((one) => one.trim().toLowerCase()).filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, `${text}${ext}`)
      if (isAbsolute(full) && isFile(full)) return full
    }
  }
  return ''
}

// 条目输入里本机程序那几项：程序找成完整路径，参数、普通环境变量收干净
function stdioInput(src, current = {}) {
  const raw = typeof src.command === 'string' ? src.command : current.command
  const command = resolveCommand(raw) || (typeof raw === 'string' ? raw.trim() : '')
  return {
    command,
    args: Array.isArray(src.args) ? normalizeArgs(src.args) : normalizeArgs(current.args),
    env: src.env !== undefined ? normalizeEnv(src.env) : normalizeEnv(current.env),
  }
}

// 本机程序找不到：完整路径不在、或者按名字在 PATH 里也找不到
function commandMissing(entry) {
  if (entry.transport !== 'stdio') return false
  return !entry.command || !isAbsolute(entry.command) || !existsSync(entry.command)
}

// 钥匙进钥匙串：空钥匙不算错（回头可以补），钥匙串存不了才算错
function storeSecret(keyring, id, secret, kind) {
  const text = typeof secret === 'string' ? secret.trim() : ''
  if (kind === 'none' || text === '') return { ok: true }
  if (!keyring || typeof keyring.save !== 'function') return { ok: false, message: errorLineText(t('stops.keyStoreFailed'), 'Si908') }
  const saved = keyring.save(id, text)
  if (!saved || saved.ok !== true) return { ok: false, message: saved?.message || errorLineText(t('stops.keyStoreFailed'), 'Si908') }
  return { ok: true }
}

// 加一条：id 自动起，钥匙（input.secret）加密后存进这条自己在 mcp.json 里的位置；
// 放法写得不认识就原样交给校验去报错，不悄悄当作「不用」
export function addMcp(file, input, keyring) {
  const entries = loadMcp(file)
  const src = input && typeof input === 'object' ? input : {}
  const id = nextId(entries, idBase(src.name))
  const rawAuth =
    src.auth && typeof src.auth === 'object' && !Array.isArray(src.auth)
      ? normalizeAuth(src.auth) ?? src.auth
      : { kind: 'none', name: '' }
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  const entry = src.transport === 'stdio'
    ? { id, name, transport: 'stdio', ...stdioInput(src), auth: rawAuth, enabled: src.enabled !== false }
    : { id, name, url: typeof src.url === 'string' ? src.url.trim() : '', auth: rawAuth, enabled: src.enabled !== false }
  if (commandMissing(entry)) return { ok: false, id, entries, errors: [NO_COMMAND_MESSAGE], detail: `command not found: ${entry.command}` }
  const errors = validateEntry(entry)
  if (errors.length > 0) return { ok: false, id, entries, errors, detail: entryDetail(entry) }
  // 先把条目写进去，钥匙才有地方存（密文存在这条自己身上）；存不上就把条目退回去
  const before = entries.slice()
  entries.push(entry)
  saveMcp(file, entries)
  const saved = storeSecret(keyring, id, src.secret, entry.auth.kind)
  if (!saved.ok) {
    saveMcp(file, before)
    return { ok: false, id, entries: before, errors: [saved.message] }
  }
  return { ok: true, id, entries, errors: [] }
}

// 改一条：id 不许改；secret 传了就换钥匙，放法改成「不用」就把钥匙删掉
export function updateMcp(file, id, patch, keyring, secret) {
  const entries = loadMcp(file)
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) return { ok: false, entries, errors: [t('common.badConfig')], detail: `no entry: ${id}` }
  const rest = patch && typeof patch === 'object' ? { ...patch } : {}
  delete rest.id
  const current = entries[index]
  // 种类（网址 / 本机程序）跟着改动走；只改开关时照旧
  const wasStdio = current.transport === 'stdio'
  const stdio = rest.transport === 'stdio' || (rest.transport !== 'http' && wasStdio)
  const name = typeof rest.name === 'string' ? rest.name.trim() : current.name
  const auth = normalizeAuth(rest.auth) ?? current.auth
  const enabled = 'enabled' in rest ? rest.enabled !== false : current.enabled
  const next = stdio
    ? { id, name, transport: 'stdio', ...stdioInput(rest, wasStdio ? current : {}), auth, enabled }
    : { id, name, url: typeof rest.url === 'string' ? rest.url.trim() : current.url ?? '', auth, enabled }
  const transport = stdio ? 'stdio' : 'http'
  // 程序路径改了才查它在不在：只改开关时不因为别处删了程序就存不上
  const commandChanged = transport === 'stdio' && (current.transport !== 'stdio' || next.command !== current.command)
  if (commandChanged && commandMissing(next)) return { ok: false, entries, errors: [NO_COMMAND_MESSAGE], detail: `command not found: ${next.command}` }
  const errors = validateEntry(next)
  if (errors.length > 0) return { ok: false, entries, errors, detail: entryDetail(next) }
  // 条目先写下去，钥匙才有地方存；存不上就把这条退回去
  const before = entries.slice()
  entries[index] = next
  saveMcp(file, entries)
  if (secret !== undefined && secret !== null) {
    const saved = storeSecret(keyring, id, secret, next.auth.kind)
    if (!saved.ok) {
      saveMcp(file, before)
      return { ok: false, entries: before, errors: [saved.message] }
    }
  }
  if (next.auth.kind === 'none' && keyring && typeof keyring.remove === 'function') keyring.remove(id)
  return { ok: true, id, entries, errors: [] }
}

// 删一条：条目删掉，钥匙串里的钥匙一起删
export function removeMcp(file, id, keyring) {
  const entries = loadMcp(file)
  const kept = entries.filter((entry) => entry.id !== id)
  if (kept.length === entries.length) return { ok: false, entries, errors: [t('common.badConfig')], detail: `no entry: ${id}` }
  saveMcp(file, kept)
  if (keyring && typeof keyring.remove === 'function') keyring.remove(id)
  return { ok: true, entries: kept, errors: [] }
}

// ─── 粘贴解析 ───────────────────────────────────────────────

// 粘来的本机程序配置：{ command, args, env }。程序按 PATH 找成完整路径；
// env 里名字像钥匙（带 KEY / TOKEN / SECRET / PASSWORD）的第一个抽出来单独加密存，别的照原样留着。
function takeLocalServer(out, name, cfg, bad) {
  const raw = typeof cfg.command === 'string' ? cfg.command.trim() : ''
  if (raw === '') {
    bad(NO_COMMAND_MESSAGE, 'no command')
    return
  }
  const command = resolveCommand(raw)
  if (!command) {
    bad(NO_COMMAND_MESSAGE, `command not found: ${raw}`)
    return
  }
  const args = Array.isArray(cfg.args) ? cfg.args.map((one) => String(one)) : []
  const rawEnv = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env) ? cfg.env : {}
  const env = {}
  let auth = { kind: 'none', name: '' }
  let secret = ''
  for (const [envName, value] of Object.entries(rawEnv)) {
    if (typeof value !== 'string') continue
    if (auth.kind === 'none' && SECRET_ENV_RE.test(envName) && value.trim() !== '') {
      auth = { kind: 'env', name: envName }
      secret = value.trim()
      continue
    }
    env[envName] = value
  }
  // 没名字的写法拿程序名当名字（npx、uvx 这种）
  const entryName = name || basename(command, extname(command))
  out.entries.push({ name: entryName, transport: 'stdio', command, args, env, auth })
  if (secret !== '') out.secrets[entryName] = secret
}

// 从别处粘来的标准配置：{ "mcpServers": { 名: { url/serverUrl, headers, type } 或 { command, args, env } } }
// 或单个 { url, headers } / { command, args, env }。
// 有毛病的记一条 { name, message, detail }：message 只说那几类，detail 是英文细节（进日志）。
function takeServer(out, name, cfg) {
  const bad = (message, detail) => out.problems.push({ name, message, detail })
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    bad(t('common.badConfig'), 'server entry is not an object')
    return
  }
  if (cfg.command != null || cfg.type === 'stdio') {
    takeLocalServer(out, name, cfg, bad)
    return
  }
  const rawUrl =
    typeof cfg.url === 'string' && cfg.url.trim() !== '' ? cfg.url.trim()
      : typeof cfg.serverUrl === 'string' && cfg.serverUrl.trim() !== '' ? cfg.serverUrl.trim()
        : ''
  if (rawUrl === '') {
    bad(t('mcp.testNeedUrl'), 'no url')
    return
  }
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    bad(t('common.badUrl'), 'url does not parse')
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    bad(t('common.badUrl'), `protocol ${parsed.protocol}`)
    return
  }
  // 请求头里 Authorization / 带 key / 带 token 的抽成钥匙
  const headers = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers) ? cfg.headers : {}
  let headerHit = null
  for (const [hName, hValue] of Object.entries(headers)) {
    if (typeof hValue !== 'string' || hValue.trim() === '') continue
    const low = hName.toLowerCase()
    if (low === 'authorization' || low.includes('key') || low.includes('token')) {
      headerHit = { name: hName, value: hValue.trim() }
      break
    }
  }
  // 网址参数里 key / token / api_key 也抽出来，存起来的网址不带钥匙
  let queryHit = null
  for (const key of [...parsed.searchParams.keys()]) {
    if (!QUERY_KEYS.includes(key.toLowerCase())) continue
    const value = parsed.searchParams.get(key)
    parsed.searchParams.delete(key)
    if (!queryHit && value && value.trim() !== '') queryHit = { name: key, value: value.trim() }
  }
  let auth = { kind: 'none', name: '' }
  let secret = ''
  if (headerHit) {
    auth = { kind: 'header', name: headerHit.name }
    secret = headerHit.value
    if (queryHit) bad(t('common.badConfig'), 'key in both header and url query; using the header')
  } else if (queryHit) {
    auth = { kind: 'query', name: queryHit.name }
    secret = queryHit.value
  }
  // 单个 { url, headers } 的写法没名字，拿主机名当名字
  const entryName = name || parsed.hostname
  out.entries.push({ name: entryName, url: parsed.toString(), auth })
  if (secret !== '') out.secrets[entryName] = secret
}

export function parsePasted(text) {
  const out = { entries: [], secrets: {}, problems: [] }
  let data
  const notStandard = (detail) => {
    out.problems.push({ name: '', message: t('common.badConfig'), detail })
    return out
  }
  try {
    data = JSON.parse(String(text ?? ''))
  } catch {
    return notStandard('not JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return notStandard('not a JSON object')
  if (data.mcpServers !== undefined) {
    const servers = data.mcpServers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return notStandard('mcpServers is not an object')
    for (const [name, cfg] of Object.entries(servers)) takeServer(out, name, cfg)
    return out
  }
  takeServer(out, '', data)
  return out
}

// ─── 测一下 ─────────────────────────────────────────────────

// 钥匙放网址参数时，把钥匙拼进真正发出去的网址；返回值和日志都不带它
function targetUrl(url, auth, secret) {
  if (auth && auth.kind === 'query' && secret) {
    const glue = url.includes('?') ? '&' : '?'
    return `${url}${glue}${encodeURIComponent(auth.name)}=${encodeURIComponent(secret)}`
  }
  return url
}

function failKind(status) {
  if (status === 401 || status === 403) return 'key'
  if (status === 404) return 'address'
  return null
}

// 「测一下」没通：前一句按种类说（密钥无效 / 地址无效 / 连接失败），码跟在后面；status 交给调用方记日志
function fail(kind, status = 0) {
  let code = FAIL_CODES[kind] || FAIL_CODES.other
  // 那边自己回了 HTTP 码：码就是它回的那个（Si500、Si503 这样）
  if (kind === 'other' && Number(status) >= 400 && Number(status) < 600) code = `Si${status}`
  return { ok: false, kind, code, status: Number(status) || 0, message: errorLineText(FAIL_STOPS[kind] || FAIL_STOPS.other, code) }
}

// 回包可能是 JSON，也可能是 SSE（一行一行的 data:），都要解
function jsonResult(obj, wantId) {
  if (!obj || typeof obj !== 'object') return null
  if (obj.id !== undefined && obj.id !== wantId) return null
  if (obj.error) return { error: obj.error }
  if (obj.result !== undefined) return { result: obj.result }
  return null
}

function readPayload(text, contentType, wantId) {
  const isSse = typeof contentType === 'string' && contentType.includes('text/event-stream')
  if (!isSse) {
    try {
      return jsonResult(JSON.parse(text), wantId)
    } catch {
      return null
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '') continue
    let obj
    try {
      obj = JSON.parse(payload)
    } catch {
      continue
    }
    const found = jsonResult(obj, wantId)
    if (found) return found
  }
  return null
}

// 按网址型（Streamable HTTP）连一遍：initialize → notifications/initialized → tools/list。
// 成功回 { ok: true, tools, message }；失败回 { ok: false, kind, message }，钥匙不出现在任何返回值里。
export async function probeMcp(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 20000
  const auth = normalizeAuth(opts.auth) ?? { kind: 'none', name: '' }
  const secret = typeof opts.secret === 'string' ? opts.secret.trim() : ''
  const target = targetUrl(typeof opts.url === 'string' ? opts.url : '', auth, secret)
  const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
  if (auth.kind === 'header' && secret !== '' && NAME_RE.test(auth.name)) headers[auth.name] = secret
  // 后续请求要带上的头：会话号、协商出的协议版本
  let extra = {}

  const request = async (payload, { ignoreBody = false } = {}) => {
    let res
    let text = ''
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        res = await fetchImpl(target, {
          method: 'POST',
          headers: { ...headers, ...extra },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        text = await res.text()
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return { kind: 'network' }
    }
    const kind = failKind(res.status)
    if (res.status < 200 || res.status >= 300) return kind ? { kind, status: res.status } : { kind: 'other', status: res.status }
    const sessionId = res.headers && typeof res.headers.get === 'function' ? res.headers.get('mcp-session-id') : null
    if (sessionId) extra = { ...extra, 'Mcp-Session-Id': sessionId }
    if (ignoreBody) return { ok: true }
    const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : ''
    const found = readPayload(text, contentType, payload.id)
    if (!found) return { kind: 'other' }
    if (found.error) return { kind: 'other' }
    return { result: found.result }
  }

  const init = await request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'sidemate', version: '0.1.0' },
    },
  })
  if (init.kind) return fail(init.kind, init.status)
  if (init.result && typeof init.result.protocolVersion === 'string') {
    extra = { ...extra, 'MCP-Protocol-Version': init.result.protocolVersion }
  }
  const notified = await request({ jsonrpc: '2.0', method: 'notifications/initialized' }, { ignoreBody: true })
  if (notified.kind) return fail(notified.kind, notified.status)
  const listed = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  if (listed.kind) return fail(listed.kind, listed.status)
  const rawTools = listed.result && Array.isArray(listed.result.tools) ? listed.result.tools : []
  const tools = []
  for (const tool of rawTools) {
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || tool.name === '') continue
    tools.push({ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' })
  }
  return { ok: true, tools, message: t('mcp.testOk', { count: tools.length }) }
}

// 本机程序跑起来要等一会儿（npx / uvx 第一次跑还要下包），给得比网址型宽
const STDIO_TIMEOUT_MS = 60000

// cmd.exe 的一个参数：带空格或特殊字符的整个用引号包起来，里面的引号写两遍
function cmdQuote(arg) {
  const text = String(arg)
  if (text !== '' && !/[\s"&|<>^%!()]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

// 起本机程序：.cmd / .bat 只能经 cmd.exe 跑（npx.cmd 这种），别的直接起
function spawnLocal(command, args, env) {
  const options = { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
  const ext = extname(command).toLowerCase()
  if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    const line = [command, ...args].map(cmdQuote).join(' ')
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true })
  }
  return spawn(command, args, options)
}

// 收掉本机程序和它起的子进程（cmd.exe 下面的 node 这种）
function stopLocal(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // 已经没了
  }
}

// 给本机程序的环境：桌伴自己的环境去掉像钥匙的变量（跟 dsh 起子进程同一个规矩），
// 再加上这条配的普通变量和它自己的那把钥匙
function localEnv(env, auth, secret) {
  const out = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || SECRET_ENV_RE.test(name) || name.toUpperCase().startsWith('DSH_')) continue
    out[name] = value
  }
  Object.assign(out, normalizeEnv(env))
  if (auth && auth.kind === 'env' && ENV_NAME_RE.test(auth.name) && secret) out[auth.name] = secret
  return out
}

// 按本机程序型（stdio）连一遍：起程序 → initialize → notifications/initialized → tools/list → 收掉。
// 跟网址型的「测一下」同一个回话样子；钥匙不出现在任何返回值里。
export async function probeLocalMcp(options) {
  const opts = options && typeof options === 'object' ? options : {}
  const command = resolveCommand(opts.command)
  if (!command) return { ok: false, kind: 'command', code: 'Si109', status: 0, message: NO_COMMAND_MESSAGE }
  const args = normalizeArgs(opts.args)
  const auth = normalizeAuth(opts.auth) ?? { kind: 'none', name: '' }
  const secret = typeof opts.secret === 'string' ? opts.secret.trim() : ''
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : STDIO_TIMEOUT_MS
  const spawnImpl = typeof opts.spawnImpl === 'function' ? opts.spawnImpl : spawnLocal
  let child
  try {
    child = spawnImpl(command, args, localEnv(opts.env, auth, secret))
  } catch {
    return fail('other')
  }
  return await new Promise((resolve) => {
    let settled = false
    let buffer = ''
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stopLocal(child)
      resolve(result)
    }
    const timer = setTimeout(() => done(fail('network')), timeoutMs)
    const send = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`)
      } catch {
        done(fail('other'))
      }
    }
    child.on('error', () => done(fail('other')))
    child.on('exit', () => done(fail('other')))
    child.stdin?.on?.('error', () => {})
    child.stderr?.on?.('data', () => {})
    child.stdout.setEncoding?.('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk)
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id === 1) {
          if (message.error) return done(fail('other'))
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (message.id === 2) {
          if (message.error) return done(fail('other'))
          const rawTools = message.result && Array.isArray(message.result.tools) ? message.result.tools : []
          const tools = []
          for (const tool of rawTools) {
            if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || tool.name === '') continue
            tools.push({ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' })
          }
          return done({ ok: true, tools, message: t('mcp.testOk', { count: tools.length }) })
        }
      }
    })
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sidemate', version: '0.1.0' } },
    })
  })
}

// ─── 交给 dsh ───────────────────────────────────────────────

// 服务名：剥掉 mcp- 前缀，正好落在 dsh 认的字符集和长度里
function serverName(entry) {
  const id = String(entry?.id ?? '')
  return id.startsWith('mcp-') && id.length > 4 ? id.slice(4) : id
}

// 这一轮要用的外部工具服务：[{ server, secret }]。
// server 是交给 dsh 的那条：网址型 { type: 'http', name, url, headers }；
// 本机程序型（ACP 里没有 type 字段）{ name, command, args, env: [{ name, value }] }。
// secret 是这一条的钥匙原文（只在主进程内存里传，不写盘）。
// 钥匙放请求头（header）、拼在网址参数里（query）或放进本机程序的一个环境变量（env）；不用钥匙的就不带。
// 停用的、校验不过的、要钥匙但钥匙串里没有的都不进这个表。
function pickedMcp(entries, keyring) {
  const out = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.enabled === false) continue
    if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) continue
    if (validateEntry(entry).length > 0) continue
    const auth = normalizeAuth(entry.auth) ?? { kind: 'none', name: '' }
    let secret = ''
    if (auth.kind !== 'none') {
      if (!keyring || typeof keyring.read !== 'function') continue
      secret = keyring.read(entry.id)
      if (typeof secret !== 'string' || secret === '') continue
    }
    if (entry.transport === 'stdio') {
      const env = Object.entries(normalizeEnv(entry.env)).map(([name, value]) => ({ name, value }))
      if (auth.kind === 'env') env.push({ name: auth.name, value: secret })
      out.push({ server: { name: serverName(entry), command: entry.command, args: normalizeArgs(entry.args), env }, secret })
      continue
    }
    let url = entry.url
    const headers = []
    if (auth.kind === 'header') {
      headers.push({ name: auth.name, value: secret })
    } else if (auth.kind === 'query') {
      // 钥匙过 encodeURIComponent 再拼，跟 probeMcp 发出去的网址同一套写法；
      // 钥匙里带 + / = & 时两边才不会一个过一个不过。
      const glue = url.includes('?') ? '&' : '?'
      url = `${url}${glue}${encodeURIComponent(auth.name)}=${encodeURIComponent(secret)}`
    }
    out.push({ server: { type: 'http', name: serverName(entry), url, headers }, secret })
  }
  return out
}

// 交给 dsh 的外部工具服务：ACP 原生做法，建会话时随 mcpServers 参数传。
export function mcpServersFor(entries, keyring) {
  return pickedMcp(entries, keyring).map((one) => one.server)
}

// 这一轮的外部工具服务：服务表 + 钥匙原文。
// 钥匙只在主进程内存里传（打码名单用），不写盘，也不进环境变量。
export function mcpToolsFor(entries, keyring) {
  const servers = []
  const secrets = []
  for (const one of pickedMcp(entries, keyring)) {
    servers.push(one.server)
    if (one.secret === '') continue
    if (!secrets.includes(one.secret)) secrets.push(one.secret)
    // 钥匙放网址参数里时，网址上写的是编码后的那份，两个都盖
    const encoded = encodeURIComponent(one.secret)
    if (encoded !== one.secret && !secrets.includes(encoded)) secrets.push(encoded)
  }
  return { servers, secrets }
}

