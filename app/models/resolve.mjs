import { choiceValue, noDeepseekYaml, routesYaml, singleRequestYaml } from '../dsh/models.mjs'
import { loadCatalog } from './catalog.mjs'
import { KILO_KIND } from './kilo.mjs'
import { createConsent } from './consent.mjs'
import { keyBroken } from './keys.mjs'
import { t } from '../copy/copy.mjs'

// 算不通：带上错误码（Si）和停工那句用哪一条（app/copy/errors.mjs 的 stops），
// message 是填好的那句（新闻那边、日志里用）
function refuse(reason, code, stop, vars) {
  return { ok: false, reason, code, stop, ...(vars ? { vars } : {}), message: t(`stops.${stop}`, vars) }
}

// 找不到条目或模型（Si103）
function missing() {
  return refuse('missing', 'Si103', 'missing')
}

// 在清单里找条目。
function findEntry(catalog, entryId) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  return entries.find((entry) => entry && entry.id === entryId) || null
}

// 读 DeepSeek 的钥匙，读不到就是空串。
function readDeepseekKey(keyring) {
  if (!keyring || typeof keyring.read !== 'function') return ''
  try {
    return keyring.read('deepseek') || ''
  } catch {
    return ''
  }
}

// 有没有这把钥匙：DeepSeek 看读得出来，自定义看有没有存过。
export function hasKeyOf(keyring) {
  return (id) => {
    if (id === 'deepseek') return Boolean(readDeepseekKey(keyring))
    if (!keyring || typeof keyring.has !== 'function') return false
    try {
      return keyring.has(id) === true
    } catch {
      return false
    }
  }
}

// 干活前先算清楚：用哪个模型、能不能用、要交给 dsh 什么。
// 算不通就回一句人话，钥匙原文不出现在返回值和话里。
export function resolveModel({ choice, files, keyring, now = Date.now } = {}) {
  const catalog = loadCatalog(files?.catalog)
  const consent = createConsent({ file: files?.consent, now }).status()
  const fallback = catalog.default && typeof catalog.default === 'object' ? catalog.default : {}

  const entryId = choice?.entry ?? fallback.entry
  const entry = findEntry(catalog, entryId)
  if (!entry) return missing()

  const modelId = choice?.model ?? (entryId === fallback.entry ? fallback.model : entry.models?.[0]?.id)
  const model = (entry.models || []).find((item) => item && item.id === modelId)
  if (!model) return missing()

  const effort = choice?.effort !== undefined
    ? choice.effort
    : entryId === fallback.entry
      ? fallback.effort ?? null
      : null

  if (entry.kind === KILO_KIND) {
    if (consent.agreed !== true) return refuse('consent', 'Si102', 'consent')
  }

  if (entry.kind === 'deepseek') {
    if (keyBroken(keyring, 'deepseek')) return refuse('key', 'Si101', 'keyBroken')
    if (!readDeepseekKey(keyring)) return refuse('key', 'Si101', 'noKey', { vendor: entry.name || 'DeepSeek' })
  }

  if (entry.kind === 'custom') {
    if (keyBroken(keyring, entry.id)) return refuse('key', 'Si101', 'keyBroken')
    if (!hasKeyOf(keyring)(entry.id)) return refuse('key', 'Si101', 'noKey', { vendor: entry.name })
  }

  // DeepSeek 的钥匙照旧带：选了别家模型时，联网搜索也走 DeepSeek 的搜索接口。
  const apiKey = readDeepseekKey(keyring)
  // 自定义模型的钥匙只带这一轮选的那一家：一轮一个 dsh 进程，中途不换模型，别家的钥匙用不上。
  const env = entry.kind === 'custom' && keyring && typeof keyring.env === 'function' ? keyring.env([entry.id]) : {}
  const patchTexts = [routesYaml(catalog, { consented: consent.agreed === true })]
  // DeepSeek 路线（dsh 内置的 llm-deepseek）没钥匙时挂一份手写目录，别去官方列目录。
  // 重试策略不归桌伴管了：照 dsh 自己的默认。
  if (!apiKey) patchTexts.push(noDeepseekYaml())
  // 同时只能 1 个请求的模型：子智能体关掉，免得一轮里同时发好几个请求。
  if (model.singleConcurrent === true) patchTexts.push(singleRequestYaml())

  return {
    ok: true,
    apiKey,
    env,
    patchTexts,
    model: { value: choiceValue(entry.id, model.id), effort: effort ?? null },
    // 这一轮用的是哪个条目、哪个模型：排队（每把密钥的并发上限）按条目算
    entry: entry.id,
    modelId: model.id,
    vendor: entry.name,
  }
}
