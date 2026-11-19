// 起进程用的小工具：连着子进程一起杀、把 Python 运行时挪到 dsh 家里、写插件文件。
// 单独一个文件：dsh/index.mjs 只管起 dsh。

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 几个任务同时起 dsh 时共用同一份插件文件：内容一样就不重写，免得另一个 dsh 正读着时被清空
export function writeWhenChanged(path, text) {
  try {
    if (readFileSync(path, 'utf8') === text) return
  } catch { /* 还没写过的就写一份 */ }
  writeFileSync(path, text, 'utf8')
}

export function killTree(child) {
  const pid = child?.pid
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.on('error', () => {
      // a missing taskkill must not take the shell down
    })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

export function runtimeCarrier(pythonRoot, dest) {
  const manifest = join(pythonRoot, 'runtime.json')
  if (!existsSync(manifest)) return pythonRoot
  const link = join(dest, 'dependencies', 'python')
  mkdirSync(join(dest, 'dependencies'), { recursive: true })
  // 联接坏了（指到的地方没有 python、或者被换成了一个空目录）：拆掉重接，
  // 不然 load_workspace_dependencies 会报找不到 python.exe。装着东西的真目录不碰，直接用随包那份
  const exe = join(link, process.platform === 'win32' ? 'python.exe' : join('bin', 'python3'))
  if (existsSync(link) && !existsSync(exe)) {
    try {
      rmdirSync(link)
    } catch {
      return pythonRoot
    }
  }
  if (!existsSync(link)) symlinkSync(pythonRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
  else if (!lstatSync(link).isSymbolicLink() && process.platform !== 'win32') return pythonRoot
  copyFileSync(manifest, join(dest, 'runtime.json'))
  return dest
}
