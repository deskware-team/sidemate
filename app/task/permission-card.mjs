// 权限卡：模型要越过任务文件夹做点什么，来问一声。
// 白底细线圆角，标题 + 一句话（是什么操作、哪个文件）+ 模型给的理由（有才有）+ 三个按钮（允许一次 / 本任务都允许 / 拒绝）。
// 单独一个文件：这张卡的画法跟 task.js 的对话流分开放。

export function permissionEl(block, labels, act) {
  const one = block.permission || {}
  const el = document.createElement('article')
  el.className = 'perm'
  el.dataset.id = one.id || ''
  const title = document.createElement('div')
  title.className = 'ptitle'
  title.textContent = labels.permTitle
  el.append(title)
  const text = document.createElement('div')
  text.className = 'ptext'
  text.textContent = one.text || ''
  el.append(text)
  // 模型自己给的理由：有才显示，当纯文本（模型给的话不当 HTML）
  if (one.reason) {
    const reason = document.createElement('div')
    reason.className = 'ptext'
    reason.textContent = one.reason
    el.append(reason)
  }
  const btns = document.createElement('div')
  btns.className = 'pbtns'
  const add = (label, decision, kind) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = kind
    btn.textContent = label
    btn.addEventListener('click', () => act({ type: 'permission', id: one.id, decision }))
    btns.append(btn)
  }
  add(labels.permOnce, 'once', 'once')
  add(labels.permAlways, 'always', 'always')
  add(labels.permReject, 'reject', 'no')
  el.append(btns)
  return el
}
