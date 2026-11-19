// 一句话装能力的那一段：模型只写方案 → 出确认卡 → 用户点了才下载 → 装进技能目录。
// 单独一个文件：装能力这摊事跟一轮的流水线（./session.mjs）分开放。

import {
  dropPending,
  dropPlan,
  findPending,
  installPlan,
  planSourceText,
  readPlan,
} from '../abilities/install.mjs'
import { errorText } from './codes.mjs'

export function createInstallFlow(options = {}) {
  const deps = options.deps || {}
  const workspace = typeof options.workspace === 'function' ? options.workspace : () => ''
  const skillDir = typeof options.skillDir === 'function' ? options.skillDir : () => ''
  const log = typeof options.log === 'function' ? options.log : () => {}
  const feed = typeof options.feed === 'function' ? options.feed : () => {}
  // 外部不传就用真那份，测试里换假的
  const findPendingSkill = deps.findPending || findPending
  const readPlanSkill = deps.readPlan || readPlan
  const installPlanSkill = deps.installPlan || installPlan
  const dropPlanSkill = deps.dropPlan || dropPlan
  const dropSkill = deps.dropPending || dropPending

  // 收尾看一眼方案：模型写了一份方案就往对话流里出一张确认卡，装不装由用户点。
  // 没经过用户同意，模型自己下的东西一律不装：收尾删掉，并说一句。
  function offer(taskId) {
    const dir = workspace()
    if (!dir) return
    let found = null
    try {
      found = readPlanSkill(dir)
    } catch (error) {
      log('install-find-failed', { error: error?.message || '' })
    }
    if (found) {
      const plan = found.plan || null
      // 方案哪几条没过只进日志，卡上只写「技能无效」
      log('install-offer', { id: found.id, stage: 'plan', ok: found.ok === true, detail: (found.details || []).join('; ') })
      feed({
        type: 'install',
        taskId,
        install: {
          id: found.id,
          name: plan?.name || found.id,
          // 来源分两截：仓库地址和版本，卡上隔开摆（中间不用「·」）
          source: planSourceText(plan && { ...plan, ref: '' }),
          ref: plan?.ref || '',
          does: plan?.does || '',
          ok: found.ok === true,
          problems: Array.isArray(found.problems) ? found.problems : [],
        },
      })
      return
    }
    // 模型自己下的东西：没问过用户，不装，收尾删掉
    let pending = null
    try {
      pending = findPendingSkill(dir)
    } catch (error) {
      log('install-find-failed', { error: error?.message || '' })
    }
    if (!pending || typeof pending.id !== 'string' || !pending.id) return
    try {
      dropSkill(dir, pending.id)
    } catch (error) {
      log('install-drop-failed', { error: error?.message || '' })
    }
    log('install-dropped', { id: pending.id })
    feed({ type: 'install-note', taskId, id: pending.id })
  }

  // 装上：按方案去下载，装进技能目录。下载要一阵子，卡先锁上。
  async function install(id) {
    const dir = workspace()
    const target = skillDir()
    if (!dir || !target || typeof id !== 'string' || !id) return
    let found = null
    try {
      found = readPlanSkill(dir)
    } catch (error) {
      log('install-find-failed', { error: error?.message || '' })
    }
    // 方案不在了：「安装失败 · Si906 错误」
    if (!found || found.id !== id || found.ok !== true) {
      feed({ type: 'install-fail', id, message: errorText('Si906') })
      return
    }
    feed({ type: 'install-busy', id })
    let back = null
    try {
      back = await installPlanSkill({ id: found.id, plan: found.plan, userDir: target })
    } catch (error) {
      back = { ok: false, message: '', detail: String(error?.message || '') }
    }
    // 细节（哪个文件、哪条规矩、GitHub 回的状态）只进日志
    log('install', { id, ok: back?.ok === true, message: back?.message || '', detail: back?.detail || '', raw: back?.raw || '' })
    // 方案用完就删，工作区里不留
    try {
      dropPlanSkill(dir, id)
    } catch (error) {
      log('install-drop-failed', { error: error?.message || '' })
    }
    if (back?.ok === true) feed({ type: 'install-done', id, message: back.message })
    // 没装成：「那一类 · Si906 错误」（文件过大、技能无效……）；连不上时后面接 GitHub 回的状态：
    // 「连接失败 · Si906 错误，HTTP 503」。说不出是哪一类时前一句照码表说「安装失败」
    else feed({ type: 'install-fail', id, message: errorText('Si906', back?.raw || '', back?.message || '') })
  }

  // 不装：把方案删掉，收卡、说一句
  function decline(id) {
    const dir = workspace()
    if (!dir || typeof id !== 'string' || !id) return
    try {
      dropPlanSkill(dir, id)
    } catch (error) {
      log('install-drop-failed', { error: error?.message || '' })
    }
    feed({ type: 'install-drop', id })
  }

  return { offer, install, decline }
}
