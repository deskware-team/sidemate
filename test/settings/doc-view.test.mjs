// 关于页的全文：隐私与使用声明、Kilo 模型使用须知照 Markdown 排（解析用任务窗那一份），
// 看得见的字里不露 # 和 **；隐私声明跟着现在的产品说法走。

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { docBlocks } from '../../app/settings/doc-view.js'

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

// 一块里所有看得见的字
function textsOf(block) {
  const flat = (segs) => (segs || []).map((one) => one.text)
  if (block.type === 'ul' || block.type === 'ol') return block.items.flatMap(flat)
  if (block.type === 'table') return [...block.head, ...block.rows.flat()].flatMap(flat)
  if (block.type === 'code') return [block.text]
  return flat(block.segs)
}

test('隐私声明和 Kilo 模型使用须知摊开以后：有标题，看得见的字里没有 # 和 **（\\n、\\r\\n 换行都一样）', () => {
  for (const rel of ['PRIVACY.md', 'app/legal/kilo-terms.md']) {
    const lf = read(rel).replace(/\r\n/g, '\n')
    // Windows 上检出、打包出来的是 \r\n：两种都摊一遍
    for (const text of [lf, lf.replace(/\n/g, '\r\n')]) {
      const blocks = docBlocks(text)
      // 隐私声明里有小标题；两份都有加粗（「一、……」那些）
      if (rel === 'PRIVACY.md') assert.ok(blocks.some((one) => one.type === 'h'), `${rel} 没认出标题`)
      assert.ok(blocks.some((one) => (one.segs || []).some((seg) => seg.bold)), `${rel} 没认出加粗`)
      // 开头那个一级标题跟全文页的标题重复，摘掉了
      assert.notEqual(blocks[0].type, 'h', `${rel} 开头的一级标题没摘掉`)
      for (const one of blocks.flatMap(textsOf)) {
        assert.equal(one.includes('**'), false, `${rel} 露出了 **：${one}`)
        assert.equal(/(^|\n)\s*#/.test(one), false, `${rel} 露出了 #：${one}`)
        assert.equal(one.includes('\r'), false, `${rel} 留着 \\r：${JSON.stringify(one)}`)
      }
    }
  }
})

test('隐私声明和 Kilo 模型使用须知里不出现「免费」（中英文都不出现）', () => {
  // app/legal 下所有文件都算：须知全文在那儿，文件名也不带那两个字
  const legal = readdirSync(new URL('../../app/legal/', import.meta.url)).filter((one) => one.endsWith('.md'))
  for (const rel of ['PRIVACY.md', 'PRIVACY.en.md', ...legal.map((one) => `app/legal/${one}`)]) {
    const text = read(rel)
    assert.equal(text.includes('免费'), false, `${rel} 里还有「免费」`)
    assert.equal(/\bfree\b/i.test(text), false, `${rel} 里还有 “free”`)
  }
  // 文件名也不带那两个字
  for (const one of legal) {
    assert.equal(one.includes('免费'), false, `app/legal 里的文件名还有「免费」：${one}`)
  }
})

test('隐私声明跟着现在的说法：不写免费通道、钥匙这些旧词，不提已经删掉的东西', () => {
  const text = read('PRIVACY.md')
  for (const word of ['免费通道', '钥匙', '随手', '范本', '材料', '智谱', 'token', 'key.bin', '测一下', 'safeStorage']) {
    assert.equal(text.includes(word), false, `隐私声明里还有「${word}」`)
  }
  // 相对链接在设置窗里点不开，[文字](地址) 会原样露出来
  assert.equal(/\]\(/.test(text), false, '隐私声明里有 Markdown 链接')
})
