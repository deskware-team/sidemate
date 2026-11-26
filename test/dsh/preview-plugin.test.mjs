// 预览（合并进插话插件之后）：起一个真 dsh（acp profile + 合并插件的补丁），用 ACP 调 _sidemate/preview。
// 两个样件各来一次：Word 转 PDF（非空、%PDF 开头、有页数）；带图表的 xlsx 渲成 PNG（至少一张、PNG 魔数）。
// 合并后的插件一个文件注册全部方法：顺手用 _sidemate/quiet_title 探一下插话那几个方法也挂上了。
// 样件只读：先复制到测试的临时目录再交给 dsh。样件只在这台机器上有（C:\deskware\work\shots）：
// 不在就整文件跳过（CI 上没有这两个文件）。

import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { payloadLayout } from '../../app/dsh/index.mjs'
import { killTree } from '../../app/dsh/proc.mjs'
import { PREVIEW_METHOD, QUIET_TITLE_METHOD, writeSteerPlugin } from '../../app/dsh/steer-plugin.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')

// 卡上点名的两个样件（只读，用副本）
const WORD = 'C:\\deskware\\work\\shots\\run2\\docs\\p2-word\\关于下周三家门店工作安排的通知.docx'
const CHART = 'C:\\deskware\\work\\shots\\run\\docs\\p5-chart\\门店客流柱状图.xlsx'

const layout = payloadLayout()
const roots = []
const children = []
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
  copyFileSync(process.execPath, layout.node)
  chmodSync(layout.node, 0o755)
}

after(() => {
  for (const child of children) killTree(child)
  for (const dir of roots) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {
      // Windows 上进程刚收掉还占着文件：删不掉就留给系统清
    }
  }
})

// 极简 JSON-RPC 客户端：一行一个 JSON，只管带 id 的回话
function talk(child) {
  let nextId = 1
  let buffer = ''
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (line === '') continue
      let message = null
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message && message.id !== undefined && pending.has(message.id)) {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) waiter.reject(new Error(message.error.message || 'request failed'))
        else waiter.resolve(message.result)
      }
    }
  })
  return (method, params) =>
    new Promise((done, fail) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve: done, reject: fail })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
}

// 起一个真 dsh：acp profile，补丁由调用方给（带不带 Office 套件服务那行由调用方定）
async function startDsh({ home, patchPath, agentsHome }) {
  const env = {}
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL', 'TZ',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
    'USERNAME', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  const temp = join(home, 'temp')
  mkdirSync(temp, { recursive: true })
  mkdirSync(agentsHome, { recursive: true })
  env.TEMP = temp
  env.TMP = temp
  env.DSH_HOME = join(home, 'dsh')
  env.DSH_AGENTS_HOME = agentsHome
  env.DSH_TELEMETRY_MODE = 'DISABLED'
  env.DSH_TELEMETRY_DISABLED = '1'
  const errLog = []
  const child = spawn(layout.node, [layout.dsh, '--profile', 'acp', '--patch', patchPath], {
    cwd: home,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.push(child)
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => errLog.push(chunk))
  child.on('exit', (code) => {
    if (code !== 0 && errLog.length > 0) console.error('dsh stderr:\n' + errLog.join('').slice(0, 2000))
  })
  const request = talk(child)
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'sidemate-test', version: '0.1.0' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  })
  assert.ok(initialized && typeof initialized === 'object', 'initialize 没回话')
  return { child, request }
}

function writePatch(home, text) {
  const path = join(home, 'patches', 'sidemate-preview.patch.yml')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
  return path
}

// 不带 Office 套件服务那一行的补丁：验「拿不到服务就回明确的错」
function noKitPatch(pluginPath) {
  return [
    '- id: acp',
    '  disabled: true',
    '',
    '- insert:',
    '    - id: sidemate-acp',
    `      name: ${JSON.stringify(pluginPath)}`,
    '      inject: [acpAppStartup]',
    '      config:',
    '        provider: "deepseek-official"',
    '        model: "deepseek-v4-flash"',
    '',
  ].join('\n')
}

const missing = existsSync(WORD) && existsSync(CHART) ? false : '样件不在这台机器上（C:\\deskware\\work\\shots）'

