// 问一句的弹窗：没有标题，一句话两个钮（「继续保存」/「取消」这类）。
// 设置那边要重起 dsh、要中断正在跑的会话时弹它。返回 true = 照旧做，false = 算了。
// 这一层只碰 DOM：页面在沙箱里跑，引不了带 node 的模块。

import { makeEscStack } from './overlay.js'
import { t } from '../copy/copy.mjs'

// 主进程说「先问一句」：弹窗问用户。点「继续保存/继续删除」才照旧做，点了「取消」就不了。
// 返回最后一份数据；用户取消了就还是原来那一份。
export async function withAsk(back, redo) {
  if (!back || !back.ask) return back
  const kind = back.ask.kind === 'delete' ? 'delete' : 'restart'
  const yes = await openAskDialog({
    text: back.ask.text || '',
    ok: kind === 'delete' ? t('modelPage.deleteAskOk') : t('modelPage.restartAskOk'),
    cancel: kind === 'delete' ? t('modelPage.deleteAskCancel') : t('modelPage.restartAskCancel'),
  })
  if (!yes) return back
  // 存完了才发现热加载没成：这时候只要重起进程，不用再存一遍
  if (back.ask.stage === 'after') return window.settings.restart()
  return redo(true)
}

export function openAskDialog({ text, ok, cancel } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'overlay'
    const dialog = document.createElement('div')
    dialog.className = 'dialog'
    const line = document.createElement('p')
    line.textContent = text || ''
    const actions = document.createElement('div')
    actions.className = 'actions'
    const stack = makeEscStack(document)
    let release = () => {}
    const done = (value) => {
      overlay.remove()
      release()
      resolve(value)
    }
    release = stack.push({ close: () => done(false) })
    const okButton = document.createElement('button')
    okButton.type = 'button'
    okButton.className = 'btn'
    okButton.textContent = ok || ''
    okButton.addEventListener('click', () => done(true))
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'btn'
    cancelButton.textContent = cancel || ''
    cancelButton.addEventListener('click', () => done(false))
    actions.append(okButton, cancelButton)
    dialog.append(line, actions)
    overlay.append(dialog)
    document.body.append(overlay)
  })
}
