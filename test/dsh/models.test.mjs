import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  choiceValue,
  hasChoice,
  noDeepseekYaml,
  pickEffort,
  providerOf,
  routesYaml,
} from '../../app/dsh/models.mjs'
import { addKilo, defaults, limitOf, removeEntry } from '../../app/models/catalog.mjs'

// docs/多家模型.md 第三节 session/new 回包的 configOptions 原值。
const NEW_OPTIONS = JSON.parse(
  '[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"[\\"deepseek-official\\",\\"deepseek-v4-flash\\"]","options":[{"group":"deepseek-official","name":"DeepSeek","options":[{"value":"[\\"deepseek-official\\",\\"deepseek-v4-flash\\"]","name":"deepseek-v4-flash"},{"value":"[\\"deepseek-official\\",\\"deepseek-flash\\"]","name":"DeepSeek-V4.1-Flash"},{"value":"[\\"deepseek-official\\",\\"deepseek-v4-pro\\"]","name":"DeepSeek-V4-Pro","description":"Stronger agentic coding, knowledge, and difficult reasoning; suited to complex and quality-critical tasks at higher cost."}]},{"group":"kilo","name":"Kilo","options":[{"value":"[\\"kilo\\",\\"kilo-auto/free\\"]","name":"Kilo Auto Free"}]}]},{"id":"reasoning_effort","name":"Reasoning effort","category":"thought_level","type":"select","currentValue":"high","options":[{"value":"off","name":"Off","description":"Use for simple tasks that do not need reasoning."},{"value":"low","name":"Low","description":"Prefer for routine tasks and latency-sensitive tasks."},{"value":"high","name":"High","description":"The default balance for most tasks."},{"value":"max","name":"Max","description":"Reserve for the hardest quality-first tasks."}]}]',
)

// docs/多家模型.md 第四节切到 Kilo 后回包的 configOptions 原值：只剩 model，没有思考档位。
const SWITCHED_OPTIONS = JSON.parse(
  '[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"[\\"kilo\\",\\"kilo-auto/free\\"]","options":[{"group":"deepseek-official","name":"DeepSeek","options":[{"value":"[\\"deepseek-official\\",\\"deepseek-flash\\"]","name":"DeepSeek-V4.1-Flash"},{"value":"[\\"deepseek-official\\",\\"deepseek-v4-pro\\"]","name":"DeepSeek-V4-Pro","description":"Stronger agentic coding, knowledge, and difficult reasoning; suited to complex and quality-critical tasks at higher cost."}]},{"group":"kilo","name":"Kilo","options":[{"value":"[\\"kilo\\",\\"kilo-auto/free\\"]","name":"Kilo Auto Free"}]}]}]',
)

// 一份带各种字段的样例清单；夹在条目上的 apiKey 字段是假钥匙，生成器必须无视它。
function sampleCatalog() {
  return {
    version: 1,
    default: { entry: 'deepseek', model: 'deepseek-flash', effort: null },
    entries: [
      {
        id: 'kilo',
        kind: 'free',
        name: 'Kilo 模型',
        protocol: 'openai',
        baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
        concurrency: 1,
        models: [{ id: 'kilo-auto/free', name: 'Kilo 模型', contextWindow: 256000, maxTokens: 32000 }],
      },
      {
        id: 'deepseek',
        kind: 'deepseek',
        name: 'DeepSeek',
        protocol: 'anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'plain-fake-key-1',
        models: [{ id: 'deepseek-flash', name: 'DeepSeek' }],
      },
      {
        id: 'c-kimi',
        kind: 'custom',
        name: 'Kimi',
        protocol: 'openai',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'plain-fake-key-2',
        models: [
          {
            id: 'kimi-k2',
            name: 'Kimi K2',
            contextWindow: 262144,
            maxTokens: 16384,
            efforts: [],
            vision: false,
          },
        ],
      },
      {
        id: 'c-claude',
        kind: 'custom',
        name: 'Claude: 中转#2',
        protocol: 'anthropic',
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'plain-fake-key-3',
        models: [
          {
            id: 'claude-sonnet',
            name: 'Sonnet: 快#1',
            contextWindow: 200000,
            maxTokens: null,
            efforts: ['off', 'high'],
            vision: true,
          },
        ],
      },
    ],
  }
}

test('providerOf 和 choiceValue', () => {
  assert.equal(providerOf('kilo'), 'kilo')
  assert.equal(providerOf('deepseek'), 'deepseek-official')
  assert.equal(providerOf('c-kimi'), 'c-kimi')
  assert.equal(choiceValue('kilo', 'kilo-auto/free'), '["kilo","kilo-auto/free"]')
  assert.equal(choiceValue('deepseek', 'deepseek-flash'), '["deepseek-official","deepseek-flash"]')
  assert.equal(choiceValue('c-kimi', 'kimi-k2'), '["c-kimi","kimi-k2"]')
})

