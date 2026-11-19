// 「加一个自定义模型」弹窗的纯逻辑：表单怎么校验、预设怎么填字段、
// 「测试并保存」怎么走。不引 electron，node --test 直接测。
// 钥匙原文只在 testAndSave 和 probeInput 内部用一下，不进返回值、不进 rows。

import { EFFORTS, EFFORT_LABELS, PRESETS, THINKING_FORMATS, addCustom, loadCatalog, normalizeModel, saveCatalog, updateEntry } from '../models/catalog.mjs'
import { createConsent } from '../models/consent.mjs'
import { modelRows } from './models.mjs'
import { t } from '../copy/copy.mjs'
import { errorLine, errorLineText } from '../copy/line.mjs'

// 没填模型 ID 时保存按钮的说明，也是 testAndSave 的回话
export const NO_MODEL_TEXT = t('custom.needId')
export const NO_KEY_TEXT = t('custom.keyRequired')

// 探测没通时，哪些还照存：上游忙这类是「那边的事」，地址和模型名没写错，照样存下来；
// 钥匙不对、地址不对、连不上这些存了也是错的，不存。
const SAVEABLE_KINDS = new Set(['busy', 'other'])
// 测一下没测通、又说不出是哪儿：一句「测试失败」加通用的那个码（Si901）
const PROBE_FAIL_LINE = errorLine('stops.probeFailed', 'Si901')
// 存不上：这一类只有这一句、这一个码（Si907）
const SAVE_FAILED_LINE = errorLineText(t('stops.saveFailed'), 'Si907')
// 存下来了但没测通，给用户一句交代：那边忙这类，把那边的原话摆出来
const SAVED_NOTES = {
  busy: 'custom.savedWithError',
  other: 'custom.savedFailed',
}

// 空表单：新建弹窗从这里起步。一个条目一个模型：标准三项都在 model 里。
// mode 有三种：new 新建一个条目、edit 改这个条目里的某个模型、add 给这个条目再加一个模型。
export function blankForm() {
  return {
    id: null,
    entryId: null,
    modelIndex: null,
    mode: 'new',
    preset: null,
    name: '',
    protocol: 'openai',
    baseUrl: '',
    key: '',
    model: blankModel(),
  }
}

// 空模型行：标准三项都没填
export function blankModel() {
  return {
    id: '',
    name: '',
    contextWindow: null,
    maxTokens: null,
    efforts: [],
    effortValues: {},
    vision: false,
    thinkingFormat: null,
  }
}

function formOf(form) {
  return { ...blankForm(), ...(form && typeof form === 'object' ? form : {}) }
}

function modelOf(form) {
  const base = formOf(form)
  const model = base.model && typeof base.model === 'object' ? base.model : blankModel()
  return {
    ...blankModel(),
    ...model,
    efforts: Array.isArray(model.efforts) ? model.efforts : [],
    effortValues: model.effortValues && typeof model.effortValues === 'object' ? { ...model.effortValues } : {},
  }
}

// 选预设：名称/格式/地址照预设填好；预设带的模型行填进标准三项。
// 「自己填」（presetName 为 null）只把预设标记清掉，不动已经填的字段。
export function applyPreset(form, presetName) {
  const base = formOf(form)
  if (presetName == null) return { ...base, preset: null }
  const preset = PRESETS[presetName]
  if (!preset) return { ...base, preset: null }
  const model = Array.isArray(preset.models) && preset.models.length > 0 ? preset.models[0] : blankModel()
  return {
    ...base,
    preset: presetName,
    name: typeof preset.name === 'string' ? preset.name : '',
    protocol: preset.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: typeof preset.baseUrl === 'string' ? preset.baseUrl : '',
    model: { ...blankModel(), ...normalizeModel(model) },
  }
}

// 表单拼成清单条目的输入：模型只有这一个，preset 一起带上，addCustom 拿它起条目 id。
export function formToEntry(form) {
  const base = formOf(form)
  const model = normalizeModel(modelOf(base))
  return {
    preset: base.preset ?? null,
    name: typeof base.name === 'string' ? base.name : '',
    protocol: base.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: typeof base.baseUrl === 'string' ? base.baseUrl : '',
    models: [model],
  }
}

// 标准三项缺了哪几项：模型 ID、上下文窗口、最大输出。空数组是齐了。
// 预设带来的表单不用用户填（那几个数是我们自己写的）。
export function missingFields(form) {
  const base = formOf(form)
  // 预设带来的表单不用用户填（那几个数是我们自己写的）；给已有条目加模型时照旧必填
  if (base.preset && base.mode !== 'add') return []
  const model = modelOf(base)
  const out = []
  if (typeof model.id !== 'string' || model.id.trim() === '') out.push('id')
  if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0) out.push('contextWindow')
  if (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0) out.push('maxTokens')
  return out
}

