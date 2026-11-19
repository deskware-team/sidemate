// 新闻的生成流水线：一个主题跑成一份新闻——模型自己上网找，桌伴只管排版。
// 模型自己决定用什么工具（联网搜索、打开网页、「能力」里配好的外部工具服务）去找 48 小时内的新闻，
// 交回一条条带链接的选题；桌伴不核对链接，交上来就收（同一个链接只用一次，封顶 10 条）。
// 生成的文件都在程序数据目录（news/<主题id>/<日期>），不往别处写，
// 也不转 Word——要 Word 在对话里说，接着问会交到 news/<主题id>/ 下。
// 纯 node 模块：dsh、模型、历史都从 deps 传进来，node --test 直接测；
// 存取在 ./topics.mjs，排期在 ./schedule.mjs，链接整理（去跟踪参数、取域名）在 ./links.mjs。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PAPER_FILE, appendReported, issueDir, loadTopics, readReported, todayString } from './topics.mjs'
import { hostOf, normalizeNewsLink } from './links.mjs'
import { appRoot } from '../paths.mjs'
import { codeOf, codeLine, errorCodeLine, stopText } from '../task/codes.mjs'
import { errorLineText } from '../copy/line.mjs'
import { t } from '../copy/copy.mjs'

// 早报封顶 10 件事（今天 + 进展合计）。
const TODAY_MAX = 10
// 报过的只给模型看标题，最多 30 行，够它认出旧事就行。
const REPORTED_MAX = 30

// 模型给的自由文本压成一行：换行和两头空白都不要，免得撑破版式。
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

// 骨架里当占位的说明文字：弱模型会原样照抄，校验时照抄的当没给。字在 app/copy/harness.mjs 的
// news.skeleton，贴给模型和校验都从那里读。
const summaryHint = (topic) => t('news.skeleton.summary', { name: topic.name })
const noteHint = (topic) => t('news.skeleton.note', { want: topic.want })
const urlHint = t('news.skeleton.url')
const siteHint = t('news.skeleton.site')
const headlineHint = t('news.skeleton.headline')
// 模型没给标题时的兜底（早报正文的粗体标题、给模型的「报过的」清单共用）
const UNTITLED = t('news.reported.untitled')

// 占位的判定：空、只剩省略号破折号这类符号、照抄骨架里的说明文字、或 <…> 包着——都当没给
//（summary 不印、headline 不印、note 不印）。
function placeholderChecker(topic) {
  const hints = new Set([summaryHint(topic), noteHint(topic), urlHint, siteHint, headlineHint])
  const bare = /^[\s.。…·・\-—–~～,，、;；]+$/
  const wrapped = /^<[^<>]*>$/
  return (text) => {
    const value = oneLine(text)
    return !value || hints.has(value) || bare.test(value) || wrapped.test(value)
  }
}

// 给模型贴的骨架：一条样子，说明每个字段该填什么。占位不用「…」而用说明文字，
// 弱模型照抄了也会被当没给。
function skeletonText({ topic }) {
  return [
    '{',
    `  "summary": "${summaryHint(topic)}",`,
    '  "today": [',
    '    {',
    `      "url": "${urlHint}",`,
    `      "site": "${siteHint}",`,
    `      "headline": "${headlineHint}",`,
    `      "note": "${noteHint(topic)}"`,
    '    }',
    '  ],',
    '  "progress": []',
    '}',
  ].join('\n')
}

// 贴进话里的「报过的」：只给标题，不给链接（话里不放具体网址）。
function reportedLines(items) {
  if (!items.length) return []
  const lines = ['', t('news.reported'), '']
  for (const item of items.slice(0, REPORTED_MAX)) lines.push(`- ${oneLine(item.title) || UNTITLED}`)
  return lines
}

// 第一轮和补一轮都贴的那段样子：说明 + 骨架 + 交的规矩
const sampleText = (topic) => t('news.sample', { skeleton: skeletonText({ topic }) })

// 给模型的话（app/copy/harness.mjs 的 news.prompt）：主题、想看什么、今天日期、报过的，剩下让它自己去找、自己交。
// 话里不放任何具体网站名和网址——链接得是模型自己搜到、打开过的。
function promptText({ topic, date, reported }) {
  const sample = `${sampleText(topic)}\n${t('news.sample.more')}`
  const lines = [t('news.prompt', { name: topic.name, want: topic.want, date, sample })]
  lines.push(...reportedLines(reported))
  return lines.join('\n')
}

