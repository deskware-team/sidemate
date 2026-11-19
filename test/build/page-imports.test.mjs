// 页面侧（任务窗 / 设置 / 小岛 / BYOK / 同意页）不许引 node: 或 Node 内置模块
//
// 起因：main 上任务窗一片白。app/task/task.js（页面脚本）引了 app/task/wait.mjs，
// wait.mjs 又引了 app/task/ 下一个引 node:path 的模块，页面的 CSP
// （default-src 'self'; script-src 'self'）把整张模块图挡掉，页面脚本一行没跑。
// 这里用静态解析从页面入口出发走完整张模块图，碰到 node: / Node 内置模块 / electron
// 就失败，并把「入口 → a → b → node:path」这条链写进失败信息。
//
// 只用正则解析，不引新依赖。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

// Node 内置模块名（fs、path、child_process…），node: 前缀的另外判
const BUILTINS = new Set(builtinModules)

// 页面侧禁止出现的裸模块名
const FORBIDDEN_BARE = new Set(['electron', 'electron/main', 'electron/renderer'])

// 从源码里抠出所有 import / export from / import() 的模块说明符
const RE_FROM = /(?:^|[\s;}])(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g
const RE_BARE_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g
const RE_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

export function parseSpecifiers(src) {
  const out = []
  for (const re of [RE_FROM, RE_BARE_IMPORT, RE_DYNAMIC]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      if (!out.includes(m[1])) out.push(m[1])
    }
  }
  return out
}

// 相对路径 → 实际文件；返回 null 表示文件不在树上（顺带跳过）
export function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, base + '.mjs', base + '.js', path.join(base, 'index.mjs'), path.join(base, 'index.js')]
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      // 试下一个
    }
  }
  return null
}

// 说明符是不是页面侧禁止的（node: / Node 内置模块 / electron）
export function isForbidden(spec) {
  if (spec.startsWith('node:')) return true
  if (FORBIDDEN_BARE.has(spec)) return true
  if (spec.startsWith('electron/')) return true
  const bare = spec.startsWith('node:') ? spec.slice(5) : spec
  return BUILTINS.has(bare)
}

// 找出所有页面入口（app 下的 html，带 <script type="module" src=…>）
export function findPageEntries(root = ROOT) {
  const appDir = path.join(root, 'app')
  const entries = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full)
      else if (name.endsWith('.html')) {
        const src = fs.readFileSync(full, 'utf8')
        for (const m of src.matchAll(/<script[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["']([^"']+)["']/g)) {
          const script = resolveRelative(full, m[1])
          if (script) entries.push({ html: full, script })
        }
      }
    }
  }
  walk(appDir)
  return entries
}

// 从页面入口出发递归走完整张模块图，返回违规列表
// 每条违规：{ chain: ['入口', 'a', 'b', 'node:path'], file, specifier }
export function analyzePageImports(root = ROOT, entries = findPageEntries(root)) {
  const violations = []
  const rel = (p) => path.relative(root, p).split(path.sep).join('/')

  const walk = (file, chain) => {
    let src
    try {
      src = fs.readFileSync(file, 'utf8')
    } catch {
      return
    }
    for (const spec of parseSpecifiers(src)) {
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const next = resolveRelative(file, spec)
        if (next) walk(next, chain.concat(rel(next)))
      } else if (isForbidden(spec)) {
        violations.push({ chain: chain.concat(spec), file: rel(file), specifier: spec })
      }
    }
  }

  for (const entry of entries) {
    walk(entry.script, [rel(entry.html), rel(entry.script)])
  }
  return violations
}

function describe(v) {
  return v.chain.join(' → ')
}

test('页面入口存在（任务窗 / 设置 / 小岛 / BYOK / 同意页）', () => {
  const entries = findPageEntries(ROOT)
  const htmls = entries.map((e) => path.relative(ROOT, e.html).split(path.sep).join('/'))
  for (const want of ['app/task/task.html', 'app/settings/page.html', 'app/pet/pet.html']) {
    assert.ok(htmls.includes(want), `缺少页面入口 ${want}，实际找到：${htmls.join(', ')}`)
  }
})

test('页面模块图里没有 node: / Node 内置模块 / electron', () => {
  const violations = analyzePageImports(ROOT)
  const msg = violations.map((v) => `  ${describe(v)}（出问题的文件：${v.file}）`).join('\n')
  assert.equal(violations.length, 0, `页面侧模块引了主进程用的模块，页面 CSP 会挡掉整张模块图：\n${msg}`)
})

test('解析函数能抓到 node: 内置模块，并给出入口 → … → node:path 的链', () => {
  const tmp = process.env.BOXBOX_TMP_DIR || os.tmpdir()
  const dir = path.join(tmp, 'pageimp-fake-' + process.pid)
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'app', 'fake.html'), '<script type="module" src="fake.js"></script>')
  fs.writeFileSync(path.join(dir, 'app', 'fake.js'), "import './mid.mjs'\n")
  fs.writeFileSync(path.join(dir, 'app', 'mid.mjs'), "import path from 'node:path'\n")

  const violations = analyzePageImports(dir)
  assert.equal(violations.length, 1, `应抓到 1 条违规，实际 ${violations.length} 条`)
  const chain = violations[0].chain
  assert.equal(chain[0], 'app/fake.html')
  assert.equal(chain[1], 'app/fake.js')
  assert.equal(chain[2], 'app/mid.mjs')
  assert.equal(chain[3], 'node:path')
  assert.equal(violations[0].specifier, 'node:path')
})

test('解析函数在干净的假文件树上不报错（反向证明）', () => {
  const tmp = process.env.BOXBOX_TMP_DIR || os.tmpdir()
  const dir = path.join(tmp, 'pageimp-clean-' + process.pid)
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'app', 'clean.html'), '<script type="module" src="clean.js"></script>')
  fs.writeFileSync(path.join(dir, 'app', 'clean.js'), "import { x } from './helper.mjs'\nexport const y = x\n")
  fs.writeFileSync(path.join(dir, 'app', 'helper.mjs'), "export const x = 1\n")

  const violations = analyzePageImports(dir)
  assert.equal(violations.length, 0, `干净树不该有违规：${violations.map(describe).join('; ')}`)
})
