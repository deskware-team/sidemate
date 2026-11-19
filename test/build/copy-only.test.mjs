// 固定的字只许在 app/copy 里：错误码 errors.mjs、状态码 status.mjs、给模型的话 harness.mjs，
// 界面文案 ui-desk.mjs / ui-settings.mjs / ui-windows.mjs。代码里只写键。
//
// 这里做三件事：
// 1. app/copy 本身：几个文件之间顶层不重名、开头有说明、每条上面有一行注释（在哪、什么情况出现）、
//    同一句话只留一条，错误码表、状态码 v5 里的码一个不少，Python 读出来的跟 JS 一模一样。
// 2. 扫 app 下的 js / mjs / cjs / html / py 里字符串和页面文字中的汉字（注释、正则、Python 文档字符串、
//    写日志的那几句、生成文件里的注释行都不算）：剩下的每一处都不许有，
//    界面文案在 app/copy 的 ui-*.mjs，给模型的话在 harness.mjs，错误码 / 状态码在 errors.mjs / status.mjs。
// 3. 代码里写死的键一个都不许缺（t() 找不到键就抛错，页面上写错一个 data-t，任务窗整页白掉），
//    页面上只许有 paint() 认的 data-t 属性，app/copy 里没人用的条目不留（最后一段）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOKS, around, has, t } from '../../app/copy/copy.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

// ---------------------------------------------------------------- 扫描

export const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.py'])
// 不扫的地方：文案本身、随包的运行时、第三方包
const SKIP_DIRS = ['app/copy', 'app/payload']
const SKIP_PARTS = new Set(['node_modules', 'vendor'])
// 写日志：这几种调用的参数不是文案
const LOG_CALL = /(?:\blog|\bwriteLog|\blog_line|\blogLine|console\.\w+)\s*(?:\?\.)?\s*\(\s*[rRbBuUfF]{0,2}$/
// 正则可以出现在这些记号后面（不然 / 是除号）
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'else', 'in', 'of', 'yield', 'await', 'delete', 'void', 'throw', 'new'])

export function appFiles(root = ROOT) {
  const out = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (fs.statSync(full).isDirectory()) {
        if (!SKIP_PARTS.has(name) && !SKIP_DIRS.includes(rel)) walk(full)
      } else if (EXTS.has(path.extname(name))) {
        out.push(rel)
      }
    }
  }
  walk(path.join(root, 'app'))
  return out.sort()
}

// JS：小词法器，跳过注释和正则，收字符串（含模板字符串里 ${} 之外的部分）
export function jsStrings(src) {
  const out = []
  let i = 0
  let prev = ''
  const readQuoted = (quote) => {
    const start = i
    let text = ''
    i += 1
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue }
      text += src[i]
      i += 1
    }
    i += 1
    out.push({ text, start })
  }
  const readTemplate = () => {
    let start = i
    let text = ''
    i += 1
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') {
        out.push({ text, start })
        text = ''
        i += 2
        code(true)
        start = i
        continue
      }
      text += src[i]
      i += 1
    }
    i += 1
    out.push({ text, start })
  }
  const readRegex = () => {
    i += 1
    let inClass = false
    while (i < src.length && src[i] !== '\n') {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) break
      i += 1
    }
    i += 1
    while (/[a-z]/i.test(src[i] || '')) i += 1
  }
  // untilBrace：在模板字符串的 ${ } 里，读到配对的 } 就回去
  function code(untilBrace) {
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      const next = src[i + 1]
      if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
      if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue }
      if (c === '\'' || c === '"') { readQuoted(c); prev = 'x'; continue }
      if (c === '`') { readTemplate(); prev = 'x'; continue }
      if (c === '/') {
        if (REGEX_AFTER.has(prev) || REGEX_WORDS.has(prev)) {
          readRegex()
          prev = 'x'
        } else {
          i += 1
          prev = '/'
        }
        continue
      }
      if (/[A-Za-z_$]/.test(c)) {
        let word = ''
        while (i < src.length && /[\w$]/.test(src[i])) { word += src[i]; i += 1 }
        prev = word
        continue
      }
      if (untilBrace) {
        if (c === '{') depth += 1
        if (c === '}') {
          if (depth === 0) { i += 1; return }
          depth -= 1
        }
      }
      if (!/\s/.test(c)) prev = /[0-9]/.test(c) ? 'x' : c
      i += 1
    }
  }
  code(false)
  return out
}

