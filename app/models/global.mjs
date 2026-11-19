// 全局配置：dsh 起来时照这份配置起。模型路线、能力补丁、搜索那一行都在这里。
//
// 这份文件（<dsh 家>/cordis.patch.yml）只有设置那边写：任务各写各的会互相覆盖，
// 两个任务同时跑的时候后写的把先写的盖掉，另一条线路就没了。
// dsh 的热加载盯着这个文件：改了整份重写（先写临时文件再改名），正在说的那句用老配置、下一句用新的。

import { noDeepseekYaml, providerOf, routesYaml, searchPatchYaml } from '../dsh/models.mjs'
import { createConsent } from './consent.mjs'
import { loadCatalog, usable } from './catalog.mjs'
import { hasKeyOf } from './resolve.mjs'

// 清单里某个条目的某个模型：找不到就是没有。
function modelOf(catalog, entryId, modelId) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  const entry = entries.find((one) => one && one.id === entryId)
  const models = Array.isArray(entry?.models) ? entry.models : []
  return models.find((one) => one && one.id === modelId) || null
}

// 搜索地址（Search API）：dsh 往 {地址}/search 发一个 POST。
// 不配地址就照 dsh 自己的来（它从对话那条线路的地址推）。
// 这里写的是「用哪把钥匙」（环境变量名），不是钥匙本身。
export function searchConfig() {
  const baseUrl = String(process.env.SIDEMATE_SEARCH_BASE_URL ?? '').trim()
  if (baseUrl === '') return null
  return { baseUrl, apiKeyEnv: String(process.env.SIDEMATE_SEARCH_API_KEY_ENV ?? '').trim() }
}

// 全局配置的几段文字：模型路线、能力补丁、搜索那一行。
// 单并发模型那份（关子智能体）不在这里：它只对那一轮选中的模型有意义，
// 放进全局配置会对所有会话生效；这类模型先靠 dsh 自己的 429 重试顶着。
export function globalPatchTexts({ files, keyring, abilityTexts = [], search = null } = {}) {
  const catalog = loadCatalog(files?.catalog)
  const consented = createConsent({ file: files?.consent }).status().agreed === true
  const texts = [routesYaml(catalog, { consented })]
  // DeepSeek 路线（dsh 内置的 llm-deepseek）没钥匙时挂一份手写目录，别去官方列目录。
  if (!hasKeyOf(keyring)('deepseek')) texts.push(noDeepseekYaml())
  for (const text of Array.isArray(abilityTexts) ? abilityTexts : []) {
    if (typeof text === 'string' && text.trim() !== '') texts.push(text.trim())
  }
  const baseUrl = typeof search?.baseUrl === 'string' ? search.baseUrl.trim() : ''
  if (baseUrl !== '') texts.push(searchPatchYaml(baseUrl, search?.apiKeyEnv))
  return texts
}

// acp 那一行用哪个模型：已配好（有钥匙 / Kilo 已同意）的模型里第一个能看图的；
// 没有能看图的就用默认模型。
// 这一条连接能不能收图片是连接级的（dsh-acp 在 initialize 时算一次）：桌伴里只有一条连接，
// 所以这一行在起进程时定好，不跟着一轮任务变。
export function acpRoute({ files, keyring } = {}) {
  const catalog = loadCatalog(files?.catalog)
  const consented = createConsent({ file: files?.consent }).status().agreed === true
  const ready = usable(catalog, { hasKey: hasKeyOf(keyring), consented })
  for (const one of ready) {
    const model = modelOf(catalog, one.entry, one.model)
    if (model?.vision === true) return { provider: providerOf(one.entry), model: one.model }
  }
  // 没有能看图的模型：用默认模型。默认模型自己没配钥匙就当没有（这一轮本来也跑不起来）。
  const fallback = catalog?.default ?? {}
  const model = modelOf(catalog, fallback.entry, fallback.model)
  if (!model) return null
  const readyDefault = usable(catalog, { hasKey: hasKeyOf(keyring), consented })
    .some((one) => one.entry === fallback.entry && one.model === fallback.model)
  if (!readyDefault) return null
  return { provider: providerOf(fallback.entry), model: fallback.model }
}
