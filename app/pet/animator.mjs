// 引擎和页面之间那一层：没停稳就用 raf 一帧一帧走；停稳了停掉 raf，
// 到点（下一次眨眼 / 下一趟东张西望）用闹钟叫醒，先 motion.skip 实际睡过去的秒数再接着走。
// still（关了显示动画）不走 raf，换神情 / 换视线时 motion.snap 画一帧就停；
// pause（窗口藏起来、收成细线）什么都不跑，回来从现在接着走（睡着那段不补算）。
// 依赖全部从外面传进来（测试里用假的 raf 和假闹钟），不引 node: 和 electron。

// 卡顿观察：这一帧离上一帧超过 150ms 就算卡了一下，
// 把 gapMs 和当时的神情交给 onJank（不传就不管）。重新起步的第一帧不算
// （wake() / onAlarm 把 lastNow 重置了，那不是卡，是刚醒）。
export const JANK_MS = 150

// 帧率封顶（省电第二步）：120Hz 屏 raf 一秒来 120 次，一次眨眼要画 100–260 帧、
// 每帧约 2ms CPU（docs/0.4/小岛-CPU-实测.md「修过以后」）。离上一次真正画不到一帧的间隔
// （留 1ms 余量，免得 60Hz 屏被跳成 30 帧）就只再排一帧，不 tick 不 render；
// lastNow 不动，dt 照真实间隔算，动画快慢不变。
export function createAnimator({ motion, render, raf, caf, setTimer, clearTimer, now = Date.now, gate = null, maxFps = 60, onJank = null }) {
  let pose = null // 正在演的神情（真换了才调 motion.setPose，不重置神情内的时间）
  let lastGaze = null // motion.setPose 会清视线：记住最后一次 setGaze，换神情后重新设上
  let stillOn = false
  let forced = false // 调试台按名字演：按住这个神情，不过节流、也不让到点的换挡把它顶掉
  let paused = false
  let rafId = 0
  let timerId = null
  let armedAt = 0 // 闹钟是几时定的：到点按实际睡了多少 skip（表慢了也补上）
  let lastNow = 0
  let fresh = true // 下一帧是「重新起步」：不算卡顿
  let clockSec = 0 // 页面自己的秒表：gate.want / gate.due 用

  const stopRaf = () => {
    if (rafId) { caf(rafId); rafId = 0 }
  }
  const stopTimer = () => {
    if (timerId != null) { clearTimer(timerId); timerId = null }
  }

  function setMotionPose(name) {
    pose = name
    motion.setPose(name)
    if (lastGaze) motion.setGaze(lastGaze)
  }

  // 干活三件套记着的换挡：每帧问一次 due，到点换上（被按住的神情不让换）
  function askGate() {
    if (!gate || forced) return
    const want = gate.due(clockSec)
    if (want && want !== pose) setMotionPose(want)
  }

  // 一帧：dt 用两帧真正画出来的时间差；停稳了就停 raf，还会变就定一个闹钟
  function step() {
    rafId = 0
    const t = now()
    const gap = t - lastNow
    if (gap > JANK_MS && !fresh && onJank) onJank({ gapMs: Math.round(gap), pose })
    fresh = false
    if (t - lastNow < 1000 / maxFps - 1) {
      rafId = raf(step) // 太快：这一帧不画，接着等下一拍
      return
    }
    const dt = Math.max(0, (t - lastNow) / 1000)
    lastNow = t
    clockSec += dt
    render(motion.tick(dt))
    askGate()
    const wake = motion.wakeIn()
    if (wake > 0) {
      if (Number.isFinite(wake)) {
        armedAt = t
        timerId = setTimer(onAlarm, wake * 1000)
      }
      // 停帧前把余速清干净（rest：settled 时放到目标上、速度清零），再画停下来那一帧
      const final = motion.rest?.()
      if (final) render(final)
      return // Infinity：不会再变，连闹钟都不定
    }
    rafId = raf(step)
  }

  // 闹钟到点：先 skip 睡过去的秒数画一帧，再接着 raf
  function onAlarm() {
    timerId = null
    if (paused || stillOn) return
    const slept = (now() - armedAt) / 1000
    clockSec += slept
    render(motion.skip(slept))
    lastNow = now()
    fresh = true // 闹钟叫醒的第一帧不算卡
    rafId = raf(step)
  }

  // 把循环叫醒：setPose / setGaze / blink 之后都调
  function wake() {
    if (paused) return
    stopTimer()
    if (stillOn) {
      stopRaf()
      render(motion.snap())
      return
    }
    lastNow = now()
    fresh = true // 重新起步的第一帧不算卡
    if (!rafId) rafId = raf(step)
  }

  return {
    // 换神情。干活三件套（读 / 写 / 想）先过 createPoseGate 的节流；
    // force（调试台 forcePose）直接演这个，不节流。
    setPose(name, force = false) {
      forced = Boolean(force)
      const want = forced || !gate ? name : gate.want(name, clockSec)
      if (want !== pose) setMotionPose(want)
      wake()
    },
    // 眼睛跟一个偏移看（null = 不跟了）
    setGaze(offset) {
      lastGaze = offset ? { x: Number(offset.x) || 0, y: Number(offset.y) || 0 } : null
      motion.setGaze(lastGaze)
      wake()
    },
    // 立刻眨一下（引擎自己决定眨不眨得成：正在眨、当前神情不许眨就不眨）
    blink() {
      if (paused || stillOn) return
      motion.blink()
      wake()
    },
    // 关了显示动画：不走 raf，每次 setPose / setGaze 后 snap 一帧就停
    still(on) {
      const next = Boolean(on)
      if (next === stillOn) return
      stillOn = next
      if (next) {
        stopRaf()
        stopTimer()
        render(motion.snap())
        return
      }
      wake()
    },
    // 窗口藏起来、收成细线：什么都不跑；回来从现在接着走
    pause(on) {
      const next = Boolean(on)
      if (next === paused) return
      paused = next
      if (next) {
        stopRaf()
        stopTimer()
        return
      }
      wake()
    },
  }
}