// 缺的那几项要用户补的话：返回第一句该说的话
export function missingText(form) {
  const missing = missingFields(form)
  if (missing.length === 0) return ''
  if (missing.includes('id')) return t('custom.needId')
  if (missing.includes('contextWindow')) return t('custom.needContext')
  return t('custom.needMaxOutput')
}

// 上下文那一小格的字：「上下文 128000」，没数写「按默认」
export function contextLabel(value) {
  if (value == null) return t('custom.byDefault')
  const num = Number(value)
  if (!Number.isInteger(num) || num <= 0) return t('custom.byDefault')
  return t('custom.contextTokens', { count: num })
}

// 「模型设置」改完：把值合回模型。
export function editModel(model, values) {
  const base = normalizeModel(model)
  const src = values && typeof values === 'object' ? values : {}
  const id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : base.id
  return normalizeModel({
    ...base,
    id,
    name: src.name === undefined ? base.name : String(src.name),
    contextWindow: src.contextWindow === undefined ? base.contextWindow : src.contextWindow,
    maxTokens: src.maxTokens === undefined ? base.maxTokens : src.maxTokens,
    efforts: Array.isArray(src.efforts) ? src.efforts : base.efforts,
    effortValues: src.effortValues && typeof src.effortValues === 'object' ? src.effortValues : base.effortValues,
    vision: src.vision === undefined ? base.vision : src.vision === true,
    thinkingFormat: src.thinkingFormat === undefined ? base.thinkingFormat : src.thinkingFormat,
  })
}

// 「测试并保存」能不能点：标准三项都填了，而且不在忙。
export function canSave(state) {
  return missingFields(state?.form).length === 0 && state?.busy !== true
}

// 已存的钥匙：读不到（没有、解不开、id 不合法）都当没有
function storedKey(keyring, id) {
  if (!id || !keyring) return ''
  try {
    const text = keyring.read(id)
    return text ? String(text) : ''
  } catch {
    return ''
  }
}

// 「测一下」的入参：改已有的时空着就带上已存的钥匙去测。
export function probeInput(form, keyring) {
  const base = formOf(form)
  const key = String(base.key ?? '').trim() || storedKey(keyring, base.id)
  return {
    protocol: base.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: typeof base.baseUrl === 'string' ? base.baseUrl : '',
    key,
    model: modelOf(base).id,
  }
}

// 打开弹窗要的表单：新建给空表单；改已有模型把条目字段和那个模型都填好，钥匙框空着；
// 加模型（mode 是 add）把条目字段填好，模型那几项空着。
export function customForm(catalog, id, options = {}) {
  if (id == null || id === '') return { ok: true, form: blankForm() }
  const base = catalog && Array.isArray(catalog.entries) ? catalog : null
  const entry = base ? base.entries.find((item) => item && item.id === id && item.kind === 'custom') : null
  if (!entry) return { ok: false, form: null, message: '' }
  const models = Array.isArray(entry.models) ? entry.models : []
  const adding = options?.mode === 'add'
  const wanted = Number.isInteger(options?.modelIndex) ? options.modelIndex : 0
  const editing = !adding && wanted >= 0 && wanted < models.length
  const model = editing ? models[wanted] : blankModel()
  return {
    ok: true,
    form: {
      id: entry.id,
      entryId: entry.id,
      modelIndex: editing ? wanted : null,
      mode: adding ? 'add' : 'edit',
      preset: typeof entry.preset === 'string' ? entry.preset : null,
      name: typeof entry.name === 'string' ? entry.name : '',
      protocol: entry.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : '',
      key: '',
      model: { ...blankModel(), ...normalizeModel(model) },
    },
  }
}

// 弹窗打开时要的整包数据：表单加上思考档位和思考参数格式的选项。
// 页面在沙箱里引不了带 node 的模块，这些数据只能从主进程带过去，这里先折成普通的字和数组。
export function dialogPayload(catalog, id, options) {
  const back = customForm(catalog, id, options)
  if (!back.ok) return back
  return {
    ok: true,
    form: back.form,
    efforts: EFFORTS.map((effort) => ({ id: effort, label: EFFORT_LABELS[effort] })),
    thinkingFormats: THINKING_FORMATS.slice(),
  }
}

// 跟 models.mjs 一个口径的 view：动作返回的 rows 要跟页面刚画的一样
function viewOf(files, keyring) {
  return {
    hasKey: (id) => keyring?.has(id) === true,
    consent: createConsent({ file: files.consent }).status(),
  }
}

