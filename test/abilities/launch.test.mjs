import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { abilityFiles, abilitiesForTask, readTools, webPatchYaml, withAbilities } from '../../app/abilities/launch.mjs'
import { saveMcp } from '../../app/abilities/mcp.mjs'
import { importSkill, listSkills, setEnabled } from '../../app/abilities/skills.mjs'

const tmpBase = process.env.BOXBOX_TMP_DIR || tmpdir()
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpBase, prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 造一个技能文件夹
function makeSkill(root, id) {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: ${id} 的说明\n---\n\n正文。\n`, 'utf8')
  return dir
}

// 造一个工作台：repo 下有自带技能，桌伴目录下有我加的技能
function makeDesk() {
  const repo = scratch('sidemate-ab-repo-')
  const desk = scratch('sidemate-ab-desk-')
  const bundled = makeSkill(join(repo, 'app', 'skills'), 'bundled-one')
  const mine = makeSkill(join(desk, 'skills'), 'mine-one')
  return { repo, desk, bundled, mine, files: abilityFiles({ repo, deskRoot: desk }) }
}

// 假钥匙串：按表回钥匙，缺的回 null；broken 时读一次抛一次
function fakeKeyring(keys = {}, broken = false) {
  return {
    read(id) {
      if (broken) throw new Error('钥匙串打不开')
      return Object.prototype.hasOwnProperty.call(keys, id) ? keys[id] : null
    },
  }
}

// 三条外部工具服务：请求头放钥匙的、网址参数放钥匙的、要钥匙但没存的
const KEY_HEADER = 'gh-key-111'
const KEY_QUERY = 'search-key-222'
const MCP_ENTRIES = [
  { id: 'mcp-github', name: 'GitHub 工具', url: 'https://mcp.github.example/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: true },
  { id: 'mcp-search', name: '搜索服务', url: 'https://s.side.example/mcp', auth: { kind: 'query', name: 'api_key' }, enabled: true },
  { id: 'mcp-nokey', name: '没钥匙的', url: 'https://nokey.example/mcp', auth: { kind: 'header', name: 'X-Key' }, enabled: true },
]
const MCP_KEYS = { 'mcp-github': KEY_HEADER, 'mcp-search': KEY_QUERY }

// 把 mcp 条目写进程序数据目录的 mcp.json
function writeMcpFile(files, entries) {
  mkdirSync(dirname(files.mcpFile), { recursive: true })
  writeFileSync(files.mcpFile, `${JSON.stringify({ mcp: entries }, null, 2)}\n`, 'utf8')
}

// 把联网搜索/读网页的开关写进程序数据目录的 ability.json
function writeToolsFile(files, tools) {
  mkdirSync(dirname(files.stateFile), { recursive: true })
  writeFileSync(files.stateFile, `${JSON.stringify({ tools }, null, 2)}\n`, 'utf8')
}

// 补丁里 tool-web 那一段的文字
function webText(files) {
  return abilitiesForTask({ files, keyring: fakeKeyring() }).patchTexts.join('')
}

test('abilityFiles：目录都按 repo 和程序数据根算，开关和 mcp 分两个文件', () => {
  const files = abilityFiles({ repo: join('C:', 'repo'), deskRoot: join('C:', 'desk') })
  assert.equal(files.bundledDir, join('C:', 'repo', 'app', 'skills'))
  assert.equal(files.recommendedDir, join('C:', 'repo', 'app', 'skills-recommended'))
  assert.equal(files.userDir, join('C:', 'desk', 'skills'))
  assert.equal(files.stateFile, join('C:', 'desk', 'ability.json'))
  assert.equal(files.mcpFile, join('C:', 'desk', 'mcp.json'))
})

test('没有能力.json：自带和我加的技能都挂上，没有外部工具补丁', () => {
  const { files, bundled, mine } = makeDesk()
  const out = abilitiesForTask({ files, keyring: fakeKeyring() })
  assert.equal(out.patchTexts.length, 2, '技能补丁加拦本机/局域网的插件补丁')
  const text = out.patchTexts[0]
  assert.equal(text.includes(JSON.stringify(bundled)), true, '自带技能的目录要挂上')
  assert.equal(text.includes(JSON.stringify(mine)), true, '我加的技能的目录要挂上')
  assert.equal(text.includes('dsh-mcp-client'), false, '没有外部工具条目就不放外部工具补丁')
  assert.deepEqual(out.env, {})
})

test('关掉一个技能后，它的目录不进补丁', () => {
  const { files, bundled, mine } = makeDesk()
  setEnabled(files.stateFile, 'bundled', 'bundled-one', false)
  const text = abilitiesForTask({ files, keyring: fakeKeyring() }).patchTexts.join('')
  assert.equal(text.includes(JSON.stringify(bundled)), false, '关掉的技能不挂')
  assert.equal(text.includes(JSON.stringify(mine)), true, '开着的照挂')
})

test('外部工具：随会话参数交给 dsh，不进补丁也不进环境变量', () => {
  const { files } = makeDesk()
  writeMcpFile(files, MCP_ENTRIES)
  const out = abilitiesForTask({ files, keyring: fakeKeyring(MCP_KEYS) })
  assert.deepEqual(out.env, {}, '外部工具的钥匙不进环境变量')
  assert.equal(out.patchTexts.length, 2, '技能补丁加拦本机/局域网的插件补丁')
  const text = out.patchTexts.join('')
  assert.equal(text.includes(KEY_HEADER), false, '补丁文字里不能有钥匙原文')
  assert.equal(text.includes(KEY_QUERY), false, '补丁文字里不能有钥匙原文')
  assert.equal(text.includes('mcp-github'), false, '外部工具不进补丁')
  // 交给 dsh 的是随会话参数走的服务表：名字去掉 mcp- 前缀，钥匙放请求头或网址参数里
  const github = out.mcpServers.find((one) => one.name === 'github')
  assert.deepEqual(github, {
    type: 'http',
    name: 'github',
    url: 'https://mcp.github.example/mcp',
    headers: [{ name: 'Authorization', value: KEY_HEADER }],
  })
  const search = out.mcpServers.find((one) => one.name === 'search')
  assert.equal(search.url, `https://s.side.example/mcp?api_key=${encodeURIComponent(KEY_QUERY)}`)
  assert.deepEqual(search.headers, [])
  assert.equal(out.mcpServers.some((one) => one.name === 'nokey'), false, '要钥匙但没存的不给')
  // 钥匙原文另有一份（只在内存里传，打码用）
  assert.deepEqual(out.mcpSecrets, [KEY_HEADER, KEY_QUERY])
})