// Python：跳过 # 注释；单独起一行的三引号字符串是文档字符串，也跳过
export function pyStrings(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    const prefix = /^[rRbBuUfF]{1,2}(?=['"])/.exec(src.slice(i, i + 3))
    const quoteHere = c === '\'' || c === '"'
    if ((quoteHere || (prefix && (i === 0 || !/\w/.test(src[i - 1]))))) {
      const p = prefix && !quoteHere ? prefix[0].length : 0
      const q = src[i + p]
      const triple = src.slice(i + p, i + p + 3) === q.repeat(3)
      const fence = triple ? q.repeat(3) : q
      const start = i
      let j = i + p + fence.length
      let text = ''
      while (j < src.length && src.slice(j, j + fence.length) !== fence) {
        if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; continue }
        if (!triple && src[j] === '\n') break
        text += src[j]
        j += 1
      }
      i = j + fence.length
      const lineStart = src.lastIndexOf('\n', start - 1) + 1
      if (!(triple && /^\s*$/.test(src.slice(lineStart, start)))) out.push({ text, start })
      continue
    }
    i += 1
  }
  return out
}

// HTML：标签之间的字和属性值；script / style / 注释不算
export function htmlStrings(src) {
  const out = []
  const blank = (m) => m.replace(/[^\n]/g, ' ')
  const clean = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, blank)
  const tag = /<[^>]*>/g
  let last = 0
  let m
  while ((m = tag.exec(clean)) !== null) {
    if (m.index > last) out.push({ text: clean.slice(last, m.index), start: last })
    const attr = /\s[\w:-]+\s*=\s*("([^"]*)"|'([^']*)')/g
    let a
    while ((a = attr.exec(m[0])) !== null) out.push({ text: a[2] ?? a[3] ?? '', start: m.index + a.index })
    last = m.index + m[0].length
  }
  if (last < clean.length) out.push({ text: clean.slice(last), start: last })
  return out
}

const lineAt = (src, index) => src.slice(0, index).split('\n').length

// 一个文件里散写的中文：[{ line, text }]
export function fileHits(rel, root = ROOT) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  const ext = path.extname(rel)
  const found = ext === '.py' ? pyStrings(src) : ext === '.html' ? htmlStrings(src) : jsStrings(src)
  const hits = []
  for (const one of found) {
    // 生成出来的文件里的注释行（// 或 #）不算
    const text = one.text.split('\n').filter((row) => !/^\s*(\/\/|#)/.test(row)).join('\n').trim()
    if (!HAN.test(text)) continue
    const lineStart = src.lastIndexOf('\n', one.start - 1) + 1
    if (ext !== '.html' && LOG_CALL.test(src.slice(lineStart, one.start))) continue
    hits.push({ line: lineAt(src, one.start), text })
  }
  return hits
}

// ---------------------------------------------------------------- app/copy 自己

// 不是文案：错误码用哪句停下来的话、哪一级
const META = new Set(['stop', 'level'])
const NAMES = ['errors', 'status', 'harness', 'ui-desk', 'ui-settings', 'ui-windows']
const bookSource = (name) => fs.readFileSync(path.join(ROOT, 'app', 'copy', `${name}.mjs`), 'utf8')

// 文案文件里的每个键：路径（不含最外层）和它在第几行
export function bookKeys(src) {
  const out = []
  const stack = []
  let pending = null
  let i = src.indexOf('export default')
  let line = src.slice(0, i).split('\n').length
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') { line += 1; i += 1; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    if (c === '"') {
      const start = line
      let j = i + 1
      let text = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; continue }
        text += src[j]
        j += 1
      }
      i = j + 1
      let k = i
      while (/\s/.test(src[k] || '')) k += 1
      if (src[k] === ':') {
        pending = text
        out.push({ path: [...stack.slice(1), text], line: start })
      }
      continue
    }
    if (c === '{' || c === '[') stack.push(pending ?? '')
    else if (c === '}' || c === ']') stack.pop()
    if (c === ',' || c === '{' || c === '[') pending = null
    i += 1
  }
  return out
}

