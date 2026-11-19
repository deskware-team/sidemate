// 界面文案里不出现「免费」两个字：模型线路的界面文案都改口了。
// 允许出现的只有两处文件名（须知正文和同意记录的改名留给后面的文案卡）：
// 「免费通道说明.md」「免费通道同意.json」。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// 扫的目录：界面文案和界面脚本
const DIRS = ['app/copy', 'app/byok', 'app/settings', 'app/consent', 'app/models', 'app/task', 'app/main']
// 文件名里的「免费」不算界面文案
const ALLOWED = ['免费通道说明.md', '免费通道同意.json']

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function clean(text) {
  let out = text
  for (const name of ALLOWED) out = out.split(name).join('')
  return out
}

function filesIn(dir) {
  const out = []
  for (const name of readdirSync(join(ROOT, dir))) {
    if (!/\.(mjs|cjs|js|html)$/.test(name)) continue
    out.push(join(dir, name))
  }
  return out
}

test('app/ 里的界面文案不出现「免费」', () => {
  const bad = []
  for (const dir of DIRS) {
    for (const rel of filesIn(dir)) {
      const text = clean(stripComments(readFileSync(join(ROOT, rel), 'utf8')))
      if (text.includes('免费')) bad.push(rel)
    }
  }
  assert.deepEqual(bad, [], `这些文件里还有「免费」：${bad.join('、')}`)
})

test('模型页和首次运行的文案说的是 Kilo 模型', () => {
  const settings = readFileSync(join(ROOT, 'app/copy/ui-settings.mjs'), 'utf8')
  assert.ok(settings.includes('Kilo 模型'), '模型页的文案里要有 Kilo 模型')
  const windows = readFileSync(join(ROOT, 'app/copy/ui-windows.mjs'), 'utf8')
  assert.ok(windows.includes('Kilo 模型使用须知'), '须知弹窗的标题要是 Kilo 模型使用须知')
})
