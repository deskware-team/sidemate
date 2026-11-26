// 桌伴自己的「逐字流」dsh 小插件：源码在这里生成，不进仓库。
// 起进程前按 payload 的实际位置写一份到用户目录下的 patches/（跟重试播报插件一个路子）。
//
// 为什么要有这个插件：模型回话的逐字流（agent/assistant-stream）是 dsh 进程内部的
// 瞬态事件，ACP 那条线只发每一步结算后的整段话。桌伴要打字机效果，就得有人把每个
// 文字增量递出来。这个插件把每次尝试的文字增量、结算结果写成一行 JSON，写进桌伴
// 给的那个文件（环境变量 DSH_SIDEMATE_STREAM_FILE），桌伴一行一行读。
// 一行一条：读的时候接着上次的字节读，字不会漏；一个 dsh 进程跑好几个会话，
// 每一行都带着会话号，桌伴按会话分开。
//
// 这里不许出现钥匙。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWhenChanged } from './proc.mjs'
import { createRetryTail } from './retry-log.mjs'

export const STREAM_FILE_ENV = 'DSH_SIDEMATE_STREAM_FILE'

// 插件源码：只用到 node:fs，别的都不用带进来。
export function streamPluginSource() {
  return `// 桌伴自己的逐字流 dsh 小插件（起 dsh 时生成）。
// dsh 每次问模型，回话的每个文字增量都用 agent/assistant-stream 事件发出来（进程内部、瞬态的）。
// 这里把每个文字增量、每次尝试的结算写成一行 JSON，写进桌伴给的文件，桌伴照着出打字机效果。
// 一个 dsh 进程上跑好几个会话，所以每一行都带着会话号，桌伴按会话分开。
// 这里不许出现钥匙。

import { appendFileSync } from 'node:fs'

const STREAM_FILE = process.env.${STREAM_FILE_ENV} || ''

export const name = 'sidemate-stream'
export const inject = []

// 写一行：写不动就当没这一行，桌伴等下一条
function write(line) {
  if (!STREAM_FILE) return
  try {
    appendFileSync(STREAM_FILE, line + '\\n', 'utf8')
  } catch {
    // 写不动就当没这一行
  }
}

export function apply(ctx) {
  // 根上听：没打标签的监听器收所有会话的 frame（跟重试播报一个路子），会话号从 agent 上拿
  let attempt = ''
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!frame) return
    const sessionId = String(agent?.session?.id || '')
    if (frame.type === 'start') {
      attempt = String(frame.attemptId || '')
      return
    }
    const attemptId = String(frame.attemptId || attempt)
    if (frame.type === 'chunk') {
      const chunk = frame.chunk
      if (!chunk || chunk.type !== 'text-delta') return
      write(JSON.stringify({ sessionId, attemptId, kind: 'delta', text: String(chunk.text || '') }))
      return
    }
    if (frame.type === 'end') {
      // 结算了才算成：只有结算成 assistant/message 的那次的字算数（要重试的那种不算）
      const outcome = frame.outcome || {}
      const committed = outcome.kind === 'committed' && outcome.eventType === 'assistant/message'
      write(JSON.stringify({ sessionId, attemptId, kind: 'end', committed }))
    }
  })
}
`
}

// 补丁文字：插一行我们自己的插件（不改 acp 那一行，插话、重试播报照旧）。
export function streamPatchYaml(pluginPath) {
  return [
    '# 桌伴自己的 dsh 补丁：插一行逐字流插件，把模型回话的每个文字增量一行一行写给桌伴。',
    '- insert:',
    '    - id: sidemate-stream',
    `      name: ${JSON.stringify(String(pluginPath))}`,
    '',
  ].join('\n')
}

// 把插件写进 <home>/patches/，返回 { pluginPath, patchText }；写不动就返回 null（这一轮没有逐字流）。
export function writeStreamPlugin({ home } = {}) {
  if (typeof home !== 'string' || home === '') return null
  const dir = join(home, 'patches')
  const pluginPath = join(dir, 'stream-plugin.mjs')
  try {
    mkdirSync(dir, { recursive: true })
    writeWhenChanged(pluginPath, streamPluginSource())
  } catch {
    return null
  }
  return { pluginPath, patchText: streamPatchYaml(pluginPath) }
}

