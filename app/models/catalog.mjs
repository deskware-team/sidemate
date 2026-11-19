import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { t } from '../copy/copy.mjs'
import { KILO_CONCURRENCY, KILO_ENTRY_ID, KILO_KIND, KILO_MODEL_ID, kiloEntry } from './kilo.mjs'

// 思考档位：只认 pi-ai 认得的那几档，efforts 字段只能是它的子集，并按这个顺序排。
export const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export const EFFORT_LABELS = {
  off: t('catalog.effortOff'),
  minimal: t('catalog.effortMinimal'),
  low: t('catalog.effortLow'),
  medium: t('catalog.effortMedium'),
  high: t('catalog.effortHigh'),
  xhigh: t('catalog.effortXhigh'),
  max: t('catalog.effortMax'),
}

// 思考参数格式：pi-ai 的 compat.thinkingFormat 认得的这几个，「自动」就是不写这一项。
export const THINKING_FORMATS = [
  'ant-ling',
  'baseten',
  'chat-template',
  'deepseek',
  'openai',
  'openrouter',
  'qwen',
  'qwen-chat-template',
  'string-thinking',
  'together',
  'zai',
]

// 自定义条目的预设：给 addCustom 补空缺字段用，本身不进初始清单。
export const PRESETS = {
  zhipu: {
    name: t('custom.providerZhipu'),
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    // 智谱的默认文字模型是 GLM-4.7-Flash（面向智能体和工具调用，200K 上下文；收费以智谱官方公告为准）。
    // 这个模型同一把钥匙同时只能有 1 个请求在路上，标上 singleConcurrent。
    concurrency: 1,
    models: [
      { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200000, singleConcurrent: true },
    ],
  },
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0
}

// 并发上限：0 表示不限；不是整数的按这条线路的默认来（Kilo 1，其余不限）。
function normalizeConcurrency(value, kind) {
  const num = Number(value)
  if (Number.isInteger(num) && num >= 0) return num
  return kind === KILO_KIND ? KILO_CONCURRENCY : 0
}

// 每档思考的「发送值」：只留模型自己有的那几档，值是发给对方的写法。
function normalizeEffortValues(values, efforts) {
  const src = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
  const out = {}
  for (const effort of efforts) {
    if (!Object.prototype.hasOwnProperty.call(src, effort)) continue
    out[effort] = String(src[effort] ?? '')
  }
  return out
}

// 补齐模型的默认值：name 缺省等于 id，数字缺省 null（跟着对方目录走），
// efforts 只留认识的档位并按固定顺序排，多余字段不进清单。
export function normalizeModel(m) {
  const src = m && typeof m === 'object' ? m : {}
  const id = typeof src.id === 'string' ? src.id : ''
  const efforts = EFFORTS.filter((effort) => Array.isArray(src.efforts) && src.efforts.includes(effort))
  return {
    id,
    name: typeof src.name === 'string' && src.name.trim() ? src.name : id,
    contextWindow: isPositiveInt(src.contextWindow) ? src.contextWindow : null,
    maxTokens: isPositiveInt(src.maxTokens) ? src.maxTokens : null,
    efforts,
    effortValues: normalizeEffortValues(src.effortValues, efforts),
    vision: src.vision === true,
    // 思考参数格式：pi-ai 的 compat.thinkingFormat，不认识的值丢掉
    thinkingFormat: THINKING_FORMATS.includes(src.thinkingFormat) ? src.thinkingFormat : null,
    // 这把钥匙同时只能有 1 个请求在路上（智谱的 GLM-4.7-Flash）
    singleConcurrent: src.singleConcurrent === true,
    auto: src.auto && typeof src.auto === 'object' && !Array.isArray(src.auto) ? { ...src.auto } : {},
  }
}

// 补齐条目的默认值：种类只有三种，别的当自定义；并发上限按种类补。
export function normalizeEntry(entry) {
  const src = entry && typeof entry === 'object' ? entry : {}
  const kind = src.kind === 'deepseek' || src.kind === KILO_KIND ? src.kind : 'custom'
  // keyless 那个字段没有了（旧清单里还带着的，读进来就丢掉）
  const { keyless, ...rest } = src
  return {
    ...rest,
    kind,
    concurrency: normalizeConcurrency(src.concurrency, kind),
    models: (Array.isArray(src.models) ? src.models : []).map(normalizeModel),
  }
}

