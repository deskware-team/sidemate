// 模型在干什么：报给壳一个短记号（search / web / prepare / write 名字 / read 名字 / tool 名字 / work），
// 壳那边翻成状态码 St2xx（app/task/state.mjs 的 stepLine）。记号不给人看。
//
// 这一段单独放一个文件：dsh/index.mjs 只管起 dsh 和收发消息，记号怎么写在这儿。

import { basename } from 'node:path'

function toolHint(update) {
  const input = update.rawInput && typeof update.rawInput === 'object' ? update.rawInput : {}
  const raw = input.file_path || input.path || input.query || ''
  if (typeof raw !== 'string' || raw === '') return ''
  return basename(raw)
}

// 这几个 dsh 工具在界面上的名字：状态行上翻成状态码（St213–St216）
const TOOL_STEP = {
  office_convert: 'convert',
  office_render: 'render',
  office_recalculate: 'recalc',
  present: 'present',
}

// 工具调用失败时 dsh 回的那句错：tool_call_update 的 content 里的字（记日志用）
export function failText(update) {
  const parts = Array.isArray(update?.content) ? update.content : []
  const texts = []
  for (const part of parts) {
    const inner = part?.content && typeof part.content === 'object' ? part.content : part
    if (inner && typeof inner.text === 'string') texts.push(inner.text)
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

export function progressText(update) {
  if (update.sessionUpdate !== 'tool_call') return ''
  const name = update.title || ''
  const hint = toolHint(update)
  if (name === 'web_search') return 'search'
  if (name === 'web_fetch') return 'web'
  if (name === 'write' || name === 'edit') return hint ? `write ${hint}` : 'write'
  if (name === 'read') return hint ? `read ${hint}` : 'read'
  if (name === 'load_workspace_dependencies') return 'prepare'
  if (TOOL_STEP[name]) return TOOL_STEP[name]
  return hint ? `tool ${hint}` : 'work'
}
