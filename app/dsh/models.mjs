import { envName } from '../models/keys.mjs'
import { t } from '../copy/copy.mjs'
import {
  KILO_BASE_URL,
  KILO_CONTEXT_WINDOW,
  KILO_ENTRY_ID,
  KILO_MAX_TOKENS,
  KILO_MODEL_ID,
  KILO_ROUTE,
} from '../models/kilo.mjs'

// Kilo 那条线路在 dsh 里固定叫 kilo；DeepSeek 条目走 dsh 内置的 llm-deepseek，不进 pi-ai。
const DEEPSEEK_ROUTE = 'deepseek-official'

// 字符串值一律按 JSON 的双引号形式写，名字里的冒号和 # 不会破坏 YAML 结构。
function q(value) {
  return JSON.stringify(String(value))
}

// 重试由 dsh 自己管（dsh-llm-retry）；桌伴的补丁不写重试策略。
// dsh 的默认是「正常」模式——最多 5 次、间隔 0.5–10 秒、抖动 0.1，
// 空回复（EMPTY_RESPONSE）也重试；重试的码是那五个：
// EMPTY_RESPONSE、RATE_LIMIT、SERVER、TIMEOUT、TRANSPORT。
//
// 桌伴自己也不在外面套一层重试：再发一次 session/prompt 会把用户那句话在会话里再记一遍，
// 模型以为要求又说了一遍、可能从头重做；dsh 的重试只重发那一次模型请求。
//
// dsh 的重试事件（llm/retry）留在它自己内部：会话投影缓存那一行只有 {retry, retryId}
// （payload dsh-llm-retry/lib/index.js），ACP 也只转发 assistant/tool 事件。
// 所以桌伴自己挂一个小插件（app/dsh/retry-plugin.mjs），把每次重试的
// 种类、第几次、等几秒一行一行写给桌伴，等待行照那个出，次数不漏号；
// 这一轮最后那次失败（dsh 的码、HTTP 状态、原文）也由那个插件写来。
//
// Kilo 那条线路单独一份：限流（RATE_LIMIT）不重试——那边排队限流，等一会儿再来也一样。
// 其它照 dsh 默认（次数和间隔都不写，让 dsh 用它自己的那套）。
const KILO_RETRY_CODES = ['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT']

// 清单条目在 dsh 里的路线名。
export function providerOf(entryId) {
  // 旧清单里那条线路的 id 是 free，路线名一直是 kilo
  if (entryId === KILO_ENTRY_ID || entryId === 'free') return KILO_ROUTE
  if (entryId === 'deepseek') return DEEPSEEK_ROUTE
  return entryId
}

// 会话里选模型的值：不是裸模型名，是 JSON 序列化的 [路线, 模型]。
export function choiceValue(entryId, modelId) {
  return JSON.stringify([providerOf(entryId), modelId])
}

function modelBaseLines(model) {
  return [`          - id: ${q(model.id)}`, `            name: ${q(model.name || model.id)}`]
}

// 思考档位：空档位写成 false（非推理模型）；每档的值是用户填的「发送值」，
// off 留空就什么都不发，其余档位没填值就照档位名发。
function effortsLines(efforts, effortValues) {
  if (!Array.isArray(efforts) || efforts.length === 0) return ['            reasoningEfforts: false']
  const values = effortValues && typeof effortValues === 'object' ? effortValues : {}
  const lines = ['            reasoningEfforts:']
  for (const effort of efforts) {
    const fallback = effort === 'off' ? '' : effort
    const given = Object.prototype.hasOwnProperty.call(values, effort) ? String(values[effort] ?? '') : fallback
    lines.push(given === '' ? `              ${q(effort)}:` : `              ${q(effort)}: ${q(given)}`)
  }
  return lines
}

// rc.3 里没写容量的自定义模型按 1M/128K 处理（dsh-llm-pi-ai 的默认值）。
// 自己写明：换模型前 dsh 要先压缩，压缩按这个窗口算，写不明就当 1M，容易压得太晚。
export const DEFAULT_CONTEXT_WINDOW = 1_000_000
export const DEFAULT_MAX_TOKENS = 128_000

