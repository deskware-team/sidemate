import assert from 'node:assert/strict'
import test from 'node:test'
import { addCustom, defaults } from '../../app/models/catalog.mjs'
import { has } from '../../app/copy/copy.mjs'
import { chipOf, defaultEffortOf, keyringHas, menuList, modelLabel, modelParts } from '../../app/task/models-menu.mjs'
import { createTask, reduceTask } from '../../app/task/state.mjs'

// 有 DeepSeek 钥匙的假钥匙串：usable 里的 DeepSeek 要靠它
const deepseekKey = { read: (id) => (id === 'deepseek' ? 'sk-1' : null), has: () => false }
const noKey = { read: () => null, has: () => false }

// 智谱那条自定义 + DeepSeek 钥匙的清单
function zhipuCatalog() {
  return addCustom(defaults(), { preset: 'zhipu' }).catalog
}

test('每个模型的名字：内置写条目名，自定义写条目和模型两截（不用「·」连）', () => {
  const catalog = zhipuCatalog()
  const [, deepseek] = catalog.entries
  const [kilo] = catalog.entries
  assert.equal(modelLabel(kilo, kilo.models[0]), 'Kilo 模型')
  assert.equal(modelLabel(deepseek, deepseek.models[0]), 'DeepSeek')
  const zhipu = catalog.entries.find((entry) => entry.id === 'c-zhipu')
  assert.deepEqual(modelParts(zhipu, zhipu.models[0]), ['GLM', 'GLM-4.7-Flash'])
  assert.equal(modelLabel(zhipu, zhipu.models[0]), 'GLM GLM-4.7-Flash')
})

test('能用的模型只有一个时没有 ▾，点不开', () => {
  // 一把钥匙都没有、免费通道没同意：列表里只有免费通道一行
  const catalog = defaults()
  const list = menuList({ catalog, hasKey: keyringHas(noKey), consented: false })
  assert.equal(list.length, 1)
  assert.equal(list[0].entry, 'kilo')
  const chip = chipOf({ catalog, list, choice: null, working: false })
  assert.equal(chip.canOpen, false)
  // 当前写的是清单默认那个的名字
  assert.equal(chip.name, 'DeepSeek')
})

test('模型不止一个时有 ▾', () => {
  const catalog = zhipuCatalog()
  const list = menuList({ catalog, hasKey: keyringHas(deepseekKey), consented: true })
  assert.ok(list.length > 1)
  assert.equal(chipOf({ catalog, list, choice: null, working: false }).canOpen, true)
})

test('干活中不能点，就算模型不止一个', () => {
  const catalog = zhipuCatalog()
  const list = menuList({ catalog, hasKey: keyringHas(deepseekKey), consented: true })
  assert.equal(chipOf({ catalog, list, choice: null, working: true }).canOpen, false)
})

test('DeepSeek 那行有二级菜单，只列四档', () => {
  const list = menuList({ catalog: defaults(), hasKey: keyringHas(deepseekKey), consented: false })
  const deepseek = list.find((one) => one.entry === 'deepseek')
  assert.equal(deepseek.name, 'DeepSeek')
  assert.equal(deepseek.needsConsent, false)
  assert.deepEqual(deepseek.efforts, [
    { id: 'off', label: '关' },
    { id: 'low', label: '低' },
    { id: 'high', label: '高' },
    { id: 'max', label: '最高' },
  ])
  assert.equal(deepseek.efforts.some((one) => one.id === 'medium'), false)
  // 行里的小字：几个档位用「、」连，不用「·」
  assert.equal(deepseek.note, '思考：关、低、高、最高')
})

test('智谱 GLM-4.7-Flash 没有二级菜单', () => {
  const zhipuKey = { read: () => null, has: (id) => id === 'c-zhipu' }
  const list = menuList({ catalog: zhipuCatalog(), hasKey: keyringHas(zhipuKey), consented: false })
  const zhipu = list.find((one) => one.entry === 'c-zhipu')
  assert.equal(zhipu.name, 'GLM GLM-4.7-Flash')
  assert.deepEqual(zhipu.parts, ['GLM', 'GLM-4.7-Flash'])
  assert.deepEqual(zhipu.efforts, [])
})

test('Kilo 那条一直列着：没同意标 needsConsent，同意了不标', () => {
  const catalog = zhipuCatalog()
  const key = { read: () => null, has: (id) => id === 'c-zhipu' }
  const before = menuList({ catalog, hasKey: keyringHas(key), consented: false })
  const kilo = before.find((one) => one.entry === 'kilo')
  assert.equal(kilo.name, 'Kilo 模型')
  assert.equal(kilo.needsConsent, true)
  assert.equal(before.some((one) => one.entry === 'deepseek'), false)
  const after = menuList({ catalog, hasKey: keyringHas(key), consented: true })
  assert.equal(after.find((one) => one.entry === 'kilo').needsConsent, false)
})