// 改完之后清单长什么样（不写盘）：加条目、改条目、给条目加模型，都在这儿算。
// 设置那边拿它跟现在的清单比：看这次改动要不要重起 dsh。
export function catalogAfter(catalog, form) {
  const base = formOf(form)
  const input = formToEntry(base)
  if (base.id) {
    const entry = (catalog?.entries || []).find((item) => item && item.id === base.id)
    if (!entry) return { ok: false, errors: [t('common.badConfig')], detail: `no entry: ${base.id}` }
    const models = Array.isArray(entry.models) ? entry.models.map((item) => ({ ...item })) : []
    const index = Number.isInteger(base.modelIndex) ? base.modelIndex : 0
    const editing = base.mode !== 'add'
    if (editing && (index < 0 || index >= models.length)) return { ok: false, errors: [t('common.badConfig')], detail: 'bad model index' }
    if (editing) models[index] = normalizeModel(input.models[0])
    else models.push(normalizeModel(input.models[0]))
    // 改模型时条目本身的字段跟着改；加模型时只添模型，条目不动。
    const patch = editing
      ? { name: input.name, protocol: input.protocol, baseUrl: input.baseUrl, models }
      : { models }
    const { preset, ...rest } = patch
    const updated = updateEntry(catalog, base.id, rest)
    if (!updated.ok) return { ok: false, errors: updated.errors, detail: updated.detail }
    return { ok: true, catalog: updated.catalog }
  }
  const added = addCustom(catalog, input)
  if (!added.ok) return { ok: false, errors: added.errors, detail: added.detail }
  return { ok: true, catalog: added.catalog }
}

// 「测试并保存」：先用这个模型测，通了才写；存钥匙先于写清单，免得留下没钥匙的半截条目。
// 改已有的钥匙框空着就用原来的钥匙测，也只有填了新钥匙才换。
// guard：存之前问一句「这次改动要不要重起 dsh」（问过了就照旧存）。
export async function testAndSave(files, keyring, form, { probe, guard } = {}) {
  const base = formOf(form)
  const view = viewOf(files, keyring)
  // detail：清单校验哪条没过（英文短句），设置窗记进日志，界面只说那一类
  const fail = (message, detail = '') => ({ ok: false, message, detail, rows: modelRows({ catalog: loadCatalog(files.catalog), ...view }) })

  const missing = missingText(base)
  if (missing) return fail(missing)

  const input = formToEntry(base)
  const newKey = String(base.key ?? '').trim()
  const key = newKey || storedKey(keyring, base.id)
  if (!key) return fail(NO_KEY_TEXT)

  if (typeof probe !== 'function') return fail(t('custom.probeMissing'))
  let probed
  try {
    probed = await probe({ protocol: input.protocol, baseUrl: input.baseUrl, key, model: input.models[0].id })
  } catch {
    return fail(PROBE_FAIL_LINE)
  }
  // 只是那边忙或者余额不够：配置存下来，回一句「测试成功，模型返回…」
  let note = ''
  if (!probed || probed.ok !== true) {
    const kind = probed && probed.kind
    if (!SAVEABLE_KINDS.has(kind)) return fail((probed && probed.message) || PROBE_FAIL_LINE)
    const key = SAVED_NOTES[kind] || SAVED_NOTES.other
    note = key === 'custom.savedWithError'
      ? t(key, { error: (probed && (probed.raw || probed.message)) || '' })
      : t(key)
  }

  const catalog = loadCatalog(files.catalog)
  // 改完的清单先算出来（还不写盘）：要不要重起 dsh 要拿它跟现在的比
  const next = catalogAfter(catalog, base)
  if (!next.ok) return fail(next.errors[0] || SAVE_FAILED_LINE, next.detail)
  // 新加的条目：它的钥匙也是新的（这把钥匙刚配上）
  const added = (next.catalog.entries || []).find((item) => item && !(catalog.entries || []).some((old) => old && old.id === item.id))
  const keyTarget = base.id || (added ? added.id : '')
  // 有人正在跑、这次改动要重起 dsh：先问一句（问过了就照旧存）
  const asked = await guard?.({
    catalog: next.catalog,
    keys: newKey && keyTarget ? { [keyTarget]: newKey } : {},
  })
  if (asked && asked.ask) return { ok: false, ask: asked.ask, message: '', rows: modelRows({ catalog, ...view }) }
  // 清单先写：钥匙的密文存在清单里对应的那一条上，那一条得先在
  try {
    saveCatalog(files.catalog, next.catalog)
  } catch {
    return fail(SAVE_FAILED_LINE)
  }
  if (base.id) {
    if (newKey) {
      const saved = keyring.save(base.id, newKey)
      if (!saved.ok) return fail(saved.message)
    }
  } else {
    const saved = keyring.save(keyTarget, key)
    if (!saved.ok) return fail(saved.message)
  }
  return { ok: true, message: note, rows: modelRows({ catalog: next.catalog, ...view }) }
}
