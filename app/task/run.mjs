// 任务窗主进程这头：手里一张对话表，任务窗只显示其中一条（shown）。
// 干活中切去看别的对话、点「＋ 新任务」，正在跑的那条留在后台接着跑，回来照样看得到进度、产出和报错。
// 不排队：每条对话自己一个 dsh 进程同时跑，厂商限并发就报它自己的错（dsh 重试完了报码 + 原文）。
// 一条对话的状态和一轮的流水线在 ./session.mjs；这里管看哪条、窗上的按钮、拖放、贴的东西、小岛那头的「几个在跑」。
// 外部能力（dsh、工作区、模型、对话记录）全从 deps 传进来，不 import electron，node --test 直接测。
// deps：runTask / prepareTask / finishTask / deliverOutput / clearWorkspace /
// snapshotWorkspace / root / model / extensions / recent / onRecent / onPet /
// onView / openSettings / pickFiles / openPath / history（对话记录，可不传） / log。

import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { addRecent } from './paths.mjs'
import { toTaskView } from './view.mjs'
import { createSession } from './session.mjs'
import { dropFiles } from './drop.mjs'
import { unseenNames } from './unseen.mjs'
import { unseenPending } from './pending.mjs'
import { baseName } from './paths.mjs'
import { charsText } from './paste-plan.mjs'
import { isSavedTextName, pasteDir, restoreText, saveImage, saveText } from './paste.mjs'
import { recentTasks } from './recent-tasks.mjs'
import { appPaths, dataPaths } from '../paths.mjs'
import { t } from '../copy/copy.mjs'