function customModelLines(model) {
  const lines = modelBaseLines(model)
  lines.push(`            contextWindow: ${model.contextWindow ?? DEFAULT_CONTEXT_WINDOW}`)
  lines.push(`            maxTokens: ${model.maxTokens ?? DEFAULT_MAX_TOKENS}`)
  lines.push(...effortsLines(model.efforts, model.effortValues))
  lines.push(model.vision === true ? '            input: ["text", "image"]' : '            input: ["text"]')
  // 思考参数格式：用户在下拉里选的那一种，写成 pi-ai 的 compat.thinkingFormat
  if (typeof model.thinkingFormat === 'string' && model.thinkingFormat !== '') {
    lines.push('            compat:')
    lines.push(`              thinkingFormat: ${q(model.thinkingFormat)}`)
  }
  return lines
}

// 换模型前 dsh 会先压缩：余量是 65536，窗口不够大就压不了，报 MODEL_SWITCH_COMPACTION_FAILED。
// 窗口小的线路单独给一份余量（按剩下的一成多算），压得动就行。
export function headroomTokens(contextWindow, maxTokens) {
  const w = Number(contextWindow)
  const o = Number(maxTokens)
  if (!Number.isFinite(w) || !Number.isFinite(o)) return null
  const room = w - o
  if (room <= 0) return null
  if (room > 65_536) return null
  return Math.max(1024, Math.floor(room / 4))
}

// Kilo 那条线路：地址、模型、容量都照代码常量写，模型清单改不动它。
// 匿名路线也要带占位标头，它不是钥匙。
function kiloLines() {
  return [
    `      ${KILO_ROUTE}:`,
    `        displayName: ${q(t('modelPage.kiloName'))}`,
    '        api: "openai-completions"',
    `        baseURL: ${q(KILO_BASE_URL)}`,
    '        headers:',
    '          Authorization: "Bearer anonymous"',
    // 限流不重试：别的照 dsh 默认（次数、间隔都不写）
    '        retryPolicy:',
    '          mode: normal',
    '          retryableCodes:',
    ...KILO_RETRY_CODES.map((code) => `            - ${code}`),
    '        models:',
    `          - id: ${q(KILO_MODEL_ID)}`,
    `            name: ${q(t('modelPage.kiloName'))}`,
    `            contextWindow: ${KILO_CONTEXT_WINDOW}`,
    `            maxTokens: ${KILO_MAX_TOKENS}`,
    '            reasoningEfforts: false',
    '            input: ["text"]',
  ]
}

// 自定义线路：不写重试策略，照 dsh 默认。
function customLines(entry) {
  const lines = [
    `      ${entry.id}:`,
    `        displayName: ${q(entry.name || entry.id)}`,
    `        apiKeyEnv: ${q(envName(entry.id))}`,
    `        api: ${q(entry.protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions')}`,
    `        baseURL: ${q(entry.baseUrl)}`,
    '        models:',
  ]
  for (const model of entry.models) lines.push(...customModelLines(model))
  return lines
}

