import assert from 'node:assert/strict'
import test from 'node:test'
import { canAgree, checksEnabled, plainTerms, reachedBottom } from '../../app/consent/logic.mjs'
import { readTerms } from '../../app/models/consent.mjs'

test('刚好到底算读完了', () => {
  assert.equal(reachedBottom({ scrollTop: 100, clientHeight: 200, scrollHeight: 300 }), true)
})

test('差 1px 算读完了', () => {
  assert.equal(reachedBottom({ scrollTop: 99, clientHeight: 200, scrollHeight: 300 }), true)
})

test('差 3px 不算读完', () => {
  assert.equal(reachedBottom({ scrollTop: 97, clientHeight: 200, scrollHeight: 300 }), false)
})

test('内容比框矮也算读完了', () => {
  assert.equal(reachedBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 100 }), true)
})

test('没滚到底两个勾都点不了', () => {
  assert.equal(checksEnabled(false), false)
  assert.equal(checksEnabled(true), true)
})

test('只勾一个不能同意', () => {
  assert.equal(canAgree({ reached: true, terms: true, crossBorder: false }), false)
  assert.equal(canAgree({ reached: true, terms: false, crossBorder: true }), false)
  assert.equal(canAgree({ reached: false, terms: true, crossBorder: true }), false)
})

test('两个都勾上并且读完了才能同意', () => {
  assert.equal(canAgree({ reached: true, terms: true, crossBorder: true }), true)
})

test('条款去掉 markdown 记号，正文留着', () => {
  const plain = plainTerms(readTerms())
  assert.equal(plain.includes('#'), false)
  assert.equal(plain.includes('**'), false)
  for (const mark of ['一、', '二、', '三、', '四、', '五、', '六、', '七、']) {
    assert.equal(plain.includes(mark), true, `少了 ${mark}`)
  }
  assert.equal(plain.includes('ai-gateway.kilo.ai'), true)
})

test('条款里的标题也去掉井号', () => {
  assert.equal(plainTerms('# 标题\n**一、正文。**'), '标题\n一、正文。')
})
