import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { t } from '../copy/copy.mjs'
import { basename, dirname, join, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// 技能文件夹名的规矩：只允许小写字母、数字和短横线，长度 1 到 64。
export const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/

// dsh 认的技能名：只允许小写字母、数字和短横线，段和段之间一个短横线
//（不能开头、结尾带短横线，也不能连着两个）。
// 名字不合这条的技能，dsh 那头整条当不存在：模型看不见，界面却还显示「导入成功」。
export const DSH_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// 一个技能文件夹最多 200KB。
export const MAX_SKILL_BYTES = 200 * 1024

// 一个技能文件夹最多 50 个文件。
export const MAX_SKILL_FILES = 50

// 解压后的总大小上限 1MB，防压缩炸弹。
export const MAX_ZIP_BYTES = 1024 * 1024

// 一个压缩包里最多 500 个条目。
export const MAX_ZIP_ENTRIES = 500

// 不许带进来的可执行文件后缀。
export const BANNED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.ps1', '.dll', '.vbs', '.scr', '.msi', '.com', '.jar']

// 装好的技能里记下从哪一版装的那份说明（不算进技能本身的文件）。
export const PROVENANCE_FILE_NAME = 'origin.json'

// 开关状态文件里每个技能的键：来历 + ':' + 名字。
function stateKey(source, id) {
  return `${source}:${id}`
}

// 读技能文件夹里的 SKILL.md，拆出 frontmatter 里的 name 和 description。
// 没有 frontmatter 就用文件夹名当名字、正文第一行当说明。
// frontName 是 SKILL.md 里原样写的名字（哪怕不合规），nameOk 说它合不合 dsh 的规矩。
export function readSkill(dir) {
  const id = basename(dir)
  let text = ''
  try {
    text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return { id, name: id, description: '', frontName: '', nameOk: false }
  }
  const front = parseFrontmatter(text)
  const body = (front ? text.slice(front.end) : text).trim()
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? ''
  const name = front && front.name !== '' ? front.name : id
  const description = front && front.description !== '' ? front.description : firstLine
  const frontName = front ? front.name : ''
  return { id, name, description, frontName, nameOk: DSH_SKILL_NAME_RE.test(frontName) }
}

// 拆 frontmatter：文件必须以 --- 开头，后面再有一个 --- 结束。
// 只取 name 和 description 两个字段，别的字段不认。
// 块写法（description: | 后面缩进的几行）也认：值就在那几行里。
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return null
  const fields = {}
  for (let i = 1; i < end; i += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i])
    if (!match) continue
    const key = match[1].toLowerCase()
    if (key !== 'name' && key !== 'description') continue
    let value = match[2].trim()
    if (/^[|>][-+]?$/.test(value)) {
      // 块写法：值在后面缩进的几行里，一行一行收起来
      const parts = []
      let j = i + 1
      while (j < end && /^[ \t]+\S/.test(lines[j])) {
        parts.push(lines[j].trim())
        j += 1
      }
      value = parts.join(' ')
      i = j - 1
    }
    fields[key] = unquote(value)
  }
  const endIndex = lines.slice(0, end + 1).join('\n').length
  return { name: fields.name ?? '', description: fields.description ?? '', end: endIndex }
}

// SKILL.md frontmatter 里的 name 字段，没有就返回空串。
function frontmatterNameOf(path) {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return ''
  }
  const front = parseFrontmatter(text)
  return front ? front.name : ''
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const body = value.slice(1, -1)
      // 双引号里的转义要还原：写进去的时候我们会把引号和反斜杠转义过
      return first === '"' ? body.replace(/\\(["\\])/g, '$1') : body
    }
  }
  return value
}

// 读开关状态文件。文件缺了或坏了都当空状态。
// 文件里别的字段（比如 mcp 那部分）原样留着，不能被开关的写入抹掉。
function loadState(stateFile) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { skills: {} }
    if (!parsed.skills || typeof parsed.skills !== 'object') parsed.skills = {}
    return parsed
  } catch {
    return { skills: {} }
  }
}

