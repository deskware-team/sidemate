// 任务窗「换模型」的纯函数：列表怎么拼、小签写什么、什么时候能点、选了以后开工带什么。
// 只算数据，不碰 electron、不碰窗口，node --test 直接测。钥匙串的判断也放这（keyringHas），
// 主进程拿 openKeyring() 的结果喂进来；渲染进程不用这个文件，钥匙不出去。

import { EFFORT_LABELS, usable } from '../models/catalog.mjs'
import { t } from '../copy/copy.mjs'

// keyring 变 usable 要的 hasKey：DeepSeek 要真读得出（跟 resolve.mjs 一个习惯），其余看有没有存过
export function keyringHas(keyring) {
  return (id) => {
    try {
      if (id === 'deepseek') return Boolean(keyring?.read?.('deepseek'))
      return keyring?.has?.(id) === true
    } catch {
      return false
    }
  }
}

// 每个模型写什么名字：内置条目（免费通道、DeepSeek）写条目名；自定义条目带模型名，分两截 [条目, 模型]，
// 页面把两截隔开摆（中间不用「·」，空白由样式给）
export function modelParts(entry, model) {
  const name = entry?.name || entry?.id || ''
  if (entry?.kind === 'free' || entry?.kind === 'deepseek') return [name]
  const of = model?.name || model?.id || ''
  return !of || of === name ? [name] : [name, of]
}

// 名字连成一行（停上去的提示用）：两截之间空一格
export function modelLabel(entry, model) {
  return modelParts(entry, model).join(' ')
}

// 档位配上中文标签
function withLabels(efforts) {
  return (Array.isArray(efforts) ? efforts : []).map((id) => ({ id, label: EFFORT_LABELS[id] || id }))
}

// 没选档位时 dsh 实际用的那一档：DeepSeek 条目走 dsh 内置的 llm-deepseek，它的默认是「高」。
// 自定义线路的默认由各家定，说不准，就不标。
export function defaultEffortOf(entry, efforts) {
  const ids = (Array.isArray(efforts) ? efforts : []).map((one) => (typeof one === 'string' ? one : one?.id))
  if (entry?.kind === 'deepseek' && ids.includes('high')) return 'high'
  return null
}

// 弹出列表：能用的模型每个一行；免费通道不要钥匙，没同意也一直列着，标 needsConsent。
// 顺序跟 usable 一致（清单里的次序），没同意的免费通道排在最后。
export function menuList({ catalog, hasKey, consented } = {}) {
  const entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : []
  const byId = new Map(entries.filter((entry) => entry && typeof entry === 'object').map((entry) => [entry.id, entry]))
  const rows = []
  const seen = new Set()
  for (const item of usable(catalog, { hasKey, consented })) {
    const entry = byId.get(item.entry)
    const parts = entry ? modelParts(entry, item) : [item.name]
    rows.push({
      entry: item.entry,
      model: item.model,
      name: parts.join(' '),
      parts,
      needsConsent: false,
      efforts: withLabels(item.efforts),
      defaultEffort: defaultEffortOf(entry, item.efforts),
      note: noteOf(entry, item),
    })
    seen.add(`${item.entry}/${item.model}`)
  }
  const free = entries.find((entry) => entry && entry.kind === 'free')
  const first = free && Array.isArray(free.models) ? free.models[0] : null
  if (free && first && !seen.has(`${free.id}/${first.id}`)) {
    rows.push({ entry: free.id, model: first.id, name: modelLabel(free, first), parts: modelParts(free, first), needsConsent: true, efforts: withLabels(first.efforts), defaultEffort: null, note: noteOf(free, first) })
  }
  return rows
}

// 每行的小字：有思考档位的写档位，自定义条目写自定义；Kilo 模型那行不写
function noteOf(entry, item) {
  if (entry?.kind === 'free') return ''
  const labels = (Array.isArray(item?.efforts) ? item.efforts : []).map((id) => EFFORT_LABELS[id] || id)
  // 几个档位用「、」连（跟设置里列工具一样），不用「·」
  if (labels.length) return t('models.effort', { levels: labels.join('、') })
  if (entry && entry.kind !== 'deepseek') return t('models.custom')
  return ''
}

// 小签：写当前模型的名字和思考档位的小字，还有现在点不点得开。
// choice 是这个任务选的 { entry, model, effort }；没选（null）就用清单默认。
// 能点的模型只有一个、或正在干活时点不开（页面这头就不画 ▾）。
export function chipOf({ catalog, list, choice, working } = {}) {
  const rows = Array.isArray(list) ? list : []
  const entries = catalog && Array.isArray(catalog.entries) ? catalog.entries : []
  const picked = choice && typeof choice.entry === 'string' && typeof choice.model === 'string' ? choice : null
  const fallback = catalog?.default && typeof catalog.default.entry === 'string' ? catalog.default : null
  const current = picked || fallback
  let entry = ''
  let model = ''
  let effort = null
  let parts = []
  let effortLabel = ''
  if (current) {
    entry = current.entry
    model = typeof current.model === 'string' ? current.model : ''
    effort = current.effort == null ? null : current.effort
    // 名字先在列表里找；默认选的模型可能用不了（没钥匙、没同意），再回清单里找
    const row = rows.find((one) => one.entry === entry && one.model === model)
    if (row) parts = row.parts
    else {
      const of = entries.find((one) => one && one.id === entry)
      const at = of && Array.isArray(of.models) ? of.models.find((one) => one && one.id === model) : null
      if (of && at) parts = modelParts(of, at)
    }
    effortLabel = typeof effort === 'string' ? EFFORT_LABELS[effort] || '' : ''
  }
  return { entry, model, effort, name: parts.join(' '), parts, effortLabel, canOpen: !working && rows.length > 1 }
}

