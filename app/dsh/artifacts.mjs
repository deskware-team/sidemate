// 干活时动过的文件：开工时记一遍（路径 + 修改时间 + 内容），收场时对一遍。
// 用户给的副本在 received\ 里、过程文件在 .sidemate\ 里，都不算模型动过的（那两处不扫）。
// 只给主进程用（读文件时间、算摘要）。

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { listFiles } from '../workspace/index.mjs'

// 这么大的文件不算摘要（只按时间和大小认）：省时间
const HASH_LIMIT = 4 * 1024 * 1024

// 一份文件的记号：改了时间、变了大小、内容不一样，都算动过
function mark(path) {
  let st
  try {
    st = statSync(path)
  } catch {
    return ''
  }
  let digest = ''
  if (st.isFile() && st.size <= HASH_LIMIT) {
    try {
      digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
    } catch {
      digest = ''
    }
  }
  return `${st.mtimeMs}:${st.size}:${digest}`
}

export function createFileWatcher(workspace) {
  const seen = new Map()
  const scan = () => {
    for (const path of listFiles(workspace)) {
      const one = mark(path)
      if (one) seen.set(path, one)
    }
  }
  scan()
  return {
    // 收场时对一遍：新出现的、修改过的都算这一轮动过的
    changed: () => {
      const out = []
      for (const path of listFiles(workspace)) {
        const one = mark(path)
        if (!one) continue
        if (seen.get(path) === one) continue
        seen.set(path, one)
        out.push({ path, name: basename(path) })
      }
      return out
    },
  }
}
