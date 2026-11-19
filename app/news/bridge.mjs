// 早报后台和别的壳之间的桥：设置页要点「现在生成」，自己不碰 runner。
// 设置页不能反过来 import app/main/main.mjs（main 已经 import 了设置，会绕成环），
// 所以两边只认这个口子：后台起来时 setGenerator() 把生成的办法交进来，谁要生成就 generate(主题 id)。
// 同一个主题正在跑就不再开第二份：这件事在 runner 里管（定时那一路不走这座桥）。

// 后台交进来的生成办法：没有就是后台还没起来
import { t } from '../copy/copy.mjs'
let generator = null

// 后台把生成的办法交进来：交一次就行，后面 generate 都走它
export function setGenerator(fn) {
  generator = typeof fn === 'function' ? fn : null
  return generator
}

// 空结果：没生成出来的时候都用它
function failed(topicId, message) {
  return {
    ok: false,
    topicId: String(topicId ?? ''),
    date: '',
    files: [],
    items: 0,
    message: String(message ?? ''),
  }
}

// 生成一份：后台还没起来就立刻回一句没起来
export async function generate(topicId) {
  const id = String(topicId ?? '').trim()
  if (!generator) return failed(id, t('stops.newsError'))
  try {
    const back = await generator(id)
    const source = back && typeof back === 'object' ? back : {}
    return {
      ok: source.ok === true,
      topicId: String(source.topicId ?? id),
      date: String(source.date ?? ''),
      files: Array.isArray(source.files) ? source.files : [],
      items: Number(source.items) || 0,
      message: String(source.message ?? ''),
    }
  } catch (error) {
    return failed(id, error?.message || t('stops.newsError'))
  }
}
