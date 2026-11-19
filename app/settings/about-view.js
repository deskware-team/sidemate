// 「关于」页里「开机时自动打开桌伴」那一行：摆开关、收点击、跟主进程说话。
// 界面代码跑在渲染进程里，这里不碰 electron；主进程那边的开关状态由 IPC 递过来。

// 当前这一行的动作：重画的时候换掉，监听器还是那一个
let current = { onToggle: null }

export function renderLoginItem(state, handlers = {}) {
  const safe = state && typeof state === 'object' ? state : {}
  const input = document.querySelector('#login-item-input')
  if (!input) return null
  // 显示的状态是主进程那边给的（系统里实际的状态）
  input.checked = safe.open === true
  current.onToggle = typeof handlers.onToggle === 'function' ? handlers.onToggle : null
  // 整行是那个勾选框的标签：点标题、点提示都落到勾选框上，勾选框变了才往外说一声。
  // 监听器只挂一次，重画这一行不会变成点一下切两次。
  if (input.getAttribute('data-wired') !== '1') {
    input.setAttribute('data-wired', '1')
    input.addEventListener('change', () => {
      if (typeof current.onToggle === 'function') current.onToggle(input.checked)
    })
  }
  return input
}