test('真 dsh：合并插件转出非空 PDF、渲出 PNG，第二次命中缓存', { skip: missing, timeout: 300_000 }, async () => {
  ensureNode()
  // 样件先复制（原件只读）
  const docs = scratch('sidemate-preview-docs-')
  const wordCopy = join(docs, '关于下周三家门店工作安排的通知.docx')
  const chartCopy = join(docs, '门店客流柱状图.xlsx')
  copyFileSync(WORD, wordCopy)
  copyFileSync(CHART, chartCopy)

  const home = scratch('sidemate-preview-home-')
  const agentsHome = scratch('sidemate-preview-agents-')
  const written = writeSteerPlugin({ home, payloadRoot: layout.root })
  assert.ok(written, '插件没写出来')
  // 合并后的补丁：Office 套件服务那一行也在
  assert.match(written.patchText, /'@deepseek-ai\/dsh-office-kit'/)
  const patchPath = writePatch(home, written.patchText)
  const { child, request } = await startDsh({ home, patchPath, agentsHome })
  try {
    // Word → PDF：非空、%PDF 开头、页数 ≥ 1
    const firstAt = Date.now()
    const first = await request(PREVIEW_METHOD, { path: wordCopy, kind: 'pdf' })
    const firstMs = Date.now() - firstAt
    assert.equal(first.kind, 'pdf', JSON.stringify(first))
    assert.ok(first.pages >= 1, 'PDF 没报页数')
    const pdfStat = statSync(first.path)
    assert.ok(pdfStat.size > 0 && pdfStat.size === first.bytes, 'PDF 文件是空的或字节数对不上')
    assert.equal(readFileSync(first.path).subarray(0, 5).toString('latin1'), '%PDF-', 'PDF 魔数不对')
    // 同一份再转一次：命中 dsh 自己的缓存会明显变快（第一次本来就很快就不比了）
    const secondAt = Date.now()
    const second = await request(PREVIEW_METHOD, { path: wordCopy, kind: 'pdf' })
    const secondMs = Date.now() - secondAt
    assert.equal(second.pages, first.pages, '第二次页数变了')
    assert.ok(statSync(second.path).size > 0, '第二次的 PDF 是空的')
    console.log(`预览实测：docx→PDF 第一次 ${firstMs}ms，第二次 ${secondMs}ms（页数 ${first.pages}，${first.bytes} 字节）`)
    assert.ok(secondMs < firstMs || firstMs < 500, `第二次没变快：第一次 ${firstMs}ms，第二次 ${secondMs}ms`)

    // 带图表的 xlsx → PNG：至少一张、PNG 魔数、尺寸是正的
    const chartAt = Date.now()
    const chart = await request(PREVIEW_METHOD, { path: chartCopy, kind: 'images' })
    const chartMs = Date.now() - chartAt
    assert.equal(chart.kind, 'images', JSON.stringify(chart))
    assert.ok(chart.images.length >= 1, '一张 PNG 都没渲出来')
    for (const one of chart.images) {
      const bytes = readFileSync(one.file)
      assert.ok(bytes.length > 0 && bytes.subarray(0, 8).equals(PNG_MAGIC), `不是 PNG：${one.file}`)
      assert.ok(one.width > 0 && one.height > 0, `尺寸不对：${one.width}x${one.height}`)
    }
    console.log(`预览实测：xlsx→PNG ${chartMs}ms，${chart.images.length} 张（${chart.images.map((one) => `${one.width}x${one.height}`).join('、')}），页数 ${chart.pages}，dpi ${chart.dpi}`)

    // 同一张表点名 sheet+range（把图表整个罩进去）：默认的已用区域比图表小，会切掉一大截
    const wideAt = Date.now()
    const wide = await request(PREVIEW_METHOD, { path: chartCopy, kind: 'images', sheet: '门店客流', range: 'A1:Q20' })
    const wideMs = Date.now() - wideAt
    assert.equal(wide.kind, 'images', JSON.stringify(wide))
    assert.ok(wide.images.length >= 1, '点名 sheet+range 一张都没渲出来')
    const wideOne = wide.images[0]
    assert.ok(readFileSync(wideOne.file).subarray(0, 8).equals(PNG_MAGIC), '点名 sheet+range 的不是 PNG')
    console.log(`预览实测：xlsx→PNG（sheet+range A1:Q20）${wideMs}ms，${wide.images.length} 张（${wide.images.map((one) => `${one.width}x${one.height}`).join('、')}），区域 ${JSON.stringify(wide.images.map((one) => one.range))}`)
    assert.ok(wideOne.width > chart.images[0].width, '点名更大区域没渲出更大的图')
    console.log(`预览实测：缺字体 ${JSON.stringify(chart.missingFonts)}；PDF 缺字体 ${JSON.stringify(first.missingFonts)}`)

    // 合并后的插件一个文件注册全部方法：插话那一族也挂上了（quiet_title 拿不到会话回 ok:false，不崩）
    const quiet = await request(QUIET_TITLE_METHOD, { sessionId: 'no-such-session' })
    assert.deepEqual(quiet, { ok: false }, JSON.stringify(quiet))

    // 参数错要报明确的错（同一个进程上顺手验）
    await assert.rejects(() => request(PREVIEW_METHOD, { path: wordCopy }), /kind must be/)
    await assert.rejects(() => request(PREVIEW_METHOD, { path: wordCopy, kind: 'sheet' }), /kind must be/)
    await assert.rejects(() => request(PREVIEW_METHOD, { kind: 'pdf' }), /path is required/)
    await assert.rejects(() => request(PREVIEW_METHOD, { path: join(docs, '没有这份文件.docx'), kind: 'pdf' }), /cannot read the file/)
  } finally {
    killTree(child)
  }

  // 没挂 Office 套件服务的 dsh：回明确的错，不是含糊的崩
  const bare = scratch('sidemate-preview-bare-')
  const bareAgents = scratch('sidemate-preview-bare-agents-')
  const barePatch = writePatch(bare, noKitPatch(written.pluginPath))
  const bareDsh = await startDsh({ home: bare, patchPath: barePatch, agentsHome: bareAgents })
  try {
    await assert.rejects(
      () => bareDsh.request(PREVIEW_METHOD, { path: wordCopy, kind: 'pdf' }),
      /office kit is not available/,
    )
  } finally {
    killTree(bareDsh.child)
  }
})