// 走一遍几个文件：每条（有字的那一层）交给 visit(path, node)
function walk(node, at, visit) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const own = Object.entries(node).filter(([key, value]) => !META.has(key) && (typeof value === 'string' || key === 'lines'))
  if (own.length) visit(at, node)
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'lines' && value && typeof value === 'object') walk(value, at ? `${at}.${key}` : key, visit)
  }
}

// app/copy 里所有给人看 / 给模型的字（引用 @xxx 的不算；harness 的 files 是文件说明，不算）
function copyTexts(books = ['errors', 'status', 'harness']) {
  const out = []
  for (const name of books) {
    walk(BOOKS[name], '', (at, node) => {
      for (const [key, value] of Object.entries(node)) {
        if (META.has(key)) continue
        if (key === 'lines' && Array.isArray(value)) out.push({ key: `${at}.lines`, text: value.join('\n') })
        else if (typeof value === 'string' && !value.startsWith('@')) out.push({ key: key === 'text' ? at : `${at}.${key}`, text: value })
      }
    })
  }
  return out
}

test('app/copy：几个文件顶层不重名', () => {
  const seen = new Map()
  for (const [name, book] of Object.entries(BOOKS)) {
    for (const key of Object.keys(book)) {
      assert.ok(!seen.has(key), `「${key}」在 ${seen.get(key)} 和 ${name} 里都有`)
      seen.set(key, name)
    }
  }
})

