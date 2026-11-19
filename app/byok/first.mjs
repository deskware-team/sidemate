// 首次运行第二步「先选一个模型」的纯逻辑：哪一步、按钮能不能点、成了以后设哪个默认。
// 不引 electron，node --test 直接测；钥匙原文只在参数里过一趟，不进返回值。

import { addKilo, loadCatalog, saveCatalog, setDefault } from '../models/catalog.mjs'
import { KILO_ENTRY_ID, KILO_MODEL_ID } from '../models/kilo.mjs'
import { t } from '../copy/copy.mjs'
import { applyPreset, blankForm, testAndSave } from '../settings/custom.mjs'

// 成了以后设的默认：DeepSeek 和 Kilo 是内置的两条，固定写死
export function deepseekChoice() {
  return { entry: 'deepseek', model: 'deepseek-flash', effort: null }
}

export function kiloChoice() {
  return { entry: KILO_ENTRY_ID, model: KILO_MODEL_ID, effort: null }
}

// 智谱新条目里那个默认模型：GLM-4.7-Flash 会调工具，老的 GLM-4-Flash 只会编正文
const ZHIPU_MODEL = 'glm-4.7-flash'

// 要不要走首次运行：模型能用、开场也放过，就不用了
export function needFirstRun({ ready, introPlayed } = {}) {
  return !(ready === true && introPlayed === true)
}

// 模型配好了没有：看 resolveModel 的结果。
export function modelConfigured(result) {
  if (!result || typeof result !== 'object') return false
  return result.ok === true
}

// 开窗先摆哪一步：模型能用但开场没放过，直接补开场；否则从「关于桌伴」看起
export function firstStep({ ready, introPlayed } = {}) {
  return ready === true && introPlayed !== true ? 'intro' : 'about'
}

// 「测一下」「用它开始」能不能点：贴了钥匙而且不在忙
export function canSubmit(key, busy) {
  return busy !== true && String(key ?? '').trim() !== ''
}

// 智谱的表单：预设填好地址和模型，再带上钥匙
export function zhipuForm(key) {
  return { ...applyPreset(blankForm(), 'zhipu'), key: String(key ?? '').trim() }
}

// Kilo 那条条目：删过再加回来，地址和模型照代码常量写
export function ensureKilo(files) {
  const catalog = loadCatalog(files.catalog)
  const added = addKilo(catalog)
  if (!added.ok) return { ok: false, message: added.errors[0] || t('common.saveFailed') }
  saveCatalog(files.catalog, added.catalog)
  return { ok: true }
}

// Kilo：同意过了就把条目加回清单，再把默认换过去
export function saveKilo(files) {
  const added = ensureKilo(files)
  if (!added.ok) return added
  const applied = applyDefault(files, kiloChoice())
  if (!applied.ok) return applied
  return { ok: true }
}

// 智谱成了以后设的默认：测试并保存把新条目排在清单最后，模型用 glm-4.7-flash
export function zhipuChoice(rows) {
  const list = Array.isArray(rows) ? rows : []
  const row = list.length > 0 ? list[list.length - 1] : null
  return { entry: row && typeof row.id === 'string' ? row.id : '', model: ZHIPU_MODEL, effort: null }
}

// 把默认写进清单：选择不合法就不动盘上的文件
export function applyDefault(files, choice) {
  const catalog = loadCatalog(files.catalog)
  const picked = setDefault(catalog, choice)
  if (!picked.ok) return { ok: false, message: picked.errors[0] || t('common.saveFailed') }
  saveCatalog(files.catalog, picked.catalog)
  return { ok: true }
}

// DeepSeek：先测，通了才存钥匙，再把默认设到 deepseek / deepseek-flash
export async function saveDeepseek({ files, keyring, key, probe } = {}) {
  if (typeof probe !== 'function') return { ok: false, message: t('custom.probeMissing') }
  let probed
  try {
    // probe 的签名是 ({ key, fetchImpl, timeoutMs })：要传对象，
    // 传字符串的话 probe 里拿不到 key，会当成空密钥（Si101），密钥根本没发出去
    probed = await probe({ key })
  } catch {
    return { ok: false, message: t('probe.failFirst') }
  }
  if (!probed || probed.ok !== true) {
    return { ok: false, message: (probed && probed.message) || t('probe.failFirst') }
  }
  const saved = keyring.save('deepseek', key)
  if (!saved || saved.ok !== true) return { ok: false, message: (saved && saved.message) || t('common.saveFailed') }
  const applied = applyDefault(files, deepseekChoice())
  if (!applied.ok) return applied
  return { ok: true, message: probed.message }
}

// 智谱：走「测试并保存」，通了把默认设到新条目的 glm-4.7-flash
export async function saveZhipu({ files, keyring, key, test = testAndSave, probe } = {}) {
  let back
  try {
    back = await test(files, keyring, zhipuForm(key), { probe })
  } catch {
    return { ok: false, message: t('probe.failFirst') }
  }
  if (!back || back.ok !== true) {
    return { ok: false, message: (back && back.message) || t('probe.failFirst') }
  }
  const applied = applyDefault(files, zhipuChoice(back.rows))
  if (!applied.ok) return applied
  return { ok: true, message: '' }
}

// 教程小页的数据：标题、开头、编号步骤（带链接的那步才有 url）、结尾
export function guideView(guide) {
  const src = guide && typeof guide === 'object' ? guide : {}
  return {
    title: typeof src.title === 'string' ? src.title : '',
    intro: typeof src.intro === 'string' ? src.intro : '',
    steps: (Array.isArray(src.steps) ? src.steps : []).map((step) => ({
      text: step && typeof step.text === 'string' ? step.text : '',
      url: step && typeof step.url === 'string' ? step.url : null,
    })),
    outro: typeof src.outro === 'string' ? src.outro : '',
  }
}
