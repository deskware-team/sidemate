// dshLaunch 起进程前写的那份桌伴全局说明（<DSH_AGENTS_HOME>/AGENTS.md）：
// 内容一样不重写，别的不碰。dsh 那边读不读它，依据写在回报里（payload 的
// dsh-agent-instructions 会把 <agentsHome>/AGENTS.md 当 user-global 说明收进开场白）。

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dshLaunch } from '../../app/dsh/index.mjs'
import { AGENTS_GUIDE, agentsGuideText, writeAgentsGuide } from '../../app/dsh/agents-guide.mjs'

const roots = []
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

test(() => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* Windows 上进程刚收掉还占着文件：删不掉就留给系统清 */ } }
})

test('writeAgentsGuide：写得出那两句；内容一样不重写，别的不碰', () => {
  const home = scratch('sidemate-agents-')
  const path = join(home, 'agents', 'AGENTS.md')
  // 目录还没建也能写
  writeAgentsGuide(join(home, 'agents'))
  assert.equal(existsSync(path), true)
  assert.equal(readFileSync(path, 'utf8'), `${agentsGuideText()}\n`)
  // 内容一样就不重写：改改时间戳当指纹，再跑一遍不该动它
  const before = statSync(path)
  const stamp = new Date(Date.now() - 60_000)
  utimesSync(path, stamp, stamp)
  writeAgentsGuide(join(home, 'agents'))
  assert.equal(statSync(path).mtimeMs, stamp.getTime())
  // 写坏了 / 被改过的换回桌伴自己的那份
  writeFileSync(path, '别的工具写的\n', 'utf8')
  writeAgentsGuide(join(home, 'agents'))
  assert.equal(readFileSync(path, 'utf8'), `${agentsGuideText()}\n`)
  // agents 目录里别的文件不碰
  writeFileSync(join(home, 'agents', '别的.txt'), '留着\n', 'utf8')
  writeAgentsGuide(join(home, 'agents'))
  assert.equal(readFileSync(join(home, 'agents', '别的.txt'), 'utf8'), '留着\n')
})

test('全局说明里写着今天的日期：模型写通知、落款不用自己猜一个 [20XX]', () => {
  const text = agentsGuideText(new Date(2026, 10, 13))
  assert.ok(text.includes('今天的日期是 2026年11月13日'), text)
  assert.ok(text.startsWith(AGENTS_GUIDE), text)
})

test('dshLaunch：起进程前把那份说明放进 agents 目录，DSH_AGENTS_HOME 指着它', () => {
  const lowRoot = scratch('sidemate-low-')
  const workspace = scratch('sidemate-ws-')
  const launch = dshLaunch({ lowRoot, workspace, taskId: 'agents-guide' })
  assert.equal(launch.env.DSH_AGENTS_HOME, join(lowRoot, 'agents'))
  const path = join(lowRoot, 'agents', 'AGENTS.md')
  assert.equal(existsSync(path), true)
  assert.equal(readFileSync(path, 'utf8'), `${agentsGuideText()}\n`)
  // 那几句就写在文件里，不多不少
  assert.equal(AGENTS_GUIDE, '回话用 Markdown。分几件事说时，每件用「### 小标题」开头；粗体只用一对 **。给用户看的话一律用中文。工具没拿到结果、影响成品的，在回话里直接说哪一项没拿到、你是怎么处理的。材料里没有的时间、地点、人名、数字，不要自己补；缺了就写「待定」或「另行通知」，并在回话里说一声。干活过程中你说的每一段话用户都看得到：用用户听得懂的话说你在做什么、为什么，不提工具名、命令和报错原文。任务窗能直接画统计图：用户要看数字的对比、趋势、占比时，在回话里写一个 chart 代码块——```chart 单独一行，JSON 另起一行，``` 单独一行收尾，type 写 bar、line 或 pie：\n```chart\n{"type":"bar","title":"三家门店本周客流","unit":"人次","categories":["东湖店","南站店"],"series":[{"name":"本周","data":[2160,1980]}],"source":"门店客流.xlsx · Sheet1 B2:B3"}\n```\n数字只用材料里的，source 写出处。任务窗也能直接画流程图：用户要看流程、步骤、分工时，在回话里写一个 mermaid 代码块（flowchart、sequenceDiagram、timeline 都行），节点文字用中文。任务窗也能显示图片和公式：图片用 ![说明](文件名) 引用工作区里的图片文件；公式用 $...$（行内）或 $$...$$（单独一段）。')
})
