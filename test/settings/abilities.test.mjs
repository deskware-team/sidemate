// 「能力」页的纯逻辑：小标、第二行字、tools / mcpStatus 的读写、弹窗表单跟条目怎么换、
// 「存下」什么时候能点。存取走临时目录里的 ~/桌伴/能力.json，跟 test/settings/news.test.mjs 那一套。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BUNDLED_DISPLAY,
  MCP_EMPTY_TEXT,
  PROVENANCE_FILE_NAME,
  RECOMMENDED_DISPLAY,
  abilitiesPaths,
  abilitiesView,
  allowedRepoUrl,
  authFromForm,
  canSave,
  defaultAuthName,
  entryInput,
  formFingerprint,
  importUserSkill,
  importedAtText,
  loadMcpStatus,
  loadTools,
  mcpDialogPayload,
  mcpForm,
  mcpNote,
  mcpRows,
  mineNoteParts,
  monthSearches,
  readProvenance,
  removeMcpEntry,
  removeUserSkill,
  saveMcpForm,
  saveMcpStatus,
  saveTool,
  setMcpEnabled,
  setSkillEnabled,
  skillBadge,
  skillRows,
  toolRows,
} from '../../app/settings/abilities.mjs'
import { loadMcp } from '../../app/abilities/mcp.mjs'

// 搭一个临时桌伴根：能力.json 和三种来历的技能目录都落在里面
function stage() {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-settings-ab-'))
  const paths = abilitiesPaths(root, join(root, 'repo'))
  for (const dir of [paths.bundledDir, paths.recommendedDir, paths.userDir, join(root, 'incoming')]) {
    mkdirSync(dir, { recursive: true })
  }
  return { root, ...paths, done: () => rmSync(root, { recursive: true, force: true }) }
}