test('app/copy：开头一段说明这个文件管什么，每条上面一行注释写在哪、什么情况出现', () => {
  const missing = []
  for (const name of NAMES) {
    const src = bookSource(name)
    assert.match(src, /^\/\/ \S/, `${name}.mjs 开头要有一段注释，说明这个文件管什么`)
    const lines = src.split('\n')
    for (const one of bookKeys(src)) {
      const [top, ...rest] = one.path
      // 顶层每条；错误码里每句停下来的话、每个码；界面文案里每组下面的每条
      const need = rest.length === 0
        || (name === 'errors' && rest.length === 1 && (top === 'stops' || top === 'codes'))
        || (name.startsWith('ui-') && rest.length === 1)
      if (need && !/^\s*\/\//.test(lines[one.line - 2] || '')) missing.push(`${name}.mjs:${one.line}  ${one.path.join('.')}`)
    }
  }
  assert.deepEqual(missing, [], `这几条上面没写注释：\n${missing.join('\n')}`)
})

test('app/copy：说明写在注释里，不当成字段（where、todo、_ 这种不许有）', () => {
  const found = []
  for (const name of NAMES) {
    for (const one of bookKeys(bookSource(name))) {
      const last = one.path[one.path.length - 1]
      if (['_', 'where', 'todo', 'about', 'when', 'was'].includes(last)) found.push(`${name}.mjs:${one.line}  ${one.path.join('.')}`)
    }
  }
  assert.deepEqual(found, [], `这些说明要写成注释：\n${found.join('\n')}`)
})

test('app/copy：同一句话只留一条（一样的用 @键 指过去）', () => {
  const byText = new Map()
  for (const one of copyTexts(['errors', 'status', 'harness', 'ui-desk', 'ui-settings', 'ui-windows'])) {
    const list = byText.get(one.text) || []
    list.push(one.key)
    byText.set(one.text, list)
  }
  const twice = [...byText.entries()].filter(([, keys]) => keys.length > 1).map(([text, keys]) => `${keys.join(' / ')}：${text}`)
  assert.deepEqual(twice, [], `同一句话写了好几条：\n${twice.join('\n')}`)
})

test('界面上的字：一句话末尾不加「。」，几句话的照常；一屏里一起列的几条要加都加（harness 给模型的不管）', () => {
  // 一屏里一起列、又有一条是几句话的：整组都带句号（都是一句的组，照上面一句话的规矩都不带）
  const LISTS = [['consent.point1', 'consent.point2', 'consent.point3', 'consent.point4', 'consent.point5']]
  const several = (text) => text.split('。').filter((one) => one.trim()).length > 1
  const listed = new Set(LISTS.flat())
  const bad = []
  for (const one of copyTexts(['errors', 'status', 'ui-desk', 'ui-settings', 'ui-windows'])) {
    if (!listed.has(one.key) && one.text.endsWith('。') && !several(one.text)) bad.push(`${one.key}：${one.text}`)
  }
  for (const keys of LISTS) {
    const want = keys.some((key) => several(t(key)))
    for (const key of keys) if (t(key).endsWith('。') !== want) bad.push(`${key}：${t(key)}（跟同一屏的几条不一致）`)
  }
  assert.deepEqual(bad, [], `这些句号不对：\n${bad.join('\n')}`)
})

test('错误码表里的 Si 码一个不少，停工那句都找得到', () => {
  const want = [
    'Si101', 'Si102', 'Si103', 'Si104',
    // 码表里不许有 Si201–Si203（桌伴自己降权限那层）
    // 码表里不许有 Si304、Si802
    // 码表里不许有 Si306、Si701、Si801
    'Si301', 'Si302', 'Si303', 'Si305',
    // 设置这边：Si1xx 是配置类的毛病，Si2xx/Si3xx/Si8xx/Si9xx 按类放
    'Si105', 'Si106', 'Si108', 'Si109', 'Si110', 'Si111',
    'Si206',
    'Si400', 'Si401', 'Si402', 'Si403', 'Si404', 'Si408', 'Si413', 'Si429',
    'Si500', 'Si502', 'Si503', 'Si504', 'Si601',
    // 码表里不许有 Si703
    'Si702', 'Si704',
    'Si803', 'Si805', 'Si806',
    'Si901', 'Si902', 'Si906', 'Si907', 'Si908',
  ]
  const codes = BOOKS.errors.codes
  assert.deepEqual(Object.keys(codes).sort(), want.slice().sort())
  for (const code of want) {
    // 每个码都分了级：block 报错（停了）、notice 提示（不停）
    assert.ok(['block', 'notice'].includes(codes[code].level), `${code} 没写 level（block / notice）`)
    assert.ok(BOOKS.errors.stops[codes[code].stop], `${code} 的停工那句「${codes[code].stop}」不在 stops 里`)
  }
  // 显示的样子：停工那句 · Si 码 错误，原文
  assert.equal(t('line', { stop: '模型请求失败，已保存执行进度', code: 'Si429', raw: 'Rate limit reached for requests' }), '模型请求失败，已保存执行进度 · Si429 错误，Rate limit reached for requests')
  assert.equal(t('line.short', { stop: '干活的程序没起来', code: 'Si301' }), '干活的程序没起来 · Si301 错误')
})

test('状态码 v5 里的 St 码一个不少', () => {
  const want = [
    'St101', 'St102', 'St103', 'St104',
    // 状态码表里不许有 St202、St203
    ...['St201', 'St204', 'St205', 'St206', 'St207', 'St208', 'St209', 'St210', 'St211', 'St212'],
    'St301', 'St303', 'St304', 'St305', 'St306',
    'St401', 'St402', 'St403', 'St407',
    'St502', 'St601', 'St607',
    'St701', 'St702', 'St703', 'St704', 'St705', 'St706', 'St707', 'St708',
    'St802', 'St803',
  ]
  for (const code of want) assert.ok(BOOKS.status[code], `少了 ${code}`)
  // 不许有 St404、St405、St604、St801
  for (const code of ['St404', 'St405', 'St604', 'St801']) assert.equal(BOOKS.status[code], undefined, `${code} 删了，别写回来`)
  // 几句照 v5 的原话
  assert.equal(t('St301', { after: t('St301.after', { left: 37 }), nth: 5, max: 10 }), '模型忙，37 秒后自动重试（第 5 次，最多 10 次）')
  assert.equal(t('St402', { name: '本地测试MCP' }), '「本地测试MCP」调用失败')
  assert.equal(t('St701', { elapsed: '1 分 20 秒' }), '执行中 · 1 分 20 秒')
  assert.equal(t('St708', { count: 2 }), '执行中 · 2 个任务')
  // 小岛等重试那行：头一截跟任务窗一样按错的种类说，后面接 St702.after
  assert.equal(t('St702.after', { left: 37 }), '37 秒后重试')
})

test('报错那一行只有一份实现：截 80 个字、拼那一行只在 app/copy/line.mjs', () => {
  const hits = []
  for (const rel of appFiles()) {
    if (rel === 'app/copy/line.mjs') continue
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    if (/['"]line\.(text|short)['"]/.test(src)) hits.push(`${rel}  自己拼了报错那一行`)
    if (/\bRAW_MAX\b/.test(src)) hits.push(`${rel}  自己写了截 80 个字`)
    if (/function\s+(errorLine|errorLineText|codeTail|rawText)\b/.test(src)) hits.push(`${rel}  自己写了报错行的函数`)
  }
  assert.deepEqual(hits, [], `报错行的写法只许在 app/copy/line.mjs 一处：\n${hits.join('\n')}`)
})

test('copy.mjs：找不到的键报错，变量照填，没给的变量原样留着', () => {
  assert.throws(() => t('St999'), /St999/)
  assert.throws(() => t('stops.nope'), /stops\.nope/)
  assert.equal(t('St207', { name: '市场.pdf' }), '读《市场.pdf》中')
  assert.equal(t('St207'), '读《{name}》中')
  assert.deepEqual(around('St301', 'after', { nth: 2, max: 10 }), ['模型忙，', '（第 2 次，最多 10 次）'])
  // 「{ }」这种不是变量
  assert.match(t('news.sample', { skeleton: '{}' }), /最外层必须是 \{ \}/)
})

test('copy.mjs 页面也能用：只引同目录的几个文案文件，不引 node: 也不引 electron', () => {
  for (const name of ['copy', ...NAMES]) {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'copy', `${name}.mjs`), 'utf8')
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.match(m[1], /^\.\/[\w-]+\.mjs$/, `${name}.mjs 引了 ${m[1]}`)
  }
})

test('copy.py 读出来的跟 JS 一模一样', (ctx) => {
  const python = process.env.SIDEMATE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const script = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("sidemate_copy", ${JSON.stringify(path.join(ROOT, 'app', 'copy', 'copy.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `books = {n: m.parse_book((m.HERE / f"{n}.mjs").read_text(encoding="utf-8")) for n in ${JSON.stringify(NAMES)}}`,
    'print(json.dumps([books, m.t("agents.text"), m.t("continue.text"), m.t("stops.saveFailed"), m.lines("news.prompt")], ensure_ascii=False))',
  ].join('\n')
  const run = spawnSync(python, ['-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } })
  if (run.error || run.status !== 0) {
    ctx.skip(`这台机器跑不了 ${python}`)
    return
  }
  const [books, ...some] = JSON.parse(run.stdout)
  assert.deepEqual(books, Object.fromEntries(NAMES.map((name) => [name, BOOKS[name]])))
  assert.deepEqual(some, [t('agents.text'), t('continue.text'), t('stops.saveFailed'), t('news.prompt').split('\n')])
})

// ---------------------------------------------------------------- 代码里散写的字

test('扫描本身：注释、正则、文档字符串、日志不算，字符串和页面文字算', () => {
  const js = [
    '// 注释里的中文',
    "const a = /正则里的中文/",
    "log('日志里的中文')",
    "const b = '字符串里的中文'",
    'const c = `模板${x + "里面的中文"}外面`',
    "const d = 1 / 2 / 3; const e = '除号后面'",
  ].join('\n')
  assert.deepEqual(jsStrings(js).map((one) => one.text).filter((one) => HAN.test(one)), ['日志里的中文', '字符串里的中文', '模板', '里面的中文', '外面', '除号后面'])
  const py = ['"""文档字符串"""', '# 注释', 'x = "字符串"', "y = f'格式{z}串'"].join('\n')
  assert.deepEqual(pyStrings(py).map((one) => one.text), ['字符串', '格式{z}串'])
  const html = '<title>标题</title><!-- 注释 --><script>const x = "脚本"</script><p title="提示">正文</p>'
  assert.deepEqual(htmlStrings(html).map((one) => one.text.trim()).filter((one) => HAN.test(one)), ['标题', '提示', '正文'])
})

test('代码里一处散写的中文都不许有（报告有几处）', (ctx) => {
  const outside = []
  let count = 0
  for (const rel of appFiles()) {
    for (const one of fileHits(rel)) {
      outside.push(`${rel}:${one.line}  ${one.text}`)
      count += 1
    }
  }
  ctx.diagnostic(`代码里散写的中文 ${count} 处`)
  assert.deepEqual(outside, [], `这些字散写在代码里，错误码 / 状态码 / 给模型的话放进 app/copy，界面文案放进 ui-*.mjs：\n${outside.join('\n')}`)
})

test('剩下的散写中文里没有错误码、状态码、给模型的话', () => {
  // app/copy 里每一句按变量切开，四个字以上的一截在代码里原样出现就算散写
  const pieces = []
  for (const one of copyTexts()) {
    for (const piece of one.text.split(/\{[A-Za-z][A-Za-z0-9]*\}/)) {
      const bare = piece.trim()
      if (bare.length >= 4 && HAN.test(bare)) pieces.push({ key: one.key, piece: bare })
    }
  }
  const marks = /已保存执行进度|错误码|\bE[1-6]\d{2}\b|\bSi\d{3}\b|\bSt\d{3}\b|桌伴提示/
  const found = []
  for (const rel of appFiles()) {
    for (const one of fileHits(rel)) {
      const same = pieces.find(({ piece }) => one.text.includes(piece))
      if (same) found.push(`${rel}:${one.line}  ${one.text}（app/copy 的 ${same.key} 里已有）`)
      else if (marks.test(one.text)) found.push(`${rel}:${one.line}  ${one.text}`)
    }
  }
  assert.deepEqual(found, [], `代码里还留着 app/copy 里已有的字：\n${found.join('\n')}`)
})

// ---------------------------------------------------------------- 文案键：用到的都在，没人用的不留
//
// 写死的键：JS 里 t / raw / entry / around / errorLine 的第一个参数（三元式里的几个字面量也算），
// stopKeyOf / errorText / codeTail 的码（换成 codes.<码>）；Python 里 COPY.t / COPY.lines / marks.t / t 的第一个参数；
// 页面上 data-t / data-t-placeholder / data-t-title（paint() 只认这三种）；app/copy 里每个 @键。
// 拼出来的键（`stops.${…}`、`codes.${…}`、`files.${…}`、`news.fix.${…}`）按前缀算，前缀后面只算一节。
// 没人用的条目：代码里没以字面量出现（表里存着的 'St201' 也算出现）、没被 @ 指到、也不在拼键的前缀下面。
// 注释不算；测试里用到的不算。

// JS：跟 jsStrings 一样的小词法器，另外给出每个字符串的起止，并把注释、正则、字符串里面抹成空格（找括号用）
export function jsTokens(src) {
  const code = src.split('')
  const strings = []
  let i = 0
  let prev = ''
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (code[k] !== '\n') code[k] = ' ' }
  const readQuoted = (quote) => {
    const start = i
    let text = ''
    i += 1
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') { text += src.slice(i, i + 2); i += 2; continue }
      text += src[i]
      i += 1
    }
    i += 1
    blank(start + 1, i - 1)
    strings.push({ text, tail: '', start, end: i, dynamic: false })
  }
  // 模板字符串：text 是第一个 ${ 前面那截，tail 是最后一个 } 后面那截
  const readTemplate = () => {
    const start = i
    let text = ''
    let tail = ''
    let dynamic = false
    let from = i + 1
    i += 1
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') {
        blank(from, i)
        dynamic = true
        tail = ''
        i += 2
        lex(true)
        from = i
        continue
      }
      if (dynamic) tail += src[i]
      else text += src[i]
      i += 1
    }
    blank(from, i)
    i += 1
    strings.push({ text, tail, start, end: i, dynamic })
  }
  const readRegex = () => {
    const start = i
    i += 1
    let inClass = false
    while (i < src.length && src[i] !== '\n') {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) break
      i += 1
    }
    blank(start + 1, i)
    i += 1
    while (/[a-z]/i.test(src[i] || '')) i += 1
  }
  function lex(untilBrace) {
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      const next = src[i + 1]
      if (c === '/' && next === '/') { const end = src.indexOf('\n', i); blank(i, end < 0 ? src.length : end); i = end < 0 ? src.length : end; continue }
      if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); const to = end < 0 ? src.length : end + 2; blank(i, to); i = to; continue }
      if (c === '\'' || c === '"') { readQuoted(c); prev = 'x'; continue }
      if (c === '`') { readTemplate(); prev = 'x'; continue }
      if (c === '/') {
        if (REGEX_AFTER.has(prev) || REGEX_WORDS.has(prev)) { readRegex(); prev = 'x' } else { i += 1; prev = '/' }
        continue
      }
      if (/[A-Za-z_$]/.test(c)) {
        let word = ''
        while (i < src.length && /[\w$]/.test(src[i])) { word += src[i]; i += 1 }
        prev = word
        continue
      }
      if (untilBrace) {
        if (c === '{') depth += 1
        if (c === '}') {
          if (depth === 0) { i += 1; return }
          depth -= 1
        }
      }
      if (!/\s/.test(c)) prev = /[0-9]/.test(c) ? 'x' : c
      i += 1
    }
  }
  lex(false)
  return { code: code.join(''), strings }
}

