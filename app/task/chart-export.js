// 图导成 PNG：统计图和流程图都是 SVG，画到 canvas 上转成 PNG（2 倍大小、白底、四周留 16px）。
// 页面代码：不引 node:、不引 electron。
//
// 颜色和字体先从页面上抄进 SVG 里：不抄，导出来就是黑字新罗马。

const SCALE = 2
const PAD = 16
// 抄进 SVG 的样式：颜色、线、字
const PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'stroke-opacity', 'opacity', 'color', 'font-family', 'font-size',
  'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'stop-color', 'stop-opacity',
]

// 用户右键的是哪张图：主进程让页面导图时，页面要知道导哪一张
let target = null

export function setChartTarget(one) {
  target = one
}

export function getChartTarget() {
  return target
}

// 图有多大：先看 viewBox，再看宽高属性，最后量屏幕上的
function svgSize(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal
  if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height }
  const width = parseFloat(svg.getAttribute('width') || '')
  const height = parseFloat(svg.getAttribute('height') || '')
  if (width > 0 && height > 0) return { width, height }
  const rect = svg.getBoundingClientRect()
  return { width: rect.width || 640, height: rect.height || 250 }
}

// 把这张图备成能画成 PNG 的样子：样式抄进副本，记下大小
export function svgSource(svg) {
  const clone = svg.cloneNode(true)
  const from = svg.querySelectorAll('*')
  const to = clone.querySelectorAll('*')
  for (let i = 0; i < from.length; i += 1) {
    const style = getComputedStyle(from[i])
    let text = ''
    for (const prop of PROPS) {
      const value = style.getPropertyValue(prop)
      if (value) text += `${prop}:${value};`
    }
    if (text) to[i].setAttribute('style', text)
  }
  const size = svgSize(svg)
  clone.setAttribute('width', String(Math.round(size.width)))
  clone.setAttribute('height', String(Math.round(size.height)))
  // 根上的 max-width 会把图缩窄，导出来就看不清了
  clone.setAttribute('style', 'max-width:none;')
  return { markup: new XMLSerializer().serializeToString(clone), width: size.width, height: size.height }
}

// 备好的 SVG 画成 PNG（data URL）：白底，2 倍，四周留 16px
export async function svgToPng(source) {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source.markup)}`
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('svg image failed'))
    img.src = url
  })
  const width = Math.max(1, Math.round((source.width + PAD * 2) * SCALE))
  const height = Math.max(1, Math.round((source.height + PAD * 2) * SCALE))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, PAD * SCALE, PAD * SCALE, source.width * SCALE, source.height * SCALE)
  return canvas.toDataURL('image/png')
}