function buildPrompt({ topic, date, reported }) {
  return promptText({ topic, date, reported })
}

// —— 模型交上来的选题从哪里读 ——

const NOT_JSON = Symbol('not-json')
// 解得开给值，解不开给 NOT_JSON
function tryJSON(text) {
  try { return JSON.parse(text) } catch { return NOT_JSON }
}
// 裸 { … } 片段：平衡大括号扫出所有最外层的对象，字符串里的括号不算数。
// 取最后一个能解开的：模型几句话里夹了几个对象时，最后那个才是要交的选题。
function braceSpans(text) {
  const spans = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) spans.push(text.slice(start, index + 1))
    }
  }
  return spans
}

// 这一轮的回话里取 JSON：最后一个 ``` 代码块优先，解不开就退而取最后一个
// 能解开的裸 { … } 片段。都没有被当没交，交给后面的文件兼容路。
function parseReplyJSON(replies) {
  const text = replies.filter((one) => typeof one === 'string' && one.trim()).join('\n')
  if (!text.trim()) return { found: false }
  const blocks = [...text.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)\r?\n?```/g)]
  if (blocks.length) {
    const parsed = tryJSON(blocks.at(-1)[1].trim())
    if (parsed !== NOT_JSON) return { found: true, value: parsed }
  }
  for (const span of braceSpans(text).reverse()) {
    const parsed = tryJSON(span)
    if (parsed !== NOT_JSON) return { found: true, value: parsed }
  }
  return { found: false }
}

// 解出来的 JSON 定形状：得是对象（{ summary, today, progress }）；不是对象的都带上原因，好补一轮。
function verdictOf(parsed) {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, reason: 'empty-array' }
    return { ok: false, reason: 'bad-array' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not-object' }
  return { ok: true, selection: parsed }
}

// 这一轮交了什么：只看回话里交来的 JSON。
function handedIn(replies) {
  const fromReply = parseReplyJSON(replies)
  if (fromReply.found) return verdictOf(fromReply.value)
  return { ok: false, reason: 'missing' }
}

// 校验模型交的每条：url 得是个像样的链接；同一个链接只用一次；超出封顶的不进页。
// 挑不出来的丢掉，记进 drops，最后写进 news.log。
function takeEntries(list, used, drops, isPlaceholder, max) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length >= max) { drops.capped += 1; continue }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { drops.entries += 1; continue }
    const url = normalizeNewsLink(raw.url)
    if (!url) { drops.badUrl += 1; continue }
    if (used.has(url)) { drops.repeatUrls.push(url); continue }
    used.add(url)
    const headline = oneLine(raw.headline)
    const note = oneLine(raw.note)
    const site = oneLine(raw.site)
    if (headline && isPlaceholder(headline)) drops.placeholders += 1
    if (note && isPlaceholder(note)) drops.placeholders += 1
    if (site && isPlaceholder(site)) drops.placeholders += 1
    out.push({
      url,
      site: site && !isPlaceholder(site) ? site : hostOf(url),
      headline: headline && !isPlaceholder(headline) ? headline : '',
      note: note && !isPlaceholder(note) ? note : '',
    })
  }
  return out
}

// 把模型交的选题校验成排版要用的几截：today、progress、总结；丢的记进 drops。
function evaluateSelection(selection, isPlaceholder) {
  const used = new Set()
  const drops = { entries: 0, capped: 0, badUrl: 0, repeatUrls: [], placeholders: 0 }
  const today = takeEntries(selection.today, used, drops, isPlaceholder, TODAY_MAX)
  const progress = takeEntries(selection.progress, used, drops, isPlaceholder, Math.max(TODAY_MAX - today.length, 0))
  const summary = oneLine(selection.summary)
  const summaryOk = summary && !isPlaceholder(summary)
  // 模型一共交了几条：交过东西却一条都没剩，说明交上来的挑不出来。
  const given = ['today', 'progress'].reduce((sum, key) => sum + (Array.isArray(selection[key]) ? selection[key].length : 0), 0)
  return { drops, today, progress, summary: summaryOk ? summary : '', given }
}

// 来源行：网站名和链接都照模型交的来，链接是桌伴核对过的那个。
// 链接里的文字用洗过的标题（模型爱在标题里带 **，洗掉再进方括号里）。
function sourceLine(entry) {
  const site = entry.site || hostOf(entry.url)
  const title = plainHeadline(entry.headline || site || t('report.fallbackTitle'))
  return `${t('report.source', { name: site ? `${site} ` : '' })}[${title}](${entry.url})`
}

// 标题先洗掉模型自带的 markdown 记号再包 **：头尾的 * _ # 和空白去掉、中间成对的 ** 去掉，
// 免得排出来 ****字**** 这种解不开的粗体；洗到什么都不剩就当没标题。note 里的成对 ** 不动。
function plainHeadline(text) {
  const plain = String(text ?? '')
    .replace(/\*\*/g, '')
    .replace(/^[\s*_#]+|[\s*_#]+$/g, '')
    .trim()
  return plain || UNTITLED
}

// 桌伴自己排版：标题行、一句话总结、「今天」「进展」两节、来源计数。
// 每条粗体短标题 + 说明 + 来源行；同一节里条和条之间隔一条细线（---），第一条前面和
// 最后一条后面不插，「## 今天」「## 进展」这样的节标题前也不插；today 和 progress 都空
// 就只写没有新动静。
function layoutPaper({ topic, date, summary, today, progress, sources }) {
  const lines = [`# ${t('report.title', { topic: topic.name, date })}`, '']
  if (today.length === 0 && progress.length === 0) {
    lines.push(t('newsPage.nothing'), '')
    return `${lines.join('\n')}\n`
  }
  if (summary) lines.push(summary, '')
  const section = (title, entries) => {
    if (!entries.length) return
    lines.push(title, '')
    entries.forEach((entry, index) => {
      if (index > 0) lines.push('---', '')
      lines.push(`**${plainHeadline(entry.headline)}**`, '')
      if (entry.note) lines.push(entry.note, '')
      lines.push(sourceLine(entry))
      lines.push('')
    })
  }
  section(t('report.sectionToday'), today)
  section(t('report.sectionProgress'), progress)
  lines.push(t('report.footer', { count: sources }), '')
  return `${lines.join('\n')}\n`
}

