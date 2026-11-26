// 流程图：对话里的 mermaid 代码块，画成图。
// 第一次遇到这种块才把那个打包文件插进来（app/vendor/mermaid），不拖慢任务窗启动；
// 画不出来（语法错）就退回成代码块，不显示它自己的报错图。
// 页面代码：不引 node:、不引 electron。

const SRC = new URL('../vendor/mermaid/mermaid.min.js', import.meta.url).href

let loading = null
let initialized = false
let counter = 0
// 源码 → SVG：同一块画过一次就重用，重画对话流时不闪
const cache = new Map()

function loadMermaid() {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SRC
    script.onload = () => resolve(globalThis.mermaid)
    script.onerror = () => reject(new Error('mermaid load failed'))
    document.head.append(script)
  })
  return loading
}

// 任务窗的几个颜色变量（task.css 里定义）：图里的颜色跟着任务窗走
function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

async function mermaidReady() {
  const mermaid = await loadMermaid()
  if (!initialized) {
    initialized = true
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      fontFamily: cssVar('--font', 'sans-serif'),
      themeVariables: {
        background: cssVar('--card', '#ffffff'),
        mainBkg: cssVar('--card', '#ffffff'),
        primaryColor: cssVar('--card', '#ffffff'),
        primaryTextColor: cssVar('--ink', '#22201c'),
        primaryBorderColor: cssVar('--line', '#e3ded3'),
        secondaryColor: cssVar('--paper', '#f5f1e8'),
        tertiaryColor: cssVar('--paper', '#f5f1e8'),
        clusterBkg: cssVar('--paper', '#f5f1e8'),
        clusterBorder: cssVar('--line', '#e3ded3'),
        edgeLabelBackground: cssVar('--card', '#ffffff'),
        lineColor: cssVar('--ink-faint', '#9a9284'),
        nodeBorder: cssVar('--ink-soft', '#5f5a52'),
        textColor: cssVar('--ink', '#22201c'),
        titleColor: cssVar('--ink', '#22201c'),
        fontFamily: cssVar('--font', 'sans-serif'),
      },
    })
  }
  return mermaid
}

function codeBlock(text) {
  const pre = document.createElement('pre')
  pre.textContent = text
  return pre
}

// 图按自己的大小摆：比气泡宽就在块里横向滚动，不缩成看不清的一团
function naturalSize(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal
  if (!box || !(box.width > 0) || !(box.height > 0)) return
  svg.setAttribute('width', String(box.width))
  svg.setAttribute('height', String(box.height))
}

// 把画好的 SVG 放进块里，按自己的大小摆
function put(wrap, markup) {
  wrap.innerHTML = markup
  const svg = wrap.querySelector('svg')
  if (svg) naturalSize(svg)
}

async function draw(text, wrap) {
  try {
    const mermaid = await mermaidReady()
    counter += 1
    const out = await mermaid.render(`mm${counter}`, text)
    cache.set(text, out.svg)
    put(wrap, out.svg)
  } catch {
    wrap.replaceWith(codeBlock(text))
  }
}

// 一个 mermaid 代码块：画得出来就是图，画不出来就是代码块
export function mermaidEl(text) {
  const wrap = document.createElement('div')
  wrap.className = 'mm'
  const hit = cache.get(text)
  if (hit) {
    put(wrap, hit)
    return wrap
  }
  void draw(text, wrap)
  return wrap
}
