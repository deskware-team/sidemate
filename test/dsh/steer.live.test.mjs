// 真跑一遍：干活中途插一句。
// 要设 SIDEMATE_LIVE=1 才跑（真模型、真网络、要花钱）。钥匙只从环境变量 SIDEMATE_TEST_ZHIPU_KEY 读，
// 到了子进程里换个名字（SIDEMATE_KEY_ZHIPU），不打印、不落盘。

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { noDeepseekYaml } from '../../app/dsh/models.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const KEY_ENV = 'SIDEMATE_TEST_ZHIPU_KEY'

// 智谱那条路线：钥匙只写环境变量名
const ROUTE = [
  '- id: llm-pi-ai',
  '  config:',
  '    providers:',
  '      zhipu:',
  '        displayName: "智谱"',
  '        apiKeyEnv: SIDEMATE_KEY_ZHIPU',
  '        api: "openai-completions"',
  '        baseURL: "https://open.bigmodel.cn/api/paas/v4"',
  '        models:',
  '          - id: "glm-4-flash"',
  '            name: "GLM-4-Flash"',
  '            reasoningEfforts: false',
  '',
].join('\n')

const TASK = '在工作区里建 1.txt 到 5.txt，每个文件里写一句话。写完一个再写下一个。'
const INSERT = '改成只建到 3.txt，内容都写英文'
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

const live = process.env.SIDEMATE_LIVE ? false : '设 SIDEMATE_LIVE=1 才跑'

function options(over = {}) {
  const key = process.env[KEY_ENV] || ''
  assert.equal(key !== '', true, `${KEY_ENV} 没设`)
  const workspace = mkdtempSync(join(tmpdir(), 'sidemate-live-ws-'))
  return {
    taskId: 'live-steer',
    payloadRoot: join(repo, 'payload'),
    workspace,
    lowRoot: mkdtempSync(join(tmpdir(), 'sidemate-live-low-')),
    prompt: TASK,
    patchTexts: [ROUTE, noDeepseekYaml()],
    model: { value: '["zhipu","glm-4-flash"]', effort: null },
    env: { SIDEMATE_KEY_ZHIPU: key },
    steerProvider: 'zhipu',
    steerModel: 'glm-4-flash',
    ...over,
  }
}

async function untilFile(dir, name, limit = 120_000) {
  const started = Date.now()
  while (Date.now() - started < limit) {
    if (existsSync(join(dir, name))) return true
    await delay(500)
  }
  return false
}

test('真跑：中途插一句，下一步就按这句来，这一轮不取消', { skip: live, timeout: 300_000 }, async () => {
  const opts = options()
  const handle = runTask(opts)
  const first = await untilFile(opts.workspace, '1.txt')
  assert.equal(first, true, '第一个文件没建出来')
  const result = await handle.steer(INSERT)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.mode, 'steer', JSON.stringify(result))
  const end = await handle.done
  assert.equal(end.status, 'done', '这一轮被取消了')
  const files = readdirSync(opts.workspace).filter((one) => one.endsWith('.txt')).sort()
  // 新要求：只建到 3.txt（4/5 不建）
  assert.deepEqual(files, ['1.txt', '2.txt', '3.txt'], `工作区里的文件不对：${files.join('、')}`)
  // 插话之后建的那个文件按新要求写（英文）
  const last = readFileSync(join(opts.workspace, '3.txt'), 'utf8')
  assert.equal(/[\u4e00-\u9fa5]/.test(last), false, `3.txt 里还有中文：${last}`)
  rmSync(opts.workspace, { recursive: true, force: true })
  rmSync(opts.lowRoot, { recursive: true, force: true })
})
