// 错误码（Si）：这一轮停下来时，停工那句后面跟一截灰字「· Si429 错误，原文」，
// 日志里另写一行：Si 码 + HTTP 状态码 + 原文全文（不写密钥）。
// 码表、停工那句、显示的样子都在 app/copy/errors.mjs；这里只管「哪种停工是哪个码、说哪一句」。
// 拼那一行、截 80 个字只写在 app/copy/line.mjs（唯一一份），这里引它。
// 页面（任务窗）也引这个文件：不引 node:。
//
// 模型请求的报错不一样：那一类的码是 dsh 给的（RATE_LIMIT 这种）加上 HTTP 状态，
// 显示成「停下那句 · RATE_LIMIT 429，原文」（见 app/copy/line.mjs 的 dshLine）。
// 桌伴自己的报错照旧用 Si 码。

import { entry, has, t } from '../copy/copy.mjs'
import { errorLineText } from '../copy/line.mjs'
import { maskSecrets } from '../dsh/secrets.mjs'

// 模型服务回的 HTTP 状态码：码表里有的直接当 Si 码；码表里没有的（比如 418）也照样显示成 Si + 那个码
const HTTP = /\b([45]\d{2})\b/

export function isCode(code) {
  return typeof code === 'string' && /^Si\d{3}$/.test(code) && has(`codes.${code}`)
}

// dsh 的失败码（RATE_LIMIT 这种）：dsh-llm 的 LLM_FAILURE_CODES。
// 一张表管两件事：停下那句（stop，app/copy/errors.mjs 的 stops）和错的种类（reason）。
// 等待行、停下那句、横幅上的按钮都照这一张表来，别处不另写。
// reason 决定等待行说哪一句、横幅给哪些按钮；stop 决定停工那句。
const DSH_CODES = {
  RATE_LIMIT: { stop: 'busy', reason: 'busy' },
  SERVER: { stop: 'fail', reason: 'server' },
  TIMEOUT: { stop: 'timeout', reason: 'noreply' },
  TRANSPORT: { stop: 'broken', reason: 'network' },
  // 模型回了个空的：跟服务出错一样（等待行说服务出错，停下也说请求失败）
  EMPTY_RESPONSE: { stop: 'fail', reason: 'server' },
  MALFORMED_RESPONSE: { stop: 'invalid', reason: 'badreply' },
  STREAM_CLOSED: { stop: 'invalid', reason: 'badreply' },
  INVALID_RESPONSE: { stop: 'invalid', reason: 'badreply' },
  MISSING_CREDENTIAL: { stop: 'noKey', reason: 'key' },
  AUTH: { stop: 'keyBroken', reason: 'key' },
  INVALID_CREDENTIAL: { stop: 'keyBroken', reason: 'key' },
  QUOTA: { stop: 'fail', reason: 'quota' },
  CONTEXT_WINDOW_EXCEEDED: { stop: 'fail', reason: 'other' },
  INVALID_REQUEST: { stop: 'fail', reason: 'other' },
}

// 等待行用的四种错（app/task/wait.mjs 照这四种出等待行）
const WAIT_KINDS = new Set(['busy', 'server', 'noreply', 'network'])

// 免费通道（kilo）：那边不认这个匿名通行的时候回 401，不是用户的钥匙不对，
// 说「模型请求失败」，种类是 other（横幅只给「重来」，不给「去设置」）。
const FREE_ROUTE = 'kilo'

// dsh 的失败码 → 停下那句 + 错的种类。Kilo 的 401 特判只写在这一处。
export function dshOutcome(dshCode, status, route) {
  if (route === FREE_ROUTE && Number(status) === 401) return { stop: 'fail', reason: 'other' }
  const one = DSH_CODES[String(dshCode || '').trim()]
  return one ? { ...one } : { stop: 'fail', reason: 'other' }
}

