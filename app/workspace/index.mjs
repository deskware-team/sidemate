import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { appRoot, appPaths, taskFolderName, taskLayout } from '../paths.mjs'

// 工作区和原件。每个任务在 %LOCALAPPDATA%\sidemate\tasks 下自己一个文件夹（名字是 14 位数字），
// dsh 只在那里干活，绝不把用户的文件夹当工作区。
// 原件只拷副本进来（拷进任务文件夹里的 received\），一个字不动，也不盯着它变没变。
// 干活的程序写不出工作区，靠的是 dsh 自己的沙箱（app/dsh/ask.patch.yml 定成只许写工作区）。
// 顺序：prepareTask → 驱动层起进程 → 收场（成品留在任务文件夹根目录）。用户收完再 clearWorkspace。
// 清目录逐个删。dsh 改过权限以后，一次删一整棵会报成功，其实还在。

// 图片（贴的截图、拖进来的图）也算材料：拷进工作区给能看图的模型用
export const MATERIAL_EXTENSIONS = Object.freeze(['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.md', '.txt', '.png', '.jpg', '.jpeg', '.webp'])
// 上限：一个文件 32 MiB，一次任务合计 128 MiB；超过的不拷。
export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_TOTAL_BYTES = 128 * 1024 * 1024

const EXTENSIONS = new Set(MATERIAL_EXTENSIONS)

// 用户拖进来 / 贴进来的文件副本放这个文件夹里（任务文件夹的 received\）
export const RECEIVED_NAME = 'received'
// Word / WPS 开着文档时的临时文件：~$ 开头、.~ 开头。收产出时也不认它们
const LOCKED_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function isTempName(name) {
  const text = String(name || '')
  return text.startsWith('~') || text.startsWith('.~')
}

// 任务文件夹的名字：年月日时分 + 两位随机数（14 位数字）。
// 撞了名就重摇那两位随机数：同一个任务不会跟别的一个撞文件夹。
function makeTaskDir(parent, now, random) {
  for (let n = 0; n < 100; n += 1) {
    const name = taskFolderName(now, random)
    const dir = join(parent, name)
    if (!existsSync(dir)) return dir
  }
  throw new Error('too many tasks in one minute')
}

export function isDeskWorkspace(dir, root = appRoot()) {
  const target = resolve(dir)
  const rel = relative(resolve(appPaths(root).tasks), target)
  return rel.length > 0 && rel !== '..' && !rel.includes('/') && !rel.includes('\\') && !isAbsolute(rel)
}

function isRealDir(path) {
  try {
    const st = lstatSync(path)
    return st.isDirectory() && !st.isSymbolicLink()
  } catch {
    return false
  }
}

function limitsOf(input) {
  return {
    maxFileBytes: input.maxFileBytes ?? MAX_FILE_BYTES,
    maxTotalBytes: input.maxTotalBytes ?? MAX_TOTAL_BYTES,
  }
}

function taskDir(root, now, random) {
  const parent = appPaths(root).tasks
  mkdirSync(parent, { recursive: true })
  return makeTaskDir(parent, now, random)
}

// 什么都没拖、拖了几个文件，都算 files；正好一个文件夹算 folder
function classify(paths) {
  if (paths.length === 1 && isRealDir(paths[0])) return 'folder'
  return 'files'
}

function sourceList(kind, paths) {
  if (kind === 'folder') {
    try {
      return readdirSync(paths[0]).sort((a, b) => a.localeCompare(b, 'zh')).map(name => join(paths[0], name))
    } catch {
      throw new Error('cannot read this folder')
    }
  }
  return paths
}

function judge(path, limits) {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return { take: 'skip', reason: 'not-found' }
  }
  // 符号链接和目录联接不拷。硬链接看起来像普通文件，拷走的是内容，链接关系不进工作区。
  if (st.isSymbolicLink()) return { take: 'skip', reason: 'link' }
  if (!st.isFile()) return { take: 'skip', reason: 'not-a-file' }
  const name = basename(path)
  if (name.toLowerCase() === '.env') return { take: 'skip', reason: 'env-file' }
  // Word / WPS 开着文档时的临时文件（~$开头、.~开头）：不拷
  if (name.startsWith('~') || name.startsWith('.~')) return { take: 'skip', reason: 'temp-file' }
  if (!EXTENSIONS.has(extname(name).toLowerCase())) return { take: 'skip', reason: 'wrong-type' }
  if (st.size > limits.maxFileBytes) return { take: 'skip', reason: 'too-big' }
  return { take: 'copy', size: st.size }
}

