// 卡顿上报限流：1 分钟最多 10 条，多的丢掉。
// 纯函数式：给 now 就按给的时间算，不引 Date，测试里好定。

export function createJankLimiter({ max = 10, windowMs = 60_000, now = Date.now } = {}) {
  let kept = []
  // 返回 true = 这条放行；false = 太多了，丢掉
  return (t = now()) => {
    const cut = t - windowMs
    kept = kept.filter((x) => x > cut)
    if (kept.length >= max) return false
    kept.push(t)
    return true
  }
}
