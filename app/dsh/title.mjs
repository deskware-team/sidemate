// dsh 给会话起的名字：从 dsh 的会话投影缓存里读（跟用量同一个文件，见 ./usage.mjs）。
// ACP 不往外递名字，只能读这个缓存。
// dsh 自己有个兜底名字（第一句话开头那几个词），那不算起好的名字：桌伴自己已经用第一句话前 16 个字占位了。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const flat = (text) => String(text ?? '').replace(/\s+/g, '')

// 起好的名字；还没起好、或者只是第一句话的开头，回空串
export function readTitle(dshHome, sessionId) {
  const path = join(dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
  let rows = null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    rows = parsed.record?.rows ?? parsed.rows
  } catch {
    return ''
  }
  const title = typeof rows?.title?.val === 'string' ? rows.title.val.trim() : ''
  if (!title) return ''
  const first = rows?.titleInput?.val?.first?.text
  if (typeof first === 'string' && flat(first).startsWith(flat(title))) return ''
  return title
}
