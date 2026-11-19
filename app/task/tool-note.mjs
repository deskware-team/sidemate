// 工具没调通时的那句话（状态码 St401 / St402 / St403）：壳里说得清楚是哪个服务、哪个工具。
// 单独一个文件：一句话的事，从一轮的流水线（./session.mjs）里拿出来放。

import { t } from '../copy/copy.mjs'

// dsh 那几个工具在界面上的名字（app/copy/status.mjs 的 tools 那几条）
const TOOL_NAMES = {
  office_convert: 'tools.convert',
  office_render: 'tools.render',
  office_recalculate: 'tools.recalc',
  present: 'tools.present',
}

// 模型自己读写、查找工作区里文件的那几个工具：出错多半是 dsh 的保护（改的那句对上了两处、
// 读完以后文件又变了），模型下一步自己就改好了。这种不在对话里说，只记进日志。
// 联网、外部工具服务、技能、跑命令这些照旧说一句，别让用户以为它拿到了结果。
const QUIET_TOOLS = new Set(['read', 'write', 'edit', 'glob', 'grep'])

// 这个工具出错要不要在对话里说
export function quietToolFail(name) {
  return QUIET_TOOLS.has(String(name ?? '').trim().toLowerCase())
}

// 工具名换成界面上的那个名字（别的工具照原样说）
function shownName(name) {
  const raw = String(name ?? '').trim()
  const key = TOOL_NAMES[raw]
  return key ? t(key) : raw
}

// 壳没给算法（测试的假壳）或者算挂了：照工具名说（St401）
const plain = (name) => {
  const raw = String(name ?? '').trim()
  return raw === '' ? '' : t('St401', { name: raw })
}

export function toolFailNote(deps, name, input) {
  const shown = shownName(name)
  if (typeof deps.toolFailNote !== 'function') return plain(shown)
  try {
    const text = deps.toolFailNote(shown, input)
    if (typeof text === 'string' && text.trim() !== '') return text.trim()
  } catch (error) {
    deps.log?.('tool-fail-note-failed', { error: error?.message || String(error) })
  }
  return plain(shown)
}
