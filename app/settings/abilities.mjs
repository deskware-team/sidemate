// 「能力」页的纯逻辑：技能和外部工具服务的文件放在哪、每行显示什么、小标、第二行文字、
// 搜索次数、tools / mcpStatus 的读写，弹窗表单跟条目怎么换、「存下」什么时候能点。
// 不引 electron：node --test 直接测。技能走 app/abilities/skills.mjs、外部工具服务走
// app/abilities/mcp.mjs 的规矩，这里只管拼页面要看的和存状态那两个字段，不另造一套。

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { t } from '../copy/copy.mjs'
import { errorLineText } from '../copy/line.mjs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addMcp, loadMcp, probeLocalMcp, probeMcp, removeMcp, updateMcp } from '../abilities/mcp.mjs'
import { PROVENANCE_FILE_NAME, importSkill, listSkills, removeSkill, setEnabled as recordSkillEnabled } from '../abilities/skills.mjs'
import { monthKey } from '../usage/index.mjs'
import { appPaths, appRoot } from '../paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// 存不上：这一类只有这一句、这一个码（Si907）
const SAVE_FAILED_LINE = errorLineText(t('stops.saveFailed'), 'Si907')

// 技能开关和工具开关存在程序数据目录下的 ability.json，外部工具服务存在 mcp.json
export const ABILITY_FILE_NAME = 'ability.json'
// 外部工具服务（条目和测过的结果）所在的那个文件
export const MCP_FILE_NAME = 'mcp.json'

// 没有外部工具服务时列表里那一句话
export const MCP_EMPTY_TEXT = t('abilities.mcpEmpty')

// 路径算法跟任务壳给技能目录的那一套一致：仓库里的 app/skills、程序数据目录下的 skills\；
// 推荐技能在仓库里的 app/skills-recommended，目录没有就是空。
export function abilitiesPaths(root = appRoot(), repo = resolve(here, '..', '..')) {
  const paths = appPaths(root)
  return {
    stateFile: paths.ability,
    mcpFile: paths.mcp,
    bundledDir: join(repo, 'app', 'skills'),
    recommendedDir: join(repo, 'app', 'skills-recommended'),
    userDir: paths.skills,
  }
}

