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

// 另外两个口子，也是后台起来时交进来：
// - namer(id)：给这个主题后台起个名字（问模型，回来自己存盘）
// - opener(id, date)：打开这个主题那一天的新闻（跟右键菜单点开走同一条路）
let namer = null
let opener = null

export function setNamer(fn) {
  namer = typeof fn === 'function' ? fn : null
}

export function setOpener(fn) {
  opener = typeof fn === 'function' ? fn : null
}

// 给这个主题起名字：后台没起来就算了（名字先用本地规则那个）
export function nameTopic(topicId) {
  if (!namer) return
  try { namer(String(topicId ?? '').trim()) } catch { /* 起不了名字不打扰用户 */ }
}

// 打开那一天的新闻：后台没起来就什么都不做
export function openIssue(topicId, date) {
  if (!opener) return
  try { opener(String(topicId ?? '').trim(), String(date ?? '')) } catch { /* 开不了就算了 */ }
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