// deps（除头两个外都可不传）：
//   root / topicsFile —— 新闻目录（news\，生成的文件都在这）和 news.json 的路径（字符串或 () => 字符串）
//   outputRoot —— 接着问时产出交到哪里去的那份根目录（默认程序数据根目录），交到 <它>/news/<主题id>/
//   now —— 时钟，测试里定住
//   model(choice) —— 跟任务窗同一套 resolveModel + withAbilities 算出来的模型选项；choice 是要用的条目（新闻这一轮用默认模型，传 null）
//   runTask(options) —— 起一轮 dsh（app/dsh/index.mjs 的 runTask）
//   history —— createHistory() 的实例
//   log / onDone —— 记日志、跑完喊一声（onDone 收到的和返回值同一份）
export function createNewsRunner(deps = {}) {
  const log = typeof deps.log === 'function' ? deps.log : () => {}
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const rootOf = () => (typeof deps.root === 'function' ? deps.root() : String(deps.root ?? ''))
  const outputRootOf = () => (typeof deps.outputRoot === 'function' ? deps.outputRoot() : String(deps.outputRoot ?? appRoot()))
  const topicsFileOf = () => (typeof deps.topicsFile === 'function' ? deps.topicsFile() : String(deps.topicsFile ?? ''))

  // 记一条「全部对话」里的新闻对话：标题「主题 MM-DD」（空一格，不用「·」）。它说的那条是 runner 排好的
  // 那一页 markdown 全文（失败就是失败那句 message），小岛 / 右键菜单打开某一天看到的
  // 就是这条；模型自己的回话不进历史。返回记录编号给小岛提醒用，历史没配或写坏了给 null。
  // folder 记内部日期目录（接着问就在那里干），outputDir 记 news/<主题id>/：
  // 这种对话里产出的文件（比如转成的 Word）交到那里去。
  function recordHistory({ topic, date, workspace, sessionId, said }) {
    if (!deps.history) return null
    try {
      const id = deps.history.start({
        // 记录存在这一期自己的文件夹里（.sidemate\conversation.json）
        workspace,
        prompt: `${topic.name} ${date.slice(5)}`,
        title: `${topic.name} ${date.slice(5)}`,
        folder: workspace,
        folderName: topic.name,
        kind: 'news',
      })
      if (sessionId) deps.history.setSession(id, sessionId)
      // restoreTask / restoreState 要的：工作区、地点（新闻没拖材料）、产出交到 <news>/<主题id>/。
      deps.history.setResume(id, {
        place: { kind: 'files', dir: '' },
        workspace,
        outputDir: join(outputRootOf(), 'news', topic.id),
        copied: [],
      })
      if (said) deps.history.say(id, 'it', said)
      return id
    } catch (error) {
      log('history-failed', { error: error?.message || '' })
      return null
    }
  }

  async function one(topicId, reason) {
    const done = (result) => {
      deps.onDone?.(result)
      return result
    }
    // 失败也进历史：它说的那条写失败这句，小岛点开能看到为什么没出。工作区还没建起来
    // （没有这个主题、文件夹建不起来）时没有可挂的地方，historyId 给 null。
    let topic = null
    let date = ''
    let workspace = ''
    // 停下来的这一轮也带一个错误码：「停工那句 · Si 码 错误，原文」，news.log 里另写一行码 + 细节。
    // 没有码的（用户自己按下停止）是设置·新闻页的界面文案，照原样说
    const fail = (message, code, detail) => {
      const one = detail?.line || (code ? codeLine(code, detail?.step || 'news', detail?.text || message) : null)
      if (one) log('error-code', { ...one, topicId, date })
      const said = code ? errorLineText(message, code, detail?.raw) : message
      const historyId = workspace
        ? recordHistory({ topic, date, workspace, sessionId: null, said })
        : null
      return done({ ok: false, topicId, date, files: [], items: 0, message: said, historyId })
    }
    try {
      const stamp = now()
      date = todayString(new Date(stamp))
      const root = rootOf()
      const file = topicsFileOf()

      // ① 主题
      const topics = loadTopics(file)
      topic = topics.find((item) => item && item.id === topicId) || null
      if (!topic) return fail(t('stops.newsTopic'), 'Si111')

      // ② 工作区：桌伴数据目录里 新闻/<主题id>/<今天>（dsh 这一轮就在这里干）
      const folder = issueDir(root, topic, date)
      try {
        mkdirSync(folder, { recursive: true })
      } catch {
        return fail(t('stops.newsFolder'), 'Si206')
      }
      workspace = folder

      // ④ 报过的：只给模型看标题，贴进话里，不往工作区写文件
      const reported = readReported(root, topic)

      // ⑤ 模型：跟任务窗同一套，算不通就把那句人话带回去。
      //    新闻这一轮用默认模型（传 null）：联网搜索是 dsh 自己的事，模型选的是谁都不改。
      const picked = typeof deps.model === 'function' ? deps.model(null) : null
      if (!picked || picked.ok !== true) {
        return fail((picked && picked.message) || t('stops.noModel'), picked?.code || codeOf(picked || {}) || 'Si103')
      }
      // 话里只有主题、想看什么、今天日期和报过的：链接得是模型自己找的
      const prompt = buildPrompt({ topic, date, reported })
      const isPlaceholder = placeholderChecker(topic)
      log('start', { topicId, date, reason })

      // ⑦ 起一轮 dsh 等它在回话里交 JSON；这一轮只跑一次，交得不像样就按没生成收场。
      //    onEvent：错误记下来带回去，回话一句句收下来，从里面取这一轮的 JSON；
      //    模型的回话不进历史，历史里说的是那页新闻。
      let failure = null
      const replyTexts = []
      const onEvent = (event) => {
        if (!event || typeof event !== 'object') return
        if (event.type === 'error') failure = event
        else if (event.type === 'reply') replyTexts.push(String(event.text ?? ''))
      }
      const taskBase = `news-${topic.id}-${date}`
      const handle = deps.runTask({
        taskId: taskBase,
        workspace,
        prompt,
        apiKey: picked.apiKey,
        env: picked.env,
        patchTexts: picked.patchTexts,
        model: picked.model,
        vendor: picked.vendor,
        // 外部工具服务：ACP 原生做法，建会话时随参数带给 dsh
        mcpServers: picked.mcpServers,
        // 外部工具服务的钥匙：只在内存里传，用来打码
        mcpSecrets: picked.mcpSecrets,
        // 新闻的名字是「主题 日期」，用不上 dsh 起的名字：省掉那一次起名调用
        title: false,
        // 这个主题的自动配置权限选了「允许」：会话开好后切成完全访问，那时不来权限申请
        fullAccess: topic.permission === 'allow',
        onEvent,
      })
      // 这一轮停了：停工那句和码照 dsh 报上来的那次失败算（没报就是 Si901），原文带上
      const failed = () => {
        // Kilo 模型那边忙、哪一家没配密钥：停工那句要知道是哪个模型
        const event = failure ? { ...failure, vendor: picked.vendor } : { reason: 'other' }
        const { event: _kind, ...line } = errorCodeLine({ ...event, step: 'news' }) || {}
        return fail(stopText(event), codeOf(event) || 'Si901', { raw: event.raw, line: line.code ? line : null })
      }
      const end = await handle.done
      if (!end || end.status !== 'done') {
        const stopped = !end || end.status === 'cancelled'
        return stopped ? fail(t('newsPage.stopped')) : failed()
      }

      // ⑧ 读选题：看回话里交的 JSON。解不开、或者交上来的挑不出一条，都按没生成收场。
      const handed = handedIn(replyTexts)
      if (!handed.ok) return fail(t('stops.newsNoTopics'), 'Si806')
      const verdict = evaluateSelection(handed.selection, isPlaceholder)
      const { drops, today, progress, summary } = verdict
      // 交过东西却一条都没剩：说清楚这次没找到能用的新闻
      if (!today.length && !progress.length && verdict.given > 0) {
        return fail(t('stops.newsNoMatch'), 'Si805')
      }
      if (drops.placeholders) log('placeholder-dropped', { topicId, count: drops.placeholders })
      if (drops.entries || drops.capped || drops.badUrl || drops.repeatUrls.length) {
        log('selection-dropped', {
          topicId,
          shape: drops.entries,
          overLimit: drops.capped,
          badUrl: drops.badUrl,
          repeatUrls: drops.repeatUrls.length,
        })
      }

      // ⑨ 排版写页：一页 新闻.md 落进工作区；
      //     files 照旧给但恒为空——生成的文件都在内部目录里，不往外交
      const paperPath = join(workspace, PAPER_FILE)
      // 共看了几个来源：留下的条目里不同的网站数（按链接的域名算）
      const sites = new Set([...today, ...progress].map((one) => hostOf(one.url)).filter(Boolean))
      const sources = sites.size
      const paper = layoutPaper({
        topic,
        date,
        summary,
        today,
        progress,
        sources,
      })
      writeFileSync(paperPath, paper, 'utf8')

      // ⑩ 报过的：用这次排进去的那些记（标题 + 链接），按归一化的链接去重
      const fresh = []
      const seenLinks = new Set()
      for (const entry of [...today, ...progress]) {
        const key = normalizeNewsLink(entry.url)
        if (!key || seenLinks.has(key)) continue
        seenLinks.add(key)
        fresh.push({ title: entry.headline || entry.site || t('report.fallbackTitle'), url: entry.url })
      }
      if (fresh.length > 0) {
        try {
          appendReported(root, topic, fresh, date)
        } catch (error) {
          log('reported-failed', { error: error?.message || '' })
        }
      }

      // ⑩ 交工的话：文件都在内部目录里，不转 Word（要 Word 在对话里说）
      const pickedCount = today.length + progress.length
      const message = pickedCount === 0
        ? t('newsPage.nothing')
        : t('newsPage.done', { count: pickedCount })

      // ⑪ 历史里多一条 kind 'news'：它说的就是这页新闻的 .md 全文，点开能接着问，
      //     小岛 / 右键菜单打开某一天也靠这条记录的编号
      const historyId = recordHistory({ topic, date, workspace, sessionId: handle.sessionId ?? null, said: paper })

      // ⑫ 收工：items 是挑的件数（跟页上粗体一致），不是记进「报过的」的链接数
      return done({ ok: true, topicId, date, files: [], items: pickedCount, message, historyId })
    } catch (error) {
      // 前一句固定是「生成失败」：英文的内部报错只放进原文那一截和日志
      return fail(t('stops.newsError'), 'Si901', { raw: error?.message || '', text: error?.message || '' })
    }
  }

  // 生成一份：不同的主题一起跑（DeepSeek 没有并发限制）。
  // 同一个主题正在跑（定时那一路、设置页「现在生成」都算）就回那一次的 promise，不再开第二份：
  // 两份会在同一个文件夹里、用同一个任务号跑，重试播报、日志这些文件都撞名
  const running = new Map()
  function generate(topicId, options = {}) {
    const id = String(topicId ?? '')
    const already = running.get(id)
    if (already) return already
    const reason = options?.reason === 'now' ? 'now' : 'schedule'
    const job = one(id, reason).finally(() => running.delete(id))
    running.set(id, job)
    return job
  }

  return { generate }
}
