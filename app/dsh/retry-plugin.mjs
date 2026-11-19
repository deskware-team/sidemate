// 桌伴自己的「重试播报」dsh 小插件：源码在这里生成，不进仓库。
// 起进程前按 payload 的实际位置写一份到用户目录下的 patches/（跟插话插件一个路子）。
//
// 为什么要有这个插件：重试由 dsh 自己来（dsh-llm-retry 的 retryPolicy）。
// dsh 每次要重试就往会话里记一条 llm/retry 事件，里面写着：
//   这次是哪种错（忙 / 服务出错 / 超时 / 连接断了）、第几次、最多几次、等几秒。
// 桌伴要照这个出等待行（St301–St305，次数不能漏号），所以要有人把这些数递出去。
// dsh 自己不往外递：会话投影缓存那一行只有 {retry, retryId}，ACP 也只转发
// assistant/tool 那几种事件。所以这个插件把每一条 llm/retry 事件写成一行 JSON，
// 写进桌伴给的那个文件（环境变量 DSH_SIDEMATE_RETRY_FILE），桌伴一行一行读。
// 一条事件一行：读的时候接着上次的字节读，次数不会漏。
//
// 这一轮最后那次失败也走这条路：dsh 把它记在会话的 turn/end 事件里
// （reason.error 是 LlmFailure：码、HTTP 状态、原文），ACP 只转了话，码在这儿。
// 插件把那条也写成一行 JSON（kind 是 failure），桌伴从那儿拿 dsh 的码来显示报错。
//
// 为什么不让桌伴自己重试（再发一次 session/prompt）：那样会把用户那句话
// 叠在会话里——第一次失败那句已经在会话里了，再发一次又记一遍，
// 干到一半断的话模型还会看见用户把要求又说一遍，可能从头重做。
// dsh 自己的重试只重发那一次模型请求，用户那句话一直只出现一次。
//
// 这里不许出现钥匙。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWhenChanged } from './proc.mjs'
import { dshWaitKinds } from '../task/codes.mjs'

export const RETRY_FILE_ENV = 'DSH_SIDEMATE_RETRY_FILE'

// dsh 的失败不一定带 HTTP 状态：走 SDK 的那条线路只把 HTTP 错写成「429 {…}」这种开头
// （dsh 自己就照这个开头认状态）。所以状态取两处：dsh 明写的 status，没有就看原文开头。
// 原文中间的端口（connect ECONNREFUSED 1.2.3.4:443）不是状态，不认。
// 这个函数要整个塞进插件源码里，所以自己关门：不用外头任何东西。
export function failureStatus(failure) {
  const given = Number(failure?.status) || 0
  if (given) return given
  const hit = /^[45]\d\d\b/.exec(String(failure?.message || ''))
  return hit ? Number(hit[0]) : 0
}

// 插件源码：只用到 node:fs，别的都不用带进来。
// 里面的 KIND_OF_CODE：dsh 的失败码 → 桌伴这边的四种错（等待行用哪一句）。
// 这张表在生成时从 app/task/codes.mjs 的那张表填进来（别处不另写）。
export function retryPluginSource() {
  const kinds = Object.entries(dshWaitKinds()).map(([code, kind]) => `  ${code}: '${kind}',`).join('\n')
  return `// 桌伴自己的重试播报 dsh 小插件（起 dsh 时生成）。
// dsh 自己重试的时候往会话里记一条 llm/retry 事件；这里把那条事件写成一行 JSON，
// 写进桌伴给的文件，桌伴照着出等待行。
// 这一轮最后那次失败也一样：dsh 把它记在会话的 turn/end 事件里（reason.error 是
// LlmFailure：码、HTTP 状态、原文），这里写一行 JSON 给桌伴——ACP 只转了话，码在这儿。
// 一个 dsh 进程上跑好几个会话，所以每一行都带着会话号，桌伴按会话分开。
// 这里不许出现钥匙。

import { appendFileSync } from 'node:fs'

const RETRY_FILE = process.env.${RETRY_FILE_ENV} || ''

// dsh 的失败码 → 桌伴这边的四种错（等待行：忙 / 服务出错 / 模型一直不回 / 连接断了）
// 这张表是桌伴那边填进来的（app/task/codes.mjs 里那张表）
const KIND_OF_CODE = {
${kinds}
}

// dsh 给的失败：HTTP 状态取 dsh 明写的那个，没有就看原文开头（dsh 的 SDK 线路这么写）
${failureStatus.toString()}

export const name = 'sidemate-retry'
export const inject = []

// 写一行：写不动就当没这一行，桌伴等下一条
function write(line) {
  if (!RETRY_FILE) return
  try {
    appendFileSync(RETRY_FILE, line + '\\n', 'utf8')
  } catch {
    // 写不动就当没这一行
  }
}

export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (!event) return
    const sessionId = String(session?.id || '')
    // 每一次重试：种类、第几次、等几秒
    if (event.type === 'llm/retry') {
      const data = event.data || {}
      const failure = data.failure || {}
      write(JSON.stringify({
        sessionId,
        kind: KIND_OF_CODE[failure.code] || '',
        code: failure.code || '',
        retry: Number(data.retry) || 0,
        maxRetries: Number(data.maxRetries) || 0,
        delayMs: Number(data.delayMs) || 0,
        detail: failure.message || '',
      }))
      return
    }
    // 这一轮最后那次失败：dsh 的码、HTTP 状态、原文
    if (event.type === 'turn/end') {
      const reason = (event.data || {}).reason || {}
      if (reason.kind !== 'error') return
      const failure = reason.error || {}
      write(JSON.stringify({
        sessionId,
        kind: 'failure',
        code: failure.code || '',
        status: failureStatus(failure),
        detail: failure.message || '',
      }))
    }
  })
}
`
}

// 补丁文字：插一行我们自己的插件（不改 acp 那一行，插话插件照旧）。
export function retryPatchYaml(pluginPath) {
  return [
    '# 桌伴自己的 dsh 补丁：插一行重试播报插件，把 dsh 的重试事件一行一行写给桌伴。',
    '- insert:',
    '    - id: sidemate-retry',
    `      name: ${JSON.stringify(String(pluginPath))}`,
    '',
  ].join('\n')
}

// 把插件写进 <home>/patches/，返回 { pluginPath, patchText }；写不动就返回 null（这一轮没有播报）。
export function writeRetryPlugin({ home } = {}) {
  if (typeof home !== 'string' || home === '') return null
  const dir = join(home, 'patches')
  const pluginPath = join(dir, 'retry-plugin.mjs')
  try {
    mkdirSync(dir, { recursive: true })
    writeWhenChanged(pluginPath, retryPluginSource())
  } catch {
    return null
  }
  return { pluginPath, patchText: retryPatchYaml(pluginPath) }
}
