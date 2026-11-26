// 统计图：模型在回话里给的 chart 代码块，画成 SVG。纯 DOM（createElementNS），不引第三方库。
// 颜色、字号都在 task.css 里用 class 给；页面 CSP 不许内联样式。
// 画法：柱状图（纵轴刻度、柱顶数字）、折线图（点、数字）、饼图（百分比），多组时有图例。

import { niceScale, formatNumber, percent, yAt } from './chart-math.mjs'
import { t } from '../copy/copy.mjs'

const NS = 'http://www.w3.org/2000/svg'
const W = 640
const H = 250
const PAD = { top: 24, right: 14, bottom: 40, left: 56 }
// 几套颜色（class c0…c3 / s0…s3）：强调红、墨色、次墨、淡墨
const PALETTE = 4

function svgEl(name, attrs, cls) {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  if (cls) node.setAttribute('class', cls)
  return node
}

function textEl(x, y, content, cls, anchor) {
  const node = svgEl('text', { x, y, 'text-anchor': anchor || 'middle' }, cls)
  node.textContent = content
  return node
}

// 纵轴：网格线、每格的数、零线；单位写在轴的上头
function axis(svg, scale, unit) {
  const x0 = PAD.left
  const x1 = W - PAD.right
  const y1 = H - PAD.bottom
  for (const tick of scale.ticks) {
    const y = yAt(tick, scale.max, y1, y1 - PAD.top)
    svg.append(svgEl('line', { x1: x0, x2: x1, y1: y, y2: y }, 'ch-grid'))
    svg.append(textEl(x0 - 6, y + 4, formatNumber(tick), 'ch-tick', 'end'))
  }
  svg.append(svgEl('line', { x1: x0, x2: x1, y1: y1, y2: y1 }, 'ch-axis'))
  if (unit) svg.append(textEl(x0 - 6, PAD.top - 8, unit, 'ch-unit', 'end'))
}

function maxOf(spec) {
  let max = 0
  for (const one of spec.series) {
    for (const value of one.data) if (value > max) max = value
  }
  return max
}

function barChart(spec) {
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, 'ch-svg')
  const x0 = PAD.left
  const x1 = W - PAD.right
  const y0 = PAD.top
  const y1 = H - PAD.bottom
  const scale = niceScale(maxOf(spec))
  axis(svg, scale, spec.unit)
  const count = spec.categories.length
  const slot = (x1 - x0) / count
  const area = slot * 0.68
  const width = area / spec.series.length
  spec.categories.forEach((name, i) => {
    const group = x0 + i * slot
    const left = group + (slot - area) / 2
    spec.series.forEach((one, j) => {
      const value = one.data[i]
      const height = (value / scale.max) * (y1 - y0)
      const x = left + j * width
      const y = y1 - height
      svg.append(svgEl('rect', { x: x + 1, y, width: Math.max(1, width - 2), height, rx: 2 }, `ch-bar c${j % PALETTE}`))
      svg.append(textEl(x + width / 2, y - 5, formatNumber(value), 'ch-val'))
    })
    svg.append(textEl(group + slot / 2, y1 + 16, name, 'ch-cat'))
  })
  return svg
}

function lineChart(spec) {
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, 'ch-svg')
  const x0 = PAD.left
  const x1 = W - PAD.right
  const y0 = PAD.top
  const y1 = H - PAD.bottom
  const scale = niceScale(maxOf(spec))
  axis(svg, scale, spec.unit)
  const count = spec.categories.length
  const slot = (x1 - x0) / count
  const at = (i) => x0 + (i + 0.5) * slot
  spec.series.forEach((one, j) => {
    const points = one.data.map((value, i) => `${at(i)},${yAt(value, scale.max, y1, y1 - y0)}`)
    svg.append(svgEl('polyline', { points: points.join(' ') }, `ch-line s${j % PALETTE}`))
    one.data.forEach((value, i) => {
      const cy = yAt(value, scale.max, y1, y1 - y0)
      svg.append(svgEl('circle', { cx: at(i), cy, r: 3 }, `ch-dot s${j % PALETTE}`))
      svg.append(textEl(at(i), cy - 8, formatNumber(value), 'ch-val'))
    })
  })
  spec.categories.forEach((name, i) => {
    svg.append(textEl(at(i), y1 + 16, name, 'ch-cat'))
  })
  return svg
}

function pieChart(spec) {
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' }, 'ch-svg')
  const one = spec.series[0]
  const total = one.data.reduce((sum, value) => sum + value, 0)
  const cx = (PAD.left + W - PAD.right) / 2
  const cy = (PAD.top + H - PAD.bottom) / 2
  const r = Math.min(W - PAD.left - PAD.right, H - PAD.top - PAD.bottom) / 2 - 10
  if (total <= 0) return svg
  let angle = -Math.PI / 2
  one.data.forEach((value, i) => {
    const share = value / total
    const next = angle + share * Math.PI * 2
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(next)
    const y2 = cy + r * Math.sin(next)
    const large = share > 0.5 ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    svg.append(svgEl('path', { d: path }, `ch-slice c${i % PALETTE}`))
    const mid = angle + (next - angle) / 2
    // 百分比写在饼外圈（饼上的底色深浅不一，字放外面才都看得清）
    svg.append(textEl(cx + (r + 14) * Math.cos(mid), cy + (r + 14) * Math.sin(mid) + 4, `${percent(value, total)}%`, 'ch-pct'))
    angle = next
  })
  return svg
}

// 图例：柱状图和折线图列各组的名字，饼图列每一块的名字和数
function legendEl(spec) {
  const items = []
  if (spec.type === 'pie') {
    const one = spec.series[0]
    const total = one.data.reduce((sum, value) => sum + value, 0)
    spec.categories.forEach((name, i) => {
      items.push({ color: i % PALETTE, text: `${name} ${formatNumber(one.data[i])}（${percent(one.data[i], total)}%）` })
    })
  } else {
    if (spec.series.length < 2) return null
    spec.series.forEach((one, j) => {
      items.push({ color: j % PALETTE, text: one.name })
    })
  }
  if (!items.length) return null
  const box = document.createElement('div')
  box.className = 'ch-legend'
  for (const one of items) {
    const item = document.createElement('span')
    item.className = 'ch-item'
    const key = document.createElement('i')
    key.className = `ch-key c${one.color}`
    const label = document.createElement('span')
    label.textContent = one.text
    item.append(key, label)
    box.append(item)
  }
  return box
}

// 一张图：标题在上面，图例和出处（source）在下面
export function chartEl(spec) {
  const wrap = document.createElement('div')
  wrap.className = 'ch'
  if (spec.title) {
    const title = document.createElement('div')
    title.className = 'ch-title'
    title.textContent = spec.title
    wrap.append(title)
  }
  const svg = spec.type === 'pie' ? pieChart(spec) : spec.type === 'line' ? lineChart(spec) : barChart(spec)
  wrap.append(svg)
  const legend = legendEl(spec)
  if (legend) wrap.append(legend)
  if (spec.source) {
    const source = document.createElement('div')
    source.className = 'ch-source'
    source.textContent = t('chart.source', { text: spec.source })
    wrap.append(source)
  }
  return wrap
}
