// 新闻里的链接：归一化（去片段、去末尾斜杠、域名小写）和取域名。
// 同一个链接的两种写法归成同一个，报过的按它去重。
// 纯 node 模块，不引 electron，node --test 直接测。

// 链接归一化：去 # 片段、去末尾的 /、域名小写。同一个链接的两种写法归成同一个。
export function normalizeNewsLink(url) {
  const raw = String(url ?? '').trim()
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return ''
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') return ''
  parsed.protocol = protocol
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  let text = parsed.toString()
  if (text.endsWith('/')) text = text.slice(0, -1)
  return text
}

// 链接的域名，取不到给空串。
export function hostOf(url) {
  try {
    return new URL(String(url ?? '')).hostname.toLowerCase()
  } catch {
    return ''
  }
}