const KEY_CALLS = new Set(['t', 'raw', 'entry', 'around', 'errorLine'])
const CODE_CALLS = new Set(['stopKeyOf', 'errorText', 'codeTail'])
const PY_CALL = /(?:\bCOPY\.(?:t|lines)|\bmarks\.t|(?<![\w.])t)\s*\(\s*$/
const DATA_T = /\bdata-t(?:-([\w-]+))?\s*=\s*["']([^"']*)["']/g
const PAINTED = new Set(['', 'placeholder', 'title'])
const KEY_PREFIX = /^[A-Za-z]\w*(?:\.\w+)*\.$/
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 比较里的字面量（三元式的条件 x === 'tool' ? …）：不是键
const COMPARE_BEFORE = /(?:[=!]==?|[<>]=?|&&|\|\|)\s*$/
const COMPARE_AFTER = /^\s*(?:[=!]==?|[<>]=?|&&|\|\||\?)/

// 这个字符串是哪个调用的第一个参数（三元式的两头也算）：往回找没配上的那个括号，看它前面是谁。
// 中间隔着逗号（第二个参数以后）、或者先碰到 { [（对象、数组里的）都不算
function calleeOf(code, at, end) {
  if (COMPARE_BEFORE.test(code.slice(Math.max(0, at - 8), at)) || COMPARE_AFTER.test(code.slice(end, end + 8))) return ''
  let depth = 0
  for (let k = at - 1; k >= 0; k -= 1) {
    const c = code[k]
    if (c === ')' || c === ']' || c === '}') depth += 1
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth -= 1; continue }
      if (c !== '(') return ''
      const name = /(\.?)([\w$]+)\s*$/.exec(code.slice(Math.max(0, k - 40), k))
      return name && !name[1] ? name[2] : ''
    } else if (depth === 0 && (c === ',' || c === ';')) return ''
  }
  return ''
}