function uniqueName(dir, name) {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let n = 2; n < 10000; n += 1) {
    const candidate = `${stem}-${n}${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  throw new Error('too many files with the same name')
}

function copyIn(entries, workspace, limits, reportDirs) {
  const copied = []
  const skipped = []
  let used = 0
  for (const path of entries) {
    const decision = judge(path, limits)
    if (decision.take === 'skip') {
      if (reportDirs || decision.reason !== 'not-a-file') skipped.push({ path, reason: decision.reason })
      continue
    }
    if (used + decision.size > limits.maxTotalBytes) {
      skipped.push({ path, reason: 'too-big' })
      continue
    }
    const to = join(workspace, uniqueName(workspace, basename(path)))
    try {
      copyFileSync(path, to)
    } catch (error) {
      // 读不了（被 Word / WPS 锁着、没权限）：跳过这一份，记成 unreadable，别的照常拷
      if (!LOCKED_CODES.has(String(error?.code || ''))) throw error
      skipped.push({ path, reason: 'unreadable' })
      continue
    }
    used += decision.size
    copied.push({ from: path, to })
  }
  return { copied, skipped }
}

// 中途加材料（接着说时贴的图、贴的长文字）：拷进已经在用的工作区，
// 跟开工那一遍同一套规矩：wrong-type、too-big、link 都跟 prepareTask 一样处理。
export function copyMaterials({ workspace, paths } = {}) {
  const target = resolve(workspace ?? '')
  if (!target) throw new Error('no workspace yet')
  const list = (Array.isArray(paths) ? paths : []).filter((path) => typeof path === 'string' && path).map((path) => resolve(path))
  // 用户给的文件副本都放 received\：跟成品（根目录）分开，算产出时也不把它们当产出
  const received = taskLayout(target).received
  mkdirSync(received, { recursive: true })
  return copyIn(list, received, limitsOf({}), false)
}

// 桌伴自己查出来的：不能在原件所在的文件夹里干活。正常走不到这里，真走到了算没归上类的（Si901）
function originalsFolderError() {
  return new Error('cannot work in the folder of the originals')
}

export function prepareTask(input = {}) {
  const paths = (input.paths ?? []).map(path => resolve(path))
  const root = resolve(input.root ?? appRoot())
  const now = input.now ?? new Date()
  const kind = classify(paths)
  const sourceDir = kind === 'folder' ? paths[0] : undefined
  // 什么都没拖、只说了一句话也是一个任务：一样在 tasks\ 下建自己的文件夹（14 位数字）
  const workspace = taskDir(root, now, input.random)
  if (!isDeskWorkspace(workspace, root)) throw originalsFolderError()
  if (sourceDir && resolve(sourceDir) === resolve(workspace)) throw originalsFolderError()
  mkdirSync(workspace, { recursive: true })
  const reportDirs = kind === 'files'
  // 用户拖进来的文件：副本拷进任务文件夹里的 received\
  const received = taskLayout(workspace).received
  mkdirSync(received, { recursive: true })
  const brought = copyIn(sourceList(kind, paths), received, limitsOf(input), reportDirs)
  return {
    kind,
    workspace,
    sourceDir,
    ...brought,
    snapshot: snapshotWorkspace(workspace),
  }
}

// 走一遍目录里的文件：点开头的、锁文件、快捷方式都不算。
// onFile 拿到绝对路径和相对 root 的路径。
function eachFile(dir, root, onFile) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    // 点开头的是干活时留下的内部文件，不算出产。用户给的副本（received\）也不算：那是原件的拷贝，不是产出。
    // ~$ 开头、.~ 开头的锁文件是 Word 开着文档时留下的，不算出产。
    if (name.startsWith('.')) continue
    if (name === RECEIVED_NAME) continue
    if (isTempName(name)) continue
    const path = join(dir, name)
    let st
    try {
      st = lstatSync(path)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) eachFile(path, root, onFile)
    else if (st.isFile()) onFile(path, relative(root, path))
  }
}

function walkFiles(dir, root, out) {
  eachFile(dir, root, (_path, rel) => out.push(rel))
}

// 目录里的文件（绝对路径）：干活时看哪些是新出的，就用这一份。
export function listFiles(root) {
  const out = []
  eachFile(root, root, (path) => out.push(path))
  return out
}

export function snapshotWorkspace(workspace) {
  const out = []
  walkFiles(workspace, workspace, out)
  return out.sort((a, b) => a.localeCompare(b, 'zh'))
}

function removeTree(path) {
  const st = lstatSync(path)
  if (st.isSymbolicLink()) {
    try {
      unlinkSync(path)
    } catch {
      rmdirSync(path)
    }
    return
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) removeTree(join(path, name))
    rmdirSync(path)
    return
  }
  unlinkSync(path)
}

// 只清里面的东西，任务文件夹本身留着（空了也留）：历史里那条对话还指着它，从历史打开还能接着聊；
// 名字也不会空出来给同一天开头一样的另一个任务用。
// 成品留在任务文件夹根目录（那是交给用户的东西，不清）；用户给的副本（received\）和别的子目录清掉。
export function clearWorkspace(dir, root = appRoot()) {
  const target = resolve(dir)
  const base = resolve(root)
  if (!isDeskWorkspace(target, base)) throw new Error('can only clear desk workspaces')
  if (!existsSync(target)) return
  const layout = taskLayout(target)
  for (const name of readdirSync(target)) {
    // 过程目录留着：对话记录（.sidemate\conversation.json）在里头，用户删掉任务文件夹那条历史才没。
    // 里头别的过程文件清掉。
    if (name === '.sidemate') {
      clearProcessDir(layout.process, layout.conversation)
      continue
    }
    const path = join(target, name)
    // 根目录下的文件是成品：留着
    let st = null
    try {
      st = lstatSync(path)
    } catch {
      continue
    }
    if (st.isFile() && !st.isSymbolicLink()) continue
    removeTree(path)
  }
}

// 过程目录：对话记录留着，别的过程文件删掉
function clearProcessDir(dir, keep) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    if (resolve(path) === resolve(keep)) continue
    removeTree(path)
  }
}
