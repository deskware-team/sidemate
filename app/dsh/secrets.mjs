// 日志、回复、报错里不能出现钥匙：打码的规则都在这一份。
// 打码不止盖 DeepSeek 钥匙：env 里带进来的每一把钥匙、外部工具服务的钥匙都要换成 ***。

// 像密钥的串：sk-…、Bearer …、key=… 这类
const SECRET = [
  /sk-[A-Za-z0-9_-]{6,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{6,}=*/gi,
  /(api[_-]?key|apikey|secret|token|passwd|password|私钥|密钥|钥匙)\s*[:=：]\s*("[^"]*"|'[^']*'|\S+)/gi,
  /[A-Za-z0-9]{32,}/g,
]

// 把一段文字里像密钥的串打码（盖成 ***）：日志、崩溃记录、报错原文都用这一份
export function maskSecrets(text) {
  let out = String(text ?? '')
  for (const pattern of SECRET) out = out.replace(pattern, '***')
  return out
}

// 打码：把每一把钥匙换成 ***
export function redact(text, secrets) {
  let out = text == null ? '' : String(text)
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret === '') continue
    out = out.split(secret).join('***')
  }
  return out
}

// 日志、回复、报错里都不能出现钥匙：DeepSeek 的、env 里带来的、外部工具服务的都算。
// 外部工具服务的钥匙由调用方从钥匙串读出来放在 options.mcpSecrets 里；
// 网址上的参数值不算钥匙（用户自己配的 format=json 这种不能盖掉）。
export function secretList(options) {
  const out = []
  const add = (value) => {
    if (typeof value !== 'string' || value === '' || out.includes(value)) return
    out.push(value)
  }
  add(options.apiKey)
  if (options.env && typeof options.env === 'object') {
    for (const value of Object.values(options.env)) add(value)
  }
  for (const value of Array.isArray(options.mcpSecrets) ? options.mcpSecrets : []) add(value)
  return out
}

// 这一轮走的是哪条线路：模型的值是 [线路, 模型]（见 app/dsh/models.mjs 的 choiceValue）。
// Kilo 那条线路在 dsh 里叫 kilo（那边不认这个匿名通行的时候回 401，说法不一样）。
export function routeOf(options) {
  try {
    const one = JSON.parse(String(options?.model?.value || ''))
    return Array.isArray(one) ? String(one[0] || '') : ''
  } catch {
    return ''
  }
}

// 只放行钥匙环境变量：模型的 SIDEMATE_KEY_，名字不合规的一律丢掉，不给子进程塞别的变量。
// 名字里都带 KEY：dsh 给 PowerShell / Python 这些子进程的环境里，名字带 KEY 的都剥掉，
// 模型写的脚本读不到钥匙。不带 KEY 的名字会原样漏给脚本，所以不收。
// 外部工具服务的钥匙不进环境变量：它们随建会话的参数走。
export function keyEnv(extra) {
  const out = {}
  if (!extra || typeof extra !== 'object') return out
  for (const [name, value] of Object.entries(extra)) {
    if (!/^SIDEMATE_KEY_[A-Z0-9_]+$/.test(name)) continue
    if (typeof value !== 'string' || value === '') continue
    out[name] = value
  }
  return out
}
