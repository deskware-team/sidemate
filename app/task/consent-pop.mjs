// 任务窗里「因为没同意使用须知被拦下」的那一下：立刻弹须知窗；用户同意了，就把原来那句重发一次。
// 同一轮只自动弹一次：弹过没同意，那一行留着，用户自己点「使用须知」再弹。
// 页面（任务窗）也用这个文件：不引 node:，也不引 electron。

// 视图上有没有「要弹须知窗」的那一行：有就返回那一轮的编号，没有就 null
export function consentRound(view) {
  const banner = view && view.banner
  const list = banner && Array.isArray(banner.buttons) ? banner.buttons : []
  const one = list.find((b) => b && b.action === 'consent')
  if (!one) return null
  const round = Number(one.round)
  return Number.isFinite(round) ? round : 0
}

// 弹须知窗：答应返回 true（没有桥、弹不了、用户不同意都是 false）
export async function askConsent(bridge) {
  try {
    return typeof bridge?.consent === 'function' ? (await bridge.consent()) === true : false
  } catch {
    return false
  }
}

// bridge：页面上那个桥（window.task）；act：页面上发动作给主进程的那个口子。
// 答应了就走现有的「重来」那条路：把原来那句重发一次。
export function createConsentGate({ bridge, act } = {}) {
  let asked = -1 // 弹过的那一轮
  let busy = false // 须知窗开着

  async function ask(round, force) {
    if (busy) return false
    if (!force && asked === round) return false
    asked = round
    busy = true
    const agreed = await askConsent(bridge)
    busy = false
    if (agreed !== true) return false
    act?.({ type: 'retry' })
    return true
  }

  return {
    // 自动弹：这一轮只弹一次
    offer: (round) => ask(round, false),
    // 用户自己点的：这一轮也弹
    ask: (round) => ask(round, true),
    asking: () => busy,
  }
}
