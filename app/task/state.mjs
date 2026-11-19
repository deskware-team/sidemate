// 任务窗里一条对话的纯状态层：事件归约、状态机。只算，不碰窗口和文件。
// 字都在 app/copy，页面那份视图在 ./view.mjs，路径名字的小工具在 ./paths.mjs。

import { addRecent, baseName, fitName, key } from './paths.mjs'
import { waitLine } from './wait.mjs'
import { t } from '../copy/copy.mjs'
import { rawText } from '../copy/line.mjs'
import { codeOf, errorText, stopText } from './codes.mjs'
import { pendingFiles } from './pending.mjs'

export { addRecent, fitName, fitPath } from './paths.mjs'
export { toTaskView } from './view.mjs'

const RETRY = { action: 'retry', label: t('output.retry') }
const SETTINGS = { action: 'settings', label: t('desk.goSettings') }
const STOP = { action: 'stop', label: t('input.stop') }
// 停在这儿以后给的两条路：接着干（同一个会话里往下干）、换模型
const CONTINUE = { action: 'continue', label: t('input.continueLabel') }
const SWAP_MODEL = { action: 'models', label: t('input.swapModel') }
const SETTLED = new Set(['asking', 'done', 'error', 'stopped', 'paused'])

const entry = (p) => ({ path: p, name: baseName(p) })
const item = (kind, text, round, buttons, extra) => ({ kind, text, ask: false, buttons: buttons || [], round, ...(extra || {}) })
const ageCards = (cards) => cards.map((c) => (c.old ? c : { ...c, old: true }))

function result(state, pet, notify, extra) {
  const more = extra || {}
  return {
    state,
    start: more.start || null,
    cancel: more.cancel === true,
    settle: more.settle === true,
    pet: pet || null,
    notify: notify || '',
    petText: more.petText || '',
  }
}

const same = (state) => result(state)

// 后台事件只认这条对话正在跑的这一轮；还没开跑（runId 空）也不收。
// 好几条对话同时在跑时，事件按 taskId 送到哪一条由 ./run.mjs 管
const foreign = (state, event) => !state.runId || event.taskId !== state.runId

// 这几种给「去设置」，开的是设置窗的「模型」页
const MODEL_SETTINGS = new Set(['key', 'consent', 'missing', 'model'])

// 统一的开跑：换状态、清旧按钮和 ask、记 prompt、给 start。选的模型只管这个任务，
// 开工时交给 resolveModel；没选（null）就用清单默认。
// carry 是「接着干」那句：它不是用户的新要求，用户原来那句（prompt）留着别覆盖，点「重来」时还发它。
// said 是气泡上、对话记录里写的那句（不给就是 prompt）：点「继续」发给模型的是一句话，用户看到的是「继续」。
function startRun(state, prompt, runId, round, resume, cards, extra) {
  const more = { ...(extra || {}) }
  const carry = more.carry === true
  delete more.carry
  const said = typeof more.said === 'string' && more.said ? more.said : prompt
  const flow = state.flow.map((one) => ({ ...one, ask: false, buttons: [] }))
  // 这一轮带的文件：先摆名字，工作区里那份拷贝到了再补上（见 chipsOf）
  const files = state.files.map((one) => ({ name: one.name, path: '', kind: '' }))
  flow.push(item('user', said, round, [], { files }))
  // 发下一句：输入框上方那行提示收起
  const next = { ...state, phase: 'working', runId, prompt: carry ? state.prompt : prompt, round, flow, look: false, cards, startedAt: Date.now(), step: '', stepAt: 0, pulse: '', quietSince: 0, notice: null }
  // utterance：用户要的那句。接着干的那句不算，用用户原来那句（用量的任务名看它）
  const utterance = carry && state.prompt ? state.prompt : prompt
  const start = { runId, round, prompt, utterance, resume, place: { kind: state.place.kind, dir: state.place.dir }, files: state.files.map((one) => one.path), model: state.model ?? null, ...more }

  return result(next, 'work', '', { start })
}

// 干活时那一句：把壳自己的步骤、模型调工具的过程（dsh 那头报的 search / web / prepare /
// read 名字 / write 名字 / tool 名字 / work，见 app/dsh/index.mjs 的 progressText）翻成状态行上的状态码 St2xx。
// 规矩：不露工具名、路径、命令；只有读用户给的文件念文件名；翻不出来的就空串。
// 纯函数，主进程和页面都能用。