// 内置那条 DeepSeek：地址和能力都写死，删不掉。
function deepseekEntry() {
  return {
    id: 'deepseek',
    kind: 'deepseek',
    name: 'DeepSeek',
    protocol: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    concurrency: 0,
    models: [normalizeModel({ id: 'deepseek-flash', name: 'DeepSeek', vision: true, efforts: ['off', 'low', 'high', 'max'] })],
  }
}

export function defaults() {
  return {
    version: 1,
    default: { entry: 'deepseek', model: 'deepseek-flash', effort: null },
    entries: [normalizeEntry(kiloEntry()), deepseekEntry()],
  }
}

// 只认 https 地址；本机调试用的 http://localhost 和 http://127.0.0.1 放行。
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#].*)?$/i

function httpsOnly(url) {
  if (typeof url !== 'string' || url === '') return false
  if (/^https:\/\//i.test(url)) return true
  return LOCAL_HTTP.test(url)
}

// 条目或模型上出现名字带 key / secret / token 的字段就算夹带钥匙；
// maxTokens 是设置项，名字撞上了但不是钥匙本身。
const SECRET_WORDS = ['key', 'secret', 'token']
const NOT_SECRET_NAMES = ['maxTokens']

function holdsSecrets(value) {
  if (!value || typeof value !== 'object') return false
  return Object.keys(value).some(
    (name) =>
      !NOT_SECRET_NAMES.includes(name) &&
      SECRET_WORDS.some((word) => name.toLowerCase().includes(word)),
  )
}

// 一个条目哪儿不合格：[{ text, detail }]。界面只说要用户照着改的那几句（名称、网址、至少一个模型、
// 模型 id 重复），别的都说「配置错误」；哪条规矩没过的英文短句（detail）进日志。
function entryProblems(entry) {
  if (!entry || typeof entry !== 'object') return [{ text: t('common.badConfig'), detail: 'entry is not an object' }]
  const out = []
  const bad = (text, detail) => out.push({ text, detail })
  if (entry.protocol !== 'openai' && entry.protocol !== 'anthropic') bad(t('common.badConfig'), `bad protocol: ${entry.protocol}`)
  if (!httpsOnly(entry.baseUrl)) bad(t('common.badUrl'), 'baseUrl is not https')
  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (name.length < 1 || name.length > 20) bad(t('common.badName'), 'name length not 1-20')
  const models = Array.isArray(entry.models) ? entry.models : []
  if (entry.kind === 'custom' && models.length === 0) bad(t('catalog.needModel'), 'no models')
  if (holdsSecrets(entry) || models.some(holdsSecrets)) bad(t('common.badConfig'), 'holds a key field')
  const seen = new Set()
  for (const model of models) {
    const id = model && typeof model === 'object' && typeof model.id === 'string' ? model.id.trim() : ''
    if (!id) bad(t('common.badConfig'), 'model without id')
    else if (seen.has(id)) bad(t('catalog.dupModelId'), `duplicate model id: ${id}`)
    else seen.add(id)
    if (model && Array.isArray(model.efforts)) {
      const unknown = model.efforts.find((effort) => !EFFORTS.includes(effort))
      if (unknown !== undefined) bad(t('common.badConfig'), `unknown effort: ${unknown}`)
    }
    for (const field of ['contextWindow', 'maxTokens']) {
      const value = model ? model[field] : undefined
      if (value != null && !isPositiveInt(value)) bad(t('common.badConfig'), `${field} is not a positive integer: ${id}`)
    }
  }
  return out
}

// 校验一个条目，返回中文错误数组（去重），空数组就是没问题。
export function validateEntry(entry) {
  return [...new Set(entryProblems(entry).map((one) => one.text))]
}

// 校验没过时那几条的细节，一行（进日志）
export function entryDetail(entry) {
  return entryProblems(entry).map((one) => one.detail).join('; ')
}

function entriesOf(catalog) {
  return catalog && Array.isArray(catalog.entries) ? catalog : defaults()
}

// 取第一个非空值，都不合用就给空串，让校验去报错。
function pickFilled(...values) {
  for (const value of values) {
    if (value != null && value !== '') return value
  }
  return ''
}

// 重名就往后排：c-zhipu、c-zhipu-2、c-zhipu-3……
function nextId(entries, base) {
  const taken = new Set(entries.map((entry) => (entry && typeof entry === 'object' ? entry.id : null)))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`
    if (!taken.has(id)) return id
  }
}

// 加一条自定义：有 preset 就用预设补空缺字段；校验不过不动清单。
export function addCustom(catalog, input) {
  const base = entriesOf(catalog)
  const presetName = input && typeof input.preset === 'string' && PRESETS[input.preset] ? input.preset : null
  const preset = presetName ? PRESETS[presetName] : {}
  const models = Array.isArray(input?.models) ? input.models : Array.isArray(preset.models) ? preset.models : []
  const id = nextId(base.entries, presetName ? `c-${presetName}` : 'custom')
  const entry = {
    id,
    kind: 'custom',
    // 从哪个预设来的记着：改这个条目时那几项还是我们写的，不用用户重填
    preset: presetName,
    name: pickFilled(input?.name, preset.name),
    protocol: pickFilled(input?.protocol, preset.protocol),
    baseUrl: pickFilled(input?.baseUrl, preset.baseUrl),
    concurrency: normalizeConcurrency(input?.concurrency ?? preset.concurrency, 'custom'),
    models: models.map((model) => ({ ...model })),
  }
  const errors = validateEntry(entry)
  if (errors.length > 0) return { ok: false, catalog: base, id, errors, detail: entryDetail(entry) }
  entry.models = entry.models.map(normalizeModel)
  return { ok: true, catalog: { ...base, entries: [...base.entries, entry] }, id, errors: [] }
}

// 改一条：id 不许改；补丁校验不过就原样退回。
export function updateEntry(catalog, id, patch) {
  const base = entriesOf(catalog)
  const index = base.entries.findIndex((entry) => entry && entry.id === id)
  if (index < 0) return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `no entry: ${id}` }
  const rest = { ...(patch && typeof patch === 'object' ? patch : {}) }
  delete rest.id
  const next = { ...base.entries[index], ...rest }
  if (Array.isArray(next.models)) next.models = next.models.map(normalizeModel)
  next.concurrency = normalizeConcurrency(next.concurrency, next.kind)
  const errors = validateEntry(next)
  if (errors.length > 0) return { ok: false, catalog: base, errors, detail: entryDetail(next) }
  const entries = base.entries.slice()
  entries[index] = next
  return { ok: true, catalog: { ...base, entries }, errors: [] }
}

// 删一条：DeepSeek 是内置的，删不掉；删的正好是默认时默认回到 DeepSeek。
export function removeEntry(catalog, id) {
  const base = entriesOf(catalog)
  if (id === 'deepseek') return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `built-in entry: ${id}` }
  const index = base.entries.findIndex((entry) => entry && entry.id === id)
  if (index < 0) return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `no entry: ${id}` }
  const entries = base.entries.filter((entry) => entry.id !== id)
  const fallback =
    base.default && base.default.entry === id
      ? { entry: 'deepseek', model: 'deepseek-flash', effort: null }
      : base.default
  return { ok: true, catalog: { ...base, entries, default: fallback }, errors: [] }
}

// 删一个模型（条目留着）：删掉的就是清单里那个模型 id。
// 条目里一个模型都不剩时，那条条目留着（校验会拦，页面会报错）。
export function removeModel(catalog, entryId, modelId) {
  const base = entriesOf(catalog)
  const index = base.entries.findIndex((entry) => entry && entry.id === entryId)
  if (index < 0) return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `no entry: ${entryId}` }
  const entry = base.entries[index]
  const models = Array.isArray(entry.models) ? entry.models : []
  if (!models.some((one) => one && one.id === modelId)) {
    return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `no model: ${modelId}` }
  }
  const next = { ...entry, models: models.filter((one) => one && one.id !== modelId) }
  const errors = validateEntry(next)
  if (errors.length > 0) return { ok: false, catalog: base, errors, detail: entryDetail(next) }
  const entries = base.entries.slice()
  entries[index] = next
  return { ok: true, catalog: { ...base, entries }, errors: [] }
}

// 加一条 Kilo：删掉以后还能加回来（地址和模型照代码常量写）。
export function addKilo(catalog) {
  const base = entriesOf(catalog)
  if (base.entries.some((entry) => entry && entry.id === KILO_ENTRY_ID)) {
    return { ok: true, catalog: base, id: KILO_ENTRY_ID, errors: [] }
  }
  return { ok: true, catalog: { ...base, entries: [...base.entries, normalizeEntry(kiloEntry())] }, id: KILO_ENTRY_ID, errors: [] }
}

// 这条线路同一时间最多几个请求：0 表示不限。取不到就按不限算。
export function limitOf(catalog, entryId) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  const entry = entries.find((one) => one && one.id === entryId)
  const num = Number(entry?.concurrency)
  return Number.isInteger(num) && num > 0 ? num : 0
}

// 设默认：条目和模型都要在清单里；effort 为 null 或这个模型支持。
export function setDefault(catalog, choice) {
  const base = entriesOf(catalog)
  const entry = base.entries.find((item) => item && item.id === choice?.entry)
  if (!entry) return { ok: false, catalog: base, errors: [] }
  const model = (entry.models || []).find((item) => item && item.id === choice?.model)
  if (!model) return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `no model: ${choice?.model}` }
  const effort = choice?.effort == null ? null : choice.effort
  if (effort != null && !(Array.isArray(model.efforts) && model.efforts.includes(effort))) {
    return { ok: false, catalog: base, errors: [t('common.badConfig')], detail: `effort not supported: ${effort}` }
  }
  return { ok: true, catalog: { ...base, default: { entry: entry.id, model: model.id, effort } }, errors: [] }
}

// 现在能选的模型：Kilo 要用户点过同意；其他的要有钥匙。
export function usable(catalog, options) {
  const base = entriesOf(catalog)
  const hasKey = typeof options?.hasKey === 'function' ? options.hasKey : () => false
  const consented = options?.consented === true
  const list = []
  for (const entry of base.entries) {
    if (!entry) continue
    const allowed = entry.kind === KILO_KIND ? consented : hasKey(entry.id) === true
    if (!allowed) continue
    for (const model of entry.models || []) {
      if (!model) continue
      list.push({
        entry: entry.id,
        model: model.id,
        name: model.name || model.id,
        efforts: Array.isArray(model.efforts) ? model.efforts.slice() : [],
      })
    }
  }
  return list
}

// 读清单：文件缺了或坏了回初始清单；DeepSeek 缺了补上，模型补齐默认值。
// Kilo 删掉就是删掉了，不补回来。旧清单里那条线路换成 Kilo 那条。
export function loadCatalog(file) {
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return defaults()
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return defaults()
  const entries = raw.entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => (entry.id === 'free' || entry.kind === KILO_KIND ? normalizeEntry(kiloEntry()) : normalizeEntry(entry)))
  const known = new Set(entries.map((entry) => entry.id))
  if (!known.has('deepseek')) entries.push(deepseekEntry())
  const rawDefault = raw.default
  // 旧清单的默认那条指着 free：换成 Kilo 那条
  const rawEntry = rawDefault && typeof rawDefault === 'object' && typeof rawDefault.entry === 'string'
    ? rawDefault.entry
    : ''
  const rawModel = rawDefault && typeof rawDefault === 'object' && typeof rawDefault.model === 'string'
    ? rawDefault.model
    : ''
  const picked =
    rawEntry
      ? {
          entry: rawEntry === 'free' ? KILO_ENTRY_ID : rawEntry,
          model: rawEntry === 'free' ? KILO_MODEL_ID : rawModel,
          effort: rawDefault.effort == null ? null : rawDefault.effort,
        }
      : defaults().default
  return { version: 1, default: picked, entries }
}

// 密文存在条目自己身上（字段名 sealed，由 app/models/keys.mjs 写）。
// 这个字段不进界面：给渲染进程的清单里不能带密文。
export function stripSecrets(catalog) {
  const base = catalog && typeof catalog === 'object' ? catalog : {}
  const entries = Array.isArray(base.entries) ? base.entries : []
  return {
    ...base,
    entries: entries.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const { sealed, ...rest } = entry
      return rest
    }),
  }
}

// 存清单：每条先过校验，有一条不过就抛错不写盘；先写临时文件再改名顶上。
// 盘上已有的密文（sealed）留着：清单里没带密文时不能把它抹掉。
export function saveCatalog(file, catalog) {
  const entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : []
  for (const entry of entries) {
    const errors = validateEntry(entry)
    if (errors.length > 0) throw new Error(`${errors[0]}: ${entryDetail(entry)}`)
  }
  const kept = sealedOnDisk(file)
  const merged = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    if (entry.sealed !== undefined && entry.sealed !== '') return entry
    const old = kept.get(entry.id)
    return old ? { ...entry, sealed: old } : entry
  })
  const out = { ...(catalog && typeof catalog === 'object' ? catalog : {}), entries: merged }
  const tmp = `${file}.tmp`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

// 盘上每一条已有的密文：id → 密文
function sealedOnDisk(file) {
  const out = new Map()
  let raw = null
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return out
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string') continue
    if (typeof entry.sealed === 'string' && entry.sealed !== '') out.set(entry.id, entry.sealed)
  }
  return out
}