test('联网搜索和读网页：没有 tools 字段 → 不放 tool-web 补丁', () => {
  const { files } = makeDesk()
  const out = abilitiesForTask({ files, keyring: fakeKeyring() })
  assert.equal(out.patchTexts.length, 2, '技能补丁加拦本机/局域网的插件补丁')
  assert.equal(out.patchTexts.join('').includes('tool-web'), false, '都开的时候不动 dsh 原来的行为')
})

test('联网搜索和读网页：开关都写 true → 同样不放补丁', () => {
  const { files } = makeDesk()
  writeToolsFile(files, { search: true, fetch: true })
  const text = webText(files)
  assert.equal(text.includes('tool-web'), false, '都开的时候不动 dsh 原来的行为')
})

test('联网搜索和读网页：没钥匙的事不用桌伴管，dsh 自己撤掉 web_search', () => {
  const { files } = makeDesk()
  writeToolsFile(files, { search: true, fetch: true })
  const text = webText(files)
  assert.equal(text.includes('tool-web'), false, '桌伴不再按钥匙改搜索开关')
})

test('联网搜索和读网页：关掉读网页 → 补丁里 fetch 是 false', () => {
  const { files } = makeDesk()
  writeToolsFile(files, { search: true, fetch: false })
  const text = webText(files)
  assert.equal(text.includes('- id: tool-web'), true)
  assert.equal(text.includes('fetch: false'), true)
  assert.equal(text.includes('search: true'), true)
  assert.equal(text.includes('searchTimeoutMs: 60000'), true)
})

