// 页面画的那条对话流：顶栏、对话流、小签行、输入区、产出卡。
// 只算，不碰窗口和文件。字都在 app/copy，路径名字的小工具在 ./paths.mjs。

import { join } from 'node:path'
import { baseName, fitName } from './paths.mjs'
import { appPaths } from '../paths.mjs'
import { pendingFiles } from './pending.mjs'
import { t } from '../copy/copy.mjs'
// 静了多久算「没动静」：跟后台报 pulse 的那个数一致
import { QUIET_MS } from '../dsh/pulse.mjs'


// 图片的扩展名：小签带缩略图、第二行写「图片」
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

// 原始事件流给测试和日志看：只有四个字段，形状不变
const publicItem = (one) => ({
  kind: one.kind,
  text: one.text,
  tail: one.kind === 'reply' && one.ask ? t('flow.askTail') : '',
  buttons: (one.buttons || []).map((b) => ({ action: b.action, label: b.label })),
})

// 小签的样子：贴的那头告诉了 kind 就照它（贴的图 / 贴的长文字），
// 没告诉的（拖进来的文件）自己按扩展名认图。贴的长文字能改回文字。
// lock：干活中这一轮带着的文件锁住不弹菜单；干活中挂上、还没发出去的照样能去掉
function tagOf(entry, lock) {
  const kind = entry.kind === 'text' ? 'text' : IMAGE_EXT.test(entry.name) ? 'image' : ''
  return {
    path: entry.path,
    name: entry.name,
    label: fitName(entry.name, 16),
    kind,
    sub: kind === 'text' ? (entry.sub || '') : kind === 'image' ? t('tag.image') : '',
    thumb: kind === 'image',
    restore: kind === 'text',
    lock,
  }
}

// 产出卡那一行：写这张卡是「文件生成」还是「文件变动」，有几页就再写几页。不写钱、不写用量
function cardOf(c) {
  const pages = c.pages == null || c.pages === '' ? '' : t('output.pages', { count: c.pages })
  // 卡的标题：模型交稿的写「文件生成」，只是文件动了的写「文件变动」
  const title = c.kind === 'changed' ? t('output.changed') : t('output.made')
  return {
    id: c.id,
    name: c.name,
    // 标题是「文件生成」/「文件变动」；文件名单独一行
    label: title,
    path: c.to,
    line: pages ? `${fitName(c.name, 30)} · ${pages}` : fitName(c.name, 30),
    old: !!c.old,
    round: c.round,
    kind: c.kind === 'changed' ? 'changed' : 'made',
  }
}

// 装不装那张确认卡：标签和内容都从状态来，干活中三个按钮都灰
function installBlockOf(one, working) {
  const card = one.install
  return {
    kind: 'install',
    round: one.round,
    install: { ...card, canInstall: card.ok === true, locked: working || card.busy === true },
  }
}

// 气泡里的小块：发出去的文件在工作区里的那份拷贝。图片带缩略图；
// 拷贝不在了（任务文件夹被删、文件被改名）就灰着，点不开。
function filesOf(files, options = {}) {
  const list = Array.isArray(files) ? files : []
  return list.map((one) => {
    const entry = one && typeof one === 'object' ? one : { name: String(one || '') }
    const path = typeof entry.path === 'string' ? entry.path : ''
    const name = typeof entry.name === 'string' && entry.name ? entry.name : (path ? baseName(path) : '')
    const kind = entry.kind === 'image' || entry.kind === 'text' ? entry.kind : ''
    const there = typeof options.exists === 'function' ? options.exists(path) === true : true
    return {
      name,
      label: fitName(name, 16),
      path,
      kind,
      thumb: kind === 'image',
      // 没有拷贝的（压根没拷进去）也算不在了
      missing: !path || !there,
    }
  })
}

// 改文件的工具：write、edit、apply_patch、str_replace_editor 都是动文件，不是跑命令
const FILE_ACTIONS = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor'])

// 权限卡上那句话：是什么操作、哪个文件（跑命令的那些给命令）
// 第二行是模型自己给的理由（有才显示）
function permissionOf(one) {
  const p = one && typeof one === 'object' ? one : {}
  const action = typeof p.action === 'string' ? p.action : ''
  const target = typeof p.target === 'string' ? p.target : ''
  const file = FILE_ACTIONS.has(action)
  const verb = action === 'write' ? t('perm.write') : file ? t('perm.edit') : t('perm.run')
  const where = file ? (p.outside ? t('perm.outside') : t('perm.inside')) : ''
  const text = file ? `${verb}${where}${target}` : target ? t('perm.command', { command: target }) : verb
  const reason = typeof p.justification === 'string' ? p.justification : ''
  return {
    id: typeof p.id === 'string' ? p.id : '',
    text,
    reason: reason ? t('perm.reason', { reason }) : '',
  }
}