// 一个文件里的键：literal 写死的（要查在不在），dynamic 拼出来的（按前缀），seen 出现过的字面量，attrs 页面上的 data-t 属性
export function keyRefs(rel, src) {
  const out = { literal: [], dynamic: [], seen: [], attrs: [] }
  const ext = path.extname(rel)
  const lineOf = (index) => lineAt(src, index)
  const pageAttrs = (text, at) => {
    for (const m of text.matchAll(DATA_T)) {
      out.attrs.push({ name: m[1] || '', line: lineOf(at + m.index) })
      out.literal.push({ key: m[2], line: lineOf(at + m.index) })
      out.seen.push(m[2])
    }
  }
  if (ext === '.html') {
    pageAttrs(src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')), 0)
    return out
  }
  if (ext === '.py') {
    for (const one of pyStrings(src)) {
      out.seen.push(one.text)
      const before = src.slice(src.lastIndexOf('\n', one.start - 1) + 1, one.start)
      if (PY_CALL.test(before)) out.literal.push({ key: one.text, line: lineOf(one.start) })
    }
    return out
  }
  const { code, strings } = jsTokens(src)
  for (const one of strings) {
    const callee = calleeOf(code, one.start, one.end)
    if (one.dynamic) {
      if (KEY_PREFIX.test(one.text)) out.dynamic.push({ prefix: one.text, re: new RegExp(`^${escape(one.text)}[^.]+${escape(one.tail)}$`), line: lineOf(one.start) })
      continue
    }
    out.seen.push(one.text)
    if (KEY_CALLS.has(callee)) out.literal.push({ key: one.text, line: lineOf(one.start) })
    else if (CODE_CALLS.has(callee)) out.literal.push({ key: `codes.${one.text}`, line: lineOf(one.start) })
    if (one.text.includes('data-t')) pageAttrs(one.text, one.start)
  }
  return out
}

// app/copy 里的每一条（有字的那一层）：键的路径。错误码的 stop / level 不是字
export function copyEntries() {
  const out = []
  const visit = (node, at) => {
    if (typeof node === 'string') { out.push(at); return }
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    if (typeof node.text === 'string' || Array.isArray(node.lines)) out.push(at)
    for (const [key, value] of Object.entries(node)) {
      if (META.has(key) || key === 'text' || key === 'lines') continue
      visit(value, at ? `${at}.${key}` : key)
    }
  }
  for (const book of Object.values(BOOKS)) visit(book, '')
  return out
}

// app/copy 里的 @键：指到的那一条
function copyRefs() {
  const out = []
  const visit = (node, at) => {
    if (typeof node === 'string') { if (node.startsWith('@')) out.push({ key: node.slice(1), from: at }); return }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) visit(value, at ? `${at}.${key}` : key)
  }
  for (const book of Object.values(BOOKS)) visit(book, '')
  return out
}

