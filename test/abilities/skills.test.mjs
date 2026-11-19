import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BANNED_EXTENSIONS,
  MAX_SKILL_BYTES,
  MAX_ZIP_BYTES,
  checkSkill,
  importSkill,
  listSkills,
  readSkill,
  removeSkill,
  setEnabled,
  skillsPatchYaml,
} from '../../app/abilities/skills.mjs'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'sidemate-skills-'))
}

// 仓库根：随包的推荐目录在 app/skills-recommended 下
function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

// 造一个技能文件夹：SKILL.md 加上可选的附带文件。
function makeSkill(root, id, frontmatter = true, extra = {}) {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const body = frontmatter
    ? `---\nname: ${id}\ndescription: ${id} 的说明\n---\n\n正文第一行。\n`
    : '正文第一行，没有 frontmatter。\n'
  writeFileSync(join(dir, 'SKILL.md'), body, 'utf8')
  for (const [name, content] of Object.entries(extra)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return dir
}

// 算 crc32，zip 的本地头和中央目录都要写。
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 拼一个小 zip：entries 是 { name, data, method }，method 缺省 stored(0)。
function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.method ?? 0
    const body = method === 8 ? deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralPart.length, 12)
  eocd.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, eocd])
}

test('readSkill 读 frontmatter 里的名字和说明', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'my-skill')
    assert.deepEqual(readSkill(skill), {
      id: 'my-skill',
      name: 'my-skill',
      description: 'my-skill 的说明',
      frontName: 'my-skill',
      nameOk: true,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('没有 frontmatter 就用文件夹名和正文第一行', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'plain-skill', false)
    assert.deepEqual(readSkill(skill), {
      id: 'plain-skill',
      name: 'plain-skill',
      description: '正文第一行，没有 frontmatter。',
      frontName: '',
      nameOk: false,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('三种来历都列出来，没记过的一律默认开', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    const recommended = join(dir, 'recommended')
    const user = join(dir, 'user')
    makeSkill(bundled, 'bundled-one')
    makeSkill(recommended, 'rec-one')
    makeSkill(user, 'mine-one')
    const list = listSkills({ bundledDir: bundled, recommendedDir: recommended, userDir: user })
    assert.deepEqual(
      list.map((item) => [item.id, item.source, item.enabled, item.removable]),
      [
        ['bundled-one', 'bundled', true, false],
        ['rec-one', 'recommended', true, false],
        ['mine-one', 'mine', true, true],
      ],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('记过关的照记的走：关过的还是关着', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    const recommended = join(dir, 'recommended')
    const user = join(dir, 'user')
    makeSkill(bundled, 'bundled-one')
    makeSkill(recommended, 'rec-one')
    makeSkill(user, 'mine-one')
    const stateFile = join(dir, 'state', 'skills.json')
    setEnabled(stateFile, 'recommended', 'rec-one', false)
    setEnabled(stateFile, 'mine', 'mine-one', false)
    const list = listSkills({ bundledDir: bundled, recommendedDir: recommended, userDir: user, stateFile })
    assert.deepEqual(
      list.map((item) => [item.id, item.enabled]),
      [
        ['bundled-one', true],
        ['rec-one', false],
        ['mine-one', false],
      ],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('推荐目录不存在就当空', () => {
  const dir = scratch()
  try {
    const list = listSkills({
      bundledDir: join(dir, 'bundled'),
      recommendedDir: join(dir, 'nope'),
      userDir: join(dir, 'user'),
    })
    assert.deepEqual(list, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('开关记在状态文件里，下次还认', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    const recommended = join(dir, 'recommended')
    const user = join(dir, 'user')
    makeSkill(bundled, 'bundled-one')
    makeSkill(recommended, 'rec-one')
    makeSkill(user, 'mine-one')
    const stateFile = join(dir, 'state', 'skills.json')
    setEnabled(stateFile, 'recommended', 'rec-one', true)
    setEnabled(stateFile, 'bundled', 'bundled-one', false)
    const list = listSkills({ bundledDir: bundled, recommendedDir: recommended, userDir: user, stateFile })
    assert.deepEqual(
      list.map((item) => [item.id, item.enabled]),
      [
        ['bundled-one', false],
        ['rec-one', true],
        ['mine-one', true],
      ],
    )
    assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).skills, {
      'recommended:rec-one': true,
      'bundled:bundled-one': false,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('状态文件坏了就当空状态', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    makeSkill(bundled, 'bundled-one')
    const stateFile = join(dir, 'skills.json')
    writeFileSync(stateFile, '{oops', 'utf8')
    const list = listSkills({ bundledDir: bundled, userDir: join(dir, 'user'), stateFile })
    assert.equal(list.length, 1)
    assert.equal(list[0].enabled, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('状态文件里别的字段留着不丢', () => {
  const dir = scratch()
  try {
    const stateFile = join(dir, 'skills.json')
    writeFileSync(stateFile, JSON.stringify({ skills: {}, mcp: [{ id: 'mcp-one' }] }), 'utf8')
    setEnabled(stateFile, 'mine', 'mine-one', false)
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
    assert.deepEqual(saved.mcp, [{ id: 'mcp-one' }])
    assert.deepEqual(saved.skills, { 'mine:mine-one': false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('合格技能过关，文件数和大小都报出来', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'good-skill', true, { 'notes/notes.md': '一些说明' })
    const check = checkSkill(skill)
    assert.equal(check.ok, true)
    assert.deepEqual(check.problems, [])
    assert.equal(check.files, 2)
    assert.ok(check.bytes > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('缺 SKILL.md 被拒', () => {
  const dir = scratch()
  try {
    const skill = join(dir, 'no-skill')
    mkdirSync(skill, { recursive: true })
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['技能无效'])
    assert.ok(check.details.includes('missing SKILL.md'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('带可执行文件被拒', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'exe-skill', true, { 'run.exe': 'MZ' })
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['文件不支持'])
    // 哪个文件只进细节（日志），界面上只说那一类
    assert.ok(check.details.some((one) => one.includes('run.exe')))
    for (const ext of BANNED_EXTENSIONS) {
      assert.ok(ext.startsWith('.'))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('太大了被拒', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'big-skill', true, { 'big.txt': 'x'.repeat(MAX_SKILL_BYTES + 10) })
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['文件过大'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('名字不合规被拒', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'Bad Name')
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['技能无效'])
    assert.ok(check.details.some((one) => one.startsWith('bad name')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('文件太多被拒', () => {
  const dir = scratch()
  try {
    const extra = {}
    for (let i = 0; i < 60; i += 1) extra[`note-${i}.md`] = '短'
    const skill = makeSkill(dir, 'many-files', true, extra)
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['文件过大'])
    assert.ok(check.details.some((one) => one.includes('files >')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('带符号链接被拒', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'link-skill')
    // Windows 上普通符号链接要管理员权限，用目录联接代替，同样是符号链接。
    symlinkSync(join(dir, 'link-skill'), join(skill, 'link'), 'junction')
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['文件不支持'])
    assert.ok(check.details.some((one) => one.startsWith('symlink')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('文件夹能导入', () => {
  const dir = scratch()
  try {
    const source = makeSkill(join(dir, 'src'), 'imported')
    const user = join(dir, 'user')
    const result = importSkill(source, user)
    assert.equal(result.ok, true)
    assert.equal(result.id, 'imported')
    assert.deepEqual(result.problems, [])
    assert.equal(existsSync(join(user, 'imported', 'SKILL.md')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('拷到一半失败就报失败，不留半截技能', () => {
  const dir = scratch()
  try {
    const source = makeSkill(join(dir, 'src'), 'half-copied', true, { 'a.txt': '第一个文件' })
    writeFileSync(join(source, 'b.txt'), '第二个文件', 'utf8')
    const user = join(dir, 'user')
    // 注入一个会失败的拷贝函数：第二个文件拷不进去。
    let count = 0
    const result = importSkill(source, user, {
      copyFile: (from, to) => {
        count += 1
        if (count === 2) throw new Error('假装这个文件被占着')
        copyFileSync(from, to)
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.message, '文件读取失败')
    assert.ok(result.detail.includes('copy failed'), result.detail)
    // 目标文件夹不能留半截。
    assert.equal(existsSync(join(user, 'half-copied')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('zip 能导入，压缩包里一层顶层文件夹就取那一层', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'pack.zip')
    writeFileSync(
      zip,
      makeZip([
        { name: 'zipped-skill/SKILL.md', data: '---\nname: zipped-skill\ndescription: 压缩包里的技能\n---\n\n正文。\n' },
        { name: 'zipped-skill/notes.md', data: '说明' },
      ]),
    )
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, true)
    assert.equal(result.id, 'zipped-skill')
    assert.equal(existsSync(join(user, 'zipped-skill', 'SKILL.md')), true)
    assert.equal(existsSync(join(user, 'zipped-skill', 'notes.md')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('zip 用 deflate 也能解出来', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'deflated.zip')
    writeFileSync(
      zip,
      makeZip([
        { name: 'deflate-skill/SKILL.md', data: '---\nname: deflate-skill\ndescription: 压着的技能\n---\n\n正文。\n', method: 8 },
      ]),
    )
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, true)
    assert.equal(result.id, 'deflate-skill')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('zip 里有 .. 直接拒', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'evil.zip')
    writeFileSync(
      zip,
      makeZip([
        { name: '../escape/SKILL.md', data: '---\nname: escape\ndescription: 跑路\n---\n' },
      ]),
    )
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['技能无效'])
    assert.ok(result.detail.includes('unsafe path'), result.detail)
    assert.equal(existsSync(join(user, 'escape')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('压缩炸弹被拒', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'bomb.zip')
    writeFileSync(
      zip,
      makeZip([
        { name: 'bomb-skill/SKILL.md', data: '---\nname: bomb-skill\ndescription: 炸弹\n---\n', method: 8 },
        { name: 'bomb-skill/big.txt', data: 'x'.repeat(MAX_ZIP_BYTES + 1024), method: 8 },
      ]),
    )
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['文件过大'])
    assert.equal(existsSync(join(user, 'bomb-skill')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('一个条目解出来超过 1MB 被拒，也不炸', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'big.zip')
    writeFileSync(
      zip,
      makeZip([
        { name: 'big-skill/SKILL.md', data: '---\nname: big-skill\ndescription: 太大\n---\n', method: 8 },
        { name: 'big-skill/big.bin', data: Buffer.alloc(3 * 1024 * 1024), method: 8 },
      ]),
    )
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['文件过大'])
    assert.equal(existsSync(join(user, 'big-skill')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('几个条目加起来超过 1MB 被拒', () => {
  const dir = scratch()
  try {
    const zip = join(dir, 'sum.zip')
    const entries = [{ name: 'sum-skill/SKILL.md', data: '---\nname: sum-skill\ndescription: 加起来太大\n---\n', method: 8 }]
    for (let i = 0; i < 3; i += 1) {
      entries.push({ name: `sum-skill/part${i}.bin`, data: Buffer.alloc(400 * 1024), method: 8 })
    }
    writeFileSync(zip, makeZip(entries))
    const user = join(dir, 'user')
    const result = importSkill(zip, user)
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['文件过大'])
    assert.equal(existsSync(join(user, 'sum-skill')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('不合格的技能导不进来', () => {
  const dir = scratch()
  try {
    const source = join(dir, 'src')
    const skill = join(source, 'bad-skill')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: bad-skill\ndescription: 不合格\n---\n', 'utf8')
    writeFileSync(join(skill, 'run.bat'), 'echo hi', 'utf8')
    const user = join(dir, 'user')
    const result = importSkill(skill, user)
    assert.equal(result.ok, false)
    assert.deepEqual(result.problems, ['文件不支持'])
    assert.ok(result.detail.includes('run.bat'), result.detail)
    assert.equal(existsSync(join(user, 'bad-skill')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('已经有同名就拒', () => {
  const dir = scratch()
  try {
    const source = makeSkill(join(dir, 'src'), 'twice')
    const user = join(dir, 'user')
    assert.equal(importSkill(source, user).ok, true)
    const again = importSkill(source, user)
    assert.equal(again.ok, false)
    assert.equal(again.message, '技能已存在')
    assert.equal(again.detail, 'exists: twice')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('只能删我加的技能', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    const user = join(dir, 'user')
    makeSkill(bundled, 'bundled-one')
    makeSkill(user, 'mine-one')
    const list = listSkills({ bundledDir: bundled, userDir: user })
    assert.equal(list.find((item) => item.id === 'bundled-one').removable, false)
    assert.equal(list.find((item) => item.id === 'mine-one').removable, true)

    const removed = removeSkill(user, 'mine-one')
    assert.equal(removed.ok, true)
    assert.equal(existsSync(join(user, 'mine-one')), false)

    // 自带的技能不在 userDir 里，删不到。
    const cross = removeSkill(user, 'bundled-one')
    assert.equal(cross.ok, false)
    assert.equal(existsSync(join(bundled, 'bundled-one')), true)

    // 名字里带路径的也不给删。
    const escape = removeSkill(user, '../bundled/bundled-one')
    assert.equal(escape.ok, false)
    assert.equal(existsSync(join(bundled, 'bundled-one')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skillsPatchYaml 只挂开着的技能目录', () => {
  const dir = scratch()
  try {
    const bundled = join(dir, 'bundled')
    const recommended = join(dir, 'recommended')
    const user = join(dir, 'user')
    makeSkill(bundled, 'bundled-on')
    makeSkill(bundled, 'bundled-off')
    makeSkill(recommended, 'rec-on')
    makeSkill(user, 'mine-on')
    const stateFile = join(dir, 'skills.json')
    setEnabled(stateFile, 'bundled', 'bundled-off', false)
    setEnabled(stateFile, 'recommended', 'rec-on', true)
    const list = listSkills({ bundledDir: bundled, recommendedDir: recommended, userDir: user, stateFile })
    const patch = skillsPatchYaml(list)
    assert.match(patch, /- id: skill-filesystem/)
    assert.match(patch, /customSkillDirs:/)
    assert.ok(patch.includes(JSON.stringify(join(bundled, 'bundled-on'))))
    assert.ok(patch.includes(JSON.stringify(join(recommended, 'rec-on'))))
    assert.ok(patch.includes(JSON.stringify(join(user, 'mine-on'))))
    assert.equal(patch.includes('bundled-off'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('一个都没开时 patch 里目录是空的', () => {
  const patch = skillsPatchYaml([
    { id: 'a', source: 'bundled', enabled: false },
    { id: 'b', source: 'mine', enabled: false },
  ])
  assert.match(patch, /customSkillDirs: \[\]/)
})

test('顶层多一个带技能信息的 md 被拒，免得 dsh 当成两个技能', () => {
  const dir = scratch()
  try {
    const skill = makeSkill(dir, 'two-docs', true, {
      'other.md': '---\nname: other\ndescription: 另一个技能\n---\n',
    })
    const check = checkSkill(skill)
    assert.equal(check.ok, false)
    assert.deepEqual(check.problems, ['技能无效'])
    assert.ok(check.details.some((one) => one.startsWith('second skill md')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// —————————————————————————————— 名字不合 dsh 的规矩 ——————————————————————————————

// 造一个 frontmatter 名字是中文的技能文件夹（dsh 那头整条当不存在）
function makeNamedSkill(root, id, name, description = '数一个文本文件里有多少字。') {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\nwhenToUse: 用户要数字数的时候使用。\n---\n\n正文第一行。\n`,
    'utf8',
  )
  return dir
}

test('导入的技能名字是中文：自动改好，模型才看得见，原来的名字当显示名', () => {
  const dir = scratch()
  try {
    const source = makeNamedSkill(join(dir, 'src'), 'text-stats', '数字统计')
    const user = join(dir, 'user')
    const stateFile = join(dir, '能力.json')
    const result = importSkill(source, user, { stateFile })
    assert.equal(result.ok, true)
    assert.equal(result.id, 'text-stats', '技能 id 用文件夹名')
    const text = readFileSync(join(user, 'text-stats', 'SKILL.md'), 'utf8')
    assert.ok(text.includes('name: text-stats'), 'SKILL.md 里的名字要改成 dsh 认的写法')
    assert.ok(!text.includes('name: 数字统计'), '原来的中文名字不能留在 name 字段里')
    assert.ok(text.includes('数字统计'), '原来的名字要留在说明里，模型才认得出')
    assert.ok(text.includes('whenToUse'), '别的 frontmatter 字段原样留着')
    // 界面上显示的还是用户自己起的那个名
    const list = listSkills({ bundledDir: '', recommendedDir: '', userDir: user, stateFile })
    const one = list.find((item) => item.id === 'text-stats')
    assert.equal(one.name, '数字统计')
    assert.equal(one.description.includes('数字统计'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导入的技能名字是中文：改好了也要说清楚改了什么', () => {
  const dir = scratch()
  try {
    const source = makeNamedSkill(join(dir, 'src'), 'text-stats', '数字统计')
    const result = importSkill(source, join(dir, 'user'))
    assert.equal(result.ok, true)
    assert.ok(result.message.includes('已导入'), result.message)
    assert.ok(result.message.includes('text-stats'), result.message)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导入的技能名字本来就合规：不动它', () => {
  const dir = scratch()
  try {
    const source = makeNamedSkill(join(dir, 'src'), 'count-stats', 'count-stats')
    const user = join(dir, 'user')
    const before = readFileSync(join(source, 'SKILL.md'), 'utf8')
    const result = importSkill(source, user)
    assert.equal(result.ok, true)
    assert.equal(result.message, '已导入：count-stats')
    assert.equal(readFileSync(join(user, 'count-stats', 'SKILL.md'), 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导入的技能没有 frontmatter：补一段出来，不然 dsh 当它不存在', () => {
  const dir = scratch()
  try {
    const source = makeSkill(join(dir, 'src'), 'plain-skill', false)
    const user = join(dir, 'user')
    const result = importSkill(source, user)
    assert.equal(result.ok, true)
    const text = readFileSync(join(user, 'plain-skill', 'SKILL.md'), 'utf8')
    assert.ok(text.includes('name: plain-skill'), text)
    assert.ok(text.includes('description:'), text)
    assert.ok(text.includes('正文第一行'), '说明拿正文第一行补上')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('文件夹名是中文：收拾一个能用的 id 出来，导入照样成', () => {
  const dir = scratch()
  try {
    const source = makeNamedSkill(join(dir, 'src'), '数字统计', 'text-stats')
    const user = join(dir, 'user')
    const result = importSkill(source, user)
    assert.equal(result.ok, true)
    assert.equal(result.id, 'text-stats')
    assert.equal(existsSync(join(user, 'text-stats', 'SKILL.md')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('文件夹名和 frontmatter 名字都是中文：起一个 import 开头的 id，原名当显示名', () => {
  const dir = scratch()
  try {
    const source = makeNamedSkill(join(dir, 'src'), '数字统计', '数字统计')
    const user = join(dir, 'user')
    const stateFile = join(dir, '能力.json')
    const result = importSkill(source, user, { stateFile })
    assert.equal(result.ok, true)
    assert.equal(result.id, 'imported-skill')
    const list = listSkills({ bundledDir: '', recommendedDir: '', userDir: user, stateFile })
    assert.equal(list.find((item) => item.id === 'imported-skill').name, '数字统计')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('说明是块写法（|）：改名字时不把它改坏', () => {
  const dir = scratch()
  try {
    const skill = join(dir, 'block-skill')
    mkdirSync(skill, { recursive: true })
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: 数字统计\ndescription: |\n  数一个文本文件里有多少字。\n  统计字数、行数、高频词的时候使用。\nwhenToUse: 用户要数字数的时候使用。\n---\n\n正文第一行。\n',
      'utf8',
    )
    const user = join(dir, 'user')
    const result = importSkill(skill, user)
    assert.equal(result.ok, true)
    const text = readFileSync(join(user, 'block-skill', 'SKILL.md'), 'utf8')
    assert.ok(text.includes('name: block-skill'), text)
    assert.ok(text.includes('数一个文本文件里有多少字'), text)
    assert.ok(text.includes('whenToUse'), '别的字段原样留着')
    assert.equal(text.includes('description: |'), false, '块写法换成了单行')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