// dsh 的失败码 → 等待行用的种类（重试播报插件生成时填进去，别处不另写）
export function dshWaitKinds() {
  const out = {}
  for (const [code, one] of Object.entries(DSH_CODES)) {
    if (WAIT_KINDS.has(one.reason)) out[code] = one.reason
  }
  return out
}

// dsh 的码长这样：RATE_LIMIT（可以带 HTTP 状态：RATE_LIMIT 429）
const DSH_CODE = /^([A-Z][A-Z0-9_]*)(?:\s(\d{3}))?$/

// dsh 的码跟 HTTP 状态拼起来的样子：RATE_LIMIT 429（没有状态就只有码）
export function dshCodeText(dshCode, status) {
  const code = String(dshCode || '').trim()
  if (!code) return ''
  const http = Number(status) || 0
  return http ? `${code} ${http}` : code
}

// 显示用的码拆回 dsh 的码和状态：不是 dsh 的码就 null
export function parseDshCode(code) {
  const hit = DSH_CODE.exec(String(code || '').trim())
  if (!hit) return null
  return { code: hit[1], status: Number(hit[2]) || 0 }
}

// dsh 的码 → 停下那句用哪一条（app/copy/errors.mjs 的 stops）
export function stopKeyForDsh(dshCode, status, route) {
  return dshOutcome(dshCode, status, route).stop
}

// dsh 的码 → 桌伴这边的哪种错（等重试、说哪一句、横幅给哪些按钮）
export function reasonForDsh(dshCode, status, route) {
  return dshOutcome(dshCode, status, route).reason
}

// dsh 给的失败：只信它写的 status（重试插件照 dsh 的失败算出来的：dsh 明写的，
// 没有就看原文开头那个 HTTP 状态）。没有就是 0。
// 原文中间的端口（connect ECONNREFUSED 1.2.3.4:443）不当 HTTP 状态。
export function statusOf(failure, detail = '') {
  if (failure) return Number(failure?.status) || 0
  return httpOf(detail)
}

// 报错原文里的 HTTP 状态码；没有就 0
export function httpOf(raw) {
  const hit = HTTP.exec(String(raw ?? ''))
  return hit ? Number(hit[1]) : 0
}

// 码表里有这个 HTTP 码就用它；没有的也照样显示成 Si + 那个码（418 这样）
const byHttp = (raw) => {
  const http = httpOf(raw)
  if (!http) return ''
  return `Si${http}`
}

// 停工的 reason → Si 码。raw 是报错原文：模型服务回的 HTTP 码在码表里就直接用它。
// 这里不拿英文原文猜错的种类：模型请求的错照 dsh 给的码（见上面的 dshCodeText），
// 这里的原文只用来取 HTTP 状态码。busy / noreply 这几种是没带 dsh 码时的兜底。
export function codeFor(reason, raw = '') {
  const key = String(reason ?? '').trim()
  const text = String(raw ?? '')
  if (key === 'key') {
    // 没有原文是桌伴自己查出来没配密钥；没有 HTTP 码的（那边说没有凭据）也是没配
    if (!text.trim() || !httpOf(text)) return 'Si101'
    return httpOf(text) === 403 ? 'Si403' : 'Si401'
  }
  if (key === 'quota') return 'Si402'
  if (key === 'busy') {
    const http = httpOf(text)
    if (http >= 500) return byHttp(text)
    return 'Si429'
  }
  if (key === 'noreply') return httpOf(text) === 408 ? 'Si408' : 'Si303'
  // 服务自己出错：码就是它回的 HTTP 码（503 就是 Si503）；没回 HTTP 码就当 500
  if (key === 'server') return byHttp(text) || 'Si500'
  if (key === 'other') return byHttp(text) || 'Si901'
  const fixed = {
    consent: 'Si102',
    missing: 'Si103',
    model: 'Si103',
    crash: 'Si301',
    toolcall: 'Si302',
    badreply: 'Si305',
    network: 'Si601',
    locked: 'Si803',
  }
  return fixed[key] || ''
}

