// 真 dsh + 本机假服务：模型发来的工具调用没有编号（provider 少给了 id）时，dsh 记会话对不上，
// 这一轮直接挂掉。桌伴这边照 dsh 给的码报（这错 dsh 那边给的是 UNKNOWN），原文带出去。

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, describe } from 'node:test'
// 全局配置由测试先写好（设置那边做的事）：任务自己不再写这份文件
import { runTaskWithGlobal as runTask } from './global.mjs'
import { choiceValue, routesYaml } from '../../app/dsh/models.mjs'
import { codeOf, stopText } from '../../app/task/codes.mjs'
import { envName } from '../../app/models/keys.mjs'
import { startFakeOpenAI } from './fake-openai.mjs'

const KEY = 'sidemate-test-key'
const ROUTE = 'c-fake'
const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function routesFor(url) {
  return routesYaml(
    {
      entries: [
        {
          id: ROUTE,
          kind: 'custom',
          name: '假服务',
          protocol: 'openai',
          baseUrl: url,
          models: [{ id: 'fake-model', name: '假模型' }],
        },
      ],
    },
    { consented: true },
  )
}

function taskOptions(extra) {
  const shared = extra.shared || {}
  return {
    taskId: 'toolcall',
    workspace: shared.workspace || scratch('sidemate-ws-'),
    lowRoot: shared.lowRoot || scratch('sidemate-low-'),
    apiKey: KEY,
    env: { [envName(ROUTE)]: KEY },
    model: { value: choiceValue(ROUTE, 'fake-model'), effort: null },
    route: ROUTE,
    ...extra,
  }
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

describe('模型发来的工具调用没有编号', { concurrency: 1 }, () => {
  test('工具调用没有 id：这一轮挂掉，桌伴认得这种错', { timeout: 180_000 }, async () => {
    const events = []
    const fake = await startFakeOpenAI({
      expectKey: KEY,
      // provider 发了一个没有 id 的工具调用（过载时见过）
      respond: () => ({ kind: 'tool', name: 'read', input: { path: 'a.txt' } }),
    })
    try {
      const handle = runTask(taskOptions({
        taskId: 'toolcall-no-id',
        prompt: '看一个文件',
        patchTexts: [routesFor(fake.url)],
        onEvent: (event) => events.push(event),
      }))
      const end = await handle.done
      assert.equal(end.status, 'error', JSON.stringify(events.map((event) => event.type)))
      const failure = events.find((event) => event.type === 'error')
      // dsh 那边给的是 UNKNOWN（它也认不出是哪种错）：桌伴照着报，不自己猜
      assert.equal(failure?.dshCode, 'UNKNOWN', JSON.stringify(failure))
      assert.equal(codeOf(failure), 'UNKNOWN', JSON.stringify(failure))
      assert.equal(stopText(failure, codeOf(failure)), '模型请求失败，已保存执行进度')
      // 原文带出去（壳截到 80 个字显示）
      assert.match(failure.raw, /requires toolCallId matching its tool source/)
      // 日志里是 dsh 那句校验失败的话
      const log = readFileSync(handle.logPath, 'utf8')
      assert.match(log, /requires toolCallId matching its tool source/)
    } finally {
      await fake.close()
    }
  })

  test('工具调用有 id：照常干完，不算错', { timeout: 180_000 }, async () => {
    const events = []
    const fake = await startFakeOpenAI({
      expectKey: KEY,
      // 第一次发一个带 id 的工具调用（桌伴会拒掉这个权限），第二次回话
      respond: (body, nth) => (nth === 1
        ? { kind: 'tool', name: 'read', id: 'call-1', input: { path: 'a.txt' } }
        : { kind: 'text', text: '好了' }),
    })
    try {
      const end = await runTask(taskOptions({
        taskId: 'toolcall-with-id',
        prompt: '看一个文件',
        patchTexts: [routesFor(fake.url)],
        onEvent: (event) => events.push(event),
      })).done
      // 工具调了以后模型还要回话；这里只关心没有撞上那个校验错
      assert.equal(end.status, 'done', JSON.stringify(events.map((event) => event.type)))
      const failure = events.find((event) => event.type === 'error')
      assert.equal(failure, undefined, JSON.stringify(failure))
    } finally {
      await fake.close()
    }
  })
})
