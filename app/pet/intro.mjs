// 首次运行小岛出场：小岛从顶边正中滑下来，冒一行「把文件拖给我试试」。
// 滑下 320ms、出来曲线，从顶边上方 30px 到贴顶；
// 眼睛往上看、落定眨一下换睁眼；停 0.3 秒冒那一行，停 6 秒或鼠标离开就收回。
// 纯函数，不碰 electron，好测。

import { t } from '../copy/copy.mjs'

export const INTRO_LINE = t('island.intro')

export const introTiming = {
  fromOffset: -30, // 从顶边上方 30px
  slideMs: 320, // 滑下来 320ms
  pauseMs: 300, // 落定后停 0.3 秒
  holdMs: 6000, // 冒一行后停 6 秒
  expandMs: 240, // 展开 240ms
  textInMs: 120, // 字最后 120ms 淡入
  collapseMs: 200, // 收回 200ms
}

// 出场还在走吗：换了代（重新开始）或者已经冒完那一行，就别再往下走
// 免得兜底已经把那一行冒出来了，页面后来才回话，又滑一次
export function introAlive(gen, currentGen, busy) {
  return gen === currentGen && Boolean(busy)
}

// 开机那套跟出场撞上了怎么办（页面的 boot 回来得晚，出场先到了）：
// 场景照最新的来，眼神要是出场已经定过了就别盖回去，那一行更别盖回去
export function bootPlan({ introStarted = false, introLineSet = false, bootScene = 'strip', lastScene = 'strip' } = {}) {
  return {
    scene: introStarted ? lastScene : bootScene,
    keepEyes: introStarted,
    setBubble: !introLineSet,
  }
}

// 只放一次：byok 那边记着 introPlayed，放过就不再来一遍
export async function playIntroOnce(played, play) {
  if (played) return false
  try { await play() } catch { /* 大场面没放成也只试这一次 */ }
  return true
}
