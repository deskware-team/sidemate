// 对话记录：每个任务的记录放在它自己那个任务文件夹里（.sidemate\conversation.json），
// 新闻的记录放在它自己那次的 news\<主题id>\<日期>\ 里。
// 历史列表是扫出来的：扫 tasks\ 下每个文件夹、扫 news\ 下每个主题的每一期；
// 用户把任务文件夹删了，那条历史就没了。标题从记录里取，不看文件夹名。
// 这里只管存和取、搜索；按天分组、时间标签这些给界面看的在 ./history-view.mjs。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { countPaperItems } from '../news/entry.mjs'
import { PAPER_FILE } from '../news/topics.mjs'
import { t } from '../copy/copy.mjs'

// 任务名：先用第一句话的前 16 个字占位，dsh 起好名字再换上（setTitle）
const TITLE_CHARS = 16

// 单条消息最多留这么多字，超了只留前面
export const MAX_MESSAGE_CHARS = 20000

// 消息太长时末尾加的标记
const TOO_LONG = t('history.tooLong')

// 没写要求时的标题
const EMPTY_TITLE = t('history.emptyTitle')

// 把消息文字缩到不超过上限
function clipText(text) {
  const chars = Array.from(String(text ?? ''))
  if (chars.length <= MAX_MESSAGE_CHARS) return chars.join('')
  return chars.slice(0, MAX_MESSAGE_CHARS).join('') + TOO_LONG
}

// 标题：去掉头尾空白，换行换成空格，只留前 16 个字
function makeTitle(prompt) {
  const flat = String(prompt ?? '').trim().replace(/\s*\r?\n\s*/g, ' ')
  const chars = Array.from(flat)
  if (!chars.length) return EMPTY_TITLE
  return chars.slice(0, TITLE_CHARS).join('').trim()
}

// 记录文件在哪儿：<任务文件夹>\.sidemate\conversation.json
export function conversationFile(folder) {
  return join(String(folder ?? ''), '.sidemate', 'conversation.json')
}

