// 弹窗的两件共用事：Esc 只关最上面那一层；中间那段内容滚起来时按钮排上方那条线才出现。
// 这一层只碰 DOM，弹窗的三个地方（自定义模型、新闻主题、MCP）都用它，行为一样。

// Esc：一串打开的层，Esc 只关最上面那一层；全关完了把 keydown 监听撤掉
export function makeEscStack(doc) {
  const stack = []
  const onKey = (event) => {
    if (event.key !== 'Escape') return
    const top = stack[stack.length - 1]
    if (top) top.close()
  }
  return {
    // 登记一层，返回一个撤掉这层的函数；最后一层关掉时监听也跟着撤
    push(layer) {
      stack.push(layer)
      if (stack.length === 1) doc.addEventListener('keydown', onKey)
      let released = false
      return function release() {
        if (released) return
        released = true
        const index = stack.indexOf(layer)
        if (index >= 0) stack.splice(index, 1)
        if (stack.length === 0) doc.removeEventListener('keydown', onKey)
      }
    },
  }
}

// 内容滚起来时给弹窗记一个号，CSS 拿它画按钮排上方那条 1px 的线
export function markScroll(dialog, body) {
  const sync = () => {
    const more = body.scrollHeight > body.clientHeight + 1
    dialog.classList.toggle('scrolled', more && body.scrollTop > 0)
  }
  body.addEventListener('scroll', sync)
  sync()
  return sync
}
