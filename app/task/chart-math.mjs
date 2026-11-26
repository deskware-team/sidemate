// 统计图的纯计算：刻度、数字格式、百分比、坐标换算。
// 不碰 DOM、不引 node:：页面那边直接用，测试也直接跑这个文件。

// 刻度：最大值往上取整到一个好看的数，再分成 4–5 格。
// 返回 { max, ticks }：max 是纵轴顶上的数，ticks 是每一格的数（含 0）。
export function niceScale(max, target = 4) {
  const top = Number(max)
  if (!Number.isFinite(top) || top <= 0) return { max: 1, ticks: [0, 1] }
  const steps = Math.max(1, Math.round(target))
  const raw = top / steps
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const limit = Math.ceil(top / step) * step
  const ticks = []
  for (let i = 0; i * step <= limit + step * 1e-9; i += 1) {
    ticks.push(Math.round(i * step * 1e6) / 1e6)
  }
  return { max: limit, ticks }
}

// 数字：千分位；小数最多留两位（2.5 写成 2.5，2.50 写成 2.5）
export function formatNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const rounded = Math.round(n * 100) / 100
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  const int = Math.floor(abs)
  const frac = Math.round((abs - int) * 100)
  const intText = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fracText = frac > 0 ? '.' + String(frac).padStart(2, '0').replace(/0$/, '') : ''
  return sign + intText + fracText
}

// 百分比：占多少，保留一位小数（33.3）
export function percent(value, total) {
  const sum = Number(total)
  if (!Number.isFinite(sum) || sum <= 0) return 0
  const share = (Number(value) / sum) * 100
  if (!Number.isFinite(share)) return 0
  return Math.round(share * 10) / 10
}

// 一个数落在图上哪：0 在底上，max 在顶上
export function yAt(value, max, bottom, height) {
  const top = Number(max)
  if (!Number.isFinite(top) || top <= 0) return bottom
  const n = Number(value)
  if (!Number.isFinite(n)) return bottom
  return bottom - (n / top) * height
}