test('联网搜索和读网页：两个都关 → 补丁里两个都是 false', () => {
  const { files } = makeDesk()
  writeToolsFile(files, { search: false, fetch: false })
  const text = webText(files)
  assert.equal(text.includes('search: false'), true)
  assert.equal(text.includes('fetch: false'), true)
  assert.equal(text.includes('searchTimeoutMs: 60000'), true)
})

test('联网搜索和读网页：能力.json 坏了 → 当两个都开', () => {
  const { files } = makeDesk()
  mkdirSync(dirname(files.stateFile), { recursive: true })
  writeFileSync(files.stateFile, '{ 这不是 JSON', 'utf8')
  assert.deepEqual(readTools(files.stateFile), { search: true, fetch: true, localNet: false })
  const text = webText(files)
  assert.equal(text.includes('tool-web'), false, '文件坏了当没记过开关')
})

test('允许访问本地网络：默认关着就挂拦本机/局域网的插件，打开了就不挂', () => {
  const { files } = makeDesk()
  const off = abilitiesForTask({ files, keyring: fakeKeyring() }).patchTexts.join('')
  assert.equal(off.includes('sidemate-local-net'), true, '默认关着：挂上拦本机/局域网的插件')
  writeToolsFile(files, { localNet: true })
  const on = abilitiesForTask({ files, keyring: fakeKeyring() }).patchTexts.join('')
  assert.equal(on.includes('sidemate-local-net'), false, '用户打开了：那个插件不挂')
})

test('能力.json 读不了：记一句日志，任务照样起得来', () => {
  const { files } = makeDesk()
  const logs = []
  const out = abilitiesForTask({ files, keyring: fakeKeyring(), log: (line) => logs.push(line) })
  assert.equal(out.patchTexts.length, 2, '技能补丁还在，拦本机/局域网的插件补丁也在')
  assert.equal(logs.length, 1, '记一句日志')
  assert.equal(logs[0].includes('abilities web skipped'), true)
})

test('readTools：字段缺了就当开，文件没了也算开', () => {
  const { files } = makeDesk()
  writeToolsFile(files, { search: false })
  assert.deepEqual(readTools(files.stateFile), { search: false, fetch: true, localNet: false })
  assert.deepEqual(readTools(join(files.stateFile, '没这个文件')), { search: true, fetch: true, localNet: false })
})

test('webPatchYaml：都开返回空串，否则给一整段 tool-web 配置', () => {
  assert.equal(webPatchYaml({ search: true, fetch: true }), '')
  assert.equal(webPatchYaml({}), '')
  const text = webPatchYaml({ search: false, fetch: true })
  assert.equal(text.includes('- id: tool-web'), true)
  assert.equal(text.includes('    search: false'), true)
  assert.equal(text.includes('    fetch: true'), true)
  assert.equal(text.includes('    searchTimeoutMs: 60000'), true)
})

test('withAbilities：能力的补丁排在模型补丁后面，环境变量合并，外部工具的服务表也合并', () => {
  const picked = {
    ok: true,
    apiKey: 'model-key',
    env: { SIDEMATE_KEY_C_A: 'a' },
    patchTexts: ['routes.yaml'],
    mcpServers: [{ type: 'http', name: 'base', url: 'https://b.example/mcp', headers: [] }],
    mcpSecrets: ['base-key'],
    model: { value: 'c-a/m1', effort: 'low' },
    vendor: '自定义 A',
    free: false,
  }
  const extra = {
    patchTexts: ['技能补丁'],
    env: {},
    mcpServers: [{ type: 'http', name: 'github', url: 'https://g.example/mcp', headers: [] }],
    mcpSecrets: ['github-key'],
  }
  const merged = withAbilities(picked, extra)
  assert.deepEqual(merged.patchTexts, ['routes.yaml', '技能补丁'])
  assert.deepEqual(merged.env, { SIDEMATE_KEY_C_A: 'a' })
  assert.deepEqual(merged.mcpServers.map((one) => one.name), ['base', 'github'])
  assert.deepEqual(merged.mcpSecrets, ['base-key', 'github-key'])
  assert.equal(merged.apiKey, 'model-key')
  assert.deepEqual(merged.model, picked.model)
  assert.equal(merged.vendor, '自定义 A')
  assert.equal(merged.free, false)
  // 模型没算成：原样还回去，不添字段
  const failed = { ok: false, reason: 'key', message: '还没填钥匙' }
  assert.equal(withAbilities(failed, extra), failed)
})