// 工具名、命令行：看见就当翻不出来（宁可只显示计时，也不把命令露出去）
const TOOL_WORD = /(^|[\s"'`(])(python3?|node|npm|npx|bash|sh|powershell|cmd|curl|wget|git|pip|dsh|libreoffice|soffice)\b/i

// 图片的后缀：看图说「查看图片中」，不念文件名
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff'])

// 脚本、代码、配置：不念名字（那是干活的东西，不是给人看的）
const CODE_EXT = new Set(['py', 'js', 'mjs', 'cjs', 'ts', 'sh', 'ps1', 'bat', 'cmd', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'sql', 'ini', 'toml'])

// 文件只写文件名：目录、盘符都去掉
function fileName(text) {
  const one = String(text || '').trim().replace(/^["'「『]|["'」』]$/g, '')
  const cut = one.split(/[\\/]/).pop() || one
  return cut.replace(/[。.…、，]+$/, '').trim()
}

// 文件后缀
function extOf(name) {
  const hit = String(name || '').match(/\.([A-Za-z0-9]+)$/)
  return hit ? hit[1].toLowerCase() : ''
}

// 该不该念这个文件名：没有后缀的（多半是工具名、技能名）和脚本、代码都不念
function sayableName(name) {
  const ext = extOf(name)
  if (!ext) return ''
  if (CODE_EXT.has(ext)) return ''
  return name
}

// 过程里提到的文件念给用户听的名字：去掉两头的引号，只留文件名
export function materialName(raw) {
  const one = String(raw || '').trim().replace(/^["'「『]|["'」』]$/g, '')
  if (!one) return ''
  return fileName(one)
}

// 壳自己的那一步：拷文件
const SHELL_STEP = { copy: 'St201' }

// 读《文件名》中：名字太长中间用…（按宽度算，一个汉字算 2）
const NAME_FIT = 24

// dsh 那头报的过程 → 状态码：不带名字的几种
const PLAIN_STEP = { search: 'St204', web: 'St205', prepare: 'St206', write: 'St208', tool: 'St211', work: 'St103', convert: 'St213', render: 'St214', recalc: 'St215', present: 'St216' }

// 这一句在干什么：把过程翻成状态码那句。翻不出来返回空串（状态行照旧是上一句）。
export function stepLine(text) {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return ''
  if (TOOL_WORD.test(raw)) return ''
  const at = raw.indexOf(' ')
  const verb = at < 0 ? raw : raw.slice(0, at)
  const arg = at < 0 ? '' : raw.slice(at + 1).trim()
  // 读：只有读念文件名，写、处理都不念
  if (verb === 'read') {
    if (!arg) return t('St209')
    const mapped = materialName(arg)
    if (!mapped) return t('St210')
    const name = sayableName(mapped)
    if (!name) return t('St209')
    return IMAGE_EXT.has(extOf(name)) ? t('St212') : t('St207', { name: fitName(name, NAME_FIT) })
  }
  return PLAIN_STEP[verb] ? t(PLAIN_STEP[verb]) : ''
}

// 换得太快会闪：上一句还没站够 1.5 秒就不换
const STEP_HOLD_MS = 1500

// 记下这一句人话。同一句不重复记；换得太快就先压着。
function setStep(state, line, at) {
  if (!line) return state
  if (state.step === line) return state
  const now = Number(at) || Date.now()
  if (state.step && now - state.stepAt < STEP_HOLD_MS) return state
  return { ...state, step: line, stepAt: now }
}

// 挂上一批文件（拖进来的、贴的）：已经挂着的不重复，新的接在后面；没东西可挂返回 null。
// 干活中挂上的先不发：跟下一句、或者插进去的那句一起发出去（跟开工前拖进来一样）。
function attach(state, list) {
  const seen = new Set(state.files.map((one) => key(one.path)))
  const fresh = []
  for (const one of list) {
    if (!one || !one.path || seen.has(key(one.path))) continue
    seen.add(key(one.path))
    fresh.push(one)
  }
  if (!fresh.length) return null
  return { ...state, phase: state.phase === 'empty' ? 'ready' : state.phase, files: [...state.files, ...fresh] }
}

// 装一次拖进来的东西；没东西可装返回 null。带文件夹就清空重装。
function loadDrop(state, paths, folder) {
  const list = paths.filter(Boolean).map(entry)
  if (!folder) return attach(state, list)
  const seen = new Set()
  const files = []
  for (const one of list) {
    if (seen.has(key(one.path))) continue
    seen.add(key(one.path))
    files.push(one)
  }
  return { ...state, place: { kind: 'folder', dir: folder }, files, phase: 'ready' }
}

// 输入框上方那行提示（错误码里的 notice 级：不停工）。同一时刻只留一行，后来的顶掉先前的。
// code 是 Si 码；text 不给就照码表说停下来那句；bare 是不带码的那种
function withNotice(state, one) {
  const code = one.code || ''
  const text = one.text || stopText(one, code)
  return { ...state, notice: { text, code: one.bare ? '' : code, raw: rawText(one.raw) } }
}

// 换成新的空任务：对话流是空的，什么也不说
function freshTask(state) {
  return { ...createTask(), foreground: state.foreground }
}

function onDrop(state, event) {
  const files = Array.isArray(event.files) ? event.files : []
  const folder = typeof event.folder === 'string' && event.folder ? event.folder : ''
  // 干活中拖进来的：挂在输入框上，跟下一句或插的那句一起发出去（拖的是文件夹就挂上里面的文件）
  if (state.phase === 'working') {
    const loaded = attach(state, files.filter(Boolean).map(entry))
    return loaded ? result(loaded, null) : same(state)
  }
  // 做完了、停在这儿、问一句……这时拖进任务窗的文件：挂在这条对话的输入框上，下一句接着这个会话一起发，不另开新对话。
  // 拖到小岛上的（fresh，新的一件事）、或者拖的是一整个文件夹（换了干活的地方）才换成新任务
  if (SETTLED.has(state.phase)) {
    if (!folder && event.fresh !== true) {
      const loaded = attach(state, files.filter(Boolean).map(entry))
      return loaded ? result(loaded, null) : same(state)
    }
    const base = freshTask(state)
    const loaded = loadDrop(base, files, folder)
    if (!loaded) return same(state)
    return result(loaded, 'idle', '', { settle: true })
  }
  const loaded = loadDrop(state, files, folder)
  return loaded ? result(loaded, null) : same(state)
}

// 贴的图、贴的长文字：已经存成了文件，加进当前这个任务。
// 跟拖放不一样的地方：不重开任务——收下以后接着说时贴的，也进下一轮；干活中贴的跟下一句或插的那句一起发。
function onPaste(state, event) {
  const files = (Array.isArray(event.files) ? event.files : [])
    .filter((one) => one && typeof one.path === 'string' && one.path)
    .map((one) => ({
      path: one.path,
      name: typeof one.name === 'string' && one.name ? one.name : baseName(one.path),
      kind: one.kind === 'image' || one.kind === 'text' ? one.kind : '',
      sub: typeof one.sub === 'string' ? one.sub : '',
    }))
  // 没贴上：输入框上方一行提示（Si702 / Si704）
  if (!files.length) return event.code ? result(withNotice(state, { code: event.code }), null) : same(state)
  const loaded = attach(state, files)
  return loaded ? result(loaded, null) : same(state)
}

function onRemove(state, event) {
  if (!event.path) return same(state)
  const want = key(event.path)
  // 干活中只能去掉还没发出去的（干活中挂上的那几份）；这一轮带着的不动
  if (state.phase === 'working' && !pendingFiles(state).some((one) => key(one.path) === want)) return same(state)
  const files = state.files.filter((one) => key(one.path) !== want)
  if (files.length === state.files.length) return same(state)
  // 干活中、收尾态里去掉小签：任务还停在原地，下一轮（重来、接着说）照当前的小签走。
  // 去掉读不了的那份，再点重来就不带它了。
  if (!(state.phase === 'empty' || state.phase === 'ready')) return result({ ...state, files }, null)
  // 还没开工、小签全去掉了：回到空的；拖进来的文件夹那种还是那个文件夹
  const phase = !files.length && state.place.kind === 'files' ? 'empty' : state.phase
  return result({ ...state, files, phase }, null)
}

// 选的模型只管当前这个任务：记在状态里，下一句开工用；清单的默认不动（默认去设置改）。
// 干活中不收（页面那头也点不开）；选同一个不重复记。
function onModel(state, event) {
  if (state.phase === 'working') return same(state)
  const entry = typeof event.entry === 'string' ? event.entry.trim() : ''
  const model = typeof event.model === 'string' ? event.model.trim() : ''
  if (!entry || !model) return same(state)
  const effort = event.effort == null ? null : typeof event.effort === 'string' ? event.effort : ''
  if (effort === '') return same(state)
  const picked = { entry, model, effort }
  if (state.model && state.model.entry === entry && state.model.model === model && state.model.effort === effort) return same(state)
  return result({ ...state, model: picked }, null)
}

function onSend(state, event) {
  const text = typeof event.text === 'string' ? event.text.trim() : ''
  if (!text || !event.runId || state.phase === 'working') return same(state)
  if (state.phase === 'empty' || state.phase === 'ready') return startRun(state, text, event.runId, 1, false, state.cards)
  // 停在这儿、问一句、做完了、点了「停止」：这几种都在同一个会话里接着说（模型记得前面聊过什么）。
  // 出错的那几种（比如会话坏了）照旧开新会话
  if (state.phase === 'done' || state.phase === 'asking' || state.phase === 'paused' || state.phase === 'stopped') {
    // tail：排队的插话带过的文件那一行，只发给模型，不进气泡
    const extra = { noted: event.noted === true, steered: event.steered === true, tail: typeof event.tail === 'string' ? event.tail : '' }
    return startRun(state, text, event.runId, state.round + 1, true, state.cards, extra)
  }
  return startRun(state, text, event.runId, state.round + 1, false, ageCards(state.cards))
}

// 「＋ 新任务」：干活中那条留在后台接着跑，由 ./run.mjs 另开一条，不走到这里
function onNew(state) {
  if (SETTLED.has(state.phase)) return result(freshTask(state), 'idle', '', { settle: true })
  if (state.phase === 'ready') return result({ ...createTask(), foreground: state.foreground }, null)
  return same(state)
}

// 壳自己的一步（拷文件）：页面上没有过程行，只换掉状态行那句话；小岛照旧是干活中。
function onStep(state, event) {
  if (foreign(state, event)) return same(state)
  const line = SHELL_STEP[event.step] ? t(SHELL_STEP[event.step]) : ''
  if (!line || state.phase !== 'working') return result(state, state.phase === 'working' ? 'work' : null)
  // 壳自己在干（模型还没开问、或者已经答完）：模型那头的说法和「没动静」都不算了
  const base = state.pulse || state.quietSince ? { ...state, pulse: '', quietSince: 0 } : state
  return result(setStep(base, line, event.at), 'work')
}

// 模型那边在哪一步（等回话、在想、在写回答、调工具）、静了多久：只记这两样，它想的写的不进来。
// 状态行上说哪一种在 ./view.mjs 的 workingOf
const PULSE = new Set(['wait', 'think', 'write', 'tool'])
function onPulse(state, event) {
  if (foreign(state, event) || state.phase !== 'working') return same(state)
  const pulse = PULSE.has(event.phase) ? event.phase : ''
  const quietSince = Number(event.quietSince) || 0
  if (pulse === state.pulse && quietSince === state.quietSince) return same(state)
  let next = state
  // 模型出声了（在想、在写、调工具）：重试起来了，那行等待收掉
  if (!quietSince && pulse && pulse !== 'wait') next = { ...next, flow: dropWait(next.flow) }
  // 请求刚发出去、或者工具都跑完了又在等回话：上一步在干什么不留，只说等待模型响应
  if (pulse === 'wait' && state.pulse !== 'wait') next = { ...next, step: '', stepAt: 0 }
  return result({ ...next, pulse, quietSince }, 'work')
}

// 进收尾态时的宠和通知：前台不打扰
// 宠的五种：work 干活中 · done 做完了（笑眼）· look 要你看一眼 · fail 没干成（平线）· idle 待命
function finish(state, phase, flow, notifyText, petText) {
  const kind = phase === 'done' ? 'done' : phase === 'asking' ? 'look' : 'fail'
  // 任务窗开着、在前台：用户已经看着了，小岛就待命
  if (state.foreground) return result({ ...state, phase, flow, look: false }, 'idle', '', { petText })
  return result({ ...state, phase, flow, look: true }, kind, notifyText, { petText })
}

// 停工那一行：停工那句 + 「· Si 码 错误，原文」（原文截到 80 个字）。
// 记在对话流里；页面不在流里画，画成输入框上方的红色横幅（见 ./view.mjs 的 bannerOf）
const errorItem = (state, text, buttons, code, raw) => item('error', text, state.round, buttons, { code: code || '', raw: rawText(raw) })
const enterError = (state, text, buttons, code, raw) => finish(state, 'error', [...state.flow, errorItem(state, text, buttons, code, raw)], text, text)

// 模型那边一直忙：不算没干成，算「停在这儿」。小岛照「等你回话」的样子。
// 挂死不回也走这里：等够了就停在这儿，做完的都留着。
function enterPaused(state, text, code, raw) {
  const flow = [...dropWait(state.flow), errorItem(state, text, [CONTINUE, SWAP_MODEL], code, raw)]
  if (state.foreground) return result({ ...state, phase: 'paused', flow, look: false }, 'idle', '', { petText: text })
  return result({ ...state, phase: 'paused', flow, look: true }, 'look', text, { petText: text })
}

// 权限申请：模型要越过任务文件夹做点什么，来问一声。
// 卡上三个按钮（允许一次 / 本任务都允许 / 拒绝），用户点了才回 dsh。
function onPermission(state, event) {
  if (foreign(state, event)) return same(state)
  const id = typeof event.id === 'string' ? event.id : ''
  if (!id) return same(state)
  const one = {
    id,
    action: typeof event.tool === 'string' ? event.tool : '',
    target: typeof event.target === 'string' ? event.target : '',
    outside: event.outside === true,
    justification: typeof event.justification === 'string' ? event.justification : '',
  }
  const card = item('permission', '', state.round, [], { permission: one })
  const flow = state.flow.filter((it) => !(it.kind === 'permission' && it.permission && it.permission.id === id))
  const next = { ...state, flow: [...flow, card] }
  // 任务窗在前台就不用小岛喊了：后台跑的才让小岛说「等你确认」
  return result(next, state.foreground ? null : 'confirm', '', { petText: t('perm.wait') })
}

// 用户点了：这张卡收掉
function onPermissionAnswered(state, event) {
  const id = typeof event.id === 'string' ? event.id : ''
  if (!id) return same(state)
  const flow = state.flow.filter((it) => !(it.kind === 'permission' && it.permission && it.permission.id === id))
  if (flow.length === state.flow.length) return same(state)
  return result({ ...state, flow }, null)
}

// 等待行：模型忙、桌伴自己要重试。同一时刻只留一行。
function onWait(state, event) {
  if (foreign(state, event) || state.phase !== 'working') return same(state)
  const options = { kind: event.kind || '' }
  const text = typeof event.text === 'string' && event.text ? event.text : waitLine(event.seconds, event.retry, event.max, options)
  const flow = state.flow.filter((one) => one.kind !== 'wait')
  // waitKind：错的种类（busy / server / noreply / network），小岛悬停那行照它挑说法
  const extra = { until: event.until || 0, retry: event.retry || 0, max: event.max || 0, waitKind: typeof event.kind === 'string' ? event.kind : '' }
  if (typeof event.head === 'string' && event.head) extra.head = event.head
  if (typeof event.tail === 'string' && event.tail) extra.tail = event.tail
  // 事件里没拆开的三段，就从整句里拆：第一个数是倒数的那几秒
  if (!extra.head) {
    const parts = text.match(/^([\s\S]*?)(\d+)([\s\S]*)$/)
    if (parts) {
      extra.head = parts[1]
      extra.tail = parts[3]
    }
  }
  return result({ ...state, flow: [...flow, item('wait', text, state.round, [STOP], extra)] }, 'work')
}

// 重试起来了或者模型说话了：那行等待就没了
function dropWait(flow) {
  return flow.some((one) => one.kind === 'wait') ? flow.filter((one) => one.kind !== 'wait') : flow
}

// 还没点的权限卡：这一轮收场了就收掉
function dropPerms(flow) {
  return flow.some((one) => one.kind === 'permission') ? flow.filter((one) => one.kind !== 'permission') : flow
}

// 说一句就装技能：收尾时在工作区里找到 pending-skills，对话流里出一张确认卡。
// 名字没写用 id，从哪来那句由后台拼好送进来。
function onInstall(state, event) {
  const one = event.install
  if (foreign(state, event) || !one || typeof one.id !== 'string' || !one.id) return same(state)
  const install = {
    id: one.id,
    name: typeof one.name === 'string' && one.name ? one.name : one.id,
    source: typeof one.source === 'string' ? one.source : '',
    ref: typeof one.ref === 'string' ? one.ref : '',
    does: typeof one.does === 'string' ? one.does : '',
    ok: one.ok === true,
    problems: Array.isArray(one.problems) ? one.problems.filter((p) => typeof p === 'string' && p) : [],
    busy: false,
    error: '',
  }
  // 同一个技能又找到一回（比如接着聊又点了一遍）：换新的一张，不量两张
  const flow = state.flow.filter((it) => !(it.kind === 'install' && it.install && it.install.id === install.id))
  const card = item('install', install.name, state.round, [], { install })
  return result({ ...state, flow: [...flow, card] }, state.phase === 'working' ? 'work' : null)
}

// 找到那一张确认卡；没有就 null
const installCard = (state, id) => state.flow.find((it) => it.kind === 'install' && it.install && it.install.id === id) || null

// 装好了 / 不装了：卡收掉，对话流里跟一句它说的气泡
function closeInstall(state, id, text) {
  const card = installCard(state, id)
  if (!card) return same(state)
  return result({ ...state, flow: [...state.flow.filter((it) => it !== card), item('reply', text, card.round)] }, null)
}

function onEnd(state, event) {
  if (foreign(state, event) || state.phase !== 'working') return same(state)
  // 这一轮收场了：还没点的权限卡收掉
  const done = { ...state, flow: dropPerms(state.flow) }
  if (event.status === 'cancelled') {
    // 设置变化（删模型、改钥匙）把这一轮中断的：不是用户点的停下，说另一句
    const said = event.note === 'settings' ? t('St609') : t('St607')
    return result({ ...done, phase: 'stopped', flow: [...dropWait(done.flow), item('note', said, done.round, [CONTINUE, RETRY])], look: false }, 'idle')
  }
  // dsh 意外退出：这一轮标成「已中断」（不报错），跟用户点停下一样能点「继续」接着做
  if (event.status === 'interrupted') {
    return result({ ...done, phase: 'stopped', flow: [...dropWait(done.flow), item('note', t('St608'), done.round, [CONTINUE, RETRY])], look: false }, 'idle')
  }
  // 没带报错就收场了：没归上类的（Si901）
  if (event.status === 'error') return enterError(done, stopText({ reason: 'other' }), [RETRY], 'Si901')
  if (event.status !== 'done') return same(state)
  const hasCard = done.cards.some((c) => c.round === done.round)
  let lastReply = null
  for (const one of done.flow) {
    if (one.kind === 'reply' && one.round === done.round) lastReply = one
  }
  const tail = lastReply ? String(lastReply.text).replace(/\s+$/, '') : ''
  if (!hasCard && (tail.endsWith('？') || tail.endsWith('?'))) {
    return finish(done, 'asking', done.flow.map((one) => (one === lastReply ? { ...one, ask: true } : one)), t('flow.askTail'), tail)
  }
  // 做完了：不再收过程行，对话流里就是回答和产出卡
  return finish(done, 'done', dropWait(done.flow), '', '')
}

export function createTask() {
  return {
    phase: 'empty', place: { kind: 'files', dir: '' }, files: [],
    flow: [], cards: [], usages: [], round: 0, runId: null, prompt: '', model: null,
    foreground: false, look: false, seq: 0, startedAt: 0, step: '', stepAt: 0, pulse: '', quietSince: 0, notice: null,
  }
}

export function reduceTask(state, event) {
  if (!state || !event || typeof event.type !== 'string') return same(state)
  switch (event.type) {
    case 'drop':
      return onDrop(state, event)
    case 'paste':
      return onPaste(state, event)
    case 'remove':
      return onRemove(state, event)
    case 'model':
      return onModel(state, event)
    case 'send':
      return onSend(state, event)
    case 'retry':
      if (!SETTLED.has(state.phase) || !state.prompt || !event.runId) return same(state)
      return startRun(state, state.prompt, event.runId, state.round + 1, false, ageCards(state.cards), { carry: true })
    // 停在这儿、或者按要求停下以后点「接着干」：同一个会话里只说一句短话。
    // 原来那句要求和文件 dsh 那边都记着，不再发一遍。那句短话只给模型：气泡上、对话记录里写按钮上的「继续」
    case 'continue':
      if ((state.phase !== 'paused' && state.phase !== 'stopped') || !event.runId) return same(state)
      return startRun(state, t('continue'), event.runId, state.round + 1, true, state.cards, { carry: true, said: t('input.continueLabel') })
    case 'stop':
      return state.phase === 'working' ? result(state, null, '', { cancel: true }) : same(state)
    case 'accept':
      if (!SETTLED.has(state.phase)) return same(state)
      return result(freshTask(state), 'idle', '', { settle: true })
    case 'new':
      return onNew(state)
    case 'window': {
      const fg = event.foreground === true
      if (fg && state.look) return result({ ...state, foreground: true, look: false }, 'idle')
      if (state.foreground === fg) return same(state)
      return result({ ...state, foreground: fg }, null)
    }
    case 'step':
      return onStep(state, event)
    case 'pulse':
      return onPulse(state, event)
    case 'workspace':
      if (foreign(state, event) || state.place.kind !== 'files' || state.place.dir === event.dir) return same(state)
      return result({ ...state, place: { ...state.place, dir: event.dir } }, null)
    // 这一轮带的文件在工作区里的那份拷贝：气泡里的小块靠它（路径、名字、是不是图）
    case 'chips': {
      if (foreign(state, event)) return same(state)
      const files = Array.isArray(event.files) ? event.files : []
      let hit = false
      const flow = state.flow.map((one) => {
        if (one.kind !== 'user' || one.round !== state.round) return one
        hit = true
        return { ...one, files }
      })
      if (!hit) return same(state)
      return result({ ...state, flow }, null)
    }
    case 'progress': {
      // 页面上没有过程行：只把小岛留在「干活中」，原话进日志。
      if (foreign(state, event) || typeof event.text !== 'string' || !event.text.trim()) return same(state)
      // 过程话翻成状态行上的「xxx中」，翻不出来就照旧
      const line = stepLine(event.text)
      if (!line || state.phase !== 'working') return result(state, state.phase === 'working' ? 'work' : null)
      return result(setStep(state, line, event.at), 'work')
    }
    // 壳自己插进来的一句话：工具没调通、模型看不了文件里的图。
    // 不是它说的话，灰字单独一行，可以带按钮
    case 'note': {
      if (foreign(state, event) || typeof event.text !== 'string' || !event.text.trim()) return same(state)
      const buttons = Array.isArray(event.buttons)
        ? event.buttons.filter((one) => one && typeof one.action === 'string' && typeof one.label === 'string')
        : []
      return result({ ...state, flow: [...state.flow, item('note', event.text.trim(), state.round, buttons)] }, state.phase === 'working' ? 'work' : null)
    }
    // 干活中途插进去的那句话：先当「我说的」冒出来，走哪条路的那行灰字随后补上。
    // 干活中挂上的文件跟这句一起发：气泡里摆成小块（工作区里那份拷贝）
    case 'steer': {
      if (foreign(state, event)) return same(state)
      const text = typeof event.text === 'string' ? event.text.trim() : ''
      if (!text) return same(state)
      const id = typeof event.id === 'string' ? event.id : ''
      const files = Array.isArray(event.files) ? event.files : []
      const one = item('steer', text, state.round, [], { steerId: id, status: '', files })
      return result({ ...state, flow: [...state.flow, one] }, state.phase === 'working' ? 'work' : null)
    }
    // 插话走通了哪条路：steer 插进这一步了 / queue 排队等这轮干完
    case 'steer-status': {
      if (foreign(state, event)) return same(state)
      const id = typeof event.id === 'string' ? event.id : ''
      if (!id) return same(state)
      const status = typeof event.status === 'string' ? event.status : ''
      const flow = state.flow.map((one) => (one.kind === 'steer' && one.steerId === id ? { ...one, status } : one))
      return result({ ...state, flow }, state.phase === 'working' ? 'work' : null)
    }
    // 模型忙、服务出错、连接断了：自己要重试，出一行灰字，底下倒数
    case 'wait':
      return onWait(state, event)
    case 'reply': {
      if (foreign(state, event) || typeof event.text !== 'string' || !event.text.trim()) return same(state)
      const text = event.text
      const flow = dropWait(state.flow)
      const last = flow[flow.length - 1]
      // 同一段被流式补全：后一段是前一段长出来的，还是同一个气泡，不重复
      if (last && last.kind === 'reply' && last.round === state.round && last.text && text.startsWith(last.text)) {
        const merged = flow.slice(0, -1).concat([{ ...last, text }])
        return result({ ...state, flow: merged }, state.phase === 'working' ? 'work' : null)
      }
      return result({ ...state, flow: [...flow, item('reply', text, state.round)] }, state.phase === 'working' ? 'work' : null)
    }
    // 用户点了提示那行的 ×
    case 'dismiss':
      return state.notice ? result({ ...state, notice: null }, null) : same(state)
    case 'usage': {
      if (foreign(state, event)) return same(state)
      const tokens = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].reduce((sum, one) => sum + (Number(event[one]) || 0), 0)
      if (!tokens && !event.searches) return same(state)
      return result({ ...state, usages: [...state.usages, { round: state.round, tokens, searches: Number(event.searches) || 0 }] }, null)
    }
    case 'output': {
      if (foreign(state, event) || typeof event.name !== 'string' || !event.name.trim()) return same(state)
      const card = { id: String(state.seq + 1), name: event.name, to: event.to, pages: event.pages == null ? null : event.pages, round: state.round, old: false, kind: event.kind === 'changed' ? 'changed' : 'made' }
      return result({ ...state, seq: state.seq + 1, cards: [card, ...state.cards] }, state.phase === 'working' ? 'work' : null)
    }
    case 'error': {
      if (foreign(state, event) || state.phase !== 'working') return same(state)
      // 停工那句、码、原文：码表和那几句在 app/copy/errors.mjs，哪种停工说哪句在 ./codes.mjs
      const code = codeOf(event)
      const text = stopText(event, code)
      const raw = event.raw || ''
      // 「忙」「服务出错」「一直没回」不是没干成：停在这儿，做完的都留着
      if (event.reason === 'busy' || event.reason === 'server' || event.reason === 'noreply') return enterPaused(state, text, code, raw)
      // 回的话是坏的：点重来，老这样就换模型
      if (event.reason === 'badreply') return enterError(state, text, [RETRY, SWAP_MODEL], code, raw)
      return enterError(state, text, MODEL_SETTINGS.has(event.reason) ? [SETTINGS, RETRY] : [RETRY], code, raw)
    }
    case 'permission':
      return onPermission(state, event)
    case 'permission-answered':
      return onPermissionAnswered(state, event)
    case 'install':
      return onInstall(state, event)
    // 装上了：收卡，加一句它说的气泡
    case 'install-done':
      return closeInstall(state, typeof event.id === 'string' ? event.id : '', t('install.done'))
    // 正在下载：卡留着，按钮都灰着
    case 'install-busy': {
      const id = typeof event.id === 'string' ? event.id : ''
      const card = installCard(state, id)
      if (!card) return same(state)
      const next = { ...card, install: { ...card.install, busy: true } }
      return result({ ...state, flow: state.flow.map((it) => (it === card ? next : it)) }, null)
    }
    // 模型自己下的东西被清掉了：说一句
    case 'install-note': {
      if (foreign(state, event)) return same(state)
      const text = typeof event.message === 'string' && event.message ? event.message : t('install.note')
      return result({ ...state, flow: [...state.flow, item('reply', text, state.round)] }, null)
    }
    // 没装上：卡留着，红字写明原因，还能再点
    case 'install-fail': {
      const id = typeof event.id === 'string' ? event.id : ''
      const card = installCard(state, id)
      if (!card) return same(state)
      const message = typeof event.message === 'string' && event.message ? event.message : errorText('Si906')
      const next = { ...card, install: { ...card.install, busy: false, error: message } }
      return result({ ...state, flow: state.flow.map((it) => (it === card ? next : it)) }, null)
    }
    // 不装了：收卡，也说一句
    case 'install-drop':
      return closeInstall(state, typeof event.id === 'string' ? event.id : '', t('install.drop'))
    case 'end':
      return onEnd(state, event)
    default:
      return same(state)
  }
}