export function createRunner(deps = {}) {
  const log = deps.log || (() => {})
  let recent = Array.isArray(deps.recent) ? deps.recent.slice() : []
  let seq = 0
  const newRunId = () => `run-${Date.now().toString(36)}-${(seq += 1)}`
  let foreground = false // 任务窗在不在前台：只有正看着的那条算在前台
  let running = 0 // 上回告诉小岛的「几个在跑」
  const sessions = [] // 正看着的那条，加上切走了还留着的（在跑的、在后台跑完还没回来看的）

  const make = () => {
    const one = createSession({ deps, log, newRunId, onChange, onSettled, onFolderStart })
    sessions.push(one)
    return one
  }
  let shown = make()

  // 在一个文件夹里真开干了：记进右键「最近」（只拖进来不记）
  function onFolderStart(dir) {
    recent = addRecent(recent, dir)
    deps.onRecent?.(recent)
  }

  // 一条对话的状态变了：任务窗看着它就重画；在跑的个数变了告诉小岛（两个以上时冒「执行中 · N 个任务」）
  function onChange(one) {
    if (one === shown) deps.onView?.(view())
    const count = sessions.filter((each) => each.running()).length
    if (count === running) return
    running = count
    deps.onPet?.({ type: 'running', count })
  }

  // 一条对话这一轮收场了：不在眼前（切走了、在后台跑完的）、而且是干完了的，就收拾它的临时文件，产出留着。
  // 在眼前的先不收拾：接着说还要用那些副本，等用户离开它时再收拾（switchTo、「＋ 新任务」）。
  // 停在「继续」「等你回答」「已停止」、出错停下的，对话流里有装技能卡的，也先不收拾：
  // 回来点「继续」要接着用之前写的草稿，点「安装」要读工作区里的方案。等用户离开它或者收下时再收拾
  function onSettled(one) {
    if (one === shown) return
    const now = one.state()
    if (now.phase !== 'done' || now.flow.some((item) => item.kind === 'install')) return
    one.tidy()
  }

  const view = () => {
    const root = deps.root?.() || ''
    const tasks = root ? recentTasks(root) : []
    const allTasks = root && existsSync(appPaths(root).tasks) ? appPaths(root).tasks : ''
    // 小块还在不在：主进程看得到文件在不在（页面看不了）
    const hasVision = () => deps.hasVisionModel?.() === true
    return toTaskView(shown.state(), { root, recent, recentTasks: tasks, allTasks, historyId: shown.historyId() || '', exists: (p) => Boolean(p) && existsSync(p), unseen, hasVision })
  }

  // 现在看着的这条对话用的模型自己看不看得了图
  const sees = () => shown.sees()
  // 输入框上方那句话：现在的模型看不了图时，带着的图、扫描的 PDF 哪几份它读不了内容（./unseen.mjs）
  const unseen = (files) => (deps.visionOf ? unseenNames(files, { sees }) : [])
  // 拦：还没发出去的那几份里，有现在的模型读不了内容的（图片、扫描的 PDF）——这几份带着就发不出去
  const blocked = () => (deps.visionOf ? unseenPending(shown.state(), { sees }).length > 0 : false)
  // 拦下来时记一行：带的是什么、拦的是哪一种操作（不发出去，页面上按钮也灰着）
  const refuse = (what) => {
    if (!blocked()) return false
    const names = unseenPending(shown.state(), { sees }).map((one) => one.name)
    log('send-blocked', { what, files: names })
    return true
  }

  // 换去看另一条：正看着的那条在跑就留在后台接着跑（跑完时收拾）；没在跑就收拾掉临时文件、不留了（对话记录里还有）
  function switchTo(next) {
    const old = shown
    if (old === next) return
    if (old.running()) old.feed({ type: 'window', foreground: false })
    else {
      old.tidy()
      sessions.splice(sessions.indexOf(old), 1)
    }
    shown = next
    if (!sessions.includes(next)) sessions.push(next)
    next.feed({ type: 'window', foreground })
    log('switch', { historyId: next.historyId() || '', background: sessions.filter((one) => one !== next && one.running()).length })
    deps.onView?.(view())
    deps.onSees?.(sees())
  }

  // 「＋ 新任务」：看着的这条在跑就留在后台接着跑，另开一条空的；没在跑就照旧收下、清空
  function fresh() {
    if (shown.running()) switchTo(make())
    else shown.feed({ type: 'new' })
    deps.onSees?.(sees())
  }

  // 事件的总口：带 taskId 的（干活那头报的）送到那一条对话；不带的（窗上的）送到看着的那条
  function feed(event) {
    if (!event || typeof event.type !== 'string') return null
    if (event.type === 'new') return fresh()
    if (event.type === 'window') foreground = event.foreground === true
    const one = event.taskId ? sessions.find((each) => each.owns(event.taskId)) : shown
    if (!one) return null
    const step = one.feed(event)
    // 换了模型、窗回到前台（设置里可能刚改过）：告诉小岛现在的模型看不看得了图
    if (one === shown && (event.type === 'model' || (event.type === 'window' && event.foreground === true))) deps.onSees?.(sees())
    return step
  }

  // 拖放的总口：正好一个文件夹就装文件夹，否则只留普通文件。
  // fresh：从小岛那边拖来的（新的一件事）——上一条做完了就另开一条；拖进任务窗的接着当前这条对话
  function drop(paths, { fresh = false } = {}) {
    const got = dropFiles(paths, deps.extensions)
    if (!got) return
    if (got.folder) {
      // 只是拖进来不记「最近」：真在这个文件夹里开干了才记（见 onFolderStart）
      feed({ type: 'drop', folder: got.folder, files: got.files })
      return
    }
    feed({ type: 'drop', files: got.files, fresh })
  }

  // 贴的图：主进程存成文件（存在哪、怎么编号在 ./paste.mjs），加小签；
  // 一次贴几张就存几张、加几张小签。一张都没存上的，输入框上方一行提示（Si702 / Si704）。
  // 图照原样存成文件，不缩小（dsh 发给模型前自己会缩）。
  function pasteImages(list) {
    const root = deps.root?.() || ''
    if (!root) return
    const files = []
    let code = ''
    for (const one of Array.isArray(list) ? list : []) {
      if (!one || typeof one.mime !== 'string' || !one.mime) continue
      const saved = saveImage(pasteDir(root), Buffer.from(one.bytes ?? []), one.mime)
      if (saved.ok) files.push({ path: saved.path, name: saved.name, kind: 'image' })
      else if (!code) code = saved.code || ''
    }
    feed({ type: 'paste', files, code })
  }

  // 贴的长文字：存成 md 文件挂上，不往输入框里塞；小签第二行写字数
  function pasteText(text) {
    const root = deps.root?.() || ''
    if (typeof text !== 'string' || !text || !root) return
    const saved = saveText(pasteDir(root), text)
    feed({ type: 'paste', files: [{ path: saved.path, name: saved.name, kind: 'text', sub: charsText(saved.chars) }] })
  }

  // 改回文字：把存下来的长文字取回输入框、去掉小签。
  // 只认 data\paste 里的 贴的文字-数字.md，别的文件一律不碰。
  function restorePaste(path) {
    const root = deps.root?.() || ''
    if (typeof path !== 'string' || !path || !root) return { ok: false }
    const rel = relative(resolve(dataPaths(root).paste), resolve(path))
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !isSavedTextName(baseName(path))) return { ok: false }
    try {
      const text = restoreText(path)
      feed({ type: 'remove', path, pasted: true })
      return { ok: true, text }
    } catch (error) {
      log('restore-failed', { error: error?.message || '' })
      return { ok: false }
    }
  }

  // 窗上那排按钮和宠那头的入口：都对着看着的那条对话（「停下」只停这一条）
  function act(action) {
    if (!action || typeof action.type !== 'string') return
    const type = action.type
    if (type === 'send' && typeof action.text === 'string') {
      if (refuse('send')) return
      feed({ type: 'send', text: action.text, runId: newRunId() })
    } else if (type === 'steer' && typeof action.text === 'string') {
      if (refuse('steer')) return
      shown.steer(action.text)
    } else if (type === 'retry') {
      if (refuse('retry')) return
      feed({ type: 'retry', runId: newRunId() })
    } else if (type === 'continue') {
      if (refuse('continue')) return
      feed({ type: 'continue', runId: newRunId() })
    }
    // 换模型：选中的模型管下一轮
    else if (type === 'model') feed({ type: 'model', entry: action.entry, model: action.model, effort: action.effort ?? null })
    else if (type === 'stop' || type === 'accept' || type === 'dismiss' || type === 'new') feed({ type })
    else if (type === 'remove') feed({ type: 'remove', path: action.path })
    else if (type === 'install-skill') shown.install(action.id)
    else if (type === 'install-drop') shown.decline(action.id)
    // 权限卡上的三个钮：允许一次 / 本任务都允许 / 拒绝
    else if (type === 'permission') {
      const id = typeof action.id === 'string' ? action.id : ''
      const decision = typeof action.decision === 'string' ? action.decision : ''
      if (!id || !decision) return
      // 卡在眼前这条对话上；不在就找别的对话（后台跑的那条）
      const one = sessions.find((each) => each.hasPermission(id)) || shown
      void Promise.resolve(one.answerPermission(id, decision)).catch((error) => log('permission-failed', { error: error?.message || '' }))
    }
    else if (type === 'settings') deps.openSettings?.('models')
    else if (type === 'add') Promise.resolve(deps.pickFiles?.()).catch((error) => log('pick-failed', { error: error?.message || '' }))
    else if (type === 'recent' && recent.includes(action.dir)) drop([action.dir])
    else if (type === 'open-recent' || type === 'all-tasks') {
      const now = view()
      const listed = type === 'all-tasks' ? now.top.recent.allTasks : ''
      const path = listed && listed === action.dir ? listed : knownPath(action.dir)
      const isTask = now.top.recent.tasks.some((one) => one.dir === path)
      if (path && (type === 'all-tasks' ? path === listed : isTask)) deps.openPath?.(path, false)
    } else if (type === 'open-folder' || type === 'open' || type === 'reveal') {
      const path = knownPath(action.path)
      if (path) deps.openPath?.(path, type === 'reveal')
    }
    // 另存为：系统另存为对话框，拷一份到用户选的地方
    else if (type === 'save-as') {
      const path = knownPath(action.path)
      if (path) void deps.saveAs?.(path)
    }
  }

  // 打开 / 显示只认当前视图里出现过的路径
  function knownPath(path) {
    if (typeof path !== 'string' || !path) return ''
    const now = view()
    if (now.top.path.open === path || now.top.recent.allTasks === path) return path
    if (now.top.recent.tasks.some((one) => one.dir === path)) return path
    return now.bottom.cards.some((card) => card.path === path) ? path : ''
  }

  // 宠那头点开了任务窗：fresh 开新任务，recent 装那个文件夹，paths 当拖放，
  // taskId 切到那一轮所在的那条对话（小岛说「做完了！」「需要关注！」「出错了！」说的是它，不一定是眼前这条）
  function opened(detail) {
    if (!detail || typeof detail !== 'object') return
    if (typeof detail.taskId === 'string' && detail.taskId) {
      const one = sessions.find((each) => each.owns(detail.taskId))
      if (one) switchTo(one)
    } else if (detail.fresh === true) fresh()
    else if (typeof detail.recent === 'string' && recent.includes(detail.recent)) drop([detail.recent])
    else if (Array.isArray(detail.paths)) drop(detail.paths, { fresh: true })
  }

  // 关桌伴：每条对话正在跑的那一轮都收手
  function quit() {
    for (const one of sessions) one.quit()
  }

  // 打开一条历史对话：干活中也能开，正看着的那条在跑就留在后台接着跑。
  // 还在表里的（在后台跑着、或跑完还没回来看）直接切过去，进度、产出、报错都在；
  // 别的从对话记录里拼回来：工作区还在就接着聊，不在了只读，再说一句提醒重开。
  function openHistory(id) {
    const key = String(id ?? '')
    if (key && shown.historyId() === key) return { ok: true }
    const known = key ? sessions.find((one) => one.historyId() === key) : null
    if (known) {
      switchTo(known)
      return { ok: true }
    }
    let record = null
    try {
      record = deps.history ? deps.history.get(key) : null
    } catch (error) {
      log('history-failed', { action: 'get', error: error?.message || '' })
    }
    if (!record) return { ok: false, message: t('St802') }
    const next = createSession({ deps, log, newRunId, onChange, onSettled, onFolderStart })
    next.restore(record)
    switchTo(next)
    return { ok: true }
  }

  // 正在跑的任务在用哪些模型（'条目/模型'）：设置里删模型前要知道有没有人在用
  function inUse() {
    const out = []
    for (const one of sessions) {
      if (!one.running()) continue
      const model = one.state().model
      if (model && model.entry && model.model) out.push(`${model.entry}/${model.model}`)
    }
    return out
  }

  // 中断正在跑的会话：choices 是 '条目/模型' 的名单，不给就全停
  // 停了以后走现有的停下后状态（用户点「继续」接着做）；
  // note 记成 'settings'：界面上说的是「改了模型设置」，不是用户点的停下
  function interrupt(choices) {
    const wanted = Array.isArray(choices) && choices.length > 0 ? new Set(choices) : null
    let count = 0
    for (const one of sessions) {
      if (!one.running()) continue
      const model = one.state().model
      const id = model && model.entry && model.model ? `${model.entry}/${model.model}` : ''
      if (wanted && !wanted.has(id)) continue
      one.stop('settings')
      count += 1
    }
    return count
  }

  return {
    view, feed, act, drop, opened, quit, openHistory, pasteImages, pasteText, restorePaste, recent: () => recent.slice(),
    // 正在跑的任务在用哪些模型 / 中断它们（设置那边改模型、删模型时用）
    inUse,
    interrupt,
    // 任务窗选的模型（没选是 null）：主进程 task:models 拿去算当前显示哪个
    model: () => shown.state().model ?? null,
    // 现在干活的模型自己看不看得了图：小岛平时那几句里要不要加「拖个图片试试？」
    sees,
    // 现在看着的这个任务的工作区：点气泡里的小块时用它核路径（只放工作区里的文件）
    workspace: () => shown.workspace(),
    // 有没有对话在干活（看着的、后台的都算）：小岛的新闻红点等手头的活干完再亮
    busy: () => sessions.some((one) => one.running()),
  }
}
