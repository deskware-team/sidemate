// 收拾 dsh 的临时目录（程序数据目录下的 temp\，dshLaunch 把它设成 dsh 的 TEMP）。
// 桌伴每轮干完用 taskkill /F 收 dsh（./proc.mjs 的 killTree），dsh 退出时收临时目录的那段根本跑不到，
// 每轮都留几个下来；重试播报 retry-<任务>.log 也是一个任务留一个。随包 node 换版本也管不了这个。
// 桌伴起来时收拾一次（./index.mjs 的 startTempSweep），收拾完之前要起的 dsh 先等着（./index.mjs 的 runTask）。
//
// 三条规矩，免得删到还在用的：
// 1. 只删每轮 dsh 自己建、被掐掉以后留下的那几种（见 LEFTOVER），共用的（dsh-acl-locks 这种）一律不碰；
// 2. 新旧看整个条目里最新的那个修改时间：目录自己的修改时间只跟着下一层增删变，里面深处的文件在写它不知道。
//    走不完（太深、太多）就当它还新，留着；
// 3. 放了一天以上才删：上一个桌伴没收走还在跑的 dsh 正用着的不碰。删不掉的留着，下次起来再说。

import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const STALE_MS = 24 * 60 * 60 * 1000
const WALK_DEPTH = 6
const WALK_ENTRIES = 500

// 每轮 dsh 被掐掉后留下的几种：名字后面 6 个字是 mkdtemp 随机出来的
const LEFTOVER = [
  /^dsh-subprocess-[A-Za-z0-9]{6}$/, // 子进程输出溢出（dsh-subprocess-local）
  /^dsh-spill-[A-Za-z0-9]{6}$/, // 工具输出溢出（dsh-spill-local）
  /^dsh-acl-skill-[A-Za-z0-9]{6}$/, // 技能暂存（dsh-sandbox-windows-acl）
  // 沙箱给模型脚本的私有 TEMP（dsh-sandbox-local）。随机的 6 个字里总有大写或数字才认：
  // 全是小写字母的可能是 dsh 哪天起的固定名字，不碰（真是随机出来的，留到下次也没事）
  /^dsh-(?=[a-z]*[A-Z0-9])[A-Za-z0-9]{6}$/,
  /^retry-[\w.-]+\.log$/, // 桌伴自己的重试播报（./index.mjs）
]

export function isLeftover(name) {
  return LEFTOVER.some((pattern) => pattern.test(name))
}

// 整个条目里最新的修改时间（不跟进链接）；走不完返回 Infinity，当它还新
export async function newestMtime(path, { depth = WALK_DEPTH, entries = WALK_ENTRIES } = {}) {
  let newest = 0
  let seen = 0
  const walk = async (current, level) => {
    const info = await lstat(current)
    newest = Math.max(newest, info.mtimeMs)
    seen += 1
    if (seen > entries) return false
    if (!info.isDirectory()) return true
    const names = await readdir(current)
    if (names.length > 0 && level >= depth) return false
    for (const name of names) {
      if (!(await walk(join(current, name), level + 1))) return false
    }
    return true
  }
  return (await walk(path, 0)) ? newest : Infinity
}

export async function sweepTemp({ dir, now = Date.now(), staleMs = STALE_MS } = {}) {
  const out = { removed: [], kept: [], skipped: [], failed: [] }
  let names
  try {
    names = await readdir(dir)
  } catch {
    return out // 还没有这个目录：没东西可收
  }
  for (const name of names) {
    if (!isLeftover(name)) {
      out.skipped.push(name)
      continue
    }
    const path = join(dir, name)
    try {
      if (now - (await newestMtime(path)) < staleMs) {
        out.kept.push(name)
        continue
      }
      await rm(path, { recursive: true, force: true })
      out.removed.push(name)
    } catch {
      out.failed.push(name)
    }
  }
  return out
}

// 起来时那次收拾：还没收拾完的时候是个 promise，收拾完（成不成都算）变回 null。
let pending = null

export function startSweep(options, sweep = sweepTemp) {
  const run = Promise.resolve()
    .then(() => sweep(options))
    .catch(() => null)
    .then((out) => {
      if (pending === run) pending = null
      return out
    })
  pending = run
  return run
}

export function sweepPending() {
  return pending
}