test('钥匙串抛异常：只丢外部工具，技能补丁还在', () => {
  const { files, bundled } = makeDesk()
  writeMcpFile(files, MCP_ENTRIES)
  writeToolsFile(files, { search: true, fetch: true })
  const logs = []
  const out = abilitiesForTask({ files, keyring: fakeKeyring({}, true), log: (line) => logs.push(line) })
  assert.equal(out.patchTexts.length, 2, '技能补丁还在，拦本机/局域网的插件补丁也在')
  assert.equal(out.patchTexts[0].includes(JSON.stringify(bundled)), true)
  assert.deepEqual(out.env, {}, '外部工具的环境变量也不放')
  assert.deepEqual(out.mcpServers, [], '钥匙串读不出来：外部工具一个都不给')
  assert.deepEqual(out.mcpSecrets, [], '钥匙串读不出来：钥匙原文也没有')
  assert.equal(logs.length, 1, '记一句日志')
  assert.equal(logs[0].includes(KEY_HEADER), false, '日志里不带钥匙')
})

test('开关和 mcp 分两个文件：记开关不冲掉 mcp，存 mcp 不冲掉技能开关', () => {
  const { files } = makeDesk()
  saveMcp(files.mcpFile, MCP_ENTRIES.slice(0, 2))
  setEnabled(files.stateFile, 'bundled', 'bundled-one', false)
  const first = JSON.parse(readFileSync(files.stateFile, 'utf8'))
  assert.equal(first.mcp, undefined, '开关文件里没有 mcp 那一摊')
  assert.equal(first.skills['bundled:bundled-one'], false)
  const mcpRaw = JSON.parse(readFileSync(files.mcpFile, 'utf8'))
  assert.equal(mcpRaw.mcp.length, 2)
  saveMcp(files.mcpFile, MCP_ENTRIES.slice(0, 1))
  const second = JSON.parse(readFileSync(files.stateFile, 'utf8'))
  assert.equal(second.skills['bundled:bundled-one'], false, '存 mcp 不冲掉技能开关')
  assert.equal(JSON.parse(readFileSync(files.mcpFile, 'utf8')).mcp.length, 1)
})

// ─── 能力有问题时说一句话 ───────────────────────────────────

// 造一个 frontmatter 名字是中文的技能文件夹（dsh 那头整条当不存在）
function makeNamedSkill(root, id, name) {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: 数一个文本文件里有多少字。\n---\n\n正文第一行。\n`,
    'utf8',
  )
  return dir
}

test('技能名字不合规：导入那一刻就改好，开工时不再每轮改一遍', () => {
  const { files } = makeDesk()
  // 导入：名字改成 dsh 认的写法，界面上显示的还是用户自己起的那个
  const source = makeNamedSkill(join(dirname(files.userDir), '外面'), 'text-stats', '数字统计')
  const done = importSkill(source, files.userDir, { stateFile: files.stateFile })
  assert.equal(done.ok, true, done.message)
  const imported = readFileSync(join(files.userDir, 'text-stats', 'SKILL.md'), 'utf8')
  assert.equal(imported.includes('name: text-stats'), true, '名字要改成 dsh 认的写法')
  assert.equal(imported.includes('数字统计'), true, '原来的名字留在说明里')
  assert.equal(listSkills(files).find((one) => one.id === 'text-stats').name, '数字统计')
  // 开工：不碰技能文件（直接丢进技能目录、没走导入的那种也不改）
  const raw = makeNamedSkill(join(dirname(files.userDir), '技能'), 'raw-skill', '原样技能')
  const before = readFileSync(join(raw, 'SKILL.md'), 'utf8')
  abilitiesForTask({ files, keyring: fakeKeyring() })
  assert.equal(readFileSync(join(raw, 'SKILL.md'), 'utf8'), before)
})
