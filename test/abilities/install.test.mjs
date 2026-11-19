// 一句话装能力：模型只写方案，桌伴看了方案才去下载。
// 这里测三件事：方案读得对不对、下载有没有按白名单和时限来、装不成时说的是不是人话。

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DOWNLOAD_HOSTS,
  PENDING_DIR_NAME,
  PLAN_DIR_NAME,
  PLAN_FILE_NAME,
  dropPending,
  dropPlan,
  findPending,
  installPlan,
  normalizePlan,
  planSourceText,
  readPlan,
} from '../../app/abilities/install.mjs'
import { PROVENANCE_FILE_NAME } from '../../app/abilities/skills.mjs'

// 临时目录放在盒子给的临时目录里，没有就退到系统临时目录。
function scratch() {
  const base = process.env.BOXBOX_TMP_DIR || tmpdir()
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, 'sidemate-install-'))
}

// 造一个工作区。
function makeWorkspace(root) {
  const workspace = join(root, '任务区')
  mkdirSync(workspace, { recursive: true })
  return workspace
}

// 在工作区里写一份方案。
function writePlan(workspace, id, plan) {
  const dir = join(workspace, PLAN_DIR_NAME, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PLAN_FILE_NAME), JSON.stringify(plan), 'utf8')
  return dir
}

// 一份像样的方案。
const PLAN = (over = {}) => ({
  name: 'Markdown 转 PDF',
  source: 'https://github.com/some-author/md2pdf-skill',
  ref: 'main',
  path: '',
  license: 'MIT',
  updated: '2026-11-11',
  does: '把 Markdown 转成 PDF',
  ...over,
})

// 假的 fetch：按「地址里有什么」来答，并把每次请求记下来。
// 没人接的地址一律当「连不上」，跟真断网一样。
function fakeFetch(handlers) {
  const calls = []
  const fn = async (url) => {
    calls.push(String(url))
    for (const one of handlers) {
      if (String(url).includes(one.match)) return one.reply(String(url))
    }
    throw new Error('network down')
  }
  fn.calls = calls
  return fn
}

// 回一份 JSON。
function jsonRes(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => (String(key).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => obj,
    arrayBuffer: async () => Buffer.alloc(0),
  }
}

// 回一份 base64 内容（GitHub 的内容接口那样）。
function contentRes(text) {
  const buf = Buffer.from(text, 'utf8')
  return jsonRes({ encoding: 'base64', content: buf.toString('base64'), size: buf.length })
}

// 仓库里有 SKILL.md 和一个脚本。
const TREE = {
  tree: [
    { path: 'SKILL.md', type: 'blob', size: 20 },
    { path: 'scripts/convert.py', type: 'blob', size: 30 },
    { path: 'README.md', type: 'blob', size: 10 },
  ],
}

// 仓库的提交号：装的时候按它下，记下来也是它。
const SHA = '1a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d'

