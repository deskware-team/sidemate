// 设置变化要不要重起 dsh 的判断：钥匙变了、能不能看图的模型变了，都得重起；
// 删掉正在用的模型要先问一句。纯函数，直接测。

import assert from 'node:assert/strict'
import test from 'node:test'
import { acpSignature, keyChanges, planSave, removedChoices, routeChanges, snapshot, visionChanges } from '../../app/models/restart.mjs'

// 一份清单：一个自定义条目（两个模型，一个看图）、DeepSeek
const CATALOG = {
  version: 1,
  default: { entry: 'deepseek', model: 'deepseek-flash', effort: null },
  entries: [
    {
      id: 'c-zhipu',
      kind: 'custom',
      name: '智谱',
      protocol: 'openai',
      baseUrl: 'https://example.invalid/v4',
      concurrency: 1,
      models: [
        { id: 'glm', name: 'GLM', vision: false },
        { id: 'glm-vision', name: 'GLM 看图', vision: true },
      ],
    },
    {
      id: 'deepseek',
      kind: 'deepseek',
      name: 'DeepSeek',
      protocol: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      concurrency: 0,
      models: [{ id: 'deepseek-flash', name: 'DeepSeek', vision: true }],
    },
  ],
}

const KEYS = { 'c-zhipu': 'hash-1', deepseek: 'hash-2' }

test('快照：钥匙的指纹、能用的模型、能看图的模型、默认那个', () => {
  const snap = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  assert.deepEqual(snap.keys, KEYS)
  assert.deepEqual(snap.vision, ['c-zhipu/glm-vision', 'deepseek/deepseek-flash'])
  assert.deepEqual(snap.usable, ['c-zhipu/glm', 'c-zhipu/glm-vision', 'deepseek/deepseek-flash'])
  assert.equal(snap.default, 'deepseek/deepseek-flash')
  assert.deepEqual(snap.models['c-zhipu'], ['glm', 'glm-vision'])
})

test('没配钥匙的条目：那个条目上的模型不算能用', () => {
  const snap = snapshot({ catalog: CATALOG, keys: { deepseek: 'hash-2' }, consented: false })
  assert.deepEqual(snap.vision, ['deepseek/deepseek-flash'])
  assert.equal(snap.usable.includes('c-zhipu/glm'), false)
})

test('acp 那一行：能看图的第一个；没有就默认那个', () => {
  const withVision = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  assert.equal(acpSignature(withVision), 'c-zhipu/glm-vision')
  const noVision = snapshot({ catalog: CATALOG, keys: {}, consented: false })
  // 什么钥匙都没有：能看图的模型一个都没有，acp 那一行空着
  assert.equal(acpSignature(noVision), '')
  const onlyText = snapshot({ catalog: CATALOG, keys: { 'c-zhipu': 'hash-1' }, consented: false })
  assert.equal(acpSignature(onlyText), 'c-zhipu/glm-vision')
})

test('钥匙变了：加了、删了、换了都算', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({ catalog: CATALOG, keys: { 'c-zhipu': 'hash-9', deepseek: 'hash-2' }, consented: false })
  const diff = keyChanges(before, after)
  assert.deepEqual(diff.changed, ['c-zhipu'])
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
})

test('看图模型变了：多了一个、没了一个都算', () => {
  const before = snapshot({ catalog: CATALOG, keys: { deepseek: 'hash-2' }, consented: false })
  const after = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const diff = visionChanges(before, after)
  assert.deepEqual(diff.added, ['c-zhipu/glm-vision'])
  assert.deepEqual(diff.removed, [])
})

test('清单里少了哪些模型：删条目、删模型、改模型 id 都算', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({
    catalog: { ...CATALOG, entries: CATALOG.entries.map((one) => (one.id === 'c-zhipu' ? { ...one, models: [{ id: 'glm', name: 'GLM', vision: false }] } : one)) },
    keys: KEYS,
    consented: false,
  })
  assert.deepEqual(removedChoices(before, after), ['c-zhipu/glm-vision'])
})

test('什么都没改：照热加载走，不重起', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const plan = planSave({ before, after: before, busy: false })
  assert.equal(plan.action, 'none')
  assert.deepEqual(plan.reasons, [])
})

