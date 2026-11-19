// 权限申请这一段：dsh 原生的 ask，桌伴把申请转到任务窗，用户点了才回。
//
// 卡上给用户看的那一行：写文件的工具给路径，跑命令的给命令（只留第一行）；
// 模型自己给的理由（justification）另带一句，太长截掉。
//
// 这里的「允许一次 / 本任务都允许 / 拒绝」三选一里，「本任务都允许」多一步：
// 先把这个会话切成 dsh 自己的完全访问（danger-full-access），再当允许一次回。
// 切模式是往会话日志里追加一条 sandbox/mode 事件，dsh 按会话记，重启后还在，
// 别的会话不受影响（dsh-sandbox-policy 的 README）。切不动就退化成「允许一次」。

import { isAbsolute, relative, resolve, sep } from 'node:path'
import { MODE_METHOD } from './steer-plugin.mjs'
import { sleep } from './usage.mjs'

// 权限申请里要给人看的那个文件：工具参数里的路径（没有就空着）
function permissionPath(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of ['file_path', 'filePath', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

// 权限卡上要给人看的那一行：写文件的工具给路径，别的（跑命令那些）给命令，只留第一行
export function permissionTarget(input) {
  const path = permissionPath(input)
  if (path !== '') return path
  if (!input || typeof input !== 'object') return ''
  const command = typeof input.command === 'string' ? input.command : ''
  return command.split(/\r?\n/)[0].trim()
}

// 理由最长留这么多字
const REASON_MAX = 120

// 模型给用户看的那句理由（dsh-tool-pwsh 的 justification）：没有就空着，太长截掉
export function permissionReason(input) {
  if (!input || typeof input !== 'object') return ''
  const text = typeof input.justification === 'string' ? input.justification.trim() : ''
  if (text === '') return ''
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text
}

// 这个文件在任务文件夹外吗（任务文件夹外面写、要问用户）
// 相对路径按任务文件夹算（resolve(workspace, target)），不按桌伴当前目录
export function outsideWorkspace(target, workspace) {
  if (typeof target !== 'string' || target === '') return false
  if (typeof workspace !== 'string' || workspace === '') return false
  const rel = relative(resolve(workspace), resolve(workspace, target))
  if (rel === '') return false
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

// 切模式最多等这么久：dsh 不回就当切不动，退化成「允许一次」
const MODE_WAIT_MS = 5_000

// 一张权限桌：记着等用户点的申请，回话时按用户的选择回给 dsh。
// news 为 true 的会话（新闻那一轮）：桌伴直接回拒绝，不弹权限卡。
export function createPermissionDesk({ send, request, writeLog, workspace, onAsk, news = false } = {}) {
  // 键是桌伴自己给的编号，值是 dsh 那边的请求号和会话号
  const pending = new Map()
  let seq = 0

  // 这一轮收手了：还没回的申请按取消回掉（别让 dsh 在那儿干等着）
  const cancel = () => {
    for (const [id, one] of pending) {
      pending.delete(id)
      if (one.requestId === undefined) continue
      send({ jsonrpc: '2.0', id: one.requestId, result: { outcome: { outcome: 'cancelled' } } })
    }
  }

  // 把一个会话切成完全访问（dsh 自己的沙箱模式）：切不动就当没切
  const setFullAccess = async (sessionId) => {
    if (!sessionId) return false
    try {
      await Promise.race([
        request(MODE_METHOD, { sessionId, mode: 'danger-full-access' }),
        sleep(MODE_WAIT_MS).then(() => { throw new Error('mode switch timed out') }),
      ])
      writeLog?.('sandbox full access')
      return true
    } catch (error) {
      writeLog?.(`sandbox switch failed ${error?.message || error}`)
      return false
    }
  }

  // 回权限申请：允许一次 / 本任务都允许（先切完全访问，再当允许一次回）/ 拒绝
  const answer = async (id, decision) => {
    const one = pending.get(id)
    if (!one) return { ok: false }
    pending.delete(id)
    let choice = decision === 'reject' ? 'reject' : decision === 'always' ? 'always' : 'once'
    if (choice === 'always') {
      const switched = await setFullAccess(one.sessionId)
      // 切不动就只当允许这一次
      if (!switched) choice = 'once'
    }
    if (one.requestId !== undefined) {
      const optionId = choice === 'reject' ? 'reject-once' : 'allow-once'
      send({ jsonrpc: '2.0', id: one.requestId, result: { outcome: { outcome: 'selected', optionId } } })
    }
    writeLog?.(`permission ${choice}`)
    return { ok: true, decision: choice }
  }

  // dsh 问一声要权限：记下来，交给任务窗（onAsk）
  const ask = ({ requestId, sessionId, toolCallId = '', tool = '', target = '', justification = '' } = {}) => {
    // 编号带上会话号：几个会话同时问的时候，任务窗也知道是哪一条对话的
    const id = `perm-${sessionId || 'local'}-${(seq += 1)}`
    if (requestId !== undefined) pending.set(id, { requestId, sessionId })
    // 新闻那一轮：桌伴直接回拒绝，不问用户
    if (news) {
      send({ jsonrpc: '2.0', id: requestId, result: { outcome: { outcome: 'selected', optionId: 'reject-once' } } })
      pending.delete(id)
      writeLog?.('permission rejected')
      return id
    }
    onAsk?.({
      id,
      sessionId: sessionId || '',
      toolCallId,
      tool,
      target,
      justification,
      outside: outsideWorkspace(target, workspace),
    })
    return id
  }

  return { ask, answer, cancel, pending }
}

// 补丁文字：新闻那一轮仍旧一律拒绝（越权直接拒，不问用户，不弹权限卡）。
// 会话的审批策略是权限预设给的，所以预设也一起换成拒绝。
export function neverApprovalPatchYaml() {
  return [
    '# 新闻那一轮：审批策略照旧一律拒绝，不弹权限卡。',
    '- id: approval',
    '  config:',
    '    policy: never',
    '- id: permission',
    '  config:',
    '    presets:',
    '      sidemate-news:',
    '        sandbox: workspace-write',
    '        approval: never',
    '    defaultPreset: sidemate-news',
    '',
  ].join('\n')
}
