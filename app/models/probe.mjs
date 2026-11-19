// 自定义模型接口（OpenAI / Anthropic 格式）的「测一下」：先拉模型列表，再用一个模型发最小请求
//
// 失败的话给一行「前一句 · Si 码 错误，原文」：码是模型服务那边的（那边回了 HTTP 码，码就是它回的那个：
// Si401 密钥不对、Si402 余额、Si404、Si429、Si5xx…），原文是那边回的原话。
// 桌伴自己查出来的毛病（地址不是 https、会跳到别处）用 Si1xx。
// 不猜厂商的错因：那边回了什么码就照什么码说，原话原样摆出来。

import { errorLine, stopKeyOf } from '../copy/line.mjs'
import { t } from '../copy/copy.mjs'

const FAIL = {
  key: { code: 'Si401', stop: 'probe.key' },
  busy: { code: 'Si429', stop: 'probe.busy' },
  network: { code: 'Si601', stop: 'probe.network' },
  address: { code: 'Si404', stop: 'probe.address' },
  https: { code: 'Si105' },
  redirect: { code: 'Si106' },
  other: { code: 'Si901', stop: 'stops.probeFailed' },
}

// 模型列表没拉到：不算测不通，但要告诉用户手动加模型
const NO_MODEL_CODE = 'Si108'

// 这些毛病用模型服务自己回的 HTTP 码：那边回了 401 就是 Si401、回了 500 就是 Si500
const BY_HTTP = new Set(['key', 'address', 'busy', 'other'])

// 那边回了什么状态码就是什么毛病：只看码，不看回包里的话
export function classify(status) {
  const one = Number(status) || 0
  if (one === 401 || one === 403) return 'key'
  if (one === 429 || one >= 500) return 'busy'
  if (one === 400 || one === 404 || one === 422) return 'address'
  return 'other'
}

// 码：那边回了 HTTP 码就用它（Si401、Si500 这样），自己查出来的用这一类自己的码
function codeOf(status, kind) {
  const one = FAIL[kind] || FAIL.other
  if (BY_HTTP.has(kind) && Number(status) >= 400 && Number(status) < 600) return `Si${status}`
  return one.code
}

function fail(kind, raw = '', status = 0) {
  const one = FAIL[kind] || FAIL.other
  const code = codeOf(status, kind)
  return {
    ok: false,
    kind,
    code,
    raw: String(raw ?? '').replace(/\s+/g, ' ').trim(),
    message: errorLine(stopKeyOf(code, one.stop), code, raw),
  }
}

// 读回包的头：fake fetch 有时只给普通对象，都认
function headerOf(response, name) {
  const headers = response && response.headers
  if (!headers) return ''
  const lower = String(name).toLowerCase()
  if (typeof headers.get === 'function') return String(headers.get(lower) ?? '')
  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === lower) return String(value ?? '')
    }
  }
  return ''
}

// 跳转到 https 去了：地址要用 https 开头。
// 只在请求地址是 http、跳过去是 https 时才这么说；别的跳转当地址不对。
function redirectKind(requestUrl, location) {
  const to = String(location ?? '').trim()
  const from = String(requestUrl ?? '').trim()
  if (to.startsWith('https://') && from.startsWith('http://')) return 'https'
  if (to === '') return 'address'
  return 'redirect'
}

// 地址末尾的 / 去掉，拼路径才不会出 //
function trimBase(url) {
  return String(url ?? '').replace(/\/+$/, '')
}

// anthropic 的地址可以带 /v1 也可以不带，先把末尾 / 和 /v1 都剥掉得到根
function anthropicRoot(url) {
  return trimBase(url).replace(/\/v1$/, '')
}

// 依次找第一个正整数，找不到给 null
function firstPositiveInt(...values) {
  for (const value of values) {
    const num = Number(value)
    if (Number.isInteger(num) && num > 0) return num
  }
  return null
}

function readModel(id, info) {
  const raw = info && typeof info === 'object' ? info : {}
  return {
    id: String(id),
    name: raw.display_name ?? raw.name ?? null,
    contextWindow: firstPositiveInt(raw.context_window, raw.context_length, raw.max_input_tokens),
    maxTokens: firstPositiveInt(raw.max_tokens, raw.max_output_tokens),
  }
}

