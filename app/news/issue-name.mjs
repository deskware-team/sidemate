// 一期早报生成时的主题名：订阅改过名以后，菜单里旧那几期还写当时的名字，才不看着像混在一起。
// 名字从那一期文件夹里 新闻.md 的第一行标题拆出来（标题按 report.title 的模板拼，带「# 」）。
// 纯逻辑（拆名字）在 topicNameFromTitle，好测；碰盘的只有 issueNameOf（只读开头一小段）。

import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'

import { raw } from '../copy/copy.mjs'
import { PAPER_FILE, issueDir } from './topics.mjs'

// 正则里的特殊字符转义
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 标题第一行的样子：照 report.title 的模板（「{topic} {date} 新闻」）拆成形状，
// {topic} 抓名字、{date} 抓日期（YYYY-MM-DD），别的字面那段得原样对上
const TITLE_RE = new RegExp(
  `^#\\s${raw('report.title')
    .split(/(\{topic\}|\{date\})/)
    .map((part) => (part === '{topic}' ? '(.+)' : part === '{date}' ? '(\\d{4}-\\d{2}-\\d{2})' : escapeRe(part)))
    .join('')}$`,
)

// 从早报第一行拆出生成时的主题名。对不上模板（没有 #、日期跟那一期对不上、结尾不是那句）就当不知道，给 null。
export function topicNameFromTitle(firstLine, date = '') {
  const hit = TITLE_RE.exec(String(firstLine ?? '').trimEnd())
  if (!hit || (date && hit[2] !== date)) return null
  return hit[1].trim() || null
}

// 只读开头这一截就够拆第一行，用不着整份读进来（截断了当不知道，只写日期）
const HEAD_BYTES = 256

// 那一期生成时的主题名：读 <news>/<主题id>/<日期>/新闻.md 的第一行。文件不在、拆不出来，都给 null。
export function issueNameOf(low, topic, date) {
  let fd
  try {
    fd = openSync(join(issueDir(low, topic, date), PAPER_FILE), 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const got = readSync(fd, buf, 0, HEAD_BYTES, 0)
    const firstLine = buf.subarray(0, got).toString('utf8').split(/\r?\n/, 1)[0]
    return topicNameFromTitle(firstLine, date)
  } finally {
    closeSync(fd)
  }
}