// 这一次停工的码：事件里自带 Si 码就用它；模型请求的错用 dsh 的码（RATE_LIMIT 429）；
// 别的照 reason 和原文算
export function codeOf(event = {}) {
  if (isCode(event?.code)) return event.code
  const dsh = dshCodeText(event?.dshCode, event?.status)
  if (dsh) return dsh
  return codeFor(event?.reason, event?.raw)
}

// 停工那句用哪一条（errors.mjs 的 stops）：事件点名了就用点名的，别的照码表的默认
export function stopKey(code, event = {}) {
  if (typeof event?.stop === 'string' && has(`stops.${event.stop}`)) return event.stop
  if (isCode(code)) return entry(`codes.${code}`).stop || 'other'
  // 模型请求的错：照 dsh 的码挑停下那句
  const dsh = parseDshCode(code)
  if (dsh) return stopKeyForDsh(dsh.code, dsh.status || event?.status, event?.route)
  // 码表里没有的 HTTP 码（比如 418）：码照样显示，停下那句说「模型请求失败」，不落 Si901
  if (/^Si\d{3}$/.test(String(code || ''))) return 'fail'
  return 'other'
}

// 停工那句：变量从事件里带（name 是文件名，vars 里是 vendor、minutes、list 这些）。
// 没配密钥又不知道是哪一家（vendor）时，说不带厂商名的那句
export function stopText(event = {}, code = codeOf(event)) {
  const vars = { ...(event?.vars || {}) }
  if (typeof event?.name === 'string' && event.name) vars.name = event.name
  if (!vars.vendor && typeof event?.vendor === 'string' && event.vendor) vars.vendor = event.vendor
  const key = stopKey(code, event)
  const text = t(`stops.${key === 'noKey' && !vars.vendor ? 'noKeyAny' : key}`, vars)
  // 该填的没给（比如被占着的文件名没拿到）：别把 {name} 露出去，说没归上类的那句
  return /\{[A-Za-z][A-Za-z0-9]*\}/.test(text) ? t('stops.other') : text
}

// 界面上显示的报错那一行：照码表查停下那句，拼成「那句 · Si 码 错误」（有原文就带上原文）。
// 停下那句可以自己给（比如装能力失败时要说清出了什么问题）；不给就照码表里的。
export function errorText(code, raw = '', stop = '') {
  if (!code) return ''
  const say = String(stop || stopText({}, code)).trim()
  if (!say) return ''
  return errorLineText(say, code, raw)
}

// 日志里的细节：密钥这类东西不写进去，日志是给人查的，不能带密钥出去
// 打码的规则只有一份（app/dsh/secrets.mjs）
export function scrub(text, limit = 400) {
  return maskSecrets(text).replace(/\s+/g, ' ').trim().slice(0, limit)
}

// 攒一行日志：{ code, step, detail }，再带上 HTTP 状态码、原文全文这些
export function codeLine(code, step, detail, extra = {}) {
  const one = { code: String(code || ''), step: String(step || ''), detail: scrub(detail) }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null || value === '' || value === 0) continue
    one[key] = typeof value === 'string' ? scrub(value, key === 'raw' ? 4000 : 200) : value
  }
  return one
}

// 一次停工该写的那一行日志：没有码就写不了（这行不记）
export function errorCodeLine(event = {}) {
  const code = codeOf(event)
  if (!code) return null
  const raw = String(event.raw ?? '')
  const dsh = parseDshCode(code)
  // dsh 的码：HTTP 状态只认它给的那个（没有就没有），不从原文里找
  const extra = { exitCode: event.exitCode, http: dsh ? dsh.status : httpOf(raw), raw }
  return { event: 'error-code', ...codeLine(code, event.step || event.reason, event.detail || raw || event.reason || '', extra) }
}
