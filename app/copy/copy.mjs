// 桌伴所有固定的字都在这个文件夹里，一类一个文件：
//   errors.mjs       错误码：一轮干不下去、停下来时说的话
//   status.mjs       状态码：干活过程中告诉用户的话
//   ui-desk.mjs      界面文案：小岛、右键菜单、托盘、任务窗
//   ui-settings.mjs  界面文案：设置窗
//   ui-windows.mjs   界面文案：首次运行、密钥获取教程、同意页、早报页面
//   harness.mjs      发给模型的话：用户在界面上看不到
// 代码里只写键（比如 t('St207', { name })），不写字。
//
// 这几个文件的写法：
//   每条上面一行注释，说清在哪、什么情况出现。
//   {name} 这种是程序填进去的内容（文件名、秒数……），括号里的名字别改。
//   "@St407" 表示和 St407 是同一句。
//   字用双引号，最后一条后面不加逗号：Python 脚本也读这几个文件（./copy.py）。
//
// 这个文件本身页面和主进程都用：不引 node: 也不引 electron（页面只许加载自己目录下的脚本）。

import errors from './errors.mjs'
import status from './status.mjs'
import harness from './harness.mjs'
import uiDesk from './ui-desk.mjs'
import uiSettings from './ui-settings.mjs'
import uiWindows from './ui-windows.mjs'

// 几个文件原样摆出来：测试查有没有重复
export const BOOKS = { errors, status, harness, 'ui-desk': uiDesk, 'ui-settings': uiSettings, 'ui-windows': uiWindows }

// 顶层的键在几份之间不许重名：合成一份查
const ALL = Object.assign({}, ...Object.values(BOOKS))

// 「跟 St407 同一句」：整句写成 @键
const REF = /^@([\w.]+)$/
// 变量：{name}、{left}；{ } 和 { "summary" … } 这种不是变量
const VAR = /\{([A-Za-z][A-Za-z0-9]*)\}/g

// 一条的样子：有 text 的取 text，有 lines 的按换行拼；直接是字的就是它
function textOf(node, key) {
  if (typeof node === 'string') return node
  if (node && typeof node === 'object') {
    if (typeof node.text === 'string') return node.text
    if (Array.isArray(node.lines)) return node.lines.join('\n')
  }
  throw new Error(`app/copy 里「${key}」不是一句话`)
}

// 键是用点隔开的路径：St301、St301.after、stops.busy、news.prompt
function find(key) {
  let node = ALL
  for (const part of String(key ?? '').split('.')) {
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, part)) return undefined
    node = node[part]
  }
  return node
}

// 键对应的原样（没填变量）：找不到就报错，写错的键别悄悄变成空白
export function raw(key, seen = []) {
  const node = find(key)
  if (node === undefined) throw new Error(`app/copy 里没有「${key}」这一条`)
  const text = textOf(node, key)
  const ref = REF.exec(text)
  if (!ref) return text
  if (seen.includes(key)) throw new Error(`app/copy 里「${key}」转来转去转回自己了`)
  return raw(ref[1], [...seen, key])
}

export function has(key) {
  return find(key) !== undefined
}

// 整条原样：码表这类要看字段的用（codes.Si429.stop）
export function entry(key) {
  const node = find(key)
  if (node === undefined) throw new Error(`app/copy 里没有「${key}」这一条`)
  return node
}

// 填变量：给了的换上，没给的原样留着 {name}（界面上一眼看得出漏了什么）
export function fill(text, vars = {}) {
  return String(text).replace(VAR, (whole, name) => (vars && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : whole))
}

export function t(key, vars) {
  return fill(raw(key), vars)
}

// 页面里写死的字换成键：data-t 换文字，data-t-placeholder / data-t-title 换对应属性。只在页面里调。
export function paint(root) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t)
  for (const el of root.querySelectorAll('[data-t-placeholder]')) el.setAttribute('placeholder', t(el.dataset.tPlaceholder))
  for (const el of root.querySelectorAll('[data-t-title]')) el.setAttribute('title', t(el.dataset.tTitle))
}

// 按一个变量切成前后两截（都填好别的变量）：页面上中间那截自己走（倒数的秒数）
export function around(key, name, vars) {
  const text = raw(key)
  const mark = `{${name}}`
  const at = text.indexOf(mark)
  if (at < 0) return [fill(text, vars), '']
  return [fill(text.slice(0, at), vars), fill(text.slice(at + mark.length), vars)]
}
