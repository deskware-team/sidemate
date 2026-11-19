import assert from 'node:assert/strict'
import test from 'node:test'
import { ALLOWED_HOSTS, GUIDES, isGuideUrl } from '../../app/models/guides.mjs'

const GUIDE_IDS = ['deepseek', 'zhipu']

test('两份教程都在，各有 5 步', () => {
  assert.deepEqual(Object.keys(GUIDES).sort(), GUIDE_IDS.slice().sort())
  for (const id of GUIDE_IDS) {
    const guide = GUIDES[id]
    assert.equal(typeof guide.title, 'string')
    assert.equal(typeof guide.intro, 'string')
    assert.equal(guide.steps.length, 5)
    assert.equal(typeof guide.outro, 'string')
    assert.equal(typeof guide.docs.label, 'string')
    assert.equal(typeof guide.docs.url, 'string')
    for (const item of guide.steps) {
      assert.equal(typeof item.text, 'string')
      assert.ok(item.text.length > 0)
      assert.ok(item.url === null || typeof item.url === 'string')
    }
  }
})

test('每一步的链接和官方说明都过 isGuideUrl', () => {
  for (const id of GUIDE_IDS) {
    const guide = GUIDES[id]
    for (const item of guide.steps) {
      if (item.url) assert.equal(isGuideUrl(item.url), true, `${id} 的步骤链接：${item.url}`)
    }
    assert.equal(isGuideUrl(guide.docs.url), true, `${id} 的官方说明链接`)
  }
})

test('isGuideUrl 只放行官方 https 域名', () => {
  assert.equal(isGuideUrl('https://platform.deepseek.com/'), true)
  assert.equal(isGuideUrl('https://api-docs.deepseek.com/zh-cn/'), true)
  assert.equal(isGuideUrl('https://bigmodel.cn/'), true)
  assert.equal(isGuideUrl('https://docs.bigmodel.cn/cn/guide/start/quick-start'), true)
  assert.equal(isGuideUrl('http://platform.deepseek.com/'), false)
  assert.equal(isGuideUrl('https://evil.com/'), false)
  assert.equal(isGuideUrl('https://platform.deepseek.com.evil.com/'), false)
  assert.equal(isGuideUrl('https://a@platform.deepseek.com/'), false)
  assert.equal(isGuideUrl(''), false)
  assert.equal(isGuideUrl(null), false)
  assert.equal(isGuideUrl('不是地址'), false)
})

test('放行的域名表就是这四个', () => {
  assert.deepEqual(ALLOWED_HOSTS, [
    'platform.deepseek.com',
    'api-docs.deepseek.com',
    'bigmodel.cn',
    'docs.bigmodel.cn',
  ])
})

test('两份结尾都以「为准」收尾；开头、步骤、结尾都是一句话，末尾不加句号', () => {
  for (const id of GUIDE_IDS) {
    const guide = GUIDES[id]
    assert.ok(guide.outro.endsWith('为准'), `${id} 的结尾`)
    for (const text of [guide.intro, ...guide.steps.map((one) => one.text), guide.outro]) {
      assert.equal(text.endsWith('。'), false, `${id}：${text}`)
    }
  }
})

test('文字里没有不该出现的词', () => {
  const words = ['MCP', 'mcp', 'token', 'Token', 'skill', 'Skill']
  for (const id of GUIDE_IDS) {
    const guide = GUIDES[id]
    const parts = [guide.title, guide.intro, guide.outro, guide.docs.label]
    for (const item of guide.steps) parts.push(item.text)
    for (const part of parts) {
      for (const word of words) {
        assert.equal(part.includes(word), false, `${id} 的文字里出现了 ${word}`)
      }
    }
  }
})

test('导出的教程是冻住的', () => {
  assert.equal(Object.isFrozen(GUIDES), true)
  assert.equal(Object.isFrozen(ALLOWED_HOSTS), true)
  for (const id of GUIDE_IDS) {
    const guide = GUIDES[id]
    assert.equal(Object.isFrozen(guide), true)
    assert.equal(Object.isFrozen(guide.steps), true)
    assert.equal(Object.isFrozen(guide.docs), true)
    for (const item of guide.steps) assert.equal(Object.isFrozen(item), true)
  }
})