// 读整个文件：缺了、坏了都当空对象，别的字段原样留着
function readWhole(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// 先写临时文件再改名顶上，中途断电不会写坏
function writeWhole(file, raw) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

// —————————————————————————————— 技能 ——————————————————————————————

// 自带技能在页面上叫什么、第二行写什么：照 0.3 稿。表里没有的自带技能还用 SKILL.md 的那两行。
export const BUNDLED_DISPLAY = {
  'sidemate-writing': { name: t('abilities.skillWriting'), note: t('abilities.skillWritingNote') },
}
// 内部用的自带技能不列进列表：装技能那个是「说一句就装技能」专用的
const BUNDLED_HIDDEN = ['sidemate-skill-install']

// 推荐技能在页面上叫什么、第二行写什么：跟 BUNDLED_DISPLAY 同一做法。
// 入选结论和出处看 docs/能力入选标准.md。表里没有的推荐技能还用 SKILL.md 的那两行。
export const RECOMMENDED_DISPLAY = {
  'sidemate-diagram': { name: t('abilities.skillDiagram'), note: t('abilities.skillDiagramNote') },
}

// 来历小标：自带 / 我加的 是纸底字次色，推荐 是白底红边红字（样子在 page.css 的 .tag）
export function skillBadge(source) {
  const text = source === 'recommended'
    ? t('abilities.tagRecommended')
    : source === 'mine' ? t('abilities.tagMine') : t('abilities.tagBuiltin')
  return { text, kind: source === 'recommended' ? 'line' : 'bg' }
}

const two = (n) => String(n).padStart(2, '0')

// 我加的技能第二行：SKILL.md 的修改日期写成「导入于 MM-DD」
export function importedAtText(at, now = Date.now()) {
  return t('abilities.imported', { date: dayText(at, now) })
}

// 日子：MM-DD
function dayText(at, now = Date.now()) {
  const date = new Date(Number.isFinite(at) ? at : now)
  return `${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

// AI 装的能力和技能放在一起的那份来历说明
export { PROVENANCE_FILE_NAME }
// 只认 GitHub 公开仓库的地址
const GITHUB_REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(?:\.git)?\/?$/
// 提交号：GitHub 给的是一串十六进制
const COMMIT_RE = /^[0-9a-f]{7,40}$/i

// 只放行 GitHub 仓库的地址：别的地址不给点
export function allowedRepoUrl(url) {
  const text = typeof url === 'string' ? url.trim() : ''
  if (!/^https:\/\/github\.com\//i.test(text)) return ''
  return text
}

// 读技能文件夹里的 origin.json：读不出来、字段类型不对、地址不是 GitHub，都当没有这份说明
export function readProvenance(dir) {
  const path = join(String(dir ?? ''), PROVENANCE_FILE_NAME)
  let raw = null
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = typeof raw.source === 'string' ? raw.source.trim() : ''
  const match = GITHUB_REPO_RE.exec(source)
  if (!match) return null
  // 哪个字段类型不对，这份说明就不可信，当没有
  for (const key of ['license', 'commit', 'installedAt', 'by']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') return null
  }
  const license = String(raw.license ?? '').trim()
  const commit = String(raw.commit ?? '').trim()
  return {
    source,
    owner: match[1],
    repo: match[2],
    repoText: `github.com/${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}`,
    license: license === '' ? t('abilities.noLicense') : t('abilities.license', { name: license }),
    commit: COMMIT_RE.test(commit) ? commit : '',
    installedAt: String(raw.installedAt ?? '').trim(),
    by: String(raw.by ?? '').trim(),
  }
}

// 装的那一天：来历里写了安装时间就用它，没写就照 SKILL.md 的修改日期
function installedDay(prov, skill) {
  const at = parseTime(prov.installedAt)
  if (at) return `${two(at.getMonth() + 1)}-${two(at.getDate())}`
  return dayText(mtimeOf(join(String(skill.dir ?? ''), 'SKILL.md')))
}

// 认时间：认 ISO 那种写法
function parseTime(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const date = new Date(text.trim())
  if (Number.isNaN(date.getTime())) return null
  return date
}

// 我加的技能第二行：AI 按用户的话装的写「对话中安装于 MM-DD，仓库，许可证 X」，
// 仓库那一段能点；没有 origin.json 的照旧写「导入于 MM-DD」。几段之间用「，」（页面那边同一个），设置里的行不用「· 」隔开。
export function mineNoteParts(skill) {
  const one = skill && typeof skill === 'object' ? skill : {}
  const prov = readProvenance(String(one.dir ?? ''))
  if (!prov) return null
  const title = prov.commit !== ''
    ? t('abilities.commit', { commit: prov.commit.slice(0, 7) })
    : t('abilities.openRepo')
  return [
    { text: t('abilities.aiInstalled', { date: installedDay(prov, one) }) },
    { text: prov.repoText, url: prov.url, title },
    { text: prov.license },
  ]
}

// 一个文件的修改时间，读不到就不写日子
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return NaN
  }
}

// 第二行字：我加的写导入日期，表里的自带和推荐技能写表上那句，其余写 SKILL.md 的 description
export function skillNote(skill) {
  const one = skill && typeof skill === 'object' ? skill : {}
  if (one.source === 'mine') return importedAtText(mtimeOf(join(String(one.dir ?? ''), 'SKILL.md')))
  if (one.source === 'bundled' && BUNDLED_DISPLAY[one.id]) return BUNDLED_DISPLAY[one.id].note
  if (one.source === 'recommended' && RECOMMENDED_DISPLAY[one.id]) return RECOMMENDED_DISPLAY[one.id].note
  return String(one.description ?? '')
}

// 第一行的名字：表里的自带和推荐技能用页面上的叫法
function skillName(skill) {
  const one = skill && typeof skill === 'object' ? skill : {}
  if (one.source === 'bundled' && BUNDLED_DISPLAY[one.id]) return BUNDLED_DISPLAY[one.id].name
  if (one.source === 'recommended' && RECOMMENDED_DISPLAY[one.id]) return RECOMMENDED_DISPLAY[one.id].name
  return String(one.name ?? '')
}

// 技能列表每行：名字、小标、第二行字、右边「删」（只有我加的）和开关；内部用的自带技能不列
export function skillRows(list) {
  return (Array.isArray(list) ? list : []).filter(Boolean)
    .filter((skill) => !(skill.source === 'bundled' && BUNDLED_HIDDEN.includes(String(skill.id ?? ''))))
    .map((skill) => {
      const parts = skill.source === 'mine' ? mineNoteParts(skill) : null
      return {
        id: String(skill.id ?? ''),
        source: String(skill.source ?? ''),
        name: skillName(skill),
        badge: skillBadge(skill.source),
        note: parts ? parts.map((one) => one.text).join('，') : skillNote(skill),
        // 第二行分成几段：仓库那一段能点，其余就是字
        parts: parts || [],
        enabled: skill.enabled !== false,
        removable: skill.source === 'mine',
        buttons: skill.source === 'mine' ? [{ id: 'remove', label: t('abilities.remove') }] : [],
      }
    })
}

// 技能开关：只记状态，文件里别的字段不动
export function setSkillEnabled(stateFile, source, id, on) {
  recordSkillEnabled(stateFile, String(source ?? ''), String(id ?? ''), on === true)
}

// 导入技能：结果原样带回，界面只挑 ok / problems 用
// stateFile 给了就把改过的名字记成显示名：界面上还是用户自己起的那个名
export function importUserSkill(userDir, from, stateFile = '') {
  return importSkill(String(from ?? ''), userDir, { stateFile: String(stateFile ?? '') })
}

// 删技能：只能删我加的那批
export function removeUserSkill(userDir, id) {
  return removeSkill(userDir, String(id ?? ''))
}

// —————————————————————————————— 联网搜索 ——————————————————————————————

// tools 字段只存开关；用不用由任务壳决定（app/abilities/launch.mjs）
export function loadTools(file) {
  const tools = readWhole(file).tools
  const safe = tools && typeof tools === 'object' && !Array.isArray(tools) ? tools : {}
  return {
    search: typeof safe.search === 'boolean' ? safe.search : true,
    fetch: typeof safe.fetch === 'boolean' ? safe.fetch : true,
    // 「允许访问本地网络」默认关：开着模型才能读本机和局域网里的网页
    localNet: typeof safe.localNet === 'boolean' ? safe.localNet : false,
  }
}

// 记一个工具的开关：只动 tools 字段，skills / mcp 等别的字段原样留着
export function saveTool(file, name, on) {
  const key = name === 'search' || name === 'fetch' || name === 'localNet' ? name : ''
  if (!key) return { ok: false, message: t('common.badConfig'), tools: loadTools(file) }
  const raw = readWhole(file)
  raw.tools = { ...loadTools(file), [key]: on === true }
  writeWhole(file, raw)
  return { ok: true, message: '', tools: loadTools(file) }
}

// 这个月搜了几次：用量记录里的 searches 按自然月加起来
export function monthSearches(records, now = Date.now()) {
  const month = monthKey(now)
  return (Array.isArray(records) ? records : [])
    .filter((row) => row && typeof row === 'object' && monthKey(row.at) === month)
    .reduce((sum, row) => sum + (typeof row.searches === 'number' && Number.isFinite(row.searches) ? row.searches : 0), 0)
}

// 联网搜索和读网页两行：没配钥匙时联网搜索灰掉、显示关，名字旁边挂「需填入密钥」那块小标；
// 配好了小标就摘掉
export function toolRows(tools, options = {}) {
  const safe = tools && typeof tools === 'object' ? tools : {}
  const hasKey = options.hasKey === true
  const count = Number.isFinite(options.searches) ? Math.max(0, Math.round(options.searches)) : 0
  const searchBadges = [{ text: t('abilities.tagBuiltin'), kind: 'bg' }]
  if (!hasKey) searchBadges.push({ text: t('abilities.searchNeedKey'), kind: 'line' })
  return [
    {
      id: 'search',
      name: t('abilities.search'),
      badges: searchBadges,
      note: t('abilities.searchStat', { count }),
      enabled: hasKey ? safe.search !== false : false,
      disabled: !hasKey,
    },
    {
      id: 'fetch',
      name: t('abilities.fetch'),
      badges: [{ text: t('abilities.tagBuiltin'), kind: 'bg' }],
      note: t('abilities.fetchNote'),
      enabled: safe.fetch !== false,
      disabled: false,
    },
    // 「允许访问本地网络」：默认关；读网页那关关着时这一行置灰
    {
      id: 'localNet',
      name: t('abilities.localNet'),
      badges: [{ text: t('abilities.tagBuiltin'), kind: 'bg' }],
      note: t('abilities.localNetNote'),
      enabled: safe.fetch !== false && safe.localNet === true,
      disabled: safe.fetch === false,
    },
  ]
}

// —————————————————————————————— 外部工具服务 ——————————————————————————————

// 测过的结果记在 mcp.json 的 mcpStatus 里；条目自己只留那几个字段，不把结果塞进条目
export function loadMcpStatus(file) {
  const status = readWhole(file).mcpStatus
  const safe = status && typeof status === 'object' && !Array.isArray(status) ? status : {}
  const out = {}
  for (const [id, one] of Object.entries(safe)) {
    if (!one || typeof one !== 'object') continue
    out[id] = {
      ok: one.ok === true,
      tools: Number.isFinite(one.tools) ? one.tools : 0,
      message: typeof one.message === 'string' ? one.message : '',
      at: Number.isFinite(one.at) ? one.at : 0,
    }
  }
  return out
}

// 记一条测过的结果，只动 mcpStatus 字段
export function saveMcpStatus(file, id, status) {
  const key = String(id ?? '')
  if (!key) return { ok: false }
  const raw = readWhole(file)
  raw.mcpStatus = {
    ...(raw.mcpStatus && typeof raw.mcpStatus === 'object' && !Array.isArray(raw.mcpStatus) ? raw.mcpStatus : {}),
    [key]: status,
  }
  writeWhole(file, raw)
  return { ok: true }
}

// 第二行字：未测试 / 已连接 N 个工具 / 连接失败：原因（设置里的行不用「· 」隔开）
export function mcpNote(entry, status) {
  if (!status || typeof status !== 'object') return t('abilities.mcpNotTested')
  if (status.ok !== true) return t('abilities.mcpFail', { reason: status.message || t('abilities.mcpFailReason') })
  return t('abilities.mcpOk', { count: status.tools })
}

// 服务列表每行：名字、「我加的」小标、第二行字、右边「改」和开关
export function mcpRows(entries, statusMap = {}) {
  const map = statusMap && typeof statusMap === 'object' ? statusMap : {}
  return (Array.isArray(entries) ? entries : []).filter(Boolean).map((entry) => ({
    id: String(entry.id ?? ''),
    name: String(entry.name ?? ''),
    badge: { text: t('abilities.tagMine'), kind: 'bg' },
    note: mcpNote(entry, map[entry.id]),
    enabled: entry.enabled !== false,
    buttons: [{ id: 'edit', label: t('common.edit') }],
  }))
}

// 服务开关：只改 enabled，别的字段不动
export function setMcpEnabled(file, id, on) {
  return updateMcp(file, String(id ?? ''), { enabled: on === true })
}

// 删一条：条目和钥匙串里的钥匙一起删，测过的结果也不留
export function removeMcpEntry(file, id, keyring) {
  const key = String(id ?? '')
  const back = removeMcp(file, key, keyring)
  if (back.ok) {
    const raw = readWhole(file)
    if (raw.mcpStatus && typeof raw.mcpStatus === 'object' && key in raw.mcpStatus) {
      delete raw.mcpStatus[key]
      writeWhole(file, raw)
    }
  }
  return back
}

// —————————————————————————————— 弹窗 ——————————————————————————————

// 每种放法默认的名字：请求头是 Authorization，网址参数是 key
export function defaultAuthName(kind) {
  return kind === 'query' ? 'key' : 'Authorization'
}

// 条目换成弹窗表单；hasSavedKey 由主进程查钥匙串告诉页面（只说是非，不给钥匙）。
// 网址型：放法总选中一个，没存过放法的默认「请求头」，名字预填对应的默认名。
// 本机程序型：程序完整路径、参数一行一个、钥匙放进哪个环境变量（envName）；
// 普通环境变量（不是钥匙的那些）原样带着走，页面上不改。
export function mcpForm(entry = null, options = {}) {
  const src = entry && typeof entry === 'object' ? entry : {}
  const auth = src.auth && typeof src.auth === 'object' ? src.auth : {}
  const kind = auth.kind === 'query' ? 'query' : 'header'
  const named = (auth.kind === 'header' || auth.kind === 'query') && String(auth.name ?? '').trim() !== ''
  const stdio = src.transport === 'stdio'
  return {
    id: typeof src.id === 'string' ? src.id : '',
    name: typeof src.name === 'string' ? src.name : '',
    transport: stdio ? 'stdio' : 'http',
    url: typeof src.url === 'string' ? src.url : '',
    authKind: kind,
    authName: named ? String(auth.name) : defaultAuthName(kind),
    command: stdio && typeof src.command === 'string' ? src.command : '',
    args: stdio && Array.isArray(src.args) ? src.args.filter((one) => typeof one === 'string').join('\n') : '',
    env: stdio && src.env && typeof src.env === 'object' && !Array.isArray(src.env) ? { ...src.env } : {},
    envName: stdio && auth.kind === 'env' ? String(auth.name ?? '') : '',
    enabled: src.enabled !== false,
    hasSavedKey: options.hasSavedKey === true,
  }
}

// 本机程序的参数：表单里一行一个，存盘时去掉空行
export function argsFromForm(text) {
  return String(text ?? '').split(/\r?\n/).map((one) => one.trim()).filter((one) => one !== '')
}

// 表单里的放法收成条目的 auth：网址型总有一个放法选中，本机程序型放进 envName 那个环境变量；
// 值空着又没有旧钥匙就当不用钥匙
export function authFromForm(form) {
  const src = form && typeof form === 'object' ? form : {}
  const secret = typeof src.secret === 'string' ? src.secret : ''
  if (secret === '' && src.hasSavedKey !== true) return { kind: 'none', name: '' }
  if (src.transport === 'stdio') return { kind: 'env', name: String(src.envName ?? '').trim() }
  const kind = src.authKind === 'query' ? 'query' : 'header'
  return { kind, name: String(src.authName ?? '').trim() }
}

// 弹窗表单换成存盘要的样子（id 由后台起，钥匙只走钥匙串）
export function entryInput(form) {
  const src = form && typeof form === 'object' ? form : {}
  const base = { name: String(src.name ?? '').trim(), auth: authFromForm(src), enabled: src.enabled !== false }
  if (src.transport === 'stdio') {
    return {
      ...base,
      transport: 'stdio',
      command: String(src.command ?? '').trim(),
      args: argsFromForm(src.args),
      env: src.env && typeof src.env === 'object' && !Array.isArray(src.env) ? src.env : {},
    }
  }
  return { ...base, transport: 'http', url: String(src.url ?? '').trim() }
}

// 表单的指纹：网址、放法或钥匙一改，之前测的就不算数了。放法那一段用收进条目的 kind，
// 跟页面里算的口径一致（值空着又没旧钥匙时都是 none）。
// 指纹只在页面里比一比，不进 IPC、不进日志；这里只放一个短哈希，不存钥匙本身。
function shortHash(text) {
  let h = 5381
  for (const ch of String(text)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0
  return h.toString(36)
}

export function formFingerprint(form) {
  const src = form && typeof form === 'object' ? form : {}
  const secret = typeof src.secret === 'string' ? src.secret : ''
  if (src.transport === 'stdio') {
    return [
      'stdio',
      String(src.command ?? '').trim(),
      argsFromForm(src.args).join('\n'),
      authFromForm(src).kind,
      String(src.envName ?? '').trim(),
      secret.length,
      shortHash(secret),
    ].join('|')
  }
  return [
    String(src.url ?? '').trim(),
    authFromForm(src).kind,
    String(src.authName ?? '').trim(),
    secret.length,
    shortHash(secret),
  ].join('|')
}

// 「存下」什么时候能点：测通过，而且测的就是现在这份表单
export function canSave(form, test) {
  if (!test || typeof test !== 'object' || test.ok !== true) return false
  return test.fingerprint === formFingerprint(form)
}

// 这一条有没有存过钥匙（只说是非，不把钥匙带出来）
export function hasSavedKey(keyring, id) {
  const key = String(id ?? '')
  if (!key || !keyring || typeof keyring.has !== 'function') return false
  try {
    return keyring.has(key) === true
  } catch {
    return false
  }
}

// 「测一下」：输入框里有钥匙用它；留空而且有旧钥匙就用旧的那把（先把钥匙落实了再算放法，
// 有钥匙放法就照选的来）。钥匙不进返回值、不进日志。
export async function probeForm(form, keyring) {
  const src = form && typeof form === 'object' ? form : {}
  let secret = typeof src.secret === 'string' ? src.secret : ''
  const id = String(src.id ?? '')
  if (!secret && id && hasSavedKey(keyring, id) && typeof keyring.read === 'function') {
    try {
      secret = keyring.read(id) ?? ''
    } catch {
      secret = ''
    }
  }
  const auth = authFromForm({ ...src, secret })
  if (src.transport === 'stdio') {
    return probeLocalMcp({ command: String(src.command ?? '').trim(), args: argsFromForm(src.args), env: src.env, auth, secret })
  }
  return probeMcp({ url: String(src.url ?? '').trim(), auth, secret })
}

// 「存下」：测通过的才存；存的时候把这次测的结果一起记进 mcpStatus。
// 新条目钥匙进钥匙串；改条目留空就沿用旧钥匙（表单里 hasSavedKey 说是非），
// 值空着又没有旧钥匙就存 auth none。
export function saveMcpForm(file, form, test, keyring) {
  const src = form && typeof form === 'object' ? form : {}
  if (!canSave(src, test)) return { ok: false, errors: [t('mcp.needTest')] }
  const input = entryInput(src)
  const secret = typeof src.secret === 'string' && src.secret !== '' ? src.secret : undefined
  let back
  try {
    back = src.id
      ? updateMcp(file, String(src.id), input, keyring, secret)
      : addMcp(file, { ...input, secret: typeof secret === 'string' ? secret : '' }, keyring)
  } catch {
    // 写盘失败：存不上只有这一句、这一个码（Si907）
    return { ok: false, errors: [SAVE_FAILED_LINE] }
  }
  if (!back.ok) return { ok: false, errors: back.errors?.length ? back.errors : [SAVE_FAILED_LINE], detail: back.detail || '' }
  const count = Array.isArray(test.tools) ? test.tools.length : Number.isFinite(test.tools) ? test.tools : 0
  saveMcpStatus(file, back.id, { ok: true, tools: count, message: String(test.message ?? ''), at: Date.now() })
  return { ok: true, id: back.id, errors: [] }
}

// 弹窗要的那份：表单和有没有旧钥匙
export function mcpDialogPayload(file, id, keyring) {
  const key = String(id ?? '')
  const entry = loadMcp(file).find((one) => one.id === key)
  if (key && !entry) return { ok: false, errors: [t('common.badConfig')] }
  return { ok: true, form: mcpForm(entry ?? null, { hasSavedKey: hasSavedKey(keyring, key) }) }
}

// —————————————————————————————— 整页 ——————————————————————————————

// 整页的数据：技能行、联网搜索两行、服务行和空状态那句话
export function abilitiesView(paths, options = {}) {
  const p = paths && typeof paths === 'object' ? paths : {}
  const stateFile = String(p.stateFile ?? '')
  const mcpFile = String(p.mcpFile ?? stateFile)
  const skills = listSkills({
    bundledDir: p.bundledDir,
    recommendedDir: p.recommendedDir,
    userDir: p.userDir,
    stateFile,
  })
  const entries = loadMcp(mcpFile)
  return {
    skills: skillRows(skills),
    tools: toolRows(loadTools(stateFile), {
      hasKey: options.hasKey === true,
      searches: monthSearches(options.records),
    }),
    hasKey: options.hasKey === true,
    mcp: mcpRows(entries, loadMcpStatus(mcpFile)),
    mcpEmpty: entries.length === 0,
    mcpEmptyText: MCP_EMPTY_TEXT,
  }
}