// 这个文件夹是不是某个能放记录的地方：tasks\ 下的一个任务文件夹，或 news\ 下的某一期
function within(root, target) {
  if (!root) return false
  const rel = relative(resolve(root), resolve(target))
  if (!rel || isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

// 编号对不上格式就不给碰，免得拼出目录外的路径
function checkId(id) {
  const text = String(id ?? '')
  if (!isAbsolute(text)) throw new TypeError('bad conversation id')
  return resolve(text)
}

// 消息里带的小块：材料在工作区里的那份拷贝（名字、路径、是不是图）
function chipFiles(list) {
  return (Array.isArray(list) ? list : [])
    .filter((one) => one && typeof one === 'object' && typeof one.name === 'string' && one.name)
    .map((one) => ({
      name: one.name,
      path: typeof one.path === 'string' ? one.path : '',
      kind: one.kind === 'image' || one.kind === 'text' ? one.kind : '',
    }))
}

// 建对话记录：每个任务（每一期新闻）一个文件，放在它自己那个文件夹里
export function createHistory({ tasksDir, newsDir, now = Date.now } = {}) {
  const taskRoot = String(tasksDir ?? '')
  const newsRoot = String(newsDir ?? '')

  // 这个文件夹能不能放记录
  function allowed(folder) {
    if (within(taskRoot, folder)) return true
    // 新闻：news\<主题id>\<日期>
    if (within(newsRoot, folder)) {
      const rel = relative(resolve(newsRoot), resolve(folder))
      return rel.split(/[\\/]/).filter(Boolean).length === 2
    }
    return false
  }

  function fileOf(id) {
    return conversationFile(id)
  }

  // 先写临时文件再改名，免得写到一半断电留下半个文件
  function writeRecord(record) {
    const target = fileOf(record.id)
    mkdirSync(join(record.id, '.sidemate'), { recursive: true })
    const tmp = `${target}.tmp`
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(tmp, target)
  }

  // 读一个对话；文件不在或者坏了就当没有，不报错
  function readRecord(id) {
    const path = fileOf(id)
    if (!existsSync(path)) return null
    let raw = ''
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return null
    }
    let parsed = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    return normalize(parsed)
  }

  // 存之前把字段补齐，坏文件读回来也照这个形状
  function normalize(record) {
    const messages = Array.isArray(record.messages) ? record.messages : []
    const files = Array.isArray(record.files) ? record.files : []
    return {
      version: 1,
      // 编号就是这条记录所在的那个文件夹
      id: String(record.id),
      title: typeof record.title === 'string' ? record.title : EMPTY_TITLE,
      folder: record.folder ?? null,
      folderName: record.folderName ?? null,
      kind: record.kind === 'news' ? 'news' : 'task',
      startedAt: Number(record.startedAt) || 0,
      updatedAt: Number(record.updatedAt) || 0,
      sessionId: record.sessionId ?? null,
      model: record.model ?? null,
      // 接着聊要用的东西（工作区、地点）：原样存取，不在这里猜形状
      resume: record.resume && typeof record.resume === 'object' && !Array.isArray(record.resume) ? record.resume : null,
      messages: messages.map((m) => ({
        role: m && m.role === 'it' ? 'it' : 'me',
        text: typeof m?.text === 'string' ? m.text : '',
        at: Number(m?.at) || 0,
        // 这一句带的材料（气泡里的小块）：重开对话时照这个画
        files: chipFiles(m?.files),
      })),
      files: files.map((f) => ({
        name: typeof f?.name === 'string' ? f.name : '',
        path: typeof f?.path === 'string' ? f.path : '',
      })),
    }
  }

  // 记一条消息，文字空的就不记
  function say(id, role, text, files) {
    const good = checkId(id)
    const record = readRecord(good)
    if (!record) throw new Error(`no such conversation: ${good}`)
    const body = String(text ?? '')
    if (!body.trim()) return record
    record.messages.push({ role: role === 'it' ? 'it' : 'me', text: clipText(body), at: now(), files: chipFiles(files) })
    record.updatedAt = now()
    writeRecord(record)
    return record
  }

  // 有记录的那些文件夹：任务文件夹、新闻的每一期
  function folders() {
    const out = []
    for (const dir of childDirs(taskRoot)) {
      if (existsSync(conversationFile(dir))) out.push(dir)
    }
    for (const topic of childDirs(newsRoot)) {
      for (const issue of childDirs(topic)) {
        if (existsSync(conversationFile(issue))) out.push(issue)
      }
    }
    return out
  }

  return {
    // 开一个新对话，返回编号（就是那个任务文件夹）
    // title 不给就照第一句话占位（新闻那边自己给「主题 日期」）
    start({ workspace, prompt, title = '', folder = null, folderName = null, kind = 'task', model = null, files = null } = {}) {
      const at = now()
      const id = checkId(workspace)
      if (!allowed(id)) throw new Error('conversation folder not allowed')
      const record = normalize({
        id,
        title: String(title || '').trim() || makeTitle(prompt),
        folder: folder ?? id,
        folderName,
        kind,
        model,
        startedAt: at,
        updatedAt: at,
        messages: [{ role: 'me', text: clipText(prompt), at, files: chipFiles(files) }],
        files: [],
      })
      writeRecord(record)
      return id
    },

    // 加一条消息，顺手更新时间
    say,

    // 记下这次对话挂在哪个会话上
    setSession(id, sessionId) {
      const good = checkId(id)
      const record = readRecord(good)
      if (!record) throw new Error(`no such conversation: ${good}`)
      record.sessionId = sessionId ?? null
      record.updatedAt = now()
      writeRecord(record)
      return record
    },

    // dsh 起好了任务名：换掉先占位的那个。一样就不重写
    setTitle(id, title) {
      const good = checkId(id)
      const record = readRecord(good)
      if (!record) throw new Error(`no such conversation: ${good}`)
      const next = String(title ?? '').trim()
      if (!next || next === record.title) return record
      record.title = next
      writeRecord(record)
      return record
    },

    // 记下这次对话用的是哪个模型
    setModel(id, model) {
      const good = checkId(id)
      const record = readRecord(good)
      if (!record) throw new Error(`no such conversation: ${good}`)
      record.model = model ?? null
      record.updatedAt = now()
      writeRecord(record)
      return record
    },

    // 记下接着聊要用的东西（工作区、地点、挂着的文件），打开历史时照这个恢复
    setResume(id, data) {
      const good = checkId(id)
      const record = readRecord(good)
      if (!record) throw new Error(`no such conversation: ${good}`)
      record.resume = data && typeof data === 'object' && !Array.isArray(data) ? data : null
      record.updatedAt = now()
      writeRecord(record)
      return record
    },

    // 加一个材料文件，同一个路径不重复加
    addFile(id, file) {
      const good = checkId(id)
      const record = readRecord(good)
      if (!record) throw new Error(`no such conversation: ${good}`)
      const path = String(file?.path ?? '')
      if (!path) return record
      if (!record.files.some((f) => f.path === path)) {
        record.files.push({ name: String(file?.name ?? ''), path })
      }
      record.updatedAt = now()
      writeRecord(record)
      return record
    },

    // 取一个对话；没有或者坏了就返回空
    get(id) {
      const good = checkId(id)
      if (!allowed(good)) return null
      return readRecord(good)
    },

    // 列最近的对话，从新到旧；能搜、能筛。
    // 扫任务文件夹和新闻的每一期：用户删了任务文件夹，这条就没了。
    list({ query = '', kind = null, folder = null } = {}) {
      const q = String(query ?? '').trim().toLowerCase()
      const items = []
      for (const folderPath of folders()) {
        const record = readRecord(folderPath)
        if (!record) continue
        if (kind !== null && record.kind !== kind) continue
        if (folder !== null && record.folder !== folder) continue
        if (q && !matchQuery(record, q)) continue
        items.push({
          id: record.id,
          title: record.title,
          folder: record.folder,
          folderName: record.folderName,
          kind: record.kind,
          updatedAt: record.updatedAt,
          fileCount: record.files.length,
          // 新闻订阅那行右边要写「N 条」：数那份 新闻.md 里的条目（算法在 news/entry.mjs 的 countPaperItems）。
          // 数不出来（文件没了、那一期没有「今天」「进展」两节）就给 null，界面上改写时间。
          count: record.kind === 'news' ? newsItemCount(record) : null,
        })
      }
      items.sort((a, b) => b.updatedAt - a.updatedAt)
      return items
    },

    // 有记录的那些文件夹：任务文件夹、新闻的每一期
    folders,

    // 删掉一个对话（只删记录，任务文件夹留着）
    remove(id) {
      const good = checkId(id)
      const path = fileOf(good)
      if (!existsSync(path)) return false
      rmSync(path, { force: true })
      return true
    },
  }
}

// 一个目录下的子文件夹
function childDirs(root) {
  const out = []
  if (!root) return out
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    out.push(join(root, entry.name))
  }
  return out
}

// 一份新闻有几条：新闻那一期的内部目录（记录里的 folder）里找 新闻.md，
// 用 countPaperItems 数。找不到文件、或者那一期没有条目就数不出来，给 null。
function newsItemCount(record) {
  const folder = String(record?.folder ?? '')
  if (!folder) return null
  let markdown = ''
  try {
    markdown = readFileSync(join(folder, PAPER_FILE), 'utf8')
  } catch {
    return null
  }
  const count = countPaperItems(markdown)
  return Number.isInteger(count) ? count : null
}

// 搜标题、文件夹名、文件名和消息里的文字，不分大小写
function matchQuery(record, q) {
  if (record.title.toLowerCase().includes(q)) return true
  if (String(record.folderName ?? '').toLowerCase().includes(q)) return true
  for (const f of record.files) {
    if (f.name.toLowerCase().includes(q)) return true
  }
  for (const m of record.messages) {
    if (m.text.toLowerCase().includes(q)) return true
  }
  return false
}
