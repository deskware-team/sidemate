// 一期早报第一行标题里拆生成时的主题名：纯逻辑拆名字、只读文件开头一小段。全程只碰临时目录。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PAPER_FILE } from '../../app/news/topics.mjs'
import { issueNameOf, topicNameFromTitle } from '../../app/news/issue-name.mjs'

const DATE = '2026-11-25'

// 临时目录，用完删掉
function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sidemate-news-name-'))
}

// 造一期：<news>/<主题id>/<日期>/新闻.md，第一行按 runner 写标题的样子拼
function makeIssue(root, firstLine, date = DATE) {
  const dir = join(root, 't-ai', date)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PAPER_FILE), `${firstLine}\n\n## 今天\n\n**一条**\n\n来源：站 [题](https://e.example/1)\n`, 'utf8')
}

test('拆名字：标题第一行是「# {topic} {date} 新闻」，名字带空格也拆得出', () => {
  assert.equal(topicNameFromTitle(`# AI 行业 ${DATE} 新闻`, DATE), 'AI 行业')
  assert.equal(topicNameFromTitle(`# 人工智能 大模型 ${DATE} 新闻`, DATE), '人工智能 大模型')
})

test('拆名字：对不上模板的当不知道，给 null', () => {
  // 没有 #、没有日期、结尾不是那句、日期跟那一期对不上、空的
  assert.equal(topicNameFromTitle(`AI 行业 ${DATE} 新闻`, DATE), null)
  assert.equal(topicNameFromTitle('# AI 行业 新闻', DATE), null)
  assert.equal(topicNameFromTitle('# 每日快讯', DATE), null)
  assert.equal(topicNameFromTitle(`# AI 行业 ${DATE} 周报`, DATE), null)
  assert.equal(topicNameFromTitle('# AI 行业 2026-11-24 新闻', DATE), null)
  assert.equal(topicNameFromTitle('', DATE), null)
  assert.equal(topicNameFromTitle(null, DATE), null)
})

test('读文件：那一期生成时的名字从 新闻.md 第一行来', () => {
  const root = tempDir()
  makeIssue(root, `# AI 行业 ${DATE} 新闻`)
  assert.equal(issueNameOf(root, { id: 't-ai' }, DATE), 'AI 行业')
  rmSync(root, { recursive: true, force: true })
})

test('读文件：文件不在、第一行对不上模板，都当不知道', () => {
  const root = tempDir()
  assert.equal(issueNameOf(root, { id: 't-ai' }, DATE), null)
  makeIssue(root, '# 今天的快报')
  assert.equal(issueNameOf(root, { id: 't-ai' }, DATE), null)
  rmSync(root, { recursive: true, force: true })
})

test('读文件：只看第一行，后面的正文多长都不碍事', () => {
  const root = tempDir()
  makeIssue(root, `# AI 行业 ${DATE} 新闻`)
  writeFileSync(join(root, 't-ai', DATE, PAPER_FILE), `# AI 行业 ${DATE} 新闻\n\n${'很长的正文。'.repeat(5000)}\n`, 'utf8')
  assert.equal(issueNameOf(root, { id: 't-ai' }, DATE), 'AI 行业')
  rmSync(root, { recursive: true, force: true })
})
