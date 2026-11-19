// 任务窗里的一条对话：自己的状态、任务文件夹、对话记录、正在跑的那一轮。
// 好几条可以同时在跑，每条自己一个 dsh 进程、自己一个任务文件夹；任务窗只显示其中一条（./run.mjs 管看哪条）。
// 一轮的七个步骤、收尾、插话都在这里。外部能力全从 deps 传进来（见 ./run.mjs 开头），不 import electron。

import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { createTask, reduceTask } from './state.mjs'
import { fileHasImage } from './unseen.mjs'
import { pendingFiles } from './pending.mjs'
import { retryWait } from './wait.mjs'
import { restoreState, restoreTask } from './history-open.mjs'
import { baseName } from './paths.mjs'
import { chipsOf } from './chips.mjs'
import { noteUsage } from '../usage/index.mjs'
import { PENDING_DIR_NAME, PLAN_DIR_NAME } from '../abilities/install.mjs'
import { RECEIVED_NAME } from '../workspace/index.mjs'
import { createInstallFlow } from './install-flow.mjs'
import { quietToolFail, toolFailNote } from './tool-note.mjs'
import { codeFor, errorCodeLine } from './codes.mjs'
import { copiesOf, freshFiles, markReceivedFiles, steerFiles } from './attach.mjs'
import { appPaths } from '../paths.mjs'
import { t } from '../copy/copy.mjs'

const beat = () => new Promise((done) => setImmediate(done))
const LOCKED = /^(EBUSY|EPERM|EACCES)$/
// 任务文件夹里的过程目录（对话记录、脚本这些放这儿）：里面的文件不算产出
const PROCESS_NAME = '.sidemate'

