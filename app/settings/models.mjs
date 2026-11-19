// 「模型」页的纯函数：每行显示什么，加上选默认、删钥匙、删条目三个动作。
// 不碰 electron，node --test 直接测。钥匙原文只留在 keyring，rows 和返回值里都不带。

import { addKilo, defaults, loadCatalog, removeEntry, removeModel as removeModelFromCatalog, saveCatalog, setDefault, updateEntry } from '../models/catalog.mjs'
import { createConsent } from '../models/consent.mjs'
import { KILO_ENTRY_ID } from '../models/kilo.mjs'
import { t } from '../copy/copy.mjs'

// 默认那条选不了（没同意、没钥匙）时，页面顶上提醒这一句
export const BROKEN_DEFAULT_TEXT = t('modelPage.warn')

// 圆点不能选时鼠标停上去的说明
const WHY_NOT_CONSENT = t('modelPage.needConsent')
const WHY_NOT_KEY = t('modelPage.needKey')

// 存着的钥匙读不出来时，那一行上写的话
const KEY_BROKEN_TEXT = t('modelPage.keyBroken')

// 条目的小字：DeepSeek 看钥匙，自定义看格式和模型数（几段之间用「，」，设置里的行不用「· 」隔开）
function noteOf(entry, kind, { withKey, agreed, consentVersion, broken, maskedKey }) {
  if (kind === 'kilo') return ''
  if (broken) return KEY_BROKEN_TEXT
  if (kind === 'deepseek') return withKey ? (maskedKey || t('modelPage.maskedKey')) : t('modelPage.noKey')
  const label = entry.protocol === 'anthropic' ? t('modelPage.formatAnthropic') : t('modelPage.formatOpenai')
  const count = (entry.models || []).length
  const parts = [label, t('modelPage.modelCount', { count })]
  if (!withKey) parts.push(t('modelPage.noKey'))
  return parts.join('，')
}

// 每行的数据：id、kind、name、note、tags（名字旁的小标）、withKey、isDefault、canBeDefault、whyNot、buttons。
// hasKey 是函数，consent 是同意状态。
export function modelRows({ catalog, hasKey, consent, brokenKey, maskedKey } = {}) {
  const base = catalog && Array.isArray(catalog.entries) ? catalog : defaults()
  const has = typeof hasKey === 'function' ? hasKey : () => false
  const isBroken = typeof brokenKey === 'function' ? brokenKey : () => false
  const agreed = consent?.agreed === true
  const consentVersion = consent?.version ?? null
  const rows = []
  for (const entry of base.entries) {
    if (!entry) continue
    const kind = entry.id === KILO_ENTRY_ID ? 'kilo' : entry.kind === 'deepseek' ? 'deepseek' : 'custom'
    const withKey = kind === 'kilo' ? true : has(entry.id) === true
    const broken = kind !== 'kilo' && isBroken(entry.id) === true
    const canBeDefault = kind === 'kilo' ? agreed : withKey && !broken
    const isDefault = base.default?.entry === entry.id
    const buttons = []
    if (kind === 'kilo') {
      buttons.push({ id: 'guide', label: t('modelPage.kiloGuide') })
      buttons.push({ id: 'remove', label: t('modelPage.remove') })
    }
    if (kind === 'deepseek' && withKey) {
      buttons.push({ id: 'change-key', label: t('modelPage.changeKey') })
      buttons.push({ id: 'remove-key', label: t('modelPage.removeKey') })
    }
    if (kind === 'custom') {
      buttons.push({ id: 'add-model', label: t('modelPage.addModel') })
      buttons.push({ id: 'remove', label: t('modelPage.remove') })
    }
    const tags = []
    if (kind === 'custom') tags.push(t('modelPage.tagCustom'))
    if (isDefault) tags.push(t('modelPage.tagDefault'))
    rows.push({
      id: entry.id,
      kind,
      agreed,
      name: entry.name || entry.id,
      note: noteOf(entry, kind, { withKey, agreed, consentVersion, broken, maskedKey: typeof maskedKey === 'function' ? maskedKey(entry.id) : maskedKey }),
      tags,
      withKey,
      broken,
      isDefault,
      canBeDefault,
      whyNot: canBeDefault ? null : broken ? KEY_BROKEN_TEXT : kind === 'kilo' ? WHY_NOT_CONSENT : WHY_NOT_KEY,
      // 这一条线路同一时间最多几个请求：0 表示不限。每个条目都能改。
      concurrency: Number.isInteger(entry.concurrency) && entry.concurrency > 0 ? entry.concurrency : 0,
      canSetConcurrency: true,
      // 这一把钥匙底下的模型：界面上一个一个列出来，各自带一个「改」
      models: kind === 'custom'
        ? (entry.models || []).map((model) => ({ id: model.id, name: model.name || model.id }))
        : [],
      buttons,
    })
  }
  return rows
}

// 「看说明」点了该干什么：没同意过（或同意的是以前那一版条款）先弹同意弹窗，
// 同意过就直接看「关于」页里的条款全文。row 是模型页那一行的数据。
export function guideAction(row) {
  return row?.agreed === true ? 'doc' : 'consent'
}

