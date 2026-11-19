// 界面上的字都改叫「新闻」：app/news、app/pet、app/settings、app/task、app/main 里
// 字符串字面量（引号 / 反引号里）和 .html 正文都不含「早报」。注释和变量名不查。

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 要查的那几个文件夹（一张卡一个文件夹的那五个）
const FOLDERS = ['app/news', 'app/pet', 'app/settings', 'app/task', 'app/main']

// 一个文件夹底下（递归）的 .mjs / .js / .html 文件
function listFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, out)
    else if (entry.isFile() && /\.(mjs|js|html)$/.test(entry.name)) out.push(path)
  }
  return out
}

// 一个源文件里所有字符串字面量：引号 / 反引号里的内容；行注释、块注释跳过不算
function stringLiterals(source) {
  const text = String(source ?? '')
  const out = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\') {
          value += text.slice(j + 1, j + 2)
          j += 2
        } else {
          value += text[j]
          j += 1
        }
      }
      out.push(value)
      i = j + 1
      continue
    }
    i += 1
  }
  return out
}

// .html 的正文：去掉注释和样式块以后整段都算（属性、标题、正文都查；样式和脚本不是给用户看的字）
function htmlBody(source) {
  return String(source ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
}

test('界面上的字都改叫「新闻」：字符串字面量和 html 正文不含「早报」', () => {
  const offenders = []
  for (const folder of FOLDERS) {
    for (const path of listFiles(join(root, folder))) {
      const text = readFileSync(path, 'utf8')
      if (path.endsWith('.html')) {
        if (htmlBody(text).includes('早报')) offenders.push(`${path}（正文）`)
        continue
      }
      for (const literal of stringLiterals(text)) {
        if (String(literal).includes('早报')) offenders.push(`${path}（字符串）`)
        break
      }
    }
  }
  assert.deepEqual(offenders, [], `这几处还带着「早报」两个字：${offenders.join('、')}`)
})
