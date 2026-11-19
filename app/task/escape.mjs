// 任务窗里按 Esc：弹层、下拉、菜单开着的时候先关它们；都没开就把任务窗收起来
// （跟点小岛收起一样）。输入框里有字也收，字留着不清。
//
// 纯逻辑，不碰 DOM：页面把「谁开着」报进来，这儿算出这一下 Esc 该干什么。

// 这一下 Esc 该关谁：
// history / tag / models：那个弹层、下拉或菜单（先关它们，别顺手把窗也收了）
// input：输入胶囊张着、里面没有字（收胶囊）
// window：任务窗（弹层都没开，收窗；输入框里有字也收，字保留）
export function escapeAction(state = {}) {
  const { history = false, tag = false, models = false, inputOpen = false, inputEmpty = true } = state
  if (history) return 'history'
  if (tag) return 'tag'
  if (models) return 'models'
  if (inputOpen && inputEmpty) return 'input'
  return 'window'
}
