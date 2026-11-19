// dsh 意外退出时记一份崩溃记录。只管记，还没有调用方。
// 记什么：时间、退出码和信号、dsh 最后 200 行输出、当时在跑的对话（只记编号和状态）、桌伴版本和 dsh 版本。
// 输出里可能带密钥：写盘之前先打码（sk-…、Bearer …、key=…、长串字母数字都盖掉）。
// 对话只留编号和状态：对话内容和文件内容一律不记。
// 只留最近 20 份，多的按时间删最旧的；写坏了不抛错（记录坏了不能误事）。

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { maskSecrets } from './secrets.mjs'

// 最多留多少份崩溃记录
export const KEEP = 20
// 一次崩溃最多记多少行输出（dsh 的 stdout 和 stderr 合起来的尾巴）
export const TAIL_LINES = 200
// 连崩判定：几分钟内崩几次算连崩
export const LOOP_WINDOW_MS = 5 * 60 * 1000
export const LOOP_COUNT = 3
// 连崩了就停下，停工用这个码（Si301 已在 app/task/codes.mjs 和 app/copy/errors.mjs 里，这里只是点名）
export const CRASH_LOOP_CODE = 'Si301'

// 像密钥的串：sk-…、Bearer …、key=… 这类（规则在 app/dsh/secrets.mjs）

// 时间算成毫秒：数字、Date、ISO 字符串都认；认不出给 null
function toMillis(value) {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

// 崩溃记录的文件名：crash-20261116-193042-123.json（本地时间，带毫秒）
export function crashFileName(ms) {
  const d = new Date(ms)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`
  return `crash-${stamp}.json`
}

// 输出的尾巴：行数组或一整段文字都行，只留最后 TAIL_LINES 行，每行先打码
export function tailLines(output, limit = TAIL_LINES) {
  const lines = Array.isArray(output)
    ? output.map((line) => String(line ?? ''))
    : String(output ?? '').split(/\r?\n/)
  return lines.slice(-limit).map((line) => maskSecrets(line))
}

// 目录里只留最近 KEEP 份崩溃记录，多的按时间删最旧的（别的文件不碰）
function prune(dir, keep = KEEP) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  const mine = names.filter((name) => /^crash-.*\.json$/.test(name))
  if (mine.length <= keep) return
  const stamped = mine.map((name) => {
    let when = 0
    try {
      when = statSync(join(dir, name)).mtimeMs
    } catch {
      when = 0
    }
    return { name, when }
  })
  stamped.sort((a, b) => (a.when - b.when) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const one of stamped.slice(0, stamped.length - keep)) {
    try {
      unlinkSync(join(dir, one.name))
    } catch {
      // 删不掉就先留着：下次再收
    }
  }
}

// 记一次崩溃：写一份 JSON 到 dir 下面，返回写好的文件路径；写不了返回 null，不抛错
export function writeCrashLog(dir, info = {}) {
  try {
    if (typeof dir !== 'string' || dir === '') return null
    mkdirSync(dir, { recursive: true })
    let ms = toMillis(info.time) ?? Date.now()
    // 同一毫秒里连着崩两次：往后挪一毫秒，别把上一份盖掉
    let name = crashFileName(ms)
    while (existsSync(join(dir, name))) {
      ms += 1
      name = crashFileName(ms)
    }
    const conversations = (Array.isArray(info.conversations) ? info.conversations : [])
      .filter((one) => one && typeof one === 'object')
      .map((one) => ({ id: one.id ?? null, state: one.state ?? null }))
    const record = {
      time: new Date(ms).toISOString(),
      exitCode: info.exitCode ?? null,
      signal: info.signal ?? null,
      output: tailLines(info.output),
      conversations,
      appVersion: info.appVersion ?? '',
      dshVersion: info.dshVersion ?? '',
    }
    const path = join(dir, name)
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    prune(dir)
    return path
  } catch {
    return null // 记录坏了不能误事
  }
}

// 连崩判定：给一串崩溃时间，看最近 windowMs 里是不是崩了 count 次以上
export function isCrashLoop(times, { now = Date.now(), windowMs = LOOP_WINDOW_MS, count = LOOP_COUNT } = {}) {
  const list = Array.isArray(times) ? times : []
  let hits = 0
  for (const raw of list) {
    const ms = toMillis(raw)
    if (ms === null || ms > now) continue
    if (ms >= now - windowMs) hits += 1
  }
  return hits >= count
}
