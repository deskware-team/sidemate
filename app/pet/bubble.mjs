// 冒的那一行：五个状态各一行字，末尾可能有能点的「打开」「去设置」。
// 这一行只在鼠标停着（小岛张着）的时候出现；有事不自动冒字。
// 有新新闻（红点亮着）的时候换成新闻那句（但在等用户做事的 look / confirm 除外）。字是状态码 St7xx（app/copy/status.mjs），
// 「打开」「去设置」两个按钮是界面文案（app/copy/ui-desk.mjs）。
// 纯函数，不碰 electron，好测。

// 干活中那行后面的秒数：1 分 20 秒
import { elapsedText } from '../task/timing.mjs'
import { secondsLeft, waitHead } from '../task/wait.mjs'
import { t } from '../copy/copy.mjs'

export { elapsedText }

export const SAY = {
  // 干活中：执行中 · 跑了多久（还没开始计时就只说执行中）
  work: (elapsed) => (elapsed ? t('St701', { elapsed }) : t('St103')),
  // 两个以上任务同时在跑（切走的在后台接着跑）：执行中 · N 个任务
  many: (count) => t('St708', { count }),
  // 在等重试：头一截照错的种类跟任务窗那行一样（模型忙 / 模型服务出错 / 模型连接中断），
  // 后面是「N 秒后重试」，倒数到 0 是重新连接中
  wait: (left, kind = '') => `${waitHead(kind)}${left > 0 ? t('St702.after', { left }) : t('St306')}`,
  news: t('St703'),
  look: t('St704'),
  // 有任务在等确认：等你确认
  confirm: t('perm.wait'),
  done: t('St705'),
  fail: t('St706'),
  // 平时：几句轮换，每次张开换一句（页面那头换）；现在干活的模型能看图才加最后那句
  tips: [t('St707'), t('St707.click'), t('St707.right')],
  imageTip: t('St707.image'),
}

export function bubbleOf(state, now = Date.now()) {
  const mode = state?.mode || 'idle'
  const artifact = (state?.artifact || '').trim()
  const elapsed = (state?.elapsed || '').trim()
  // 干活中只说「执行中 · 跑了多久」；在等重试就说还有几秒；两个以上任务在跑就说几个
  if (mode === 'work') {
    const running = Number(state?.running) || 0
    if (running > 1) return { text: SAY.many(running), actions: [] }
    const wait = Number(state?.wait) || 0
    return { text: wait ? SAY.wait(secondsLeft(wait, now), state?.waitKind || '') : SAY.work(elapsed), actions: [] }
  }
  // 有新新闻：停上来冒的那行换成新闻那句（点一下就开）
  // 顺序：work > confirm > look > 新闻 > done > fail > 平时那几句
  // confirm（等用户确认权限）和 look（任务在问用户问题）是在等用户做事，
  // 不能被新闻盖掉，所以这两句排在新闻前面
  if (mode === 'confirm') return { text: state?.message || SAY.confirm, actions: [] }
  if (mode === 'look') return { text: SAY.look, actions: [] }
  if (state?.news === true) return { text: SAY.news, actions: [] }
  // 做完了：有产出才给「打开文件夹」（开的是成品所在的那个文件夹）
  if (mode === 'done') return { text: SAY.done, actions: artifact ? [{ id: 'open', label: t('top.openFolder') }] : [] }
  if (mode === 'fail') return { text: SAY.fail, actions: [{ id: 'settings', label: t('desk.goSettings') }] }
  const tips = state?.sees === true ? [...SAY.tips, SAY.imageTip] : SAY.tips.slice()
  return { text: tips[0], actions: [], tips }
}