// 键的用法要扫的文件：app 下的代码，加上 app/copy 里拼报错行的 line.mjs（copy.mjs / copy.py 是查表本身，不算）
const keyFiles = () => [...appFiles(), 'app/copy/line.mjs']

// 没人用、又先留着的条目（现在一条都没有）：要留就写进来，并在上面注释说清为什么
const UNUSED_OK = new Set([])

test('文案键的扫描本身：调用的第一个参数、三元式、拼出来的、码、页面属性都认，注释和第二个参数不算', () => {
  const js = [
    "// t('注释.不算')",
    "t('a.b'); raw(\"c\"); around('St301', 'after', { x: 'y' })",
    "t(n > 1 ? 'codes.Si305.all' : 'codes.Si305'); t(p === 'tool' ? 'St103' : 'St101')",
    't(`files.${reason}`); obj.t(\'不是.它\'); errorText(\'Si906\', \'原文\')',
    "const html = '<i data-t=\"top.tasks\" data-t-aria=\"x.y\"></i>'",
  ].join('\n')
  const got = keyRefs('a.mjs', js)
  assert.deepEqual(got.literal.map((one) => one.key), ['a.b', 'c', 'St301', 'codes.Si305.all', 'codes.Si305', 'St103', 'St101', 'codes.Si906', 'top.tasks', 'x.y'])
  assert.deepEqual(got.dynamic.map((one) => one.prefix), ['files.'])
  assert.deepEqual(got.attrs.map((one) => one.name), ['', 'aria'])
  const py = keyRefs('a.py', 'x = COPY.t("files.text")\nlines.extend(COPY.lines("harness.files.text"))\ny = marks.t("skills.readFailed")\n')
  assert.deepEqual(py.literal.map((one) => one.key), ['files.text', 'harness.files.text', 'skills.readFailed'])
  assert.deepEqual(keyRefs('a.html', '<p data-t="sidemate"></p><!-- <p data-t="nope"></p> -->').literal.map((one) => one.key), ['sidemate'])
})

