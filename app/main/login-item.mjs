// 开机启动（登录以后自动打开桌伴）：该不该登记、登记什么，都在这一层算。
// 这一层不引 electron：电子那层把 app 对象递进来，node --test 直接测。
// 登记的名字和参数跟 build/installer.nsh 里删的那两条注册表值对得上。

// 登记的名字：Windows「启动应用」里显示的那一条
export const LOGIN_ITEM_NAME = 'sidemate'
// 带的参数：带着这个参数起来的是开机启动那次，只出小岛
export const LOGIN_ITEM_ARGS = ['--login']

// 偏好：没这一项 = 默认开
export function preferredOpenAtLogin(pref) {
  if (pref === undefined || pref === null) return true
  return pref === true
}

// 该不该登记、登记什么：
//   packaged 假 = 开发时不登记（别把开发用的 electron 登记进去）
//   current   = 现在系统里是不是已经登记着（登记着但被用户禁了也算登记着）
//   跟现状一样就不写注册表；登记着但用户禁了也不动（尊重用户在任务管理器里的选择）
export function planLoginItem({ packaged = false, pref = null, current = null, execPath = '' } = {}) {
  const want = preferredOpenAtLogin(pref)
  const settings = {
    openAtLogin: want,
    name: LOGIN_ITEM_NAME,
    path: execPath,
    args: [...LOGIN_ITEM_ARGS],
  }
  if (!packaged) return { write: false, want, reason: 'not-packaged', settings }
  const registered = current === true
  if (!registered) {
    // 没登记着：想开就登记一次；想关也不用写（本来就没有）
    return { write: want, want, reason: 'not-registered', settings }
  }
  if (!want) {
    // 登记着但偏好关了：写一次关掉，把那条登记撤了
    return { write: true, want, reason: 'differs', settings }
  }
  // 登记着（不管用户禁没禁）：不动
  return { write: false, want, reason: 'same', settings }
}

// 系统里现在的登记状态。
// Windows 上：用自定义名字登记的时候 openAtLogin 永远是假的，
// 真状态在 launchItems 里（按名字认自己那一条）和 executableWillLaunchAtLogin 里。
export function readLoginItem(app, { execPath = '' } = {}) {
  const empty = { registered: false, enabled: false, executableWillLaunchAtLogin: false, openAtLogin: false }
  if (!app || typeof app.getLoginItemSettings !== 'function') return empty
  try {
    const state = app.getLoginItemSettings({
      path: execPath,
      args: [...LOGIN_ITEM_ARGS],
      name: LOGIN_ITEM_NAME,
    }) || {}
    const items = Array.isArray(state.launchItems) ? state.launchItems : []
    const item = items.find((one) => one && one.name === LOGIN_ITEM_NAME) || null
    const registered = item !== null
    const launch = state.executableWillLaunchAtLogin === true
    // 登记着的那条自己带 enabled：用户在任务管理器里禁了就是假
    const enabled = registered
      ? (typeof item.enabled === 'boolean' ? item.enabled : launch)
      : launch
    return {
      registered,
      enabled,
      executableWillLaunchAtLogin: launch,
      openAtLogin: state.openAtLogin === true,
    }
  } catch {
    return empty
  }
}

// 开关显示的状态：登记着、而且没被用户禁掉，才是开
// （用户在任务管理器「启动应用」里禁了的时候，系统说不会自动起来，那就是关）
export function loginItemOpen(state) {
  if (!state || typeof state !== 'object') return false
  if (state.registered !== true) return false
  return state.enabled === true
}

// 启动时核对一遍：打包了才登记；跟现状一致就不写注册表
export function applyLoginItem(app, { pref = null, execPath = '' } = {}) {
  const packaged = app?.isPackaged === true
  const state = packaged ? readLoginItem(app, { execPath }) : null
  const plan = planLoginItem({ packaged, pref, current: state ? state.registered : null, execPath })
  if (plan.write) {
    try {
      app.setLoginItemSettings(plan.settings)
    } catch {
      // 登记不上就算了：不能因为登记不了就不让桌伴起来
    }
  }
  return plan
}

// 用户在「设置 · 关于」里拨开关：存偏好 + 重新登记
// 拨开时写 openAtLogin:true（默认 enabled:true，会把任务管理器里的禁用取消，这是对的）
export function setLoginItem(app, { openAtLogin = false, execPath = '' } = {}) {
  const settings = {
    openAtLogin: openAtLogin === true,
    name: LOGIN_ITEM_NAME,
    path: execPath,
    args: [...LOGIN_ITEM_ARGS],
  }
  if (app?.isPackaged !== true) return { ok: false, written: false, settings }
  try {
    app.setLoginItemSettings(settings)
  } catch {
    return { ok: false, written: false, settings }
  }
  return { ok: true, written: true, settings }
}
