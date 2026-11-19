// 桌伴自己的全局说明：dsh 起进程时会把 <DSH_AGENTS_HOME>/AGENTS.md 读进去当全局规矩讲给模型
//（dsh-agent-instructions 的 user-global 一路），所以回话怎么用 Markdown 写在这。内容一样就不重写，
// 别的文件不碰。字在 app/copy/harness.mjs 的 agents。
//
// 这一段单独放一个文件：dsh/index.mjs 只管起 dsh，规矩本身在这儿。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../copy/copy.mjs'

export const AGENTS_GUIDE = t('agents')

// 今天的日期也写进这份全局说明：模型写通知、落款、表格里的日期时用当天的，
// 不用自己猜一个 [20XX] 出来。
export function agentsGuideText(now = new Date()) {
  const day = now instanceof Date ? now : new Date(now)
  return `${AGENTS_GUIDE}\n${t('agents.today', { year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate() })}`
}

export function writeAgentsGuide(agentsHome) {
  mkdirSync(agentsHome, { recursive: true })
  const path = join(agentsHome, 'AGENTS.md')
  const want = `${agentsGuideText()}\n`
  try {
    if (readFileSync(path, 'utf8') === want) return
  } catch { /* 还没写过的就写一份 */ }
  writeFileSync(path, want, 'utf8')
}