// 列表认两种形状：{ data: [...] } 数组，或 { models: { id: ... } } 对象；认不出给 null
function parseModels(bodyText) {
  let payload
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return null
  }
  const models = []
  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      if (item?.id == null) continue
      models.push(readModel(item.id, item))
    }
  } else if (payload?.models && typeof payload.models === 'object' && !Array.isArray(payload.models)) {
    for (const [id, info] of Object.entries(payload.models)) {
      models.push(readModel(id, info))
    }
  } else {
    return null
  }
  return models
}

export async function probeEndpoint({ protocol, baseUrl, key, model, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const auth = String(key ?? '').trim()
  const chosen = String(model ?? '').trim()
  const isAnthropic = protocol === 'anthropic'
  // 原文里不能出现密钥：那边把密钥原样回在错误里时，先涂掉
  const scrub = (text) => (auth ? String(text ?? '').split(auth).join('***') : String(text ?? ''))
  const base = trimBase(baseUrl)
  const root = anthropicRoot(baseUrl)
  const headers = {}
  if (isAnthropic) {
    headers['anthropic-version'] = '2023-06-01'
    if (auth) headers['x-api-key'] = auth
  } else if (auth) {
    headers['authorization'] = `Bearer ${auth}`
  }
  const listUrl = isAnthropic ? `${root}/v1/models?limit=1000` : `${base}/models`
  const chatUrl = isAnthropic ? `${root}/v1/messages` : `${base}/chat/completions`

  // 第一步：拉列表。钥匙不对直接报；其他拉不到（404、405、解析不了、空列表）不算失败，只是 listed=false
  let listed = false
  let models = []
  try {
    const response = await fetchImpl(listUrl, {
      method: 'GET',
      // 不跟着跳转走：跟着走就可能把钥匙发到别的地方去。跳了也不算数，只记下来
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    })
    if (response.status === 401 || response.status === 403) return fail('key', scrub(await response.text().catch(() => '')), response.status)
    if (response.status >= 300 && response.status < 400) {
      // 跳到 https 去了要说明白；别的跳转当地址不对
      const kind = redirectKind(listUrl, headerOf(response, 'location'))
      if (kind === 'https') return fail('https')
      return fail('redirect')
    }
    if (response.ok) {
      const bodyText = await response.text()
      const parsed = parseModels(bodyText)
      if (parsed && parsed.length > 0) {
        listed = true
        models = parsed
      }
    }
  } catch {
    // 列表连不上不在这报，接着发最小请求，按那边的结果说话
  }

  // 第二步：发一次最小请求。模型用传进来的，没传就用列表第一个，两样都没有就不发
  const useModel = chosen || models[0]?.id || null
  if (!useModel) {
    // 回得来但一个模型都没列出来：告诉用户手动加
    return {
      ok: true,
      listed,
      models,
      kind: 'nomodels',
      code: NO_MODEL_CODE,
      message: errorLine(stopKeyOf(NO_MODEL_CODE), NO_MODEL_CODE),
    }
  }
  try {
    const response = await fetchImpl(chatUrl, {
      method: 'POST',
      // 同样不跟着跳转走，理由一样
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    // 跳转：地址写了 http 而那边要 https，或者跳到别处去了，都说清楚
    if (response.status >= 300 && response.status < 400) {
      const kind = redirectKind(chatUrl, headerOf(response, 'location'))
      if (kind === 'https') return fail('https')
      return fail('redirect')
    }
    if (response.ok) return { ok: true, listed, models, message: t('common.probeOk') }
    const bodyText = await response.text().catch(() => '')
    return fail(classify(response.status), scrub(bodyText), response.status)
  } catch {
    return fail('network')
  }
}

// DeepSeek 钥匙的「测一下」：走它自己的 Anthropic 路线，就发一次最小请求。
export const DEEPSEEK_PROBE = { protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash' }
// 密钥框空着：桌伴自己查出来的，跟开工前没填密钥同一个码
const EMPTY_KEY_CODE = 'Si101'

export async function probeDeepseek({ key, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  // 空着点「测试并保存」：不发请求，直接说密钥没填（不然 DeepSeek 回一串英文原文）
  if (!String(key ?? '').trim()) {
    return { ok: false, kind: 'empty', code: EMPTY_KEY_CODE, raw: '', message: errorLine('probe.empty', EMPTY_KEY_CODE) }
  }
  return probeEndpoint({ ...DEEPSEEK_PROBE, key, fetchImpl, timeoutMs })
}