test('只改开关、线路：不用重起', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({
    catalog: { ...CATALOG, default: { entry: 'c-zhipu', model: 'glm', effort: null } },
    keys: KEYS,
    consented: false,
  })
  const plan = planSave({ before, after, busy: false })
  assert.equal(plan.action, 'none')
})

test('换了钥匙：没人跑就重起，有人跑先问一句', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({ catalog: CATALOG, keys: { 'c-zhipu': 'hash-9', deepseek: 'hash-2' }, consented: false })
  const idle = planSave({ before, after, busy: false })
  assert.equal(idle.action, 'restart')
  assert.deepEqual(idle.reasons, ['key'])
  const busy = planSave({ before, after, busy: true })
  assert.equal(busy.action, 'ask')
  assert.equal(busy.ask, 'restart')
})

test('看图模型从无到有：一样要重起', () => {
  const before = snapshot({ catalog: CATALOG, keys: { deepseek: 'hash-2' }, consented: false })
  const after = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const plan = planSave({ before, after, busy: false })
  assert.equal(plan.action, 'restart')
  assert.equal(plan.reasons.includes('vision'), true)
})

test('删掉正在用的模型：先问一句，删的是哪些也说得清', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({
    catalog: { ...CATALOG, entries: CATALOG.entries.map((one) => (one.id === 'c-zhipu' ? { ...one, models: [{ id: 'glm', name: 'GLM', vision: false }] } : one)) },
    keys: KEYS,
    consented: false,
  })
  const plan = planSave({ before, after, busy: true, inUse: ['c-zhipu/glm-vision'] })
  assert.equal(plan.action, 'ask')
  assert.equal(plan.ask, 'delete')
  assert.deepEqual(plan.hit, ['c-zhipu/glm-vision'])
  assert.deepEqual(plan.interrupt, ['c-zhipu/glm-vision'])
})

test('删掉没人用的模型：不用问，也不用重起（热加载删得掉）', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  // 删掉那个只认字的模型：看图的名单没变，acp 那一行也没变
  const after = snapshot({
    catalog: { ...CATALOG, entries: CATALOG.entries.map((one) => (one.id === 'c-zhipu' ? { ...one, models: [{ id: 'glm-vision', name: 'GLM 看图', vision: true }] } : one)) },
    keys: KEYS,
    consented: false,
  })
  const plan = planSave({ before, after, busy: true, inUse: ['deepseek/deepseek-flash'] })
  assert.notEqual(plan.ask, 'delete')
  assert.deepEqual(plan.hit, [])
  assert.equal(plan.action, 'none', '没人用的模型删掉不用重起')
  assert.deepEqual(plan.reasons, [])
})

test('删掉的是能看图的那个：acp 那一行变了，得重起（有人跑就问一句）', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({
    catalog: { ...CATALOG, entries: CATALOG.entries.map((one) => (one.id === 'c-zhipu' ? { ...one, models: [{ id: 'glm', name: 'GLM', vision: false }] } : one)) },
    keys: KEYS,
    consented: false,
  })
  const idle = planSave({ before, after, busy: false })
  assert.equal(idle.action, 'restart')
  assert.deepEqual(idle.reasons, ['vision'])
  const busy = planSave({ before, after, busy: true, inUse: ['deepseek/deepseek-flash'] })
  assert.equal(busy.action, 'ask')
  assert.equal(busy.ask, 'restart')
})

test('路线集合变了：等得到 dsh 报的那一声（别的改动等不到）', () => {
  const before = snapshot({ catalog: CATALOG, keys: KEYS, consented: false })
  const after = snapshot({
    catalog: { ...CATALOG, entries: [...CATALOG.entries, { id: 'c-new', kind: 'custom', name: '新线路', protocol: 'openai', baseUrl: 'https://example.invalid/v4', concurrency: 1, models: [{ id: 'm1', name: 'M1', vision: false }] }] },
    keys: KEYS,
    consented: false,
  })
  const diff = routeChanges(before, after)
  assert.deepEqual(diff.added, ['c-new'])
  assert.deepEqual(diff.removed, [])
  const plan = planSave({ before, after, busy: false })
  assert.equal(plan.expectReport, true, '加了路线要等 dsh 报一声')
  const same = planSave({ before, after: snapshot({ catalog: CATALOG, keys: KEYS, consented: false }), busy: false })
  assert.equal(same.expectReport, false, '没加路线就不用等')
})