test('没钥匙的 DeepSeek 不进列表，keyringHas 看读不读得出', () => {
  assert.equal(keyringHas(deepseekKey)('deepseek'), true)
  assert.equal(keyringHas({ read: () => null, has: () => true })('deepseek'), false)
  assert.equal(keyringHas({ read: () => null, has: (id) => id === 'c-zhipu' })('c-zhipu'), true)
  assert.equal(keyringHas(noKey)('deepseek'), false)
  const list = menuList({ catalog: defaults(), hasKey: keyringHas(noKey), consented: false })
  assert.deepEqual(list.map((one) => one.entry), ['kilo'])
})

test('选了记进任务状态，下一句开工带出去；干活中不收', () => {
  let s = createTask()
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  s = reduceTask(s, { type: 'model', entry: 'deepseek', model: 'deepseek-flash', effort: 'low' }).state
  assert.deepEqual(s.model, { entry: 'deepseek', model: 'deepseek-flash', effort: 'low' })
  const sent = reduceTask(s, { type: 'send', text: '写一份', runId: 'r1' })
  assert.deepEqual(sent.start.model, { entry: 'deepseek', model: 'deepseek-flash', effort: 'low' })
  // 干活中再选：不收
  const atWork = reduceTask(sent.state, { type: 'model', entry: 'kilo', model: 'kilo-auto/free', effort: null })
  assert.equal(atWork.state, sent.state)
  // 坏的不收：空的、档位不是字符串
  let d = reduceTask(sent.state, { type: 'end', taskId: 'r1', status: 'done' }).state
  const same1 = reduceTask(d, { type: 'model', entry: '', model: 'x' })
  assert.equal(same1.state, d)
  const same2 = reduceTask(d, { type: 'model', entry: 'deepseek', model: 'deepseek-flash', effort: 3 })
  assert.equal(same2.state, d)
})

test('新任务回到清单默认，小签跟着写默认的名字', () => {
  const catalog = defaults()
  const list = menuList({ catalog, hasKey: keyringHas(deepseekKey), consented: false })
  let s = createTask()
  s = reduceTask(s, { type: 'drop', files: ['C:/材料/一.pdf'] }).state
  s = reduceTask(s, { type: 'model', entry: 'deepseek', model: 'deepseek-flash', effort: 'low' }).state
  assert.deepEqual(chipOf({ catalog, list, choice: s.model, working: false }).effortLabel, '低')
  s = reduceTask(s, { type: 'new' }).state
  assert.equal(s.model, null)
  const chip = chipOf({ catalog, list, choice: s.model, working: false })
  assert.deepEqual([chip.entry, chip.model, chip.effort], ['deepseek', 'deepseek-flash', null])
  assert.equal(chip.name, 'DeepSeek')
  assert.equal(chip.effortLabel, '')
})

test('清单默认选的模型用不了时，小签照样写得出它的名字', () => {
  const catalog = defaults()
  const list = menuList({ catalog, hasKey: keyringHas(noKey), consented: false })
  assert.deepEqual(list.map((one) => one.entry), ['kilo'])
  const chip = chipOf({ catalog, list, choice: null, working: false })
  assert.equal(chip.name, 'DeepSeek')
})

test('Kilo 模型那行不写额度：额度自己数的那套删了', () => {
  // 「免费」这条文案删了
  assert.equal(has('models.free'), false)
  // 额度那几句文案也删了
  assert.equal(has('models.quotaLeft'), false)
  assert.equal(has('models.quotaDone'), false)
  // 菜单里 Kilo 那一行不写小字
  const list = menuList({
    catalog: defaults(),
    hasKey: keyringHas(noKey),
    consented: true,
  })
  const kilo = list.find((one) => one.entry === 'kilo')
  assert.equal(kilo.note, '')
})

test('思考档位：DeepSeek 没选档位时 dsh 用「高」，菜单上标出来；自定义线路说不准，不标', () => {
  const catalog = zhipuCatalog()
  const list = menuList({ catalog, hasKey: keyringHas(deepseekKey), consented: true })
  const deepseek = list.find((row) => row.entry === 'deepseek')
  assert.equal(deepseek.defaultEffort, 'high')
  assert.equal(defaultEffortOf({ kind: 'custom' }, ['low', 'high']), null, '自定义线路不标')
  assert.equal(defaultEffortOf({ kind: 'deepseek' }, ['off', 'low']), null, '没有「高」这一档就不标')
  assert.equal(has('models.effortDefault'), true)
})
