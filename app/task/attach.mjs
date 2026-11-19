// 中途添进来的文件：接着说时新挂上的、干活中挂上跟插的那句一起发的，
// 拷进已经在用的工作区，跟开工那一遍同一套规矩（在 app/workspace/index.mjs）。
// 交给模型的是资源链接（文件在工作区里的那份拷贝），不是名字。
// 只给主进程用（要拷文件）。

import { basename, relative, resolve } from 'node:path'
import { chipsOf } from './chips.mjs'

// 拷进去：返回这次真拷进去的那几份 { from, to }；没这个能力（测试的假壳）就不动。
// 已经拷过的（同一个原件）不再拷。
function addFiles(deps, task, paths, log = () => {}) {
  const copy = deps.copyMaterials
  if (typeof copy !== 'function') return []
  const known = new Set((task.prepared.copied || []).map((one) => resolve(one.from)))
  const fresh = (Array.isArray(paths) ? paths : []).filter(Boolean).filter((path) => !known.has(resolve(path)))
  if (!fresh.length) return []
  let more = null
  try {
    more = copy({ workspace: task.workspace, paths: fresh })
  } catch (error) {
    log('copy-more-failed', { error: error?.message || '' })
    return []
  }
  const copied = more?.copied || []
  task.prepared = {
    ...task.prepared,
    copied: [...(task.prepared.copied || []), ...copied],
    skipped: [...(task.prepared.skipped || []), ...(more?.skipped || [])],
  }
  return copied
}

// 工作区里的相对路径：用户给的文件的副本在 received\ 里，给相对路径模型才找得到
function relOf(workspace, path) {
  if (!workspace || !path) return ''
  const rel = relative(workspace, path)
  return rel && !rel.startsWith('..') ? rel : ''
}

// 提示里点的文件名换成工作区里的相对路径（cite 那边的提示只给文件名，副本在 received\ 里）
export function markReceivedFiles(prompt, copied, workspace) {
  let text = String(prompt ?? '')
  for (const one of Array.isArray(copied) ? copied : []) {
    if (!one || typeof one.to !== 'string') continue
    const name = basename(one.to)
    const rel = relOf(workspace, one.to)
    if (!name || !rel || rel === name) continue
    text = text.split(`《${name}》`).join(`《${rel}》`)
  }
  return text
}

// 这几份拷贝交给模型的样子：路径（绝对）、名字、任务文件夹里的相对路径
export function copiesOf(task, copied) {
  return (Array.isArray(copied) ? copied : [])
    .filter((one) => one && typeof one.to === 'string' && one.to)
    .map((one) => ({ path: one.to, name: basename(one.to), rel: relOf(task?.workspace, one.to) }))
}

// 干活中挂上的文件跟插进去的那句一起发：先拷进工作区，插进去的那句带上这几份的链接。
// 返回气泡里的小块和这几份文件；没有要带的返回 null。
export function steerFiles(deps, task, files, log) {
  const paths = (Array.isArray(files) ? files : []).map((one) => one?.path).filter(Boolean)
  if (!paths.length || !task?.workspace) return null
  const copied = addFiles(deps, task, paths, log)
  const chips = chipsOf({ paths, copied: task.prepared.copied || [] })
  return { chips, files: copiesOf(task, copied) }
}

// 接着说时新挂上的文件（贴的、干活中拖进来的）：拷进这个工作区，这几份交给模型。
// 没有新拷进去的返回空数组
export function freshFiles(deps, task, paths, log) {
  const copied = addFiles(deps, task, paths, log)
  return copiesOf(task, copied)
}
