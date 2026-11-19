// Kilo 那条线路的固定写法：地址、模型、容量、并发都写在代码里，
// 模型清单里的 Kilo 条目只管「用户要不要用它、同意没同意」，这些常量不跟着清单走。

import { t } from '../copy/copy.mjs'

// 清单里那条条目的 id，和 dsh 路线里的名字
export const KILO_ENTRY_ID = 'kilo'
export const KILO_ROUTE = 'kilo'

// 请求地址和模型：写死，清单改不动
export const KILO_BASE_URL = 'https://ai-gateway.kilo.ai/api/v1'
export const KILO_MODEL_ID = 'kilo-auto/free'

// 容量：上下文 256K，最大输出 32K
export const KILO_CONTEXT_WINDOW = 256_000
export const KILO_MAX_TOKENS = 32_000

// 这把线路同一时间只发 1 个请求
export const KILO_CONCURRENCY = 1

// 这条线路没有密钥：kind 这一档就是「不用密钥」的意思
export const KILO_KIND = 'free'

// 清单里那条 Kilo 条目：地址、模型、容量照上面的常量
export function kiloEntry() {
  const name = t('modelPage.kiloName')
  return {
    id: KILO_ENTRY_ID,
    kind: KILO_KIND,
    name,
    protocol: 'openai',
    baseUrl: KILO_BASE_URL,
    concurrency: KILO_CONCURRENCY,
    models: [
      {
        id: KILO_MODEL_ID,
        name,
        contextWindow: KILO_CONTEXT_WINDOW,
        maxTokens: KILO_MAX_TOKENS,
        efforts: [],
        effortValues: {},
        vision: false,
        singleConcurrent: true,
      },
    ],
  }
}
