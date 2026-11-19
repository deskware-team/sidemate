// 历史接线的纯函数：把一条对话记录拼回两样东西——
// ./session.mjs 里那个 task（接着聊过的工作区、文件副本、会话）和
// 任务窗要显示的状态（一来一回的消息、产出卡、顶栏文件夹）。
// 只算形状：工作区还在不在，由 ./session.mjs 拿 workspace 去查，这里不碰文件。

import { createTask } from './state.mjs'
import { baseName } from './paths.mjs'

const PLACES = new Set(['files', 'folder'])

const text = (v) => (typeof v === 'string' ? v : '')

// 记录里的 resume：老记录、坏文件都可能没有，统一取成对象或空
function resumeOf(record) {
  const one = record && typeof record === 'object' ? record.resume : null
  return one && typeof one === 'object' && !Array.isArray(one) ? one : null
}

// 地点：拖进来的文件夹（folder），其余都是任务自己的文件夹（files）；dir 必须是文字
function placeOf(resume) {
  const place = resume && typeof resume.place === 'object' && resume.place ? resume.place : null
  const kind = place && PLACES.has(place.kind) ? place.kind : 'files'
  return { kind, dir: place ? text(place.dir) : '' }
}

// 记录里的模型选择：形状不对就当没选，回清单默认
function modelOf(record) {
  const one = record && typeof record.model === 'object' && record.model ? record.model : null
  if (!one || !text(one.entry) || !text(one.model)) return null
  return { entry: text(one.entry), model: text(one.model), effort: one.effort == null ? null : text(one.effort) }
}

// 记录 → ./session.mjs 那个 task：工作区、产出目录、文件副本照 resume 里记的拼；
// 老记录里还留着的切块字段照旧忽略，不报错；会话在记录自己的字段上。
export function restoreTask(record) {
  const resume = resumeOf(record)
  if (!resume) return null
  const workspace = text(resume.workspace)
  if (!workspace) return null
  const copied = (Array.isArray(resume.copied) ? resume.copied : [])
    .filter((one) => one && typeof one === 'object' && text(one.from) && text(one.to))
    .map((one) => ({ from: text(one.from), to: text(one.to) }))
  const place = placeOf(resume)
  return {
    workspace,
    // 新闻的文件夹是产出本身，不是临时工作区：收下 / 换新任务时不清它，接着问照常在里面干
    news: Boolean(record && record.kind === 'news'),
    prepared: {
      kind: place.kind,
      workspace,
      copied,
      skipped: [],
      snapshot: [],
    },
    sessionId: text(record.sessionId) || undefined,
  }
}

// 记录里的消息带的小块：文件在工作区里的那份拷贝（重开对话时照这个画）
function filesOf(one) {
  const list = one && Array.isArray(one.files) ? one.files : []
  return list
    .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name)
    .map((f) => ({
      name: f.name,
      path: typeof f.path === 'string' ? f.path : '',
      kind: f.kind === 'image' || f.kind === 'text' ? f.kind : '',
    }))
}

// 记录里挂着的文件：现在记成一份 files；老记录分开记的 template（范本）+ materials（材料）照旧认，
// 拼成一份（范本排在前面），同一份只留一个
function resumeFiles(resume) {
  if (!resume) return []
  const raw = Array.isArray(resume.files) ? resume.files
    : [resume.template, ...(Array.isArray(resume.materials) ? resume.materials : [])]
  const seen = new Set()
  const out = []
  for (const one of raw) {
    const path = text(one)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({ path, name: baseName(path) })
  }
  return out
}

// 记录 → 任务窗的状态：消息按记录里的一来一回重画，产出卡排在最后那轮后面，
// 顶栏和文件小签照 resume 里记的拼。phase 给 done：能接着说，也随时能「＋ 新任务」。
export function restoreState(record, options = {}) {
  const resume = resumeOf(record)
  const messages = record && Array.isArray(record.messages) ? record.messages : []
  const files = record && Array.isArray(record.files) ? record.files : []
  const flow = []
  let round = 0
  let origin = ''
  for (const one of messages) {
    // 空的、只有空白的跳过：记录里本来就不会有，并在一起保险
    const body = one && typeof one === 'object' && typeof one.text === 'string' && one.text.trim() ? one.text : ''
    if (!body) continue
    if (one.role === 'me') {
      round += 1
      if (!origin) origin = body
      flow.push({ kind: 'user', text: body, ask: false, buttons: [], round, files: filesOf(one) })
    } else {
      flow.push({ kind: 'reply', text: body, ask: false, buttons: [], round: round || 1 })
    }
  }
  const last = round || 1
  const cards = []
  for (const one of files) {
    if (!one || typeof one !== 'object' || !text(one.path)) continue
    cards.push({
      id: String(cards.length + 1),
      name: text(one.name) || baseName(text(one.path)),
      to: text(one.path),
      pages: null,
      round: last,
      old: true,
      kind: 'made',
    })
  }
  return {
    ...createTask(),
    phase: 'done',
    place: placeOf(resume),
    files: resumeFiles(resume),
    flow,
    cards,
    round: last,
    seq: cards.length,
    origin,
    model: modelOf(record),
    startedAt: Number(record && record.startedAt) || 0,
    foreground: options.foreground === true,
  }
}
