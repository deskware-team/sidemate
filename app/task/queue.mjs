// 每把密钥的排队器：全桌伴一份（逻辑在 ./key-queue.mjs，这里只把它接起来）。
// 上限来自模型清单里那一条的 concurrency（0 = 不限）：现取现用，用户改了就生效。
// 设置里改完上限要调 refresh()：放行排着的那些。

import { limitOf, loadCatalog } from '../models/catalog.mjs'
import { modelFiles } from '../models/files.mjs'
import { createKeyQueue } from './key-queue.mjs'

// 这把钥匙（条目）现在能跑几个：清单里那条的并发上限
function limitOfEntry(entryId) {
  if (!entryId) return 0
  try {
    return limitOf(loadCatalog(modelFiles().catalog), entryId)
  } catch {
    return 0
  }
}

export const keyQueue = createKeyQueue({ limitOf: limitOfEntry })

// 设置里改了并发上限以后调它：排着的立刻能上
export function refreshKeyQueue() {
  try {
    keyQueue.refresh()
  } catch {
    // 放行不了就照旧排着
  }
}
