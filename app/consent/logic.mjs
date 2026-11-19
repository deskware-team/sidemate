// Kilo 同意弹窗里的几个判断，写成纯函数方便测。
// 页面脚本（app/consent/page.js）直接 import 这份，判断只有一处。

// 全文框差 2px 以内就算滚到底；本来就放得下的（scrollHeight 比 clientHeight 小）也算到底
export function reachedBottom({ scrollTop, clientHeight, scrollHeight } = {}) {
  const top = Number(scrollTop) || 0
  const height = Number(clientHeight) || 0
  const total = Number(scrollHeight) || 0
  return top + height >= total - 2
}

// 没到底之前两个勾不能点
export function checksEnabled(reached) {
  return reached === true
}

// 两个都勾上才让点「同意，开始用」
export function canAgree({ reached = false, terms = false, crossBorder = false } = {}) {
  return checksEnabled(reached) && terms === true && crossBorder === true
}

// 条款全文是 markdown，这里去掉行首的 # 和加粗的 **，正文里的「一、」到「七、」和网址都留着
export function plainTerms(md) {
  return String(md ?? '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*#+[ \t]*/, ''))
    .join('\n')
    .replace(/\*\*/g, '')
}