// 对话流：一轮里模型说的每一段都成一个气泡，按顺序排；产出卡跟在它那一轮的最后一块后面
function blocksOf(state, cards, options = {}) {
  const items = state.flow
  const byRound = new Map()
  for (const card of cards) {
    const list = byRound.get(card.round) || []
    list.push(card)
    byRound.set(card.round, list)
  }
  const blocks = []
  for (const [index, one] of items.entries()) {
    if (one.kind === 'user') blocks.push({ kind: 'user', round: one.round, text: one.text, files: filesOf(one.files, options) })
    else if (one.kind === 'steer') {
      // 「已发送，正在等待模型响应」只在还没回音时写：模型在这句后面说了话、或者这一轮干完了，就不写了
      const answered = state.phase !== 'working' || items.slice(index + 1).some((next) => next.kind === 'reply')
      blocks.push({ kind: 'steer', round: one.round, text: one.text, status: answered ? '' : one.status || '', files: filesOf(one.files, options) })
    }
    else if (one.kind === 'reply') blocks.push({ kind: 'reply', round: one.round, text: one.text, ask: !!one.ask })
    else if (one.kind === 'note') blocks.push({ kind: 'note', round: one.round, text: one.text, buttons: one.buttons || [] })
    else if (one.kind === 'wait') blocks.push({ kind: 'wait', round: one.round, text: one.text, until: one.until || 0, head: one.head || '', tail: one.tail || '', buttons: one.buttons || [] })
    else if (one.kind === 'install') blocks.push(installBlockOf(one, state.phase === 'working'))
    else if (one.kind === 'permission') blocks.push({ kind: 'permission', round: one.round, permission: permissionOf(one.permission) })
    // 停工那一行不在流里画：画成输入框上方的横幅（bannerOf）
  }
  // 产出卡跟在它那一轮的最后一块后面
  const out = []
  for (let i = 0; i < blocks.length; i++) {
    const one = blocks[i]
    out.push(one)
    const next = blocks[i + 1]
    if (one.round == null) continue
    if (next && next.round === one.round) continue
    for (const card of byRound.get(one.round) || []) out.push({ kind: 'card', round: one.round, card })
  }
  // 干活中：最下面一行，干完就没了。正在等重试的时候，那行等待就是它，两行不同时出现
  const waiting = items.some((one) => one.kind === 'wait')
  if (state.phase === 'working' && !waiting) out.push(workingOf(state))
  return out
}

// 状态区那一行只说一种状态，不带计时：
// 等待模型响应 St101 / 思考中 St102 / 执行中 St103（模型在写、认不出在干什么）/ 调工具和壳自己的步骤直接写在干什么（St2xx）。
// 静了 20 秒以上：「还需要更长时间」「等待模型响应」每 30 秒换一次，quiet 是开始静下来的那一刻，页面自己换
const PULSE_CODE = { wait: 'St101', think: 'St102', write: 'St103' }
function workingOf(state) {
  const base = { kind: 'working', round: state.round, quiet: 0 }
  if (state.quietSince) return { ...base, text: t('St104'), quiet: state.quietSince + QUIET_MS }
  if (PULSE_CODE[state.pulse]) return { ...base, text: t(PULSE_CODE[state.pulse]) }
  if (state.step) return { ...base, text: state.step }
  return { ...base, text: t(state.pulse === 'tool' ? 'St103' : 'St101') }
}

// 输入框上方那句话：还没发出去的图、扫描的 PDF，现在的模型看不了内容。
// 这一句是拦着的：带着这几份就发不出去（去掉这几份、或者换成能看图的模型才能发）。
// 发出去以后（名字进了「我说的」那一条）就没了；干活中插话带着图也一样拦。
// unseen 是壳给的：这几份里哪几份现在的模型读不了内容；hasVision：配没配能看图的模型
function remindOf(state, options) {
  if (typeof options.unseen !== 'function') return null
  const fresh = pendingFiles(state)
  const names = fresh.length ? options.unseen(fresh) || [] : []
  if (!names.length) return null
  // 配了能看图的模型、只是没选它：打开换模型的菜单去选；一个都没配：去设置·模型里配
  if (typeof options.hasVision === 'function' && options.hasVision() === true) {
    return { text: t('St601'), label: t('input.unseenPickGo'), action: 'models', block: true }
  }
  return { text: t('St601'), label: t('input.unseenSetGo'), action: 'settings', block: true }
}

// 输入框上方那一条：报错（这一轮停了：红色横幅，带去设置、重来这些按钮）或者
// 提示（不停：灰色一行，带 ×，点掉或者发下一句就收起）。两种都有只给报错。
function bannerOf(state) {
  if (state.phase === 'error' || state.phase === 'paused') {
    let stop = null
    for (const one of state.flow) if (one.kind === 'error' && one.round === state.round) stop = one
    if (stop) return { level: 'block', text: stop.text, code: stop.code || '', raw: stop.raw || '', buttons: stop.buttons || [] }
  }
  const one = state.notice
  if (one && one.text) return { level: 'notice', text: one.text, code: one.code || '', raw: one.raw || '', buttons: [] }
  return null
}