// 默认那一行选不了时提醒一句，能选就返回 null
export function rowsWarning(rows) {
  const row = (rows || []).find((item) => item && item.isDefault)
  return row && !row.canBeDefault ? BROKEN_DEFAULT_TEXT : null
}

// 动作返回的 rows 要跟页面刚画的一样：hasKey、同意状态缺哪样就现读哪样。
// removeKey / removeCustom 自带 keyring；chooseDefault 不碰钥匙，hasKey 由 view 传进来。
function viewOf(files, keyring, view) {
  const given = view && typeof view === 'object' ? view : {}
  return {
    hasKey:
      typeof given.hasKey === 'function' ? given.hasKey : (id) => keyring?.has(id) === true,
    consent: given.consent ?? createConsent({ file: files.consent }).status(),
  }
}

function answer(ok, message, catalog, view) {
  const rows = modelRows({ catalog, ...view })
  return { ok, message, rows, warning: rowsWarning(rows) }
}

// 选默认：圆点只挑条目，模型用该条目第一个，档位留空。选不了的（没同意、没钥匙）不写盘。
export function chooseDefault(files, id, view = {}) {
  const fresh = viewOf(files, null, view)
  const catalog = loadCatalog(files.catalog)
  const row = modelRows({ catalog, ...fresh }).find((item) => item.id === id)
  if (!row) return answer(false, '', catalog, fresh)
  if (!row.canBeDefault) return answer(false, row.whyNot || WHY_NOT_KEY, catalog, fresh)
  const entry = catalog.entries.find((item) => item && item.id === id)
  const first = entry && Array.isArray(entry.models) ? entry.models[0] : null
  const picked = first ? setDefault(catalog, { entry: id, model: first.id, effort: null }) : null
  if (!picked || !picked.ok) {
    return answer(false, picked ? picked.errors[0] : '', catalog, fresh)
  }
  saveCatalog(files.catalog, picked.catalog)
  return answer(true, '', picked.catalog, fresh)
}

// 删一把钥匙：条目留在清单里，那一行变回「还没填钥匙」；删的是默认条目时顶上提醒。
export function removeKey(files, keyring, id, view = {}) {
  const fresh = viewOf(files, keyring, view)
  const catalog = loadCatalog(files.catalog)
  keyring.remove(id)
  return answer(true, '', catalog, fresh)
}

// 删一条自定义：先删条目再删钥匙；删的是默认时默认按 removeEntry 的规矩回到 DeepSeek。
export function removeCustom(files, keyring, id, view = {}) {
  const fresh = viewOf(files, keyring, view)
  const catalog = loadCatalog(files.catalog)
  const removed = removeEntry(catalog, id)
  if (!removed.ok) return answer(false, removed.errors[0], catalog, fresh)
  keyring.remove(id)
  saveCatalog(files.catalog, removed.catalog)
  return answer(true, '', removed.catalog, fresh)
}

// 删 Kilo：条目删掉，同时把用户对使用须知的两个同意撤回来（再加回来要重新同意）。
export function removeKilo(files, view = {}) {
  const fresh = viewOf(files, null, view)
  const catalog = loadCatalog(files.catalog)
  const removed = removeEntry(catalog, KILO_ENTRY_ID)
  if (!removed.ok) return answer(false, removed.errors[0], catalog, fresh)
  saveCatalog(files.catalog, removed.catalog)
  createConsent({ file: files.consent }).withdraw()
  return answer(true, '', removed.catalog, { ...fresh, consent: createConsent({ file: files.consent }).status() })
}

// 加回 Kilo：地址和模型照代码常量写。
export function addKiloEntry(files, view = {}) {
  const fresh = viewOf(files, null, view)
  const catalog = loadCatalog(files.catalog)
  const added = addKilo(catalog)
  if (!added.ok) return answer(false, added.errors[0], catalog, fresh)
  saveCatalog(files.catalog, added.catalog)
  return answer(true, '', added.catalog, fresh)
}

// 删一个模型（条目留着，钥匙也留着）：这个模型没了。
export function removeModel(files, id, modelId, view = {}) {
  const fresh = viewOf(files, null, view)
  const catalog = loadCatalog(files.catalog)
  const removed = removeModelFromCatalog(catalog, id, modelId)
  if (!removed.ok) return answer(false, removed.errors[0], catalog, fresh)
  saveCatalog(files.catalog, removed.catalog)
  return answer(true, '', removed.catalog, fresh)
}

// 改一把密钥的并发上限：0 表示不限。
export function setConcurrency(files, id, value, view = {}) {
  const fresh = viewOf(files, null, view)
  const catalog = loadCatalog(files.catalog)
  const num = Number(value)
  const limit = Number.isInteger(num) && num >= 0 ? num : 0
  const updated = updateEntry(catalog, id, { concurrency: limit })
  if (!updated.ok) return answer(false, updated.errors[0], catalog, fresh)
  saveCatalog(files.catalog, updated.catalog)
  return answer(true, '', updated.catalog, fresh)
}
