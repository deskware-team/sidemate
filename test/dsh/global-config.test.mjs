// 全局配置（<dsh 家>/cordis.patch.yml）：只有设置那边写，任务不写。
// 这里验两件事：
// 1. 默认模型没配钥匙时，全局配置里仍然有全部线路（别的模型照样跑）；
// 2. acp 那一行用哪个模型：已配好的模型里第一个能看图的；没有就默认模型。

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { acpRoute, globalPatchTexts } from '../../app/models/global.mjs'
import { writeGlobalPatch } from '../../app/dsh/daemon.mjs'

const roots = []

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

// 清单：默认那条是 DeepSeek（没钥匙），另有一条自己配的线路（两个模型，一个能看图）
function catalogFile() {
  const dir = scratch('sidemate-global-catalog-')
  const file = join(dir, 'model.json')
  writeFileSync(file, JSON.stringify({
    version: 1,
    default: { entry: 'deepseek', model: 'deepseek-flash', effort: null },
    entries: [
      {
        id: 'c-a',
        kind: 'custom',
        name: '自家线路',
        protocol: 'openai',
        baseUrl: 'https://example.com/v1',
        models: [
          { id: 'text-model', name: '只认字', vision: false },
          { id: 'vision-model', name: '能看图', vision: true },
        ],
      },
    ],
  }))
  return { catalog: file, consent: join(dir, 'useragreement.json') }
}

// 钥匙：只有自家线路那把，DeepSeek 那把没有
function keyring() {
  return {
    has: (id) => id === 'c-a',
    read: (id) => (id === 'c-a' ? 'sidemate-test-key' : null),
  }
}

test('默认模型没配钥匙：全局配置里仍然有全部线路', () => {
  const files = catalogFile()
  const texts = globalPatchTexts({ files, keyring: keyring() })
  const all = texts.join('\n')
  // 自己配的那条线路和它两个模型都在
  assert.match(all, /c-a:/)
  assert.match(all, /text-model/)
  assert.match(all, /vision-model/)
  // DeepSeek 没钥匙：挂一份手写目录，别去官方列目录
  assert.match(all, /llm-deepseek/)
  // 单并发模型那份不进全局配置（它只对那一轮选中的模型有意义）
  assert.equal(all.includes('tool-subagent'), false, all)
})

test('全局配置整份写进 dsh 的家：内容一样不重写', () => {
  const dir = scratch('sidemate-global-home-')
  const home = join(dir, 'dsh')
  const texts = globalPatchTexts({ files: catalogFile(), keyring: keyring() })
  writeGlobalPatch(home, texts)
  const path = join(home, 'cordis.patch.yml')
  const first = readFileSync(path, 'utf8')
  assert.match(first, /- id: hmr/)
  assert.match(first, /root: \[\]/)
  // 内容一样：文件不动（省得 dsh 白重载一次）
  writeGlobalPatch(home, texts)
  assert.equal(readFileSync(path, 'utf8'), first)
})

test('acp 那一行：已配好的模型里第一个能看图的', () => {
  const files = catalogFile()
  const route = acpRoute({ files, keyring: keyring() })
  assert.deepEqual(route, { provider: 'c-a', model: 'vision-model' })
})

test('acp 那一行：没有能看图的模型就用默认模型', () => {
  const dir = scratch('sidemate-global-catalog-')
  const file = join(dir, 'model.json')
  writeFileSync(file, JSON.stringify({
    version: 1,
    default: { entry: 'c-a', model: 'text-model', effort: null },
    entries: [
      {
        id: 'c-a',
        kind: 'custom',
        name: '自家线路',
        protocol: 'openai',
        baseUrl: 'https://example.com/v1',
        models: [{ id: 'text-model', name: '只认字', vision: false }],
      },
    ],
  }))
  const files = { catalog: file, consent: join(dir, 'useragreement.json') }
  assert.deepEqual(acpRoute({ files, keyring: keyring() }), { provider: 'c-a', model: 'text-model' })
})
