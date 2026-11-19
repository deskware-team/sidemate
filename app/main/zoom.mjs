// 显示的两个档位：字号（任务窗、设置窗、首次运行窗里的字）和小岛大小。
// 这里只有数和换算，不碰 Electron，node --test 直接测。
// 存取在 app/byok/vault.mjs（设置.json），各窗怎么跟着变在 app/main/display.mjs。

// 字号四档：小 0.9 / 标准 1 / 大 1.15 / 特大 1.3
export const FONT_STEPS = [0.9, 1, 1.15, 1.3]

// 小岛三档：小 0.85 / 标准 1 / 大 1.25
export const ISLAND_STEPS = [0.85, 1, 1.25]

// 存的值不在档位里（存坏了、手改了）当标准
export function normalizeStep(value, steps) {
  const n = Number(value)
  return steps.includes(n) ? n : 1
}

// Ctrl 加减：在档位里走一步，dir 是 +1 / -1；到头就停在头一档，不再变
export function stepScale(value, steps, dir) {
  const at = steps.indexOf(normalizeStep(value, steps))
  const next = Math.max(0, Math.min(steps.length - 1, at + (dir >= 0 ? 1 : -1)))
  return steps[next]
}

// 窗口尺寸跟着字号档位放大，但不超过所在屏的工作区：超了就贴工作区，里面出滚动条。
// 宽高各自算，哪边超压哪边。
export function zoomWindowSize({ width, height, scale, workArea }) {
  const size = { width: Math.round(width * scale), height: Math.round(height * scale) }
  if (!workArea) return size
  return {
    width: Math.min(size.width, Math.round(workArea.width)),
    height: Math.min(size.height, Math.round(workArea.height)),
  }
}