// 写开关状态文件：先写临时文件再改名顶上。
function saveState(stateFile, state) {
  mkdirSync(dirname(stateFile), { recursive: true })
  const tmp = `${stateFile}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, stateFile)
}

// 一个目录里有哪些技能：只看直接子文件夹，且里面得有 SKILL.md。
// 点开头的文件夹（像 .停用）不当技能。
function skillDirsIn(root) {
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'SKILL.md'))) continue
    dirs.push(dir)
  }
  return dirs.sort()
}

// 列出三种来历的技能，带开关状态和能不能删。
// 没记过的一律默认开：能力默认全开，用户自己关过的照旧关着。
export function listSkills(options = {}) {
  const { bundledDir, recommendedDir, userDir, stateFile } = options
  const state = stateFile ? loadState(stateFile) : { skills: {} }
  const roots = [
    { source: 'bundled', root: bundledDir },
    { source: 'recommended', root: recommendedDir },
    { source: 'mine', root: userDir },
  ]
  const list = []
  for (const { source, root } of roots) {
    if (!root) continue
    for (const dir of skillDirsIn(root)) {
      const skill = readSkill(dir)
      const key = stateKey(source, skill.id)
      const recorded = state.skills[key]
      // 记过的照记的走；没记过的一律默认开（能力默认全开）。
      const enabled = typeof recorded === 'boolean' ? recorded : true
      // 记过显示名的（导入时名字被改过的）：界面上显示用户自己起的那个名
      const shown = state.names && typeof state.names === 'object' ? state.names[key] : ''
      list.push({
        id: skill.id,
        name: typeof shown === 'string' && shown !== '' ? shown : skill.name,
        description: skill.description,
        source,
        enabled,
        removable: source === 'mine',
        // 这个技能文件夹的完整路径。告诉 dsh 挂哪个目录时要用。
        dir,
      })
    }
  }
  return list
}

// 记住技能在界面上叫什么：导入时把 SKILL.md 里的名字改过的，把原来的名字记下来，
// 界面上还是显示用户自己起的那个名。
export function recordSkillName(stateFile, source, id, name) {
  if (typeof stateFile !== 'string' || stateFile === '') return
  const text = String(name ?? '').trim()
  if (text === '') return
  const state = loadState(stateFile)
  if (!state.names || typeof state.names !== 'object') state.names = {}
  state.names[stateKey(source, id)] = text
  saveState(stateFile, state)
}

// 记住一个技能的开关状态。
export function setEnabled(stateFile, source, id, on) {
  const state = loadState(stateFile)
  state.skills[stateKey(source, id)] = on === true
  saveState(stateFile, state)
  return state
}

// 导入没成：界面上只说是哪几类（problems，去重，第一类也放 message），
// 哪个文件、哪条规矩写成英文短句放 detail，调用方写进日志
function refused(id, keys, detail) {
  const problems = [...new Set(keys.map((key) => t(key)))]
  return { ok: false, id, message: problems[0], problems, detail }
}

// 查一个技能文件夹合不合格：返回问题清单（几类）、细节、文件数和总大小。
// options.id 用来检查名字；不给就用文件夹名。
// options.ignore 是不算进技能文件的文件名（比如「origin.json」），可以是文件名，也可以是相对路径。
export function checkSkill(dir, options = {}) {
  const keys = []
  const details = []
  const bad = (key, detail) => { keys.push(key); details.push(detail) }
  let files = 0
  let bytes = 0
  const id = options.id ?? basename(dir)
  const ignore = new Set((options.ignore ?? []).map((name) => String(name).split('\\').join('/')))
  if (!SKILL_NAME_RE.test(id)) bad('skills.invalid', `bad name: ${id}`)
  if (!existsSync(join(dir, 'SKILL.md'))) bad('skills.invalid', 'missing SKILL.md')
  walkSkillDir(dir, (name, path, isLink, isDir, depth, rel) => {
    if (!isDir && isIgnored(ignore, name, rel)) return
    if (!isDir) files += 1
    if (isLink) {
      bad('skills.unsupported', `symlink: ${rel}`)
      return
    }
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      size = 0
    }
    bytes += size
    if (BANNED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
      bad('skills.unsupported', `executable: ${rel}`)
    }
    // 技能目录要直接当 dsh 的扫描根挂进去，而 dsh 只看根的下一层。
    // 顶层再放一个带技能信息的 md，dsh 会当成第二个技能；
    // 下一层子目录里再放一份 SKILL.md，也会被当成一个技能。两种都不许。
    if (!isDir && depth === 0 && name.toLowerCase().endsWith('.md') && name.toLowerCase() !== 'skill.md') {
      if (hasSkillInfo(path)) bad('skills.invalid', `second skill md: ${name}`)
    }
    if (isDir && depth === 0 && existsSync(join(path, 'SKILL.md'))) {
      bad('skills.invalid', `nested SKILL.md: ${name}`)
    }
  })
  if (bytes > MAX_SKILL_BYTES) bad('skills.tooBig', `${bytes} bytes > ${MAX_SKILL_BYTES}`)
  if (files > MAX_SKILL_FILES) bad('skills.tooBig', `${files} files > ${MAX_SKILL_FILES}`)
  return { ok: keys.length === 0, problems: [...new Set(keys.map((key) => t(key)))], details, files, bytes }
}

// 文件名在忽略名单里就不算：文件名对上，或者相对路径对上，都算。
function isIgnored(ignore, name, rel) {
  if (ignore.size === 0) return false
  if (ignore.has(name)) return true
  return rel !== undefined && ignore.has(rel)
}

// 这个 md 文件里有没有技能信息（frontmatter 的 name 和 description 都在）。
function hasSkillInfo(path) {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  const front = parseFrontmatter(text)
  return front !== null && front.name !== '' && front.description !== ''
}

// 走一遍技能文件夹：文件算一个，符号链接单独记下来，不跟着钻进去。
// depth 是相对技能文件夹的层数，顶层是 0。
function walkSkillDir(dir, visit, depth = 0, rel = '') {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    const here = rel === '' ? entry.name : `${rel}/${entry.name}`
    let stat = null
    try {
      stat = lstatSync(path)
    } catch {
      continue
    }
    if (stat.isSymbolicLink()) {
      visit(entry.name, path, true, false, depth, here)
      continue
    }
    if (stat.isDirectory()) {
      visit(entry.name, path, false, true, depth, here)
      walkSkillDir(path, visit, depth + 1, here)
      continue
    }
    if (stat.isFile()) visit(entry.name, path, false, false, depth, here)
  }
}

// 从文件夹或 .zip 导入技能到 userDir。
// 先查合格，再拷进去；已经有同名就拒。
// 拷进去以后把 SKILL.md 改到 dsh 认的写法：名字用技能 id、说明不能空。
// 原来的名字（比如中文）当显示名记下来：界面上还是它，模型那边也认得。
export function importSkill(from, userDir, options = {}) {
  const source = resolve(from)
  if (!existsSync(source)) return refused('', ['skills.notFound'], `not found: ${source}`)
  let tempDir = ''
  let skillDir = source
  let id = basename(source)
  try {
    if (statSync(source).isFile()) {
      if (!source.toLowerCase().endsWith('.zip')) return refused('', ['skills.unsupported'], `not a folder or .zip: ${basename(source)}`)
      const extracted = extractZip(source)
      if (!extracted.ok) return refused(extracted.id ?? '', [extracted.key], `zip: ${extracted.detail}`)
      tempDir = extracted.dir
      skillDir = extracted.skillDir
      id = extracted.id
    }
    // 技能 id：文件夹名能用就用它；不能用（中文、大写、下划线）就收拾一个出来
    const wanted = resolveSkillId(skillDir, id, userDir)
    if (!wanted.ok) return refused(id, ['skills.invalid'], `no usable skill name: ${id}`)
    id = wanted.id
    const check = checkSkill(skillDir, { id })
    if (!check.ok) return { ok: false, id, message: check.problems[0], problems: check.problems, detail: check.details.join('; ') }
    const target = join(userDir, id)
    if (existsSync(target)) return refused(id, ['skills.exists'], `exists: ${id}`)
    mkdirSync(userDir, { recursive: true })
    try {
      copyTree(skillDir, target, options.copyFile)
    } catch (err) {
      // 拷到一半失败了：把已经拷进去的半截目标删掉，不能留一个缺文件的技能。
      removeTree(target)
      const detail = err instanceof CopyError ? err.file : (err && err.message ? err.message : String(err))
      return refused(id, ['skills.readFailed'], `copy failed: ${detail}`)
    }
    // 拷进去了：把 SKILL.md 改到 dsh 认的写法。改不好的就地撤掉，别留一个模型看不见的技能。
    const fix = fixSkillFile(target, id)
    if (!fix.ok) {
      removeTree(target)
      return { ok: false, id, message: fix.message, problems: fix.problems, detail: fix.detail }
    }
    if (fix.display && fix.display !== fix.name) {
      recordSkillName(options.stateFile, 'mine', id, fix.display)
    }
    return { ok: true, id, message: t('skills.importOk', { id }), problems: [], display: fix.display, name: fix.name }
  } finally {
    if (tempDir) removeTree(tempDir)
  }
}

// 技能 id 怎么定：文件夹名合 dsh 的规矩就用它；不合（中文、大写、下划线、连着两个短横线）
// 就收拾一个出来；收拾不出来就用 SKILL.md 里的名字；还不行就起一个 import 开头的名字，
// 原来的名字当显示名——不能因为名字就把用户挡在门外。
function resolveSkillId(skillDir, rawId, userDir) {
  const folder = String(rawId ?? '')
  // 正常的：撞名的错在后面报（「已经有一个叫 X 的技能了」）
  if (DSH_SKILL_NAME_RE.test(folder)) return { ok: true, id: folder }
  const fromFolder = skillIdOf(folder)
  if (fromFolder !== '') return { ok: true, id: fromFolder }
  const fromFront = skillIdOf(frontmatterNameOf(join(skillDir, 'SKILL.md')))
  if (fromFront !== '') return { ok: true, id: fromFront }
  for (let n = 1; n < 100; n += 1) {
    const one = n === 1 ? 'imported-skill' : `imported-skill-${n}`
    if (!userDir || !existsSync(join(userDir, one))) return { ok: true, id: one }
  }
  return { ok: false }
}

// 把任意名字收拾成 dsh 认的技能名：中文和符号都换成短横线，连着的短横线压成一个。
// 收拾不出来（全是中文之类）就回空串。
export function skillIdOf(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// 写进 frontmatter 的值：加引号，里面的引号和反斜杠转义，YAML 才认。
function yamlValue(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// 改 frontmatter 里的两个字段，别的字段（whenToUse 等）原样留着。
// 没有 frontmatter 就回 null，交给调用方补一段出来。
export function rewriteFrontmatter(text, fields = {}) {
  const lines = String(text ?? '').split(/\r?\n/)
  if (lines[0].trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return null
  const out = []
  let hasName = false
  let hasDesc = false
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    const key = match ? match[1].toLowerCase() : ''
    if (key === 'name') {
      out.push(`name: ${String(fields.name ?? '')}`)
      hasName = true
      // 这个字段后面缩进的几行是它的续行，一并丢掉
      while (i + 1 < end && /^[ \t]+\S/.test(lines[i + 1])) i += 1
      continue
    }
    if (key === 'description') {
      out.push(`description: ${yamlValue(fields.description ?? '')}`)
      hasDesc = true
      while (i + 1 < end && /^[ \t]+\S/.test(lines[i + 1])) i += 1
      continue
    }
    out.push(line)
  }
  if (!hasName) out.push(`name: ${String(fields.name ?? '')}`)
  if (!hasDesc) out.push(`description: ${yamlValue(fields.description ?? '')}`)
  return [...lines.slice(0, 1), ...out, ...lines.slice(end)].join('\n')
}

// 把 SKILL.md 改成 dsh 认的写法：frontmatter 的名字要用技能 id，说明不能空。
// 原来的名字（比如中文）写进说明里，模型和用户都还认得它。
// 改不好的说清楚哪里不对，调用方照它把这个技能撤掉。
export function fixSkillFile(dir, id) {
  const file = join(dir, 'SKILL.md')
  const skillId = String(id ?? '')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, changed: false, name: skillId, display: skillId, message: t('skills.invalid'), problems: [t('skills.invalid')], detail: 'missing SKILL.md' }
  }
  const front = parseFrontmatter(text)
  const rawName = front ? front.name : ''
  const rawDesc = front ? front.description : ''
  // 都合规：一个字都不动
  if (front && DSH_SKILL_NAME_RE.test(rawName) && rawDesc !== '') {
    return { ok: true, changed: false, name: rawName, display: rawName, message: '', problems: [] }
  }
  const body = (front ? text.slice(front.end) : text).trim()
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? ''
  // 名字不合 dsh 的规矩就用技能 id 顶上
  const name = DSH_SKILL_NAME_RE.test(rawName) ? rawName : skillId
  const display = rawName !== '' ? rawName : name
  let description = rawDesc
  if (description === '') description = firstLine !== '' ? firstLine : t('skills.descriptionFallback', { display })
  // 原来的名字留在说明里：模型按说明找得到，用户也认得出
  if (display !== name && !description.includes(display)) description = `${display}：${description}`
  let out = rewriteFrontmatter(text, { name, description })
  if (out === null) {
    // 连 frontmatter 都没有：补一段出来，不然 dsh 当这个技能不存在
    out = `---\nname: ${name}\ndescription: ${yamlValue(description)}\n---\n\n${body}\n`
  }
  if (out !== text) {
    try {
      writeFileSync(file, out, 'utf8')
    } catch (error) {
      return {
        ok: false,
        changed: false,
        name,
        display,
        message: t('skills.readFailed'),
        problems: [t('skills.readFailed')],
        detail: `SKILL.md not writable: ${(error && error.message) || error}`,
      }
    }
  }
  return { ok: true, changed: out !== text, name, display, message: '', problems: [] }
}

// 拷文件失败时抛这个，err.file 是出问题的那个文件（或文件夹）的名字。
class CopyError extends Error {
  constructor(file) {
    super(`copy failed: ${file}`)
    this.name = 'CopyError'
    this.file = file
  }
}

// 把一个文件夹整个拷过去。
// 自己一层层拷，不用 fs.cpSync：系统 Node 24.13 上 cpSync 往中文路径拷会直接崩（0xC0000409），
// Electron 自带的 Node 没事，但测试跑在系统 Node 上，所以这里不碰 cpSync。
// 任何一个文件拷不进去就算失败，不留半截技能。
function copyTree(from, to, copyFile = copyFileSync) {
  let entries = []
  try {
    entries = readdirSync(from, { withFileTypes: true })
  } catch {
    throw new CopyError(basename(from))
  }
  mkdirSync(to, { recursive: true })
  for (const entry of entries) {
    const src = join(from, entry.name)
    const dest = join(to, entry.name)
    if (entry.isDirectory()) {
      copyTree(src, dest, copyFile)
      continue
    }
    if (entry.isSymbolicLink()) continue
    try {
      copyFile(src, dest)
    } catch {
      throw new CopyError(entry.name)
    }
  }
}

// 删掉一个文件夹和里面的东西。
// 自己一层层删，不用 fs.rmSync 的递归：系统 Node 24.13 上 rmSync 递归会静默删不掉，
// Electron 自带的 Node 没事，但测试跑在系统 Node 上，所以这里不碰 rmSync。
// 删不干净就返回 false，调用方据此告诉用户「没删干净」，不能当成删好了。
export function removeTree(dir) {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  let ok = true
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!removeTree(path)) ok = false
      continue
    }
    try {
      unlinkSync(path)
    } catch {
      // 删不掉的记下来，目录就留着，最后返回 false。
      ok = false
    }
  }
  try {
    rmdirSync(dir)
  } catch {
    return false
  }
  return ok && !existsSync(dir)
}

// 删一个技能：只能删 userDir 里的。名字不对、不在技能文件夹里、找不到，都说「技能不存在」。
export function removeSkill(userDir, id) {
  if (typeof id !== 'string' || !SKILL_NAME_RE.test(id)) return refused('', ['skills.noSuchSkill'], `bad name: ${id}`)
  const root = resolve(userDir)
  const target = resolve(join(root, id))
  if (dirname(target) !== root) return refused(id, ['skills.noSuchSkill'], `outside skill folder: ${id}`)
  if (!existsSync(target)) return refused(id, ['skills.noSuchSkill'], `not found: ${id}`)
  // 删不干净（文件正被占着之类）就如实说，不能报「已删除」。
  if (!removeTree(target) || existsSync(target)) return refused(id, ['skills.notRemoved'], `files in use: ${id}`)
  return { ok: true, message: t('skills.removed', { id }), problems: [] }
}

// 告诉 dsh 哪些技能开着：只把开着的技能目录挂进去。
// dsh 每个扫描根只看下一层，挂哪个技能目录就露出哪个技能；没挂的 dsh 根本看不见，
// 所以关技能不用改用户的技能文件。
export function skillsPatchYaml(list) {
  const dirs = []
  for (const skill of Array.isArray(list) ? list : []) {
    if (!skill || skill.enabled !== true) continue
    const dir = typeof skill.dir === 'string' ? skill.dir : ''
    if (dir === '') continue
    if (!dirs.includes(dir)) dirs.push(dir)
  }
  const lines = [
    '# 只挂开着的技能目录：dsh 每个扫描根只看下一层，挂哪个技能目录就露出哪个技能。',
    '# 关掉的技能不挂，dsh 就看不见它，技能文件本身不动。',
    '- id: skill-filesystem',
    '  config:',
    '    agentsHome: !!js "process.env.DSH_AGENTS_HOME"',
  ]
  if (dirs.length === 0) {
    lines.push('    customSkillDirs: []')
    return `${lines.join('\n')}\n`
  }
  lines.push('    customSkillDirs:')
  // 路径里的反斜杠要转义，字符串值一律用 JSON.stringify 写。
  for (const dir of dirs) lines.push(`      - ${JSON.stringify(dir)}`)
  return `${lines.join('\n')}\n`
}

// 解 .zip：自己读中央目录，只认 stored 和 deflate。
// 条目名里有 .. 或者绝对路径的直接拒，解压后总大小超过 1MB 也拒。
// 没解成回 { ok: false, key, detail }：key 是哪一类（skills.tooBig 这种），detail 是英文细节（进日志）。
function extractZip(file) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch {
    return { ok: false, key: 'skills.readFailed', detail: 'unreadable' }
  }
  const entries = readZipEntries(buffer)
  if (!entries.ok) return entries
  const tempBase = process.env.BOXBOX_TMP_DIR || tmpdir()
  mkdirSync(tempBase, { recursive: true })
  const dir = mkdtempSync(join(tempBase, 'sidemate-skill-'))
  const topLevel = new Set()
  for (const entry of entries.list) {
    if (entry.isDirectory) {
      mkdirSync(join(dir, entry.name), { recursive: true })
      continue
    }
    const target = join(dir, entry.name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.data)
    topLevel.add(entry.name.split('/')[0])
  }
  // 压缩包里只有一层顶层文件夹就取那一层，id 用那层文件夹的名字。
  const only = [...topLevel]
  if (only.length === 1) {
    const candidate = join(dir, only[0])
    try {
      if (statSync(candidate).isDirectory()) {
        return { ok: true, dir, skillDir: candidate, id: basename(candidate) }
      }
    } catch {
      // 顶层不是文件夹就按平铺算。
    }
  }
  // 平铺的压缩包没有文件夹名，用 SKILL.md 里的 name 当名字。
  // 名字不合 dsh 的规矩不在这儿拒：导入那一步会收拾好（合规则用，不合规则拿它当显示名）。
  const flat = readSkill(dir)
  const frontName = frontmatterNameOf(join(dir, 'SKILL.md'))
  if (!frontName) return { ok: false, id: '', key: 'skills.invalid', detail: 'flat zip without a skill name' }
  return { ok: true, dir, skillDir: dir, id: flat.name, flat: true }
}

// 读 zip 的中央目录，把每个条目的内容解出来。没解成跟 extractZip 一样回 { ok: false, key, detail }。
function readZipEntries(buffer) {
  const no = (key, detail) => ({ ok: false, key, detail })
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) return no('skills.readFailed', 'no central directory')
  const count = buffer.readUInt16LE(eocd + 10)
  if (count > MAX_ZIP_ENTRIES) return no('skills.tooBig', `${count} entries > ${MAX_ZIP_ENTRIES}`)
  let offset = buffer.readUInt32LE(eocd + 16)
  const list = []
  // 解出来的总大小上限 1MB，解一个条目就记一次，超了立刻拒。
  let total = 0
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return no('skills.readFailed', 'broken central directory')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt32LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const rawName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    const name = rawName.replace(/\\/g, '/')
    if (name === '' || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      return no('skills.invalid', `unsafe path: ${rawName}`)
    }
    if (method !== 0 && method !== 8) return no('skills.unsupported', `compression method ${method}: ${rawName}`)
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return no('skills.readFailed', `broken entry: ${rawName}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    // 剩下的额度就是这一条最多能解出多少字节。
    const remaining = MAX_ZIP_BYTES - total
    let data
    const tooBig = () => no('skills.tooBig', `unpacked size > ${MAX_ZIP_BYTES} bytes`)
    if (method === 0) {
      if (raw.length > remaining) return tooBig()
      data = Buffer.from(raw)
    } else {
      try {
        // 限着输出解压，超过额度会抛 RangeError，不用等解完才发现太大。
        data = inflateRawSync(raw, { maxOutputLength: remaining + 1 })
      } catch (err) {
        return err instanceof RangeError ? tooBig() : no('skills.readFailed', `inflate failed: ${rawName}`)
      }
    }
    total += data.length
    if (total > MAX_ZIP_BYTES) return tooBig()
    list.push({ name, data, isDirectory: name.endsWith('/') })
  }
  return { ok: true, list }
}

// 从文件尾上找中央目录结束标记。
function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 22 - 65535)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}
