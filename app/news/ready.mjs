// 新闻能不能生成：模型得能自己上网找，才生成得了。
// 只认 DeepSeek 自带的联网搜索：存着 DeepSeek 钥匙就行。
// 没有就不生成：不起模型，带码停（Si104）。
// 纯 node 模块，不引 electron，node --test 直接测。

import { t } from '../copy/copy.mjs'

// 不 ready 时给用户看的那句话：错误码 Si104 的停工那句（设置·新闻页按钮旁的小字也是这句）
export const NOT_READY_TEXT = t('stops.newsSearch')

// hasSearchKey：有没有 DeepSeek 钥匙（主环境那把）。
export function newsReady({ hasSearchKey } = {}) {
  if (hasSearchKey === true) return { ok: true }
  return { ok: false, code: 'Si104', text: NOT_READY_TEXT }
}