// 读逐字流文件、出流式事件：一行一个（文字增量 / 这次尝试结算了）。
// 读法跟重试播报一个样（接着上次的字节读，不漏行）；不是 JSON 的、半行的都跳过，
// 别把一轮带崩。
export function createStreamWatcher({ path, onEvent, intervalMs = 120 } = {}) {
  return createRetryTail(path, (line) => {
    let info
    try {
      info = JSON.parse(line)
    } catch {
      return // 不是一行完整的 JSON：跳过
    }
    const kind = String(info?.kind || '')
    if (kind !== 'delta' && kind !== 'end') return
    const base = {
      kind,
      sessionId: String(info?.sessionId || ''),
      attemptId: String(info?.attemptId || ''),
    }
    if (kind === 'delta') onEvent({ ...base, text: String(info?.text || '') })
    else onEvent({ ...base, committed: info?.committed === true })
  }, intervalMs)
}

// 桌伴这边的逐字流：插件写来的每个文字增量攒成「到目前为止的整段前缀」，节流着发 reply。
// 任务窗那头前缀长长还是同一个气泡（app/task/state.mjs 的 reply 分支），不用新事件。
// 结算的整段（agent_message_chunk）以它为准：流式缺了尾巴、被结算超了车，都靠它校准。
// 每开始用一次工具就收住一段：干活过程中说的每一段都是一个独立的气泡，都留着。
// 新闻那一轮不转发（没人看，也省 IPC）。
export function createLiveReplies({ emit, redact, news, waitMs = 100 } = {}) {
  let attempt = '' // 正在流的那次尝试的号
  let streamed = '' // 那次尝试到目前为止的字（原始的，没打码）
  let settled = '' // 这一段已经结算成 agent_message_chunk 的字
  let shown = '' // 这个气泡已经发出去的最新前缀（打码后的）
  let saw = false // 这一段流式发出去过没有（没发过的整段，到收住时才发）
  let closed = '' // 刚收住的那次尝试：它的字晚到（文件比话慢）就不再当新的一段
  let timer = null // 节流的尾巴：到点把攒的字发出去
  let lastAt = 0 // 上一次发出去是什么时候

  // 发最新的前缀：只有流在结算前面才发（结算的整段都到了就以它为准，不抢）；空白的段不发
  const fire = () => {
    if (!streamed.startsWith(settled) || streamed.length <= settled.length) return
    const text = redact(streamed)
    if (!text.trim() || text === shown) return
    shown = text
    saw = true
    lastAt = Date.now()
    emit({ type: 'reply', text })
  }

  // 节流：至少隔 waitMs 才发一次；隔得近的增量排在尾巴里，到点发最新的那个前缀
  const push = () => {
    if (timer) return
    const due = lastAt + waitMs - Date.now()
    if (due > 0) {
      timer = setTimeout(() => {
        timer = null
        fire()
      }, due)
      timer.unref?.()
      return
    }
    fire()
  }

  // 到点没到点都现在发（结算了 / 这一步收住之前用）
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    fire()
  }

  const reset = () => {
    attempt = ''
    streamed = ''
    settled = ''
    shown = ''
    saw = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    // 插件写来的一行（文字增量 / 这次尝试结算了）
    frame(info) {
      if (news || !info) return
      if (info.kind === 'end') {
        if (info.attemptId !== attempt) return
        if (info.committed) flush()
        else {
          attempt = ''
          streamed = ''
        }
        return
      }
      if (info.attemptId !== attempt) {
        if (info.attemptId === closed) return // 刚收住那一段的晚到的字：不另开新段
        attempt = info.attemptId
        streamed = ''
      }
      streamed += info.text
      push()
    },
    // 结算的整段到了（agent_message_chunk）
    settle(chunk) {
      settled += chunk
      if (!saw) return // 这一段没流过：整段到收住（tool_call）/ 收场时才发
      if (streamed.startsWith(settled)) return // 流式还在前面：不用动
      const text = redact(settled)
      if (!text.trim() || text === shown) return
      shown = text
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      emit({ type: 'reply', text })
    },
    // 这一步收住（tool_call）：这一段当一个独立的气泡发出去，然后换新气泡。干活过程中
    // 说的每一段都这么发、都留着。rawText 是这一段结算的整段（原始的，没打码）：
    // 流式发过的拿它校准（补上尾巴、去重），没发过的这时整段补发一次；空白的段不发。
    cut(rawText) {
      flush()
      closed = attempt
      const text = redact(rawText)
      const was = shown
      reset()
      if (!news && text.trim() && text !== was) emit({ type: 'reply', text })
    },
    // 收场的整段是不是已经在气泡里了（一样就不必再发一遍）
    already(text) {
      return shown === text
    },
    // 这一轮收场：定格在已有文字上，尾巴不再发
    stop() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