test('代码和页面里写死的键都在 app/copy 里，页面上只用 paint() 认的 data-t 属性，没人用的条目不留', (ctx) => {
  const missing = []
  const attrs = []
  const seen = new Set()
  const dynamic = []
  let count = 0
  for (const rel of keyFiles()) {
    const got = keyRefs(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    count += got.literal.length
    for (const one of got.literal) if (!has(one.key)) missing.push(`${rel}:${one.line}  ${one.key}`)
    for (const one of got.attrs) if (!PAINTED.has(one.name)) attrs.push(`${rel}:${one.line}  data-t-${one.name}`)
    for (const text of got.seen) seen.add(text)
    dynamic.push(...got.dynamic)
  }
  const refs = copyRefs()
  for (const one of refs) if (!has(one.key)) missing.push(`app/copy ${one.from}  @${one.key}`)
  const pointed = new Set(refs.map((one) => one.key))
  const entries = copyEntries()
  const unused = entries.filter((key) => !seen.has(key) && !pointed.has(key) && !dynamic.some((one) => one.re.test(key)) && !UNUSED_OK.has(key))
  ctx.diagnostic(`条目 ${entries.length} 条；写死的键 ${count} 处；拼出来的键 ${dynamic.length} 处；@键 ${refs.length} 个`)
  assert.deepEqual(missing, [], `这些键 app/copy 里没有（t() 会直接抛错）：\n${missing.join('\n')}`)
  assert.deepEqual(attrs, [], `paint() 只认 data-t、data-t-placeholder、data-t-title，这些属性不会换字：\n${attrs.join('\n')}`)
  assert.deepEqual(unused, [], `app/copy 里这些条目没人用：删掉，或者把功能补上：\n${unused.join('\n')}`)
})
