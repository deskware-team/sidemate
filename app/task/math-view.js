// 公式：对话里的 $$...$$、\[...\]、行内 $...$，用 KaTeX 画成式子。
// 第一次遇到公式才把 katex.min.js 和 katex.min.css 插进来（app/vendor/katex），不拖慢任务窗启动。
// 画不出来（库没起来、式子写错）就原样显示那段字，不显示 KaTeX 那套红字报错。
// 页面代码：不引 node:、不引 electron。

const SRC = new URL('../vendor/katex/katex.min.js', import.meta.url).href
const CSS = new URL('../vendor/katex/katex.min.css', import.meta.url).href

let loading = null

function loadKatex() {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = CSS
    document.head.append(link)
    const script = document.createElement('script')
    script.src = SRC
    script.onload = () => resolve(globalThis.katex)
    script.onerror = () => reject(new Error('katex load failed'))
    document.head.append(script)
  })
  return loading
}

// 画成了吗：式子写错时 KaTeX 给的是一段带 katex-error 的红字，那段不算
function drawn(node) {
  return !node.querySelector('.katex-error')
}

// 一个公式：行内是 span，单独一段是 div（居中）。
// 先摆原样的字，库起来了再换成画好的式子；式子写错就留着原样。
// trust: false：式子里不许带链接。throwOnError: false：出错也不抛，自己再拦一道。
export function mathEl(text, display) {
  const source = String(text ?? '')
  const wrap = document.createElement(display ? 'div' : 'span')
  wrap.className = display ? 'math math-block' : 'math math-inline'
  wrap.textContent = source
  void loadKatex().then((katex) => {
    const out = document.createElement(display ? 'div' : 'span')
    try {
      katex.render(source, out, { throwOnError: false, trust: false, displayMode: display === true })
    } catch {
      return // 画不出来：原样留着
    }
    if (!drawn(out)) return // 式子写错：原样留着，不显示红字
    wrap.textContent = ''
    wrap.append(out)
  }).catch(() => {})
  return wrap
}