test('工作区里没有方案：读出来是 null', () => {
  const root = scratch()
  try {
    assert.equal(readPlan(makeWorkspace(root)), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('方案合格：名字、来源、版本都读出来', () => {
  const root = scratch()
  try {
    const workspace = makeWorkspace(root)
    writePlan(workspace, 'md2pdf-skill', PLAN())
    const found = readPlan(workspace)
    assert.ok(found, '没读到方案')
    assert.equal(found.ok, true, JSON.stringify(found.problems))
    assert.equal(found.id, 'md2pdf-skill')
    assert.equal(found.plan.name, 'Markdown 转 PDF')
    assert.equal(found.plan.owner, 'some-author')
    assert.equal(found.plan.repo, 'md2pdf-skill')
    assert.equal(planSourceText(found.plan), 'github.com/some-author/md2pdf-skill · main')
    assert.deepEqual(found.problems, [])
    assert.deepEqual(found.details, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('方案不合格：来源不是 GitHub、名字不合规、位置往上跳，卡上只说「技能无效」，细节进日志', () => {
  const root = scratch()
  try {
    const workspace = makeWorkspace(root)
    writePlan(workspace, 'Bad_Name', PLAN())
    writePlan(workspace, 'other-skill', PLAN({ source: 'https://evil.example.com/x/y' }))
    writePlan(workspace, 'third-skill', PLAN({ path: '../../etc' }))
    const bad = readPlan(workspace)
    assert.ok(bad)
    assert.equal(bad.ok, false)
    assert.deepEqual(bad.problems, ['技能无效'])
    assert.ok(bad.details.length > 0)
    const one = normalizePlan('md2pdf-skill', PLAN({ source: 'https://evil.example.com/x/y' }))
    assert.equal(one.ok, false)
    assert.deepEqual(one.problems, ['技能无效'])
    assert.ok(one.details.some((p) => p.includes('GitHub')), JSON.stringify(one.details))
    const two = normalizePlan('md2pdf-skill', PLAN({ path: '../..' }))
    assert.equal(two.ok, false)
    const three = normalizePlan('Bad_Name', PLAN())
    assert.equal(three.ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('装上：按方案下载，装进技能目录，来的 json 也在，工作区里不留方案', async () => {
  const root = scratch()
  try {
    const workspace = makeWorkspace(root)
    writePlan(workspace, 'md2pdf-skill', PLAN())
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/SKILL.md', reply: () => contentRes('---\nname: md2pdf-skill\ndescription: 转 PDF\n---\n\n正文。\n') },
      { match: '/contents/scripts/convert.py', reply: () => contentRes('print("hi")\n') },
      { match: '/contents/README.md', reply: () => contentRes('# 说明\n') },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, true, result.message)
    const target = join(userDir, 'md2pdf-skill')
    assert.equal(existsSync(join(target, 'SKILL.md')), true)
    assert.equal(existsSync(join(target, 'scripts', 'convert.py')), true)
    const meta = JSON.parse(readFileSync(join(target, PROVENANCE_FILE_NAME), 'utf8'))
    assert.equal(meta.name, 'Markdown 转 PDF')
    assert.equal(meta.source, 'https://github.com/some-author/md2pdf-skill')
    // 临时文件夹收干净了
    assert.equal(existsSync(join(userDir, '.pending', 'md2pdf-skill')), false)
    // 只去白名单里的地址
    for (const url of fetchImpl.calls) {
      const host = new URL(url).hostname
      assert.ok(DOWNLOAD_HOSTS.includes(host), `不该去的地址：${url}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('装上：下载用的是提交号，origin.json 里记下提交号、安装时间和装的人', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/commits/', reply: () => jsonRes({ sha: SHA }) },
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/SKILL.md', reply: () => contentRes('---\nname: md2pdf-skill\ndescription: 转 PDF\n---\n\n正文。\n') },
      { match: '/contents/scripts/convert.py', reply: () => contentRes('print("hi")\n') },
      { match: '/contents/README.md', reply: () => contentRes('# 说明\n') },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, true, result.message)
    // 列文件和下载都用提交号，不用分支名
    const trees = fetchImpl.calls.find((one) => one.includes('/git/trees/'))
    assert.ok(trees, '没有列文件')
    assert.ok(trees.includes(SHA), `列文件没用提交号：${trees}`)
    const contents = fetchImpl.calls.filter((one) => one.includes('/contents/'))
    assert.equal(contents.length, 3)
    for (const one of contents) assert.ok(one.includes(SHA), `下载没用提交号：${one}`)
    // origin.json 里三样都有
    const meta = JSON.parse(readFileSync(join(userDir, 'md2pdf-skill', PROVENANCE_FILE_NAME), 'utf8'))
    assert.equal(meta.commit, SHA)
    assert.match(meta.installedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    assert.equal(meta.by, 'sidemate')
    // 别的字段照旧
    assert.equal(meta.name, 'Markdown 转 PDF')
    assert.equal(meta.source, 'https://github.com/some-author/md2pdf-skill')
    assert.equal(meta.license, 'MIT')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('装上：内容接口没有这个文件就改用 raw 地址，raw 地址也用提交号', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/commits/', reply: () => jsonRes({ sha: SHA }) },
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/', reply: () => jsonRes({ message: 'Not Found' }, 404) },
      { match: 'raw.githubusercontent.com', reply: () => contentRes('x') },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, true, result.message)
    const raw = fetchImpl.calls.find((one) => one.includes('raw.githubusercontent.com'))
    assert.ok(raw, '没有走 raw 地址')
    assert.ok(raw.includes(SHA), `raw 地址没用提交号：${raw}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('提交号解不出来：照旧装上，origin.json 里不写提交号', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/commits/', reply: () => { throw new Error('network down') } },
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/', reply: () => contentRes('x') },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, true, result.message)
    const meta = JSON.parse(readFileSync(join(userDir, 'md2pdf-skill', PROVENANCE_FILE_NAME), 'utf8'))
    assert.equal(meta.commit, '')
    assert.equal(meta.by, 'sidemate')
    assert.match(meta.installedAt, /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('装不成：连不上就停，最多试三次，只说「连接失败」，状态放 raw，细节进日志', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/', reply: () => { throw new Error('network down') } },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.message, '连接失败')
    assert.equal(result.raw, 'network error')
    assert.ok(result.detail.includes('SKILL.md'), result.detail)
    // 一个文件最多试三次（api、raw、api）；列文件和取提交号那两次不算文件的尝试
    const tries = fetchImpl.calls.filter((one) => !one.includes('/git/trees/') && !one.includes('/commits/')).length
    assert.equal(tries, 3)
    // 什么也没装进去
    assert.equal(existsSync(join(userDir, 'md2pdf-skill')), false)
    assert.equal(existsSync(join(userDir, '.pending', 'md2pdf-skill')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('仓库里没有这个文件：说「文件不存在」，少的是哪个进日志', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/', reply: () => jsonRes({ message: 'Not Found' }, 404) },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.message, '文件不存在')
    assert.equal(result.raw, '')
    assert.ok(result.detail.includes('SKILL.md'), result.detail)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('下载超过时限就停：说清楚先停了', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    let tick = 0
    const clock = () => {
      tick += 60_000
      return tick
    }
    const fetchImpl = fakeFetch([
      { match: '/git/trees/', reply: () => jsonRes(TREE) },
      { match: '/contents/', reply: () => contentRes('x') },
    ])
    const result = await installPlan({
      id: 'md2pdf-skill',
      plan: PLAN(),
      userDir,
      fetchImpl,
      now: clock,
      budgetMs: 90_000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.message, '连接失败')
    assert.equal(result.raw, 'download took over 5 minutes')
    assert.equal(existsSync(join(userDir, 'md2pdf-skill')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('仓库里有好几个技能：说「技能无效」，是哪几个进日志', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([
      {
        match: '/git/trees/',
        reply: () => jsonRes({
          tree: [
            { path: 'a/SKILL.md', type: 'blob', size: 5 },
            { path: 'b/SKILL.md', type: 'blob', size: 5 },
          ],
        }),
      },
    ])
    const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(), userDir, fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.message, '技能无效')
    assert.ok(/^ambiguous: a\/?, b\/?$/.test(result.detail), result.detail)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('来源写得不对：一个请求都不发', async () => {
  const root = scratch()
  try {
    const userDir = join(root, '技能')
    const fetchImpl = fakeFetch([])
    const result = await installPlan({
      id: 'md2pdf-skill',
      plan: PLAN({ source: 'https://evil.example.com/x/y' }),
      userDir,
      fetchImpl,
    })
    assert.equal(result.ok, false)
    assert.equal(fetchImpl.calls.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('不装：方案删掉，工作区里不留', () => {
  const root = scratch()
  try {
    const workspace = makeWorkspace(root)
    writePlan(workspace, 'md2pdf-skill', PLAN())
    const result = dropPlan(workspace, 'md2pdf-skill')
    assert.equal(result.ok, true)
    assert.equal(existsSync(join(workspace, PLAN_DIR_NAME, 'md2pdf-skill')), false)
    assert.equal(dropPlan(workspace, '../坏名字').ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// 一个干净的技能：一份说明 + 两个不联网的脚本。
const CLEAN = {
  'SKILL.md': '---\nname: mindmap-skill\ndescription: 画思维导图\n---\n\n正文。\n',
  'a.py': 'def main():\n    return 1\n',
  'b.py': 'def other():\n    return 2\n',
}
// 模型自己下的东西：找得到、删得掉
test('模型自己下的东西：找得到、删得掉', () => {
  const root = scratch()
  try {
    const workspace = makeWorkspace(root)
    const dir = join(workspace, PENDING_DIR_NAME, 'mindmap-skill')
    mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(CLEAN)) writeFileSync(join(dir, name), content, 'utf8')
    const pending = findPending(workspace)
    assert.ok(pending)
    assert.equal(pending.id, 'mindmap-skill')
    assert.equal(pending.dir, dir)
    const result = dropPending(workspace, 'mindmap-skill')
    assert.equal(result.ok, true)
    assert.equal(existsSync(dir), false)
    assert.equal(dropPending(workspace, '../坏名字').ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// 找技能文件夹：前缀拼得对不对（技能在仓库根、在子目录、方案写了位置）。
const SKILL_MD = '---\nname: md2pdf-skill\ndescription: 转 PDF\n---\n\n正文。\n'

// 装一次，用给的树看装没装上、装到哪儿去了。
async function installWithTree(tree, over = {}) {
  const root = scratch()
  const userDir = join(root, '技能')
  const fetchImpl = fakeFetch([
    { match: '/git/trees/', reply: () => jsonRes({ tree }) },
    { match: '/contents/', reply: () => contentRes('x') },
  ])
  const result = await installPlan({ id: 'md2pdf-skill', plan: PLAN(over), userDir, fetchImpl })
  return { result, userDir, root }
}

test('技能在仓库根、方案没写位置：装得上', async () => {
  const { result, userDir, root } = await installWithTree([
    { path: 'SKILL.md', type: 'blob', size: 20 },
    { path: 'scripts/convert.py', type: 'blob', size: 30 },
  ])
  try {
    assert.equal(result.ok, true, result.message || result.detail)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'scripts', 'convert.py')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('技能在仓库子目录、方案没写位置：装得上（以前前缀拼成「子目录//」，一个文件都找不到）', async () => {
  const { result, userDir, root } = await installWithTree([
    { path: 'md2pdf/SKILL.md', type: 'blob', size: 20 },
    { path: 'md2pdf/scripts/convert.py', type: 'blob', size: 30 },
    { path: 'README.md', type: 'blob', size: 10 },
  ])
  try {
    assert.equal(result.ok, true, result.message || result.detail)
    const target = join(userDir, 'md2pdf-skill')
    assert.equal(existsSync(join(target, 'SKILL.md')), true)
    assert.equal(existsSync(join(target, 'scripts', 'convert.py')), true)
    // 仓库根上的别的文件不该混进技能里
    assert.equal(existsSync(join(target, 'README.md')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('方案写了位置、不带尾斜杠：装得上', async () => {
  const { result, userDir, root } = await installWithTree([
    { path: 'md2pdf/SKILL.md', type: 'blob', size: 20 },
    { path: 'md2pdf/scripts/convert.py', type: 'blob', size: 30 },
  ], { path: 'md2pdf' })
  try {
    assert.equal(result.ok, true, result.message || result.detail)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'scripts', 'convert.py')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('方案写了位置、带尾斜杠：跟不带的一样装得上', async () => {
  const { result, userDir, root } = await installWithTree([
    { path: 'md2pdf/SKILL.md', type: 'blob', size: 20 },
    { path: 'md2pdf/scripts/convert.py', type: 'blob', size: 30 },
  ], { path: 'md2pdf/' })
  try {
    assert.equal(result.ok, true, result.message || result.detail)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(userDir, 'md2pdf-skill', 'scripts', 'convert.py')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('仓库里有好几个 SKILL.md、方案没写位置：照旧拒掉，说「技能无效」', async () => {
  const { result, root } = await installWithTree([
    { path: 'a/SKILL.md', type: 'blob', size: 5 },
    { path: 'b/SKILL.md', type: 'blob', size: 5 },
  ])
  try {
    assert.equal(result.ok, false)
    assert.equal(result.message, '技能无效')
    assert.ok(/^ambiguous: a\/?, b\/?$/.test(result.detail), result.detail)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