// 占位字什么时候都是同一句。干活中：输入框不锁——能打字、能发，发出去的是插进去的那一句；停下另有一个钮。
function inputOf(phase) {
  const hint = t('input.hint')
  if (phase === 'working') return { mode: 'working', hint, button: 'send', canSend: true, focus: false }
  if (phase === 'paused') return { mode: 'paused', hint, button: 'continue', canSend: true, focus: false }
  if (phase === 'asking') return { mode: 'ask', hint, button: 'send', canSend: true, focus: true }
  if (phase === 'empty') return { mode: 'empty', hint, button: 'send', canSend: true, focus: false }
  if (phase === 'ready') return { mode: 'files', hint, button: 'send', canSend: true, focus: true }
  return { mode: 'continue', hint, button: 'send', canSend: true, focus: false }
}

// 卡二只认这个形状，页面上每个字都从这里出
export function toTaskView(state, options = {}) {
  const root = options.root || ''
  const recent = Array.isArray(options.recent) ? options.recent : []
  const recentTasks = Array.isArray(options.recentTasks) ? options.recentTasks : []
  const phase = state.phase
  let path
  if (!state.place.dir) {
    // 还没开工、任务文件夹还没建：写「任务列表」，点小图标打开程序数据目录的 tasks\
    const tasks = root ? appPaths(root).tasks : ''
    path = { text: t('top.tasks'), title: tasks || t('top.tasks'), open: tasks }
  } else {
    // 开工以后胶囊上照样写「任务列表」（点开是历史下拉）；任务文件夹的路径只在停上去的提示里，小图标打开它
    path = { text: t('top.tasks'), title: state.place.dir, open: state.place.dir }
  }
  const cards = state.cards.map(cardOf)
  // 顶栏那个「预览」按钮：这次对话有成品或材料才显示（主进程算好，页面只管显示）
  const preview = options.preview && typeof options.preview.path === 'string' ? options.preview : { path: '', count: 0 }
  // 干活中：还没发出去的（干活中挂上的）不锁，其余锁住
  const waiting = phase === 'working' ? new Set(pendingFiles(state).map((one) => one.path)) : null
  const tags = state.files.map((one) => tagOf(one, Boolean(waiting) && !waiting.has(one.path)))
  // 输入框上方那句话：图、扫描件现在的模型看不了（带一个入口）
  const remind = remindOf(state, options)
  // 拦着：现在的模型看不了图，而这几份还没发出去：发送钮灰着，回车也发不出去
  const input = inputOf(phase)
  if (remind && remind.block) input.canSend = false
  return {
    phase,
    title: t('sidemate'),
    top: {
      path,
      // 「预览」按钮：这次对话的成品和材料有几份、文件夹在哪
      preview: { path: preview.path, count: Number(preview.count) || 0 },
      // 现在这个任务记在哪条对话上：历史下拉里那一条高亮
      historyId: typeof options.historyId === 'string' ? options.historyId : '',
      recent: {
        items: recent.map((dir) => ({ dir, name: baseName(dir) })),
        tasks: recentTasks.map((one) => ({ dir: one.out, name: fitName(one.name, 40) })),
        allTasks: typeof options.allTasks === 'string' ? options.allTasks : '',
      },
      newTask: t('top.newTask'),
    },
    tags,
    remind,
    // 输入框上方那一条：报错横幅或提示
    banner: bannerOf(state),
    flow: state.flow.map(publicItem),
    blocks: blocksOf(state, cards, options),
    input,
    // 底下这层页面不画：run.mjs 靠它认产出的路径
    bottom: { cards },
    labels: {
      addFile: t('input.fileLabel'), send: t('input.send'), stop: t('input.stop'), latest: t('flow.latest'),
      continue: t('input.continueLabel'),
      reveal: t('output.reveal'), saveAs: t('output.saveAs'), retry: t('output.retry'),
      settings: t('desk.goSettings'), newTask: t('top.newTask'), askTail: t('flow.askTail'),
      dismiss: t('input.dismiss'),
      // 插进去那句话下面一行灰字：插进这一步了、排队，两种都是 St502
      steer: t('St502'),
      tagRemove: t('tag.remove'),
      tagRestore: t('tag.restore'),
      installTitle: t('install.title'), installName: t('install.name'),
      installFrom: t('install.from'), installDoes: t('install.does'),
      installYes: t('install.yes'), installNo: t('install.no'),
      // 权限卡：标题和三个按钮
      permTitle: t('perm.title'), permOnce: t('perm.once'), permAlways: t('perm.always'), permReject: t('perm.reject'),
    },
  }
}
