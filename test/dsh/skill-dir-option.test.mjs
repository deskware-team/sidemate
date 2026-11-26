// dshLaunch 的 skillDir：给了就用它（对比工具 tools/office-ab 换技能目录用），没给照旧用仓库里的。
// 这一份还验一件真事：换了 skillDir 之后，模型看到的技能目录也跟着换
// （A 组的 Office 自查技能不在目录里，模型就看不到它）。

import assert from 'node:assert/strict'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dshLaunch, payloadLayout, runTask } from '../../app/dsh/index.mjs'
import { startFake } from './fake-messages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const roots = []
const layout = payloadLayout()
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidemate-skilldir-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

function ensureNode() {
  if (existsSync(layout.node)) return
  mkdirSync(join(layout.root, 'node'), { recursive: true })
  copyFileSync(process.execPath, layout.node)
}

// app/skills 拷一份，去掉 Office 自查技能（A 组那一份）
function skillsWithoutOffice() {
  const dir = scratch()
  for (const name of readdirSync(join(root, 'app/skills'))) {
    if (name === 'sidemate-office-check') continue
    cpSync(join(root, 'app/skills', name), join(dir, name), { recursive: true })
  }
  return dir
}

test('没给 skillDir：照旧用仓库里的 app/skills', () => {
  const launch = dshLaunch({
    taskId: 'skill-dir-default',
    apiKey: 'test-placeholder',
    workspace: scratch(),
    payloadRoot: resolve(root, 'missing-payload'),
    lowRoot: scratch(),
  })
  assert.equal(launch.env.DSH_SKILL_DIR, resolve(root, 'app/skills'))
})

test('给了 skillDir：用给的那个目录', () => {
  const dir = scratch()
  const launch = dshLaunch({
    taskId: 'skill-dir-option',
    apiKey: 'test-placeholder',
    workspace: scratch(),
    payloadRoot: resolve(root, 'missing-payload'),
    lowRoot: scratch(),
    skillDir: dir,
  })
  assert.equal(launch.env.DSH_SKILL_DIR, dir)
})

test('换了 skillDir：模型看到的技能目录也跟着换', { timeout: 180_000 }, async (t) => {
  ensureNode()
  if (!existsSync(layout.dsh)) {
    t.skip('dsh payload is not linked under ./payload')
    return
  }
  const seen = async (skillDir) => {
    const fake = await startFake({ respond: () => ({ kind: 'text', text: '好了' }) })
    try {
      const end = await runTask({
        taskId: 'skill-dir-catalog',
        apiKey: 'sidemate-test-key',
        prompt: '看一眼技能',
        workspace: scratch(),
        lowRoot: scratch(),
        payloadRoot: layout.root,
        baseUrl: fake.url,
        skillDir,
      }).done
      assert.equal(end.status, 'done', '这一轮应该跑完')
      return fake.calls.map((body) => JSON.stringify(body)).join('\n')
    } finally {
      await fake.close()
    }
  }
  const withOffice = await seen(join(root, 'app/skills'))
  assert.ok(withOffice.includes('sidemate-office-check'), 'B 组的自查技能应该在模型看得见的地方')
  const withoutOffice = await seen(skillsWithoutOffice())
  assert.equal(withoutOffice.includes('sidemate-office-check'), false, 'A 组不该看见自查技能')
  assert.ok(withoutOffice.includes('sidemate-writing'), '别的技能照旧在')
})