// 把模型清单变成 pi-ai 的路线配置。Kilo 要用户同意才挂；自定义条目各占一条路线，
// 钥匙只写环境变量名，绝不写钥匙值；DeepSeek 条目不进来（走现有的 llm-deepseek）。
export function routesYaml(catalog, options) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : []
  const routes = []
  const taken = new Set()
  // 窗口小的线路要单独给压缩留余量，不然换模型时压不动。
  const policies = []
  if (options?.consented === true) {
    const kilo = entries.find((entry) => entry && entry.id === KILO_ENTRY_ID)
    if (kilo) {
      taken.add(KILO_ROUTE)
      routes.push(...kiloLines())
    }
  }
  for (const entry of entries) {
    if (!entry || entry.kind !== 'custom' || taken.has(entry.id)) continue
    if (!Array.isArray(entry.models) || entry.models.length === 0) continue
    taken.add(entry.id)
    routes.push(...customLines(entry))
    for (const model of entry.models) {
      const headroom = headroomTokens(model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW, model?.maxTokens ?? DEFAULT_MAX_TOKENS)
      if (headroom === null) continue
      policies.push({ provider: entry.id, model: model.id, headroomTokens: headroom })
    }
  }
  const providers = routes.length === 0 ? ['    providers: {}'] : ['    providers:', ...routes]
  const lines = [
    '# 由模型清单生成的路线配置：覆盖的是 pi-ai 的整行 config。',
    '- id: llm-pi-ai',
    '  config:',
    ...providers,
  ]
  if (policies.length > 0) {
    lines.push(
      '- id: compaction-basic',
      '  config:',
      '    modelPolicies:',
    )
    for (const policy of policies) {
      lines.push(
        `      - provider: ${q(policy.provider)}`,
        `        model: ${q(policy.model)}`,
        `        headroomTokens: ${policy.headroomTokens}`,
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

// 思考档位要以当前回包为准：回包里有这个档位才返回它，否则空。
export function pickEffort(configOptions, wanted) {
  const effort = (Array.isArray(configOptions) ? configOptions : []).find((item) => item && item.id === 'reasoning_effort')
  if (!effort || !Array.isArray(effort.options)) return null
  return effort.options.some((option) => option && option.value === wanted) ? wanted : null
}

// 模型选项是分组的，组里再有 options；能找到这个值才算一个可用的选择。
export function hasChoice(configOptions, value) {
  const model = (Array.isArray(configOptions) ? configOptions : []).find((item) => item && item.id === 'model')
  if (!model || !Array.isArray(model.options)) return false
  for (const option of model.options) {
    if (Array.isArray(option?.options)) {
      if (option.options.some((item) => item && item.value === value)) return true
    } else if (option && option.value === value) {
      return true
    }
  }
  return false
}

// 搜索地址的补丁：改 web-deepseek-api 这一行的 config。
// searchBaseURL 是 Search API 的地址（带路径前缀，/search 由 dsh 接）；不写钥匙那一项时，
// dsh 自己找对话那条线路的凭据，没有凭据就把 web_search 从那一次请求里撤掉。
export function searchPatchYaml(baseUrl, apiKeyEnv) {
  const lines = [
    '- id: web-deepseek-api',
    '  config:',
    `    searchBaseURL: ${JSON.stringify(String(baseUrl))}`,
  ]
  if (typeof apiKeyEnv === 'string' && apiKeyEnv !== '') lines.push(`    searchApiKeyEnv: ${JSON.stringify(apiKeyEnv)}`)
  lines.push('')
  return lines.join('\n')
}

// 用户没有 DeepSeek 钥匙时挂这份补丁。llm-deepseek 只在手写目录与内置目录完全一致、
// 且端点是官方 API 时才去请求 GET /models 列目录；给它一份只有一项的手写目录后，
// 列目录请求就此停止。没有钥匙时真正的推理请求也在发出去之前因缺凭据失败，
// 所以 DeepSeek 路线不会向官方地址发任何请求。
export function noDeepseekYaml() {
  return [
    '- id: llm-deepseek',
    '  config:',
    '    models:',
    '      - id: "deepseek-v4-flash"',
    '',
  ].join('\n')
}

// 「同时只能 1 个请求」的模型：子智能体关掉。模型一轮里能同时开好几个子智能体，
// 每个子智能体自己发模型请求，会同时有好几个请求在路上，这类模型扛不住。
export function singleRequestYaml() {
  return [
    '# 同时只能 1 个请求的模型：关掉子智能体，免得一轮里同时发好几个请求。',
    '- id: tool-subagent',
    '  disabled: true',
    '- id: tool-subagent-fork',
    '  disabled: true',
    '',
  ].join('\n')
}
