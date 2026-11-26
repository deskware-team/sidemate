// 模型这一会儿在干什么：在读、在写、在想。
// 工具名 → 阶段的纯函数（算法在这儿，dsh/index.mjs 只管把阶段发出去）。
// 读文件、搜索、查网页 → read；写文件、跑命令 → write；模型在想（还没动工具）→ think。

// 读类工具：只是看，不改东西
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'web_search', 'web_fetch', 'office_render', 'skill'])

export function phaseOfTool(name) {
  const tool = typeof name === 'string' ? name : ''
  // 外部工具服务（mcp__ 开头）这一层只当「看东西」
  if (tool.startsWith('mcp__')) return 'read'
  return READ_TOOLS.has(tool) ? 'read' : 'write'
}

// 这一条更新对应哪个阶段：模型在想（还没动工具）是 think，动了工具的照工具名算
export function phaseOfUpdate(update) {
  if (update?.sessionUpdate === 'agent_thought_chunk') return 'think'
  if (update?.sessionUpdate === 'tool_call') return phaseOfTool(update.title)
  return ''
}

// 阶段发出去：变了才发，连着同一个阶段不发第二遍
export function createPhaseEmitter(emit) {
  let last = ''
  return (phase) => {
    if (!phase || phase === last) return
    last = phase
    emit({ type: 'phase', phase })
  }
}
