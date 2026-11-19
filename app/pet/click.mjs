// 小岛上的两种手势：点一下、拖文件进来。
// 点一下 → 有新早报（红点亮着）就去开最新那份早报的对话，不走开关；
//          没有就照旧：任务窗开着就收起来，收起不到半秒的别再弹出来；
//          打开的时候照旧把「等你一句话」收回去，收起来的时候不动它 —— 活接着干。
//          那一下小岛还要缩到 0.96 再弹回（press）。
// 拖文件 → 照旧打开任务窗，把文件带进去（收窗的事不管）。

export function petClick({ toggle, clearAsk, press, news = false, openNews = null }) {
  // 红点亮着：点一下开最新那份早报的对话。开成没开、红点熄不熄，都由壳那边管
  if (news === true && typeof openNews === 'function') {
    if (typeof press === 'function') press()
    openNews()
    return 'news'
  }
  const what = typeof toggle === 'function' ? toggle() : 'opened'
  if (typeof press === 'function') press()
  if (what === 'opened') clearAsk?.()
  return what
}

export function petDrop({ openTask, clearAsk, paths }) {
  const list = Array.isArray(paths) ? paths : []
  if (!list.length) return false
  openTask({ paths: list })
  clearAsk?.()
  return true
}