test('未同意时不挂 Kilo，同意后挂上并带占位标头', () => {
  const before = routesYaml(sampleCatalog(), {})
  assert.ok(!before.includes('kilo:'), '未同意时不能有 kilo 路线')
  assert.ok(!before.includes('ai-gateway.kilo.ai'), '未同意时不写 Kilo 的地址')

  const after = routesYaml(sampleCatalog(), { consented: true })
  assert.ok(after.includes('      kilo:'), '同意后要有 kilo 路线')
  assert.ok(after.includes('displayName: "Kilo 模型"'))
  assert.ok(after.includes('api: "openai-completions"'))
  assert.ok(after.includes('baseURL: "https://ai-gateway.kilo.ai/api/v1"'))
  assert.ok(after.includes('Authorization: "Bearer anonymous"'), '匿名路线要带占位标头')
  assert.ok(after.includes('- id: "kilo-auto/free"'))
  assert.ok(after.includes('name: "Kilo 模型"'))
  assert.ok(after.includes('contextWindow: 256000'), '上下文 256K')
  assert.ok(after.includes('maxTokens: 32000'), '最大输出 32K')
  assert.ok(after.includes('reasoningEfforts: false'), 'Kilo 没有思考档位')
  assert.ok(after.includes('input: ["text"]'), 'Kilo 只收文字')
})

test('Kilo 的地址和模型是代码常量，清单改不动', () => {
  const catalog = sampleCatalog()
  const kilo = catalog.entries.find((entry) => entry.id === 'kilo')
  kilo.baseUrl = 'https://evil.example/v1'
  kilo.models = [{ id: 'kilo-auto/paid', name: '别的', contextWindow: 1000, maxTokens: 1000 }]
  const yaml = routesYaml(catalog, { consented: true })
  assert.ok(yaml.includes('baseURL: "https://ai-gateway.kilo.ai/api/v1"'))
  assert.ok(yaml.includes('- id: "kilo-auto/free"'))
  assert.ok(!yaml.includes('evil.example'))
  assert.ok(!yaml.includes('kilo-auto/paid'))
})

test('自定义条目的路线字段', () => {
  const yaml = routesYaml(sampleCatalog(), { consented: true })
  assert.ok(yaml.includes('      c-kimi:'))
  assert.ok(yaml.includes('apiKeyEnv: "SIDEMATE_KEY_C_KIMI"'), '钥匙只写环境变量名')
  assert.ok(yaml.includes('      c-claude:'))
  assert.ok(yaml.includes('apiKeyEnv: "SIDEMATE_KEY_C_CLAUDE"'))
  assert.ok(yaml.includes('api: "anthropic-messages"'), 'Anthropic 格式要写对')
  assert.ok(yaml.includes('baseURL: "https://gw.example.com/v1"'))
  assert.ok(yaml.includes('contextWindow: 262144'))
  assert.ok(yaml.includes('maxTokens: 16384'))
  assert.ok(!yaml.includes('maxTokens: null'), '留空的上限不写')
  assert.ok(yaml.includes('maxTokens: 128000'), '没写上限的按 128K 写')
  assert.ok(yaml.includes('reasoningEfforts: false'), '空档位写成 false')
  assert.ok(yaml.includes('"off":'), 'off 档位写成空值')
  assert.ok(!yaml.includes('"off": "off"'), 'off 的值必须是空的')
  assert.ok(yaml.includes('"high": "high"'), '其余档位的值等于档位名')
  assert.ok(yaml.includes('input: ["text"]'), '不看图的模型只写 text')
  assert.ok(yaml.includes('input: ["text", "image"]'), '看图的模型写 text 和 image')
})

test('DeepSeek 条目不进 pi-ai 路线', () => {
  const yaml = routesYaml(sampleCatalog(), { consented: true })
  assert.ok(!yaml.includes('deepseek-official'), 'DeepSeek 走内置路线，不写进 pi-ai')
  assert.ok(!yaml.includes('api.deepseek.com'), 'DeepSeek 的地址不能出现')
})

test('名字里的冒号和 # 被引起来', () => {
  const yaml = routesYaml(sampleCatalog(), { consented: true })
  assert.ok(yaml.includes('displayName: "Claude: 中转#2"'))
  assert.ok(yaml.includes('name: "Sonnet: 快#1"'))
})

test('输出里不含传进来的假钥匙', () => {
  const yaml = routesYaml(sampleCatalog(), { consented: true })
  for (const fake of ['plain-fake-key-1', 'plain-fake-key-2', 'plain-fake-key-3']) {
    assert.ok(!yaml.includes(fake), '生成结果不能带钥匙值')
  }
})

test('没写容量的模型按 1M/128K 写明', () => {
  const plain = {
    version: 1,
    entries: [{
      id: 'c-plain',
      kind: 'custom',
      name: '没写容量',
      protocol: 'openai',
      baseUrl: 'https://plain.example/v1',
      models: [{ id: 'm1', name: '模型' }],
    }],
  }
  const yaml = routesYaml(plain, { consented: false })
  assert.ok(yaml.includes('contextWindow: 1000000'), '没写窗口的按 1M 写')
  assert.ok(yaml.includes('maxTokens: 128000'), '没写上限的按 128K 写')
  assert.ok(!yaml.includes('- id: compaction-basic'), '1M 的窗口用不着另配余量')
})

