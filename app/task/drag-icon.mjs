// 产出卡拖出去时跟着鼠标走的那张小图：用系统给这种文件的图标（Word 文档就是 Word 的图标），不用桌伴自己的。
// 系统图标要异步问：按扩展名记下来；按下产出卡那一下（还没真开始拖）先问好，真拖起来直接用。
import { extname } from 'node:path'

export function createDragIcons({ getFileIcon, fallback }) {
  const cache = new Map()
  const keyOf = (path) => extname(String(path || '')).toLowerCase() || '*'
  return {
    // 先问好这种文件的图标；问不到就算了（拖的时候用兜底那张）
    warm(path) {
      const key = keyOf(path)
      if (cache.has(key)) return Promise.resolve(cache.get(key))
      return Promise.resolve()
        .then(() => getFileIcon(path))
        .then((image) => {
          if (image && typeof image.isEmpty === 'function' && !image.isEmpty()) cache.set(key, image)
          return cache.get(key) || null
        })
        .catch(() => null)
    },
    // 拖的那一下用的图：问好了用系统图标，没问好用兜底
    get(path) {
      return cache.get(keyOf(path)) || fallback()
    },
  }
}
