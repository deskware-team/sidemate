// 睡着的呼吸（省电）：不用一直不停的 CSS 动画了——透明、置顶的小窗上
// 无限动画让 GPU 进程每帧都在合成，睡着要烧一个核的 16–21%（docs/0.4/小岛-CPU-实测.md）。
// 改成低频定时器：每 1000/fps 毫秒算一次 offset 写出去，没有 CSS transition，一档一档跳；
// 幅度只有零点几像素、一秒才 2 次，看不出跳。页面模块：不引 node: 和 electron，
// 定时器、时钟、写入都从外面传（测试里传假的）。

// fps 默认 2（省电第二步）：睡着剩下的账就在呼吸一秒写 4 次
// （docs/0.4/小岛-CPU-实测.md「修过以后」：修完还剩 1.62%）；幅度零点几像素，一秒 2 档看不出区别。
export function createBreath({ write, setTimer, clearTimer, now, fps = 2, periodSec = 4.5, amp }) {
  const intervalMs = 1000 / fps
  let timerId = null
  let startedAt = 0

  function tick() {
    timerId = null
    const t = (now() - startedAt) / 1000
    write(amp * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / periodSec)))
    timerId = setTimer(tick, intervalMs)
  }

  return {
    // 开始呼吸。已经在跑就什么都不做（不重置相位：页面每帧调，也只保持这一份定时器）
    start() {
      if (timerId != null) return
      startedAt = now()
      timerId = setTimer(tick, intervalMs)
    },
    // 停：清掉定时器，写一次 0 回去
    stop() {
      if (timerId != null) {
        clearTimer(timerId)
        timerId = null
      }
      write(0)
    },
    get running() {
      return timerId != null
    },
  }
}