test('窗口小的线路单独给压缩留余量', () => {
  const small = {
    version: 1,
    entries: [{
      id: 'c-small',
      kind: 'custom',
      name: '小窗',
      protocol: 'openai',
      baseUrl: 'https://small.example/v1',
      models: [{ id: 'm1', name: '小模型', contextWindow: 32768, maxTokens: 4096 }],
    }],
  }
  const yaml = routesYaml(small, { consented: false })
  assert.ok(yaml.includes('- id: compaction-basic'), '窗口小的要另配压缩')
  assert.ok(yaml.includes('      - provider: "c-small"'))
  assert.ok(yaml.includes('        model: "m1"'))
  assert.ok(yaml.includes('        headroomTokens: 7168'), '余量按剩下的一成算')
  // 窗口大的不用另配：dsh 默认的 65536 够用
  const big = routesYaml(sampleCatalog(), { consented: true })
  assert.ok(!big.includes('- id: compaction-basic'), '窗口够大的不用另配')
})

test('没有任何路线时写空 providers', () => {
  const onlyDeepseek = {
    version: 1,
    default: { entry: 'deepseek', model: 'deepseek-flash', effort: null },
    entries: [sampleCatalog().entries[1]],
  }
  const yaml = routesYaml(onlyDeepseek, { consented: true })
  assert.ok(yaml.includes('    providers: {}'))
  assert.ok(!yaml.includes('kilo:'))
})

test('noDeepseekYaml 给 llm-deepseek 一份手写目录', () => {
  const yaml = noDeepseekYaml()
  assert.ok(yaml.includes('- id: llm-deepseek'))
  assert.ok(yaml.includes('    models:'))
  assert.ok(yaml.includes('- id: "deepseek-v4-flash"'))
  assert.ok(!yaml.includes('http'), '这份补丁本身不写任何地址')
})

test('pickEffort 用打样真回包判断档位', () => {
  assert.equal(pickEffort(NEW_OPTIONS, 'off'), 'off')
  assert.equal(pickEffort(NEW_OPTIONS, 'low'), 'low')
  assert.equal(pickEffort(NEW_OPTIONS, 'high'), 'high')
  assert.equal(pickEffort(NEW_OPTIONS, 'max'), 'max')
  assert.equal(pickEffort(NEW_OPTIONS, 'medium'), null, '回包没有的档位是空')
  assert.equal(pickEffort(SWITCHED_OPTIONS, 'off'), null, '切到 Kilo 后没有思考档位')
  assert.equal(pickEffort([], 'high'), null)
  assert.equal(pickEffort(undefined, 'high'), null)
})

test('hasChoice 用打样真回包找模型选项', () => {
  assert.equal(hasChoice(NEW_OPTIONS, '["kilo","kilo-auto/free"]'), true)
  assert.equal(hasChoice(NEW_OPTIONS, '["deepseek-official","deepseek-v4-pro"]'), true)
  assert.equal(hasChoice(NEW_OPTIONS, '["deepseek-official","deepseek-v4-flash"]'), true)
  assert.equal(hasChoice(NEW_OPTIONS, '["kilo","kilo-auto/paid"]'), false)
  assert.equal(hasChoice(SWITCHED_OPTIONS, '["kilo","kilo-auto/free"]'), true)
  assert.equal(hasChoice(SWITCHED_OPTIONS, '["deepseek-official","deepseek-v4-flash"]'), false, '切走后当前模型不再补入')
  assert.equal(hasChoice([{ id: 'model', options: [{ value: 'x' }] }], 'x'), true, '没有分组时也认平铺选项')
})

test('推理等级的发送值和思考参数格式都写进路线', () => {
  const catalog = {
    entries: [
      {
        id: 'c-one',
        kind: 'custom',
        name: '一家',
        protocol: 'openai',
        baseUrl: 'https://api.example.com/v1',
        models: [
          {
            id: 'm1',
            name: '模型一',
            contextWindow: 128000,
            maxTokens: 4096,
            efforts: ['low', 'high'],
            effortValues: { low: 'LOW', high: 'xhigh' },
            vision: false,
            thinkingFormat: 'deepseek',
          },
        ],
      },
    ],
  }
  const yaml = routesYaml(catalog, { consented: true })
  assert.ok(yaml.includes('"low": "LOW"'), '每档的发送值照用户填的写')
  assert.ok(yaml.includes('"high": "xhigh"'))
  assert.ok(yaml.includes('thinkingFormat: "deepseek"'), '思考参数格式写进 compat')
  assert.ok(yaml.includes('input: ["text"]'), '默认只收文字')
})

test('Kilo 那条线路：并发上限是 1，删了再加回来还是 1', () => {
  const catalog = defaults()
  assert.equal(limitOf(catalog, 'kilo'), 1)
  const removed = removeEntry(catalog, 'kilo')
  assert.equal(removed.ok, true)
  assert.equal(limitOf(removed.catalog, 'kilo'), 0)
  const back = addKilo(removed.catalog)
  assert.equal(back.ok, true)
  assert.equal(limitOf(back.catalog, 'kilo'), 1)
})