// 造一个技能文件夹：SKILL.md 带 frontmatter
function makeSkill(dir, id, name, description) {
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(
    join(dir, id, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n正文第一行\n`,
    'utf8',
  )
  return join(dir, id)
}

// 一个不落盘明文的假钥匙串
function fakeKeyring() {
  const store = new Map()
  return {
    has: (id) => store.has(id),
    save: (id, text) => {
      store.set(id, String(text))
      return { ok: true }
    },
    read: (id) => store.get(id) ?? null,
    remove: (id) => store.delete(id),
    dump: () => store,
  }
}

test('路径：状态在 ability.json，工具服务在 mcp.json，三种技能目录跟任务壳那套算法一致', () => {
  const paths = abilitiesPaths(join('C:', '桌'), join('C:', '仓'))
  assert.equal(paths.stateFile, join(join('C:', '桌'), 'ability.json'))
  assert.equal(paths.mcpFile, join(join('C:', '桌'), 'mcp.json'))
  assert.equal(paths.bundledDir, join(join('C:', '仓'), 'app', 'skills'))
  assert.equal(paths.recommendedDir, join(join('C:', '仓'), 'app', 'skills-recommended'))
  assert.equal(paths.userDir, join(join('C:', '桌'), 'skills'))
})

test('来历小标：自带和我加的是纸底，推荐是红边', () => {
  assert.deepEqual(skillBadge('bundled'), { text: '内置', kind: 'bg' })
  assert.deepEqual(skillBadge('mine'), { text: '自定义', kind: 'bg' })
  assert.deepEqual(skillBadge('recommended'), { text: '推荐', kind: 'line' })
})

test('导入日期写成「导入于 MM-DD」', () => {
  assert.equal(importedAtText(new Date(2026, 10, 12, 9, 30).getTime()), '导入于 11-12')
  assert.equal(importedAtText(new Date(2026, 0, 3).getTime()), '导入于 01-03')
})

// 在技能文件夹里写一份 origin.json
function writeProvenance(dir, raw) {
  writeFileSync(join(dir, PROVENANCE_FILE_NAME), JSON.stringify(raw), 'utf8')
}

// AI 装的能力：origin.json 里有仓库、许可证、提交号和安装时间
const PROVENANCE = {
  name: 'Markdown 转 PDF',
  source: 'https://github.com/some-author/md2pdf-skill',
  license: 'MIT',
  updated: '2026-11-11',
  does: '把 Markdown 转成 PDF',
  commit: '1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d',
  installedAt: '2026-11-13T06:00:00.000Z',
  by: 'sidemate',
}

test('AI 装的能力：第二行写「对话中安装于 MM-DD，仓库，许可证 X」，仓库那一段能点', () => {
  const s = stage()
  try {
    const dir = makeSkill(s.userDir, 'md2pdf-skill', 'Markdown 转 PDF', '把 Markdown 转成 PDF')
    writeProvenance(dir, PROVENANCE)
    const rows = skillRows([
      { id: 'md2pdf-skill', source: 'mine', name: 'Markdown 转 PDF', description: '把 Markdown 转成 PDF', enabled: true, dir },
    ])
    assert.equal(rows[0].note, '对话中安装于 11-13，github.com/some-author/md2pdf-skill，许可证 MIT')
    // 第二行分成几段，仓库那一段带地址；设置里的行不用「· 」隔开
    const parts = rows[0].parts
    assert.equal(parts.length, 3)
    assert.equal(parts[0].text, '对话中安装于 11-13')
    assert.equal(parts[1].text, 'github.com/some-author/md2pdf-skill')
    assert.equal(parts[1].url, 'https://github.com/some-author/md2pdf-skill')
    // 鼠标停上去写前 7 位提交号
    assert.ok(parts[1].title.includes('1a2b3c4'), parts[1].title)
    assert.equal(parts[2].text, '许可证 MIT')
    assert.equal(rows[0].note.includes(' · '), false)
  } finally {
    s.done()
  }
})

test('AI 装的能力：没写许可证就写「许可证未注明」', () => {
  const s = stage()
  try {
    const dir = makeSkill(s.userDir, 'md2pdf-skill', 'Markdown 转 PDF', '把 Markdown 转成 PDF')
    writeProvenance(dir, { ...PROVENANCE, license: '' })
    const rows = skillRows([
      { id: 'md2pdf-skill', source: 'mine', name: 'Markdown 转 PDF', description: '', enabled: true, dir },
    ])
    assert.equal(rows[0].note, '对话中安装于 11-13，github.com/some-author/md2pdf-skill，许可证未注明')
  } finally {
    s.done()
  }
})

test('自己拖进来的技能：没有 origin.json 就照旧写「导入于 MM-DD」', () => {
  const s = stage()
  try {
    const dir = makeSkill(s.userDir, 'week-report', '周报写法', '照老规矩写周报')
    const rows = skillRows([
      { id: 'week-report', source: 'mine', name: '周报写法', description: '照老规矩写周报', enabled: true, dir },
    ])
    assert.equal(rows[0].note, importedAtText(statSync(join(dir, 'SKILL.md')).mtimeMs))
    assert.match(rows[0].note, /^导入于 \d{2}-\d{2}$/)
    assert.deepEqual(rows[0].parts, [])
  } finally {
    s.done()
  }
})

test('origin.json 不可信：地址不是 GitHub、字段类型不对，都当没有', () => {
  const s = stage()
  try {
    const dir = makeSkill(s.userDir, 'bad-skill', '坏技能', '来历不可信')
    writeProvenance(dir, { ...PROVENANCE, source: 'https://evil.example.com/a/b' })
    assert.equal(readProvenance(dir), null)
    const rows = skillRows([
      { id: 'bad-skill', source: 'mine', name: '坏技能', description: '', enabled: true, dir },
    ])
    assert.match(rows[0].note, /^导入于 \d{2}-\d{2}$/)
    assert.deepEqual(rows[0].parts, [])
    // 字段类型不对的也一样当没有
    writeProvenance(dir, { ...PROVENANCE, license: 123 })
    assert.equal(readProvenance(dir), null)
    writeProvenance(dir, { ...PROVENANCE, source: 42 })
    assert.equal(readProvenance(dir), null)
    // 只有 GitHub 仓库地址才给点
    assert.equal(allowedRepoUrl('https://github.com/some-author/md2pdf-skill'), 'https://github.com/some-author/md2pdf-skill')
    assert.equal(allowedRepoUrl('https://evil.example.com/a/b'), '')
    assert.equal(allowedRepoUrl('http://github.com/a/b'), '')
    assert.equal(allowedRepoUrl(''), '')
    assert.equal(mineNoteParts({ dir }), null)
  } finally {
    s.done()
  }
})

test('技能行：名字、小标、第二行字、删按钮和开关', () => {
  const s = stage()
  try {
    makeSkill(s.bundledDir, 'word-count', '数字数', '数一份文件有多少字')
    makeSkill(s.recommendedDir, 'flow-chart', '画流程图', '画流程图、时间线')
    const mine = makeSkill(s.userDir, 'week-report', '周报写法', '照老规矩写周报')
    const rows = skillRows(
      [
        { id: 'word-count', source: 'bundled', name: '数字数', description: '数一份文件有多少字', enabled: true, dir: join(s.bundledDir, 'word-count') },
        { id: 'flow-chart', source: 'recommended', name: '画流程图', description: '画流程图、时间线', enabled: false, dir: join(s.recommendedDir, 'flow-chart') },
        { id: 'week-report', source: 'mine', name: '周报写法', description: '照老规矩写周报', enabled: true, dir: mine },
      ],
    )
    assert.equal(rows[0].badge.text, '内置')
    assert.equal(rows[0].note, '数一份文件有多少字')
    assert.deepEqual(rows[0].buttons, [])
    assert.equal(rows[1].badge.kind, 'line')
    assert.equal(rows[1].enabled, false)
    assert.equal(rows[2].removable, true)
    assert.deepEqual(rows[2].buttons, [{ id: 'remove', label: '删除' }])
    // 我加的第二行是 SKILL.md 的修改日期
    const mtime = statSync(join(mine, 'SKILL.md')).mtimeMs
    assert.equal(rows[2].note, importedAtText(mtime))
    assert.match(rows[2].note, /^导入于 \d{2}-\d{2}$/)
  } finally {
    s.done()
  }
})

test('推荐技能的显示表：表里的用页面名字，表外的还用 SKILL.md 那两行', () => {
  // 名字和第二行：画流程图
  assert.equal(RECOMMENDED_DISPLAY['sidemate-diagram'].name, '画流程图')
  assert.equal(RECOMMENDED_DISPLAY['sidemate-diagram'].note, '流程图、分工图、时间线')
  for (const word of ['terminal', 'git', 'patch', 'MCP', 'token']) {
    for (const one of Object.values(RECOMMENDED_DISPLAY)) {
      assert.equal(one.note.includes(word), false, `说明里不该出现 ${word}`)
    }
  }
  const rows = skillRows([
    { id: 'sidemate-diagram', source: 'recommended', name: 'sidemate-diagram', description: '用随包脚本画图。', enabled: false, dir: 'x' },
    { id: 'flow-chart', source: 'recommended', name: '画流程图', description: '画流程图、时间线', enabled: false, dir: 'x' },
  ])
  const diagram = rows.find((row) => row.id === 'sidemate-diagram')
  assert.equal(diagram.name, '画流程图')
  assert.equal(diagram.note, RECOMMENDED_DISPLAY['sidemate-diagram'].note)
  assert.equal(diagram.badge.text, '推荐')
  // 表里没有的推荐技能还用 SKILL.md 的 name / description
  const flow = rows.find((row) => row.id === 'flow-chart')
  assert.equal(flow.name, '画流程图')
  assert.equal(flow.note, '画流程图、时间线')
})

test('随包的推荐技能出现在能力页：「画流程图」默认开', () => {
  // 用仓库里的真实目录，不搭临时目录：页面看到的就是随包那套
  const root = mkdtempSync(join(tmpdir(), 'sidemate-settings-rec-'))
  try {
    const paths = abilitiesPaths(root)
    const view = abilitiesView(paths, {})
    // 画流程图是推荐技能，页面叫「画流程图」，默认开
    const diagram = view.skills.find((one) => one.id === 'sidemate-diagram')
    assert.ok(diagram, '能力页里要有 sidemate-diagram')
    assert.equal(diagram.source, 'recommended')
    assert.equal(diagram.name, '画流程图')
    assert.equal(diagram.note, '流程图、分工图、时间线')
    assert.equal(diagram.enabled, true, '「画流程图」默认开着')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('自带技能的显示表：表里的用页面名字，内部用的不列出来', () => {
  assert.equal(BUNDLED_DISPLAY['sidemate-writing'].name, '写材料')
  assert.equal(BUNDLED_DISPLAY['sidemate-writing'].note, '列提纲、成段写、通读改')
  const rows = skillRows([
    { id: 'sidemate-skill-install', source: 'bundled', name: 'sidemate-skill-install', description: '说一句就装技能', enabled: true, dir: 'x' },
    { id: 'sidemate-writing', source: 'bundled', name: 'sidemate-writing', description: '写方案、报告、总结，长长的一句', enabled: true, dir: 'x' },
    { id: 'word-count', source: 'bundled', name: '数字数', description: '数一份文件有多少字', enabled: true, dir: 'x' },
    { id: 'flow-chart', source: 'recommended', name: '画流程图', description: '画流程图、时间线', enabled: true, dir: 'x' },
  ])
  // 内部用的那个不列出来
  assert.equal(rows.some((row) => row.id === 'sidemate-skill-install'), false)
  // 表里的用页面名字和稿上那句
  const writing = rows.find((row) => row.id === 'sidemate-writing')
  assert.equal(writing.name, '写材料')
  assert.equal(writing.note, '列提纲、成段写、通读改')
  // 表里没有的还用 SKILL.md 的 name / description；推荐的不受影响
  assert.equal(rows.find((row) => row.id === 'word-count').name, '数字数')
  assert.equal(rows.find((row) => row.id === 'word-count').note, '数一份文件有多少字')
  assert.equal(rows.find((row) => row.id === 'flow-chart').badge.kind, 'line')
})

test('技能开关只记状态，tools / mcp 等别的字段不动', () => {
  const s = stage()
  try {
    writeFileSync(s.stateFile, JSON.stringify({ tools: { search: false } }), 'utf8')
    writeFileSync(s.mcpFile, JSON.stringify({ mcp: [{ id: 'mcp-one', name: '一', url: 'https://a.example.test', auth: { kind: 'none', name: '' }, enabled: true }] }), 'utf8')
    setSkillEnabled(s.stateFile, 'mine', 'week-report', false)
    const raw = JSON.parse(readFileSync(s.stateFile, 'utf8'))
    assert.equal(raw.skills['mine:week-report'], false)
    assert.deepEqual(raw.tools, { search: false })
    // 工具服务的条目在 mcp.json 里，技能开关不碰它
    assert.equal(JSON.parse(readFileSync(s.mcpFile, 'utf8')).mcp.length, 1)
  } finally {
    s.done()
  }
})

test('导入和删技能：走 app/abilities/skills.mjs 那套检查', () => {
  const s = stage()
  try {
    // 这里用 ASCII 目录当用户技能目录：本机 node 的 cpSync 遇上中文目的路径会静默不拷，
    // 那是 app/abilities/skills.mjs 自己的毛病，在 test/abilities 里测
    const user = join(s.root, 'user')
    const from = makeSkill(join(s.root, 'incoming'), 'my-skill', '我的技能', '一句话说明')
    const back = importUserSkill(user, from)
    assert.equal(back.ok, true)
    assert.equal(back.id, 'my-skill')
    const again = importUserSkill(user, from)
    assert.equal(again.ok, false)
    const removed = removeUserSkill(user, 'my-skill')
    assert.equal(removed.ok, true)
    const missing = removeUserSkill(user, 'my-skill')
    assert.equal(missing.ok, false)
  } finally {
    s.done()
  }
})

test('tools 字段：默认搜索和读网页都开、允许访问本地网络关着，记一个开关不动别的字段', () => {
  const s = stage()
  try {
    assert.deepEqual(loadTools(s.stateFile), { search: true, fetch: true, localNet: false })
    writeFileSync(s.stateFile, JSON.stringify({ skills: { 'bundled:a': false }, mcp: [] }), 'utf8')
    const back = saveTool(s.stateFile, 'search', false)
    assert.equal(back.ok, true)
    assert.deepEqual(loadTools(s.stateFile), { search: false, fetch: true, localNet: false })
    const raw = JSON.parse(readFileSync(s.stateFile, 'utf8'))
    assert.deepEqual(raw.skills, { 'bundled:a': false })
    assert.equal(saveTool(s.stateFile, '别的', true).ok, false)
  } finally {
    s.done()
  }
})

test('允许访问本地网络：记下开关，读网页关着时那一行置灰', () => {
  const s = stage()
  try {
    const back = saveTool(s.stateFile, 'localNet', true)
    assert.equal(back.ok, true)
    assert.equal(loadTools(s.stateFile).localNet, true)
    const rows = toolRows(loadTools(s.stateFile), { hasKey: true, searches: 0 })
    const one = rows.find((row) => row.id === 'localNet')
    assert.equal(one.name, '允许访问本地网络')
    assert.equal(one.note, '打开后，读网页时可以访问本机和局域网里的地址')
    assert.equal(one.enabled, true)
    assert.equal(one.disabled, false)
    // 读网页关着：这一行置灰
    const off = toolRows({ search: true, fetch: false, localNet: true }, { hasKey: true, searches: 0 })
    const grey = off.find((row) => row.id === 'localNet')
    assert.equal(grey.disabled, true)
    assert.equal(grey.enabled, false)
  } finally {
    s.done()
  }
})

test('这个月搜了几次：按自然月加起来', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()
  const records = [
    { at: new Date(2026, 10, 1).getTime(), searches: 3 },
    { at: new Date(2026, 10, 12).getTime(), searches: 4 },
    { at: new Date(2026, 9, 20).getTime(), searches: 100 },
    { at: new Date(2026, 10, 2).getTime() },
  ]
  assert.equal(monthSearches(records, now), 7)
  assert.equal(monthSearches([], now), 0)
})

test('联网搜索两行：没配钥匙时灰掉并显示关，读网页不用钥匙', () => {
  const rows = toolRows({ search: true, fetch: true }, { hasKey: false, searches: 126 })
  assert.equal(rows[0].name, '联网搜索')
  assert.deepEqual(rows[0].badges.map((one) => one.text), ['内置', '需填入 DeepSeek 密钥'])
  assert.equal(rows[0].badges[1].kind, 'line')
  assert.equal(rows[0].note, '本月搜索 126 次')
  assert.equal(rows[0].disabled, true)
  assert.equal(rows[0].enabled, false)
  assert.equal(rows[1].name, '读取网页')
  assert.equal(rows[1].note, '读取网页文字，无需密钥')
  assert.equal(rows[1].disabled, false)
  assert.equal(rows[1].enabled, true)
  const withKey = toolRows({ search: false, fetch: true }, { hasKey: true, searches: 0 })
  // 填了密钥：「需填入 DeepSeek 密钥」那块小标摘掉，只留「内置」
  assert.deepEqual(withKey[0].badges.map((one) => one.text), ['内置'])
  assert.equal(withKey[0].disabled, false)
  assert.equal(withKey[0].enabled, false)
  assert.equal(withKey[0].note, '本月搜索 0 次')
})

test('服务第二行字：通了几个工具、没测、没连上', () => {
  assert.equal(mcpNote({}, { ok: true, tools: 3, message: '', at: 1 }), '已连接 3 个工具')
  assert.equal(mcpNote({}, null), '未测试')
  assert.equal(mcpNote({}, undefined), '未测试')
  assert.equal(mcpNote({}, { ok: false, tools: 0, message: '钥匙不对', at: 1 }), '连接失败：钥匙不对')
})

test('服务行：我加的小标、改按钮和开关', () => {
  const rows = mcpRows(
    [
      { id: 'mcp-one', name: '另一家搜索', url: 'https://a.example.test', enabled: true },
      { id: 'mcp-two', name: '公司知识库', url: 'https://b.example.test', enabled: false },
    ],
    { 'mcp-one': { ok: true, tools: 3, message: '', at: 1 } },
  )
  assert.equal(rows[0].badge.text, '自定义')
  assert.equal(rows[0].note, '已连接 3 个工具')
  assert.deepEqual(rows[0].buttons, [{ id: 'edit', label: '修改' }])
  assert.equal(rows[1].enabled, false)
  assert.equal(rows[1].note, '未测试')
})

test('mcpStatus：只动那一个字段，结果只留四个字段', () => {
  const s = stage()
  try {
    writeFileSync(s.stateFile, JSON.stringify({ skills: { 'mine:a': true }, tools: { fetch: false } }), 'utf8')
    saveMcpStatus(s.mcpFile, 'mcp-one', { ok: true, tools: 3, message: '连上了', at: 123 })
    assert.deepEqual(loadMcpStatus(s.mcpFile), { 'mcp-one': { ok: true, tools: 3, message: '连上了', at: 123 } })
    const raw = JSON.parse(readFileSync(s.stateFile, 'utf8'))
    assert.deepEqual(raw.skills, { 'mine:a': true })
    assert.deepEqual(raw.tools, { fetch: false })
  } finally {
    s.done()
  }
})

test('弹窗表单跟条目互相换：放法总选中一个，名字预填默认名', () => {
  assert.equal(defaultAuthName('header'), 'Authorization')
  assert.equal(defaultAuthName('query'), 'key')
  // 新建：默认「请求头」，名字预填 Authorization
  const empty = mcpForm(null)
  assert.equal(empty.id, '')
  assert.equal(empty.authKind, 'header')
  assert.equal(empty.authName, 'Authorization')
  assert.equal(empty.hasSavedKey, false)
  // 条目存的是网址参数：选网址参数，名字用它存的
  const filled = mcpForm({ id: 'mcp-one', name: '另一家搜索', url: 'https://a.example.test/mcp', auth: { kind: 'header', name: 'Authorization' }, enabled: false }, { hasSavedKey: true })
  assert.equal(filled.authKind, 'header')
  assert.equal(filled.authName, 'Authorization')
  assert.equal(filled.hasSavedKey, true)
  assert.equal(filled.enabled, false)
  // 条目存的是不用钥匙：也默认选请求头，名字预填 Authorization
  const plain = mcpForm({ id: 'mcp-two', name: '公司知识库', url: 'https://b.example.test/mcp', auth: { kind: 'none', name: '' }, enabled: true })
  assert.equal(plain.authKind, 'header')
  assert.equal(plain.authName, 'Authorization')
  // 存过的名字照用；没存名字的按放法预填
  assert.equal(mcpForm({ auth: { kind: 'query', name: 'token' } }).authName, 'token')
  assert.equal(mcpForm({ auth: { kind: 'query', name: '' } }).authName, 'key')
})

test('表单收成条目的 auth：值空着又没旧钥匙就当不用钥匙', () => {
  const base = { id: '', name: '一', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', enabled: true }
  assert.deepEqual(authFromForm({ ...base, secret: 'abc' }), { kind: 'header', name: 'Authorization' })
  assert.deepEqual(authFromForm({ ...base, authKind: 'query', authName: ' token ', secret: 'abc' }), { kind: 'query', name: 'token' })
  // 值空着、没有旧钥匙：存 none
  assert.deepEqual(authFromForm({ ...base, secret: '' }), { kind: 'none', name: '' })
  // 值空着但有旧钥匙：放法照选的来，沿用旧钥匙
  assert.deepEqual(authFromForm({ ...base, secret: '', hasSavedKey: true }), { kind: 'header', name: 'Authorization' })
  // 网址型写明 transport: 'http'：改条目时从本机程序换回网址型要靠它
  assert.deepEqual(entryInput({ ...base, secret: 'abc', name: ' 另一家搜索 ', url: ' https://a.example.test/mcp ' }), {
    name: '另一家搜索',
    auth: { kind: 'header', name: 'Authorization' },
    enabled: true,
    transport: 'http',
    url: 'https://a.example.test/mcp',
  })
})

test('本机程序的表单：钥匙放进 envName 那个环境变量，参数一行一个，普通环境变量原样带着', () => {
  const base = { id: '', name: ' 本地搜索 ', transport: 'stdio', command: ' C:\\tools\\search.exe ', args: 'serve\n\n --fast \n', envName: ' SEARCH_API_KEY ', env: { REGION: 'cn' }, enabled: true }
  assert.deepEqual(authFromForm({ ...base, secret: 'abc' }), { kind: 'env', name: 'SEARCH_API_KEY' })
  assert.deepEqual(authFromForm({ ...base, secret: '' }), { kind: 'none', name: '' })
  assert.deepEqual(authFromForm({ ...base, secret: '', hasSavedKey: true }), { kind: 'env', name: 'SEARCH_API_KEY' })
  assert.deepEqual(entryInput({ ...base, secret: 'abc' }), {
    name: '本地搜索',
    auth: { kind: 'env', name: 'SEARCH_API_KEY' },
    enabled: true,
    transport: 'stdio',
    command: 'C:\\tools\\search.exe',
    args: ['serve', '--fast'],
    env: { REGION: 'cn' },
  })
  // 指纹：程序、参数、变量名、钥匙一改就要重测
  const fp = formFingerprint({ ...base, secret: 'abc' })
  assert.notEqual(fp, formFingerprint({ ...base, secret: 'abc', command: 'C:\\tools\\other.exe' }))
  assert.notEqual(fp, formFingerprint({ ...base, secret: 'abc', args: 'serve' }))
  assert.notEqual(fp, formFingerprint({ ...base, secret: 'abd' }))
  assert.equal(fp, formFingerprint({ ...base, secret: 'abc', args: 'serve\n--fast' }), '空行和两头空白不算改动')
})

test('「存下」什么时候能点：测通过，而且测的就是现在这份表单', () => {
  const form = { id: '', name: '一', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'abc', enabled: true }
  const test1 = { ok: true, tools: ['x'], message: '连上了', fingerprint: formFingerprint(form) }
  assert.equal(canSave(form, test1), true)
  assert.equal(canSave({ ...form, url: 'https://b.example.test/mcp' }, test1), false)
  assert.equal(canSave({ ...form, secret: 'abcd' }, test1), false)
  assert.equal(canSave({ ...form, authKind: 'query' }, test1), false)
  assert.equal(canSave({ ...form, authName: 'X-Key' }, test1), false)
  assert.equal(canSave(form, { ...test1, ok: false }), false)
  assert.equal(canSave(form, null), false)
  // 钥匙原文不进指纹本身，指纹只是个短哈希
  assert.equal(formFingerprint(form).includes('abc'), false)
  // 值空着又没旧钥匙：放法那一段按 none 算，跟页面里同一个口径
  const noKey = { ...form, secret: '' }
  const test2 = { ok: true, tools: [], message: '', fingerprint: formFingerprint(noKey) }
  assert.equal(canSave(noKey, test2), true)
  assert.equal(formFingerprint(noKey).includes('header'), false)
  assert.equal(canSave({ ...noKey, hasSavedKey: true }, test2), false)
})

test('「存下」写盘失败：是那一句、那一个码（Si907）', () => {
  const s = stage()
  try {
    const keyring = fakeKeyring()
    const blocker = join(tmpdir(), `sidemate-mcp-block-${process.pid}`)
    writeFileSync(blocker, 'x')
    const form = { id: '', name: '公司知识库', url: 'https://kb.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'k1', enabled: true }
    const test1 = { ok: true, tools: ['搜网页'], message: '连上了', fingerprint: formFingerprint(form) }
    const back = saveMcpForm(join(blocker, '能力.json'), form, test1, keyring)
    assert.equal(back.ok, false)
    assert.deepEqual(back.errors, ['保存失败 · Si907 错误'])
  } finally {
    s.done()
  }
})

test('弹窗那份 payload：新建给空表单，改给填好的，没有的条目报错', () => {
  const s = stage()
  try {
    const keyring = fakeKeyring()
    const fresh = mcpDialogPayload(s.mcpFile, null, keyring)
    assert.equal(fresh.ok, true)
    assert.equal(fresh.form.id, '')
    const saved = saveMcpForm(s.mcpFile, { name: '另一家搜索', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'abc123', enabled: true }, { ok: true, tools: ['x'], message: '连上了', fingerprint: formFingerprint({ url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'abc123' }) }, keyring)
    assert.equal(saved.ok, true)
    const edit = mcpDialogPayload(s.mcpFile, saved.id, keyring)
    assert.equal(edit.ok, true)
    assert.equal(edit.form.id, saved.id)
    assert.equal(edit.form.name, '另一家搜索')
    assert.equal(edit.form.hasSavedKey, true)
    assert.equal(mcpDialogPayload(s.mcpFile, 'mcp-nope', keyring).ok, false)
  } finally {
    s.done()
  }
})

test('「存下」：没测过不让存；测通过的存条目、记结果、钥匙进钥匙串', () => {
  const s = stage()
  try {
    const keyring = fakeKeyring()
    writeFileSync(s.stateFile, JSON.stringify({ skills: { 'bundled:a': true } }), 'utf8')
    const form = { id: '', name: '公司知识库', url: 'https://kb.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'k1', enabled: true }
    assert.equal(saveMcpForm(s.mcpFile, form, null, keyring).ok, false)
    const wrong = saveMcpForm(s.mcpFile, form, { ok: true, tools: [], message: '', fingerprint: '旧指纹' }, keyring)
    assert.equal(wrong.ok, false)
    const test1 = { ok: true, tools: ['搜网页', '读网页'], message: '连上了，有 2 个工具', fingerprint: formFingerprint(form) }
    const back = saveMcpForm(s.mcpFile, form, test1, keyring)
    assert.equal(back.ok, true)
    const entries = loadMcp(s.mcpFile)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, '公司知识库')
    assert.equal(entries[0].auth.kind, 'header')
    assert.deepEqual(loadMcpStatus(s.mcpFile)[back.id], { ok: true, tools: 2, message: '连上了，有 2 个工具', at: loadMcpStatus(s.mcpFile)[back.id].at })
    assert.equal(keyring.dump().get(back.id), 'k1')
    // 值空着又没旧钥匙：存的时候 auth 是 none，也不进钥匙串
    const plain = { id: '', name: '不要钥匙的', url: 'https://c.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: '', enabled: true }
    const back2 = saveMcpForm(s.mcpFile, plain, { ok: true, tools: [], message: '', fingerprint: formFingerprint(plain) }, keyring)
    assert.equal(back2.ok, true)
    const plainSaved = loadMcp(s.mcpFile).find((one) => one.id === back2.id)
    assert.equal(plainSaved.auth.kind, 'none')
    assert.equal(keyring.dump().has(back2.id), false)
    const raw = JSON.parse(readFileSync(s.stateFile, 'utf8'))
    assert.deepEqual(raw.skills, { 'bundled:a': true })
  } finally {
    s.done()
  }
})

test('改条目：值留空沿用旧钥匙；没有旧钥匙、值空着存 none', () => {
  const s = stage()
  try {
    const keyring = fakeKeyring()
    const form = { id: '', name: '一', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'old-one', enabled: true }
    const added = saveMcpForm(s.mcpFile, form, { ok: true, tools: [], message: '', fingerprint: formFingerprint(form) }, keyring)
    assert.equal(added.ok, true)
    // 改名字、值留空：有旧钥匙就沿用，放法照选的来
    const keep = { id: added.id, name: '一改', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: '', enabled: true, hasSavedKey: true }
    const back = saveMcpForm(s.mcpFile, keep, { ok: true, tools: [], message: '', fingerprint: formFingerprint(keep) }, keyring)
    assert.equal(back.ok, true)
    assert.equal(loadMcp(s.mcpFile)[0].name, '一改')
    assert.equal(loadMcp(s.mcpFile)[0].auth.kind, 'header')
    assert.equal(keyring.dump().get(added.id), 'old-one')
    // 另存一个没钥匙的，再改它：值空着、没旧钥匙，存 none
    const plain = { id: '', name: '二', url: 'https://b.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: '', enabled: true }
    const added2 = saveMcpForm(s.mcpFile, plain, { ok: true, tools: [], message: '', fingerprint: formFingerprint(plain) }, keyring)
    assert.equal(added2.ok, true)
    assert.equal(loadMcp(s.mcpFile).find((one) => one.id === added2.id).auth.kind, 'none')
  } finally {
    s.done()
  }
})

test('服务开关只改 enabled；删条目连结果和钥匙一起清', () => {
  const s = stage()
  try {
    const keyring = fakeKeyring()
    const form = { id: '', name: '一', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'k1', enabled: true }
    const added = saveMcpForm(s.mcpFile, form, { ok: true, tools: ['x'], message: '', fingerprint: formFingerprint(form) }, keyring)
    setMcpEnabled(s.mcpFile, added.id, false)
    assert.equal(loadMcp(s.mcpFile)[0].enabled, false)
    const back = removeMcpEntry(s.mcpFile, added.id, keyring)
    assert.equal(back.ok, true)
    assert.equal(loadMcp(s.mcpFile).length, 0)
    assert.deepEqual(loadMcpStatus(s.mcpFile), {})
    assert.equal(keyring.dump().has(added.id), false)
  } finally {
    s.done()
  }
})

test('整页的数据：三张卡的行都拼得出来，空状态那句话写死', () => {
  const s = stage()
  try {
    makeSkill(s.bundledDir, 'word-count', '数字数', '数一份文件有多少字')
    makeSkill(s.recommendedDir, 'flow-chart', '画流程图', '画流程图')
    makeSkill(s.userDir, 'week-report', '周报写法', '照老规矩写周报')
    setSkillEnabled(s.stateFile, 'recommended', 'flow-chart', true)
    const form = { id: '', name: '另一家搜索', url: 'https://a.example.test/mcp', authKind: 'header', authName: 'Authorization', secret: 'k1', enabled: true }
    saveMcpForm(s.mcpFile, form, { ok: true, tools: ['a', 'b', 'c'], message: '', fingerprint: formFingerprint(form) }, fakeKeyring())
    const now = new Date(2026, 10, 12, 15, 0).getTime()
    const view = abilitiesView(s, {
      hasKey: false,
      records: [{ at: now, searches: 5 }],
    })
    assert.equal(view.skills.length, 3)
    assert.equal(view.skills[1].badge.kind, 'line')
    assert.equal(view.skills[1].enabled, true)
    assert.equal(view.skills[2].note, importedAtText(statSync(join(s.userDir, 'week-report', 'SKILL.md')).mtimeMs))
    assert.equal(view.tools[0].note, '本月搜索 5 次')
    assert.equal(view.tools[0].disabled, true)
    assert.equal(view.mcp.length, 1)
    assert.equal(view.mcp[0].note, '已连接 3 个工具')
    assert.equal(view.mcpEmpty, false)
    assert.equal(view.hasKey, false)
    const empty = abilitiesView(s, {})
    assert.equal(empty.mcpEmpty, false)
    assert.equal(MCP_EMPTY_TEXT, '无 MCP')
  } finally {
    s.done()
  }
})
