// 右键菜单开着没有：开着的时候，任务窗、小岛那些「自己往最前面提」的动作都先停一停，
// 不然任务窗每半秒往最前面提一次，会把刚弹出来的右键菜单盖住。
// 小岛的右键菜单、各窗口里的编辑菜单弹出来时都过一下 trackMenu。

// 菜单收起以后任务窗的定时提层（每半秒一次）自己会接上，不用另外叫。

let open = 0

// 记下这个菜单开、关：菜单弹出前（menu-will-show）加一，收起时（menu-will-close）减一
export function trackMenu(menu) {
  if (!menu || typeof menu.on !== 'function') return menu
  menu.on('menu-will-show', () => { open += 1 })
  menu.on('menu-will-close', () => { open = Math.max(0, open - 1) })
  return menu
}

// 现在有没有右键菜单开着
export function menuOpen() {
  return open > 0
}
