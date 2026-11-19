// 错过的那些天：记在主题那一层，新闻列表里那几天写明「未生成：桌伴未运行」。

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isMissed, markMissed, missedDates, missedFile } from '../../app/news/missed.mjs'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sidemate-newsmissed-'))
}

const topic = { id: 't-ai', name: 'AI 行业' }

test('记一天错过：读得回来，从新到旧', () => {
  const root = tempRoot()
  try {
    assert.deepEqual(missedDates(root, topic), [])
    markMissed(root, topic, '2026-11-10')
    markMissed(root, topic, '2026-11-12')
    assert.deepEqual(missedDates(root, topic), ['2026-11-12', '2026-11-10'])
    assert.equal(isMissed(root, topic, '2026-11-10'), true)
    assert.equal(isMissed(root, topic, '2026-11-11'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('同一天不记两遍', () => {
  const root = tempRoot()
  try {
    markMissed(root, topic, '2026-11-10')
    markMissed(root, topic, '2026-11-10')
    assert.deepEqual(missedDates(root, topic), ['2026-11-10'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('不认的日期不记', () => {
  const root = tempRoot()
  try {
    markMissed(root, topic, '不是日期')
    markMissed(root, topic, '')
    assert.deepEqual(missedDates(root, topic), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('记在主题那一层：每个主题各记各的', () => {
  const root = tempRoot()
  try {
    markMissed(root, topic, '2026-11-10')
    markMissed(root, { id: 't-car', name: '汽车' }, '2026-11-11')
    assert.deepEqual(missedDates(root, topic), ['2026-11-10'])
    assert.deepEqual(missedDates(root, { id: 't-car', name: '汽车' }), ['2026-11-11'])
    assert.equal(missedFile(root, topic).endsWith(join('t-ai', 'missed.json')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