// ctx：deps（同 ./run.mjs）、log、newRunId（新一轮的编号）、
// onChange（这条对话的状态变了：任务窗看着它就重画，小岛那头数一下还有几个在跑）、
// onSettled（这一轮收场了、后面没接着的一轮：对话表看它在不在眼前，不在就收拾临时文件）
// onFolderStart：在一个文件夹里真开干了（不是只拖进来）——右键「最近」只记这种
export function createSession({ deps = {}, log = () => {}, newRunId, onChange = () => {}, onSettled = () => {}, onFolderStart = () => {} } = {}) {
  // 一句话装能力：方案 → 确认卡 → 用户点了才下载。这摊事在 install-flow.mjs 里。
  const installFlow = createInstallFlow({
    deps,
    workspace: () => task?.workspace || '',
    skillDir,
    log,
    feed,
  })
  let state = createTask()
  let task = null // 这个任务记着的工作区、文件副本、sessionId
  let current = null // 正在准备或在跑的这一轮
  let historyId = null // 这个任务记在哪条对话上
  let saidReply = 0 // 这轮它说的话里已经记进对话记录的条数
  let ghost = false // 打开的历史工作区不在了：只看，再说一句就提醒重开
  let lastRun = null
  let steers = 0 // 插话的编号
  const perms = new Map() // 权限申请：编号 → 那一轮（用户点了回给 dsh）
  let steerTurn = Promise.resolve() // 插话一句一句按顺序送：前一句还在等文件备好，后一句排在它后面
  let queuedFiles = [] // 排队的插话带的那几份文件：下一轮跟着那句话一起给模型
  // 同一条对话里一轮接一轮：上一轮的 python 没退完，下一轮不碰工作区。别的对话不排在这里
  let chain = Promise.resolve()

  // 现在干活的模型自己看不看得了图（shell.mjs 的 visionOf，只看它自己的看图标记）
  const sees = () => (deps.visionOf ? deps.visionOf(state.model ?? null) === true : false)
  // 这一轮带的文件里夹着图的那几份（Word / PPT / 有字的 PDF 里夹着图）：只读文字
  const imagesIn = (start) => (start?.files || []).filter(Boolean).filter((path) => fileHasImage(path))

  // 停下来的报错：日志里另写一行码 + 细节（哪一步、退出码、报错原文前几百字，不写密钥）
  function feed(event) {
    if (event?.type === 'error') { const stop = errorCodeLine(event); if (stop) log(stop.event, { ...stop, taskId: event.taskId }) }
    const step = reduceTask(state, event)
    const changed = step.state !== state
    state = step.state
    // 换成新任务（空状态）了：之前那条对话不再是「当前」，下拉里不再高亮
    if (state.phase === 'empty' && state.round === 0) historyId = null
    if (event.type === 'step') log('step', { step: event.step, taskId: event.taskId })
    if (step.pet) toPet(step.pet, step.notify, step.petText)
    if (changed) onChange(self)
    if (step.start) void begin(step.start)
    if (step.cancel) stop()
    if (step.settle) settle()
    recordHistory(event)
    return step
  }

  // 记对话：记不上写日志，绝不挡干活
  function note(action, ...args) {
    if (!historyId || !deps.history) return
    try {
      deps.history[action]?.(historyId, ...args)
    } catch (error) {
      log('history-failed', { action, error: error?.message || '' })
    }
  }

  // 接着聊要用的东西记进 resume：工作区、地点、挂着的文件、文件副本
  function saveResume(start, task) {
    if (!historyId || !deps.history) return
    try {
      const kind = start.place.kind
      deps.history.setResume(historyId, {
        place: { kind, dir: kind === 'files' ? task.workspace : String(start.place.dir || '') },
        files: Array.isArray(start.files) ? start.files.slice() : [],
        workspace: task.workspace,
        copied: (task.prepared.copied || []).map((one) => ({ from: one.from, to: one.to })),
      })
    } catch (error) {
      log('history-failed', { action: 'setResume', error: error?.message || '' })
    }
  }

  // 新任务开工：开一条新对话。文件夹任务的记那个文件夹，其余记任务文件夹。
  // 任务名先用第一句话的前 16 个字，dsh 起好名字再换上（runTask 报的 title）
  function beginHistory(start, task, chips) {
    historyId = null
    saidReply = 0
    ghost = false
    if (!deps.history) return
    try {
      const folder = start.place.kind === 'folder' ? start.place.dir : task.workspace
      historyId = deps.history.start({
        // 记录存在这个任务自己的文件夹里（.sidemate\conversation.json）
        workspace: task.workspace,
        prompt: start.prompt,
        folder,
        folderName: baseName(folder),
        kind: 'task',
        model: start.model ?? null,
        files: chips || [],
      })
      saveResume(start, task)
    } catch (error) {
      historyId = null
      log('history-failed', { action: 'start', error: error?.message || '' })
    }
  }

  // 这一轮带的文件在工作区里的那份拷贝：气泡里的小块靠它
  function chipsOfRound(task, start) {
    return chipsOf({ paths: (start.files || []).filter(Boolean), copied: task?.prepared?.copied || [] })
  }

  // 这轮它说的话记进对话记录：照状态里合并好的样子收尾时一次记，不逐段重复
  function flushReplies() {
    if (!historyId || !deps.history) return
    const replies = state.flow.filter((one) => one.kind === 'reply' && one.round === state.round)
    for (const one of replies.slice(saidReply)) note('say', 'it', one.text)
    saidReply = replies.length
  }

  // 干活时顺手记对话：收尾时记它说的话，出一张卡记一份交付的文件
  function recordHistory(event) {
    if (event.type === 'end' && event.taskId === state.runId) flushReplies()
    else if (event.type === 'output' && event.taskId === state.runId && event.to) {
      note('addFile', { name: event.name, path: event.to })
    }
  }

  // 宠的五种：
  // work 干活中 · done 做完了（笑眼）· look 要你看一眼（睁大 + 红点）· fail 没干成（平线）· idle 待命
  function toPet(kind, notify, petText) {
    const taskId = state.runId || lastRun
    // 在等重试：带上倒数到头的时刻和错的种类，小岛上照种类说「模型忙 / 模型服务出错 / 模型连接中断，N 秒后重试」
    // （没在等就不带，小岛那头当 0）
    const wait = state.flow.find((one) => one.kind === 'wait')
    const until = wait?.until || 0
    if (kind === 'work') deps.onPet?.({ type: 'progress', taskId, text: petText || '', ...(until ? { wait: until, waitKind: wait.waitKind || '' } : {}) })
    // 做完了：带上这一轮交出去的第一份文件，小岛上的「打开」开的就是它；这一轮没交文件就不带，也不给「打开」
    else if (kind === 'done') deps.onPet?.({ type: 'end', status: 'done', taskId, path: firstOutput() })
    else if (kind === 'idle') deps.onPet?.({ type: 'end', status: 'cancelled', taskId })
    else if (kind === 'look') deps.onPet?.({ type: 'ask', taskId, message: petText || notify || '', notice: notify || '' })
    // 有任务在等确认（权限卡）：小岛说「等你确认」
    else if (kind === 'confirm') deps.onPet?.({ type: 'confirm', taskId, message: petText || notify || '', notice: petText || notify || '' })
    else if (kind === 'fail') deps.onPet?.({ type: 'error', taskId, message: petText || notify || '' })
  }

  // 这一轮交出去的第一份文件；卡是新的排在前面，所以从后往前找
  function firstOutput() {
    const mine = state.cards.filter((card) => card.round === state.round && card.to)
    return mine.length ? mine[mine.length - 1].to : ''
  }

  // 停下：只停这一条对话。note 说明是谁让停的（设置变化中断：'settings'）
  function stop(note = '') {
    if (!current) return
    current.controller?.abort() // 还在排队等的：别等了
    if (current.handle) { current.handle.cancel(note); return } // dsh 自己发 end cancelled
    // 还在准备文件、或者在等上一轮退完：立刻停，后面每一步都会看到 stopped 悄悄收手
    current.stopped = true
    feed({ type: 'end', status: 'cancelled', taskId: current.runId, ...(note ? { note } : {}) })
  }

  // 收下也排队：等这条对话还在收尾的那一轮退完再清场
  function settle() {
    ghost = false // 收下就是新的一段：历史那套只读状态跟着作废
    const hold = task
    const prev = chain
    chain = (async () => {
      await prev
      // 新闻的文件夹是产出本身，不是临时工作区：不清也不打日志，下个任务照常另开工作区
      if (hold?.workspace && !hold.news) {
        log('settle', { dir: hold.workspace })
        try { deps.clearWorkspace(hold.workspace) } catch (error) { log('clear-failed', { error: error?.message || '' }) }
      }
      if (task === hold) task = null
    })()
  }

  // 收拾临时文件：跟收下时清的一样（拷进来的副本、带标副本这些），任务文件夹根目录里的成品留着。
  // 跟收下不同的是对话还留着：会话、任务名、对话流都不动，回来还能接着聊（副本不在了的，接着说时重新拷）
  function tidy() {
    const hold = task
    if (!hold?.workspace || hold.news) return
    const prev = chain
    chain = (async () => {
      await prev
      log('tidy', { dir: hold.workspace })
      try { deps.clearWorkspace(hold.workspace) } catch (error) { log('clear-failed', { error: error?.message || '' }) }
    })()
  }

  // 这一轮没开起来：文件的小块还是摆出来（工作区里有的照旧指过去）
  function chipsOfState() {
    const paths = (state.files || []).map((one) => one?.path).filter(Boolean)
    return chipsOf({ paths, copied: task?.prepared?.copied || [] })
  }

  // 这一轮停下来：停工那句 + 错误码（Si），日志里另写一行码 + 细节。
  // extra：code / stop / vars（停工那句用哪条、填什么）、name（文件名）、step / detail（只进日志）
  function fail(round, reason, extra = {}) {
    log('failed', { reason, code: extra.code || '', detail: extra.detail || '', name: extra.name || '', taskId: round.runId })
    const chips = chipsOfState()
    if (chips.length) feed({ type: 'chips', taskId: round.runId, files: chips })
    feed({ type: 'error', reason, ...extra, code: extra.code || codeFor(reason, extra.raw), taskId: round.runId })
    feed({ type: 'end', status: 'error', taskId: round.runId })
  }

  // 文件夹任务里用户从格上删掉的那几份，拷进来后从工作区删掉
  function removeDeleted(prepared, kept) {
    const hold = new Set(kept.map((path) => resolve(path)))
    for (const one of prepared.copied) {
      if (hold.has(resolve(one.from))) continue
      try { if (existsSync(one.to)) unlinkSync(one.to) } catch { /* 删不掉就留着 */ }
    }
  }

  // 这一轮出哪些卡：模型交稿的（文件生成），还有这一轮动过的文件（文件变动）
  function outputCards(round) {
    const root = resolve(task?.workspace || '')
    const cards = []
    const seen = new Set()
    // 用户给的那份副本不算产出（模型没动它）
    const given = new Set((task?.prepared?.copied || []).map((one) => resolve(one.to)))
    for (const one of round.presented || []) {
      const path = resolve(root, one.path)
      if (seen.has(path)) continue
      if (!existsSync(path)) continue
      seen.add(path)
      cards.push({ path, name: baseName(path), kind: 'made' })
    }
    for (const one of round.artifacts || []) {
      const path = resolve(one.path)
      if (seen.has(path)) continue
      if (given.has(path)) continue
      // 任务文件夹里的才算：received\（用户给的副本）、.sidemate\（过程）和装能力那两处的文件不算
      const rel = relative(root, path)
      if (!rel || rel.startsWith('..')) continue
      const first = rel.split(/[\\/]/)[0]
      if (first === RECEIVED_NAME || first === PROCESS_NAME || first === PENDING_DIR_NAME || first === PLAN_DIR_NAME) continue
      seen.add(path)
      cards.push({ path, name: one.name || baseName(path), kind: 'changed', pages: one.pages ?? null })
    }
    return cards
  }

  // 插不进去的那句排队：等这一轮干完再发（下一轮算插过话）。连着排了几句就都带上。
  // 跟这句一起挂上的文件已经拷进工作区了，下一轮不会再提：文件那一行单独记着，发的时候接在后面告诉模型（不进气泡）
  // noted：这句已经记进对话记录了（还没开对话记录时打的没记上，发的时候再记）
  function enqueue(round, body, line, noted) {
    round.queued = round.queued ? `${round.queued}\n${body}` : body
    if (line) round.queuedTail = round.queuedTail ? `${round.queuedTail}\n${line}` : line
    if (!noted) round.queuedUnnoted = true
  }

  // 干活中途插一句：插进这一轮的下一步；插不进去就排队，等这一轮干完再发。
  // 还在准备文件、读文件（dsh 还没起来或者已经退了）时打的话也不丢：直接排队
  async function steerNow(text) {
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) return
    const round = current
    if (!round || round.stopped) return
    const id = `steer-${Date.now().toString(36)}-${(steers += 1)}`
    // 干活中挂上的文件跟这句一起发：拷进工作区，这句后面列出文件名；气泡里摆成小块
    // （任务文件夹还没建好时先不拷，文件留在小签上，下一轮照新挂上的文件拷进去、告诉模型）
    const before = task?.prepared?.copied?.length || 0
    const extra = steerFiles(deps, task, pendingFiles(state), log)
    const fresh = extra && task?.prepared ? task.prepared.copied.slice(before) : []
    const chips = extra?.chips || []
    // 先当「我说的」冒出来，走哪条路的那行灰字随后补上
    feed({ type: 'steer', id, text: body, files: chips, taskId: round.runId })
    const noted = Boolean(historyId && deps.history)
    note('say', 'me', body, chips) // 插的话进对话历史：重新打开还看得到
    // 一句一句按顺序插：后一句排在前一句后面
    const turn = steerTurn.then(() => deliverSteer(round, id, body, extra?.files || [], fresh, noted))
    steerTurn = turn.catch(() => {})
    await turn
  }

  // 插话带的文件：已经拷进工作区了，插进去的那句后面带上这几份的链接
  async function deliverSteer(round, id, body, files, fresh, noted) {
    // 这一轮开头还在备文件：等它备完再插
    if (fresh.length) await round.prepared
    let result = null
    if (round.handle && typeof round.handle.steer === 'function') {
      try {
        result = await round.handle.steer(body, files)
      } catch (error) {
        log('steer-failed', { error: error?.message || '' })
      }
    }
    const mode = result?.mode === 'steer' ? 'steer' : 'queue'
    log('steer', { mode })
    feed({ type: 'steer-status', id, status: mode, taskId: round.runId })
    if (mode !== 'steer') {
      enqueue(round, body, '', noted)
      queuedFiles = [...queuedFiles, ...files]
    }
  }

  // 收尾：模型交稿的出「文件生成」卡，没交稿但任务文件夹根目录有文件动了出「文件变动」卡 → 存着的出错 → 结束。
  // 每个让出点之后、每次喂之前都看一眼 stopped：停了就悄悄收手，不再出卡。
  async function collect(round, status) {
    if (round.stopped) return
    const taskId = round.runId
    for (const one of outputCards(round)) {
      if (round.stopped) return
      feed({ type: 'output', taskId, name: one.name, to: one.path, kind: one.kind, pages: one.pages ?? null })
    }
    if (round.stopped) return
    // 收尾再报一次错：Si 码、原文都一起带上
    if (round.failure) {
      const { type: _type, at: _at, taskId: _taskId, ...failure } = round.failure
      feed({ type: 'error', ...failure, taskId })
    }
    installFlow.offer(round.runId)
    feed({ type: 'end', status, taskId })
  }

  async function begin(start) {
    // utterance：用户要的那句（点「继续」时是用户原来那句，不是发给模型的「接着干」）：用量的任务名看它
    const round = { runId: start.runId, stopped: false, handle: null, artifacts: [], presented: [], failure: null, utterance: start.utterance || start.prompt || '', queued: '', queuedTail: '', queuedUnnoted: false, controller: new AbortController(), releaseKey: null }
    // 这一轮开头的文件备好了没（或者这一轮已经收场）：插话带的文件等它
    round.prepared = new Promise((ok) => { round.markPrepared = ok })
    current = round
    lastRun = start.runId
    log('start', { taskId: start.runId, round: start.round, resume: start.resume === true, place: start.place.kind })
    // 打开的历史工作区不在了：只看。再说一句就提醒重开，一次 dsh 都不起
    if (ghost) {
      feed({ type: 'reply', text: t('St803'), taskId: start.runId })
      feed({ type: 'end', status: 'done', taskId: start.runId })
      round.markPrepared()
      if (current === round) current = null
      return
    }
    if (start.place.kind === 'folder' && start.place.dir) {
      try { onFolderStart(start.place.dir) } catch { /* 记不上最近不耽误干活 */ }
    }
    // 排在这条对话上一轮后面：上一轮还没退完就不碰工作区；
    // 等的时候被停了，醒来悄悄收手，一次 runTask 都不起
    const prev = chain
    const tail = (async () => {
      try {
        await prev
        if (round.stopped) return
        await work(start, round)
      } catch (error) {
        if (round.stopped) return
        if (LOCKED.test(String(error?.code || ''))) {
          return fail(round, 'locked', { name: basename(String(error.path || error.dest || '')) })
        }
        fail(round, 'other', { detail: error?.message || '' })
      } finally {
        round.markPrepared() // 没备完就收场了（停下、出错）：等着的插话别一直等
        round.releaseKey?.() // 这一轮排队的位子：不管收没收场都放掉
        round.releaseKey = null
        // 这一轮收场了，后面也没接着的一轮（排队的插话会另起一轮）：告诉对话表
        if (current === round) {
          current = null
          onSettled(self)
        }
      }
    })()
    chain = tail.catch(() => {})
  }

  async function work(start, round) {
    // 开工前先算模型：算不通就照它给的码和停工那句说，不拷文件
    const picked = deps.model?.(start.model ?? null)
    if (!picked?.ok) {
      const reason = picked?.reason || 'key'
      const extra = { code: picked?.code || (reason === 'key' ? 'Si101' : ''), stop: picked?.stop, vars: picked?.vars, detail: picked?.message || '' }
      return fail(round, reason, extra)
    }
    const files = (start.files || []).filter(Boolean)
    // 这一轮交给模型的文件：工作区里的那些副本（当资源链接发过去）
    let roundFiles = []
    let fresh = []
    if (!task?.workspace) {
      feed({ type: 'step', step: 'copy', taskId: round.runId })
      await beat()
      if (round.stopped) return
      // 什么都没拖也建任务文件夹：每个任务自己一个
      const paths = start.place.kind === 'folder' ? [start.place.dir] : files
      const prepared = await deps.prepareTask({ paths, prompt: start.prompt })
      if (round.stopped) return
      if (start.place.kind === 'folder') removeDeleted(prepared, files)
      task = { workspace: prepared.workspace, prepared, sessionId: undefined }
      log('workspace', { dir: prepared.workspace })
      // 这一轮带的文件：气泡里出小块，指向工作区里的那份拷贝
      const chips = chipsOfRound(task, start)
      feed({ type: 'chips', taskId: round.runId, files: chips })
      // 用户给的文件：工作区里的那些副本，交给模型（资源链接）
      roundFiles = copiesOf(task, task.prepared.copied)
      beginHistory(start, task, chips) // 新任务开一条对话记录
    } else {
      // 同一个任务里再说一句：记在同一张对话上。任务文件夹不在了（被人删了）就再建出来接着用
      if (!existsSync(task.workspace)) mkdirSync(task.workspace, { recursive: true })
      ghost = false
      saidReply = 0
      note('setModel', start.model ?? null)
      // 收拾临时文件时副本删掉了的（在后台跑完、离开过）：从「拷过的」里去掉，下面照新挂上的重新拷，并把名字告诉模型
      task.prepared = { ...task.prepared, copied: (task.prepared.copied || []).filter((one) => existsSync(one.to)) }
      const before = task.prepared.copied.length
      roundFiles = freshFiles(deps, task, start.files, log)
      fresh = task.prepared.copied.slice(before)
      // 不是接着同一个会话（模型不记得早先的文件）：工作区里的都发一遍
      if (!(start.resume === true && task.sessionId)) roundFiles = copiesOf(task, task.prepared.copied)
      // 用户在小签里去掉了哪几份：工作区里那份副本也删掉，别让模型还看得见它
      if (start.place.kind === 'files') removeDeleted(task.prepared, files)
      // 这一轮带的文件：气泡里出小块，指向工作区里的那份拷贝
      const chips = chipsOfRound(task, start)
      feed({ type: 'chips', taskId: round.runId, files: chips })
      // 排队的插话已经记过一遍了：别记第二遍。点「继续」记的是按钮上那两个字，不是发给模型的那句
      if (!start.noted) note('say', 'me', start.said || start.prompt, chips)
    }
    // 排队的插话带的那几份文件：跟着那句话一起给模型
    if (start.steered && queuedFiles.length) {
      roundFiles = [...roundFiles, ...queuedFiles]
      queuedFiles = []
    }
    if (start.place.kind === 'files') feed({ type: 'workspace', dir: task.workspace, taskId: round.runId })
    if (round.stopped) return

    // 这一轮的文件里夹着图，而现在的模型看不了图：说一句 St407（图里的内容读不出来，文字照读）
    if (!sees() && imagesIn(start).length) feed({ type: 'note', text: t('St407'), taskId: round.runId })

    feed({ type: 'step', step: 'copy', taskId: round.runId })
    await beat()
    if (round.stopped) return

    // 接着同一个会话说：手里得真有那个会话。上一轮还没起 dsh 就停了，这一轮照新开的走：文件照常备好、整句发过去
    const resume = start.resume === true && Boolean(task.sessionId)
    let prompt = start.prompt
    round.markPrepared()
    // 给模型的话里点到的文件换成工作区里的相对路径（副本在 received\ 里，模型照那个找得到）
    prompt = markReceivedFiles(prompt, task.prepared.copied, task.workspace)
    // 排队的插话带过的文件那一行：文件干活中就拷进去了，上面不会再提，这里接上
    if (start.tail) prompt = `${prompt}\n${start.tail}`

    // 重新打开一份新闻接着说：第一句前面悄悄带一行指路的话，模型拿得到工作区里的整页原文。
    // 每份新闻自己一个文件夹、里面只有一份新闻.md，指不错。这一行不进界面、不进历史，只在打开后的第一句带。
    // 桌伴自己带的话要标出来：模型别当成用户说的。
    if (task.news && !task.newsNoted) {
      prompt = `${t('deskHint')}${t('newsHint', { file: t('report.file') })}\n${prompt}`
      task.newsNoted = true
    }

    // 这一轮用的这把密钥：同一把钥匙同时只能跑几个请求，前面那个没完就排着
    if (deps.keyQueue && picked.entry) {
      try {
        round.releaseKey = await deps.keyQueue.acquire(picked.entry, {
          signal: round.controller.signal,
          onQueued: () => feed({ type: 'note', text: t('St410'), taskId: round.runId }),
        })
      } catch {
        // 排队的时候被停了：这一轮不跑了
        return
      }
      if (round.stopped) {
        round.releaseKey()
        round.releaseKey = null
        return
      }
    }

    round.handle = deps.runTask({
      taskId: round.runId,
      apiKey: picked.apiKey,
      env: picked.env,
      patchTexts: picked.patchTexts,
      model: picked.model,
      vendor: picked.vendor,
      // 外部工具服务：ACP 原生做法，建会话时随参数带给 dsh
      mcpServers: picked.mcpServers,
      // 外部工具服务的钥匙：只在内存里传，用来打码（回复、进度行、报错里不能出现）
      mcpSecrets: picked.mcpSecrets,
      workspace: task.workspace,
      prompt,
      // 用户给的文件：资源链接（看图的模型再带上图片本身）
      files: roundFiles,
      vision: sees(),
      sessionId: resume ? task.sessionId : undefined,
      onEvent: (event) => {
        if (event.type === 'progress') feed({ type: 'progress', text: event.text, taskId: round.runId })
        // 模型在哪一步、静了多久：状态行用，不进日志
        else if (event.type === 'pulse') feed({ type: 'pulse', phase: event.phase, quietSince: event.quietSince, taskId: round.runId })
        else if (event.type === 'reply') feed({ type: 'reply', text: event.text, taskId: round.runId })
        // 模型忙、服务出错、连接断了：dsh 自己要重试，出一行灰字，底下倒数（算的事在 ./wait.mjs）
        else if (event.type === 'retry') feed({ type: 'wait', ...retryWait(event, Date.now()), taskId: round.runId })
        else if (event.type === 'usage') {
          noteUsage(round.utterance, event) // 这一轮的用量记进设置里看的那份
          feed({ ...event, taskId: round.runId })
        }
        else if (event.type === 'artifact') round.artifacts.push(event)
        // 模型交稿了：这几份是成品（卡上写「文件生成」）
        else if (event.type === 'present') round.presented.push(...(event.files || []))
        // 工具调用没成功：都记日志；模型自己读写文件的不在对话里说（见 ./tool-note.mjs），
        // 别的说一句，别让用户以为它拿到了结果
        else if (event.type === 'tool-failed') {
          const quiet = quietToolFail(event.name)
          log('tool-failed', { taskId: round.runId, name: event.name || '', error: event.error || '', quiet })
          const text = quiet ? '' : toolFailNote(deps, event.name, event.input)
          if (text) feed({ type: 'note', text, taskId: round.runId })
        }
        // 外部工具服务的配置 dsh 不认：这一轮没带上它，说一句
        else if (event.type === 'mcp-config-failed') feed({ type: 'note', text: t('St411'), taskId: round.runId })
        // dsh 要权限：不自动拒，弹一张卡给用户点
        else if (event.type === 'permission') {
          const id = typeof event.id === 'string' ? event.id : ''
          if (!id) return
          // 编号里带着 dsh 的会话号：几个会话同时问的时候也知道是哪一条对话的
          perms.set(id, round)
          feed({
            type: 'permission',
            id,
            sessionId: typeof event.sessionId === 'string' ? event.sessionId : '',
            tool: event.tool,
            target: event.target,
            outside: event.outside,
            justification: event.justification,
            taskId: round.runId,
          })
        }
        // dsh 起好了任务名：换掉先占位的第一句话前 16 个字（新闻的名字是「主题 日期」，不换）
        else if (event.type === 'title') { if (!task.news) note('setTitle', event.text) }
        // dsh 那边模型选项变了（热加载）：模型下拉跟着换
        else if (event.type === 'config-options') deps.modelsChanged?.()
        else if (event.type === 'error') round.failure = { ...event, vendor: picked.vendor }
      },
    })
    const end = await round.handle.done
    round.releaseKey?.() // 这一轮完了：位子放掉，后面排着的接着上
    round.releaseKey = null
    for (const [id, one] of perms) if (one === round) perms.delete(id)
    task.sessionId = round.handle.sessionId ?? task.sessionId
    if (task.sessionId) note('setSession', task.sessionId) // 接着聊要接的会话
    round.handle = null // dsh 已结束：这以后点停下走「立刻 cancelled」，不再空喊 cancel
    if (round.stopped || end.status === 'cancelled') {
      // note 说清是谁让停的（设置变化中断：'settings'）
      feed({ type: 'end', status: 'cancelled', taskId: round.runId, ...(end.note ? { note: end.note } : {}) })
      return
    }
    await collect(round, end.status)
    // 插话排队的：这轮干完了，就把那句发出去（接着同一个会话说）
    if (round.queued && end.status === 'done') {
      const text = round.queued
      const tail = round.queuedTail
      const noted = !round.queuedUnnoted
      round.queued = ''
      round.queuedTail = ''
      round.queuedUnnoted = false
      feed({ type: 'send', text, tail, runId: newRunId(), noted, steered: true })
    }
  }

  // 技能装到程序数据目录下的 skills\（跟 app/dsh 那套同一个目录）
  function skillDir() {
    const base = deps.root?.() || ''
    return base ? appPaths(base).skills : ''
  }

  // 关桌伴：这条对话正在跑的那一轮收手
  function quit() {
    if (!current) return
    current.stopped = true
    current.handle?.cancel()
  }

  // 打开一条历史对话：工作区还在就把 task 恢复成那个会话接着聊；
  // 不在了就只读展示，再说一句提醒重开
  function restore(record) {
    const workspace = record.resume && typeof record.resume.workspace === 'string' ? record.resume.workspace : ''
    const back = workspace && existsSync(workspace) ? restoreTask(record) : null
    state = restoreState(record)
    ghost = !back
    saidReply = 0
    task = back
    historyId = back ? record.id : null // 接着聊的话记回同一条
    log('history-open', { id: record.id, live: Boolean(back) })
  }

  // 权限申请：用户点了（允许一次 / 本任务都允许 / 拒绝），回给 dsh
  async function answerPermission(id, decision) {
    const round = perms.get(id)
    if (!round) return { ok: false }
    perms.delete(id)
    feed({ type: 'permission-answered', id, taskId: round.runId })
    if (!round.handle || typeof round.handle.answerPermission !== 'function') return { ok: false }
    try {
      const res = await round.handle.answerPermission(id, decision)
      // 小岛回到「干活中」：等确认那阵过去了
      deps.onPet?.({ type: 'progress', taskId: round.runId, text: '' })
      return res
    } catch (error) {
      log('permission-failed', { error: error?.message || '' })
      return { ok: false }
    }
  }

  const self = {
    feed,
    stop,
    quit,
    restore,
    tidy,
    steer: (text) => steerNow(text),
    answerPermission: (id, decision) => answerPermission(id, decision),
    hasPermission: (id) => perms.has(id),
    install: (id) => void installFlow.install(id),
    decline: (id) => installFlow.decline(id),
    state: () => state,
    // 正在干活：切走了也在后台接着跑
    running: () => state.phase === 'working',
    // 这一轮的事件是不是这条对话的
    owns: (taskId) => Boolean(taskId) && state.runId === taskId,
    historyId: () => historyId,
    workspace: () => task?.workspace || '',
    sees,
  }
  return self
}
