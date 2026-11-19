// 「画流程图」（sidemate-diagram）：随包推荐能力，默认开着；
// 用户自己关掉过的照旧关着（记过的开关说了算）。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { checkSkill, listSkills, setEnabled, skillsPatchYaml } from '../../app/abilities/skills.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RECOMMENDED_DIR = join(ROOT, 'app', 'skills-recommended')
const SKILL_DIR = join(RECOMMENDED_DIR, 'sidemate-diagram')

// 读技能文件夹里的 SKILL.md。
function skillText() {
  return readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8')
}

// 拆 front matter 的字段名。
function frontmatterKeys(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '---') return []
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  const keys = []
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line)
    if (match) keys.push(match[1])
  }
  return keys
}

test('推荐目录里有「画流程图」这个技能', () => {
  assert.ok(existsSync(join(SKILL_DIR, 'SKILL.md')), 'app/skills-recommended/sidemate-diagram/SKILL.md 要在')
  assert.ok(existsSync(join(SKILL_DIR, 'scripts', 'draw_diagram.py')), 'scripts/draw_diagram.py 要在')
})

test('技能文件夹合格：名字规矩、大小、文件数', () => {
  const check = checkSkill(SKILL_DIR)
  assert.deepEqual(check.problems, [])
  assert.ok(check.files >= 2)
  assert.ok(check.bytes < 200 * 1024)
})

test('front matter 只写 name / description / whenToUse', () => {
  const keys = frontmatterKeys(skillText())
  assert.deepEqual(keys.sort(), ['description', 'name', 'whenToUse'])
})

test('技能说明里写了脚本怎么用', () => {
  const text = skillText()
  assert.ok(text.includes('draw_diagram.py'))
  assert.ok(text.includes('flow') && text.includes('org') && text.includes('timeline'))
  assert.ok(text.includes('pptx') && text.includes('docx'))
})

test('推荐技能默认是开的（「画流程图」随包就带着）', () => {
  const list = listSkills({ bundledDir: join(ROOT, 'app', 'skills'), recommendedDir: RECOMMENDED_DIR, userDir: join(ROOT, 'no-such-user-dir') })
  const found = list.find((skill) => skill.id === 'sidemate-diagram')
  assert.ok(found, '列表里要有 sidemate-diagram')
  assert.equal(found.source, 'recommended')
  assert.equal(found.enabled, true, '「画流程图」默认开着')
})

test('用户自己关掉过的照旧关着：新用户算开，关过的算关', () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'sidemate-diagram-off-')), 'skills-state.json')
  setEnabled(stateFile, 'recommended', 'sidemate-diagram', false)
  const list = listSkills({
    bundledDir: join(ROOT, 'app', 'skills'),
    recommendedDir: RECOMMENDED_DIR,
    userDir: join(ROOT, 'no-such-user-dir'),
    stateFile,
  })
  const found = list.find((skill) => skill.id === 'sidemate-diagram')
  assert.ok(found)
  assert.equal(found.enabled, false, '自己关过的还是关着')
  const patch = skillsPatchYaml(list)
  assert.ok(!patch.includes('sidemate-diagram'), '关着的技能不挂给 dsh')
})

test('打开之后 dsh 才看得见这个技能', () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'sidemate-diagram-')), 'skills-state.json')
  const before = skillsPatchYaml(listSkills({
    bundledDir: join(ROOT, 'app', 'skills'),
    recommendedDir: RECOMMENDED_DIR,
    userDir: join(ROOT, 'no-such-user-dir'),
  }))
  assert.ok(before.includes('sidemate-diagram'), '默认开着，技能目录就挂给 dsh')
  setEnabled(stateFile, 'recommended', 'sidemate-diagram', true)
  const list = listSkills({
    bundledDir: join(ROOT, 'app', 'skills'),
    recommendedDir: RECOMMENDED_DIR,
    userDir: join(ROOT, 'no-such-user-dir'),
    stateFile,
  })
  const found = list.find((skill) => skill.id === 'sidemate-diagram')
  assert.ok(found)
  assert.equal(found.enabled, true)
  const after = skillsPatchYaml(list)
  assert.ok(after.includes('sidemate-diagram'), '打开后要把技能目录挂给 dsh')
})
