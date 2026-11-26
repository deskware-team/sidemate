// 对话里的 mermaid 代码块：写完了（块闭合）才画成流程图，还没写完照普通代码块显示。

import assert from 'node:assert/strict'
import test from 'node:test'
import { markdownBlocks } from '../../app/task/markdown.mjs'

test('写完的 mermaid 块认成流程图', () => {
  const blocks = markdownBlocks('```mermaid\nflowchart TD\n  A[接需求] --> B[交付]\n```')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'mermaid')
  assert.equal(blocks[0].text, 'flowchart TD\n  A[接需求] --> B[交付]')
})

test('还没写完的 mermaid 块照普通代码块', () => {
  const blocks = markdownBlocks('```mermaid\nflowchart TD\n  A[接需求] -->')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'code')
})

test('别的语言还是代码块，chart 块照旧是统计图', () => {
  assert.equal(markdownBlocks('```js\nconst a = 1\n```')[0].type, 'code')
  const chart = markdownBlocks('```chart\n{"type":"bar","categories":["甲"],"series":[{"name":"本周","data":[1]}]}\n```')
  assert.equal(chart[0].type, 'chart')
})
