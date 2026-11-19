// 全屏程序（放 PPT、看视频）会盖住顶边，这时小岛收成 64×4 的细线，鼠标碰一下变回来。
// 前台窗口的矩形和类名直接问 Windows：主进程里用 koffi 调 user32 的
// GetForegroundWindow / GetWindowRect / GetClassName，不起任何子进程。
// 不借 PowerShell 问：-EncodedCommand 加 -ExecutionPolicy Bypass
// 会被火绒 / 360 当可疑脚本拦掉，桌伴那个小功能就废了。
// 类名用来分出桌面（Progman/WorkerW）：桌面虽然也盖满整块屏，但它不算全屏程序。

// 桌面和任务栏自己也是「盖满整块屏」，但它们不算全屏程序
export const DESKTOP_CLASSES = ['Progman', 'WorkerW', 'Shell_TrayWnd']

export function isDesktopClass(name) {
  return DESKTOP_CLASSES.includes(String(name || '').trim())
}

// 前台窗口把整块屏都盖住了（放 PPT、看视频那种）
export function coversDisplay(rect, display, tolerance = 2) {
  if (!rect || !display) return false
  // 点一下桌面时前台窗口就是桌面本身，它的矩形正好是整块屏，不算全屏
  if (isDesktopClass(rect.className)) return false
  return rect.x <= display.x + tolerance
    && rect.y <= display.y + tolerance
    && rect.x + rect.width >= display.x + display.width - tolerance
    && rect.y + rect.height >= display.y + display.height - tolerance
}

// user32 的一层薄壳：拿前台窗口的矩形和类名。
// koffi 是唯一一处外部依赖：装不上就返回 null，全屏检测整个关掉（小岛照常显示）。
let structSeq = 0

export function createUser32(koffi) {
  const user32 = koffi.load('user32.dll')
  // 结构的名字要每次都不一样：koffi 里同一个名字只能登记一次
  const rectStruct = koffi.struct(`SidemateForegroundRect${++structSeq}`, {
    Left: 'int32', Top: 'int32', Right: 'int32', Bottom: 'int32',
  })
  const getForegroundWindow = user32.func('void* GetForegroundWindow()')
  const getWindowRect = user32.func(`int GetWindowRect(void* hwnd, _Out_ ${rectStruct.name}* rect)`)
  const getClassName = user32.func('int GetClassNameW(void* hwnd, void* buf, int max)')
  const getDpiForWindow = user32.func('uint GetDpiForWindow(void* hwnd)')
  // 桌伴这个进程是按显示器缩放着的（Electron 那样），GetWindowRect 给的是物理像素；
  // 桌伴比的是逻辑坐标（跟缩放无关）。临时把这个线程改成「不感知缩放」，
  // 拿回来的就是逻辑坐标——跟从前用 PowerShell 问（它也不感知缩放）一个样。
  // 系统太老没有这个函数就退回到按窗口自己的缩放比例除。
  let setThreadDpi = null
  try {
    setThreadDpi = user32.func('void* SetThreadDpiAwarenessContext(void* ctx)')
  } catch {
    setThreadDpi = null
  }
  const unaware = -1n
  const classBuffer = koffi.alloc('char16_t', 256)
  return {
    getForegroundWindow() {
      return getForegroundWindow()
    },
    getWindowRect(handle) {
      const rect = { Left: 0, Top: 0, Right: 0, Bottom: 0 }
      if (setThreadDpi) {
        const previous = setThreadDpi(unaware)
        try {
          if (!getWindowRect(handle, rect)) return null
        } finally {
          setThreadDpi(previous)
        }
        return rect
      }
      if (!getWindowRect(handle, rect)) return null
      const dpi = Number(getDpiForWindow(handle)) || 96
      const scale = dpi > 96 ? dpi / 96 : 1
      if (scale === 1) return rect
      return {
        Left: rect.Left / scale,
        Top: rect.Top / scale,
        Right: rect.Right / scale,
        Bottom: rect.Bottom / scale,
      }
    },
    getClassName(handle) {
      const length = getClassName(handle, classBuffer, 256)
      if (!length || length < 0) return ''
      return String(koffi.decode.string16(classBuffer, length) || '').trim()
    },
  }
}

// 装 koffi、拿 user32。非 Windows、缺二进制、装不上，一律当作没有全屏检测。
let user32Promise = null

export async function loadUser32() {
  if (process.platform !== 'win32') return null
  if (!user32Promise) {
    user32Promise = (async () => {
      try {
        const mod = await import('koffi')
        const koffi = mod.default ?? mod
        if (!koffi?.load) return null
        return createUser32(koffi)
      } catch {
        return null
      }
    })()
  }
  return user32Promise
}

// 前台窗口的矩形：跟老版本给出去的一样（x / y / width / height / 类名）
export function readForeground(api) {
  if (!api) return null
  const handle = api.getForegroundWindow()
  if (!handle) return null
  const rect = api.getWindowRect(handle)
  if (!rect) return null
  return {
    x: Number(rect.Left) || 0,
    y: Number(rect.Top) || 0,
    width: (Number(rect.Right) || 0) - (Number(rect.Left) || 0),
    height: (Number(rect.Bottom) || 0) - (Number(rect.Top) || 0),
    className: String(api.getClassName(handle) || '').trim(),
  }
}

// 盯着前台窗口：每隔 pollMs 问一次，问到了就交出去。
// 问不到（koffi 装不上、非 Windows）就安静地什么都不做：小岛照常显示，只是不会收成细线。
// options.api 可以塞一份假的 user32 进来（测试用）；options.load 可以换掉装载的办法。
export function watchForeground(onRect, options = {}) {
  const pollMs = options.pollMs ?? 700
  let timer = null
  let stopped = false
  const stop = () => {
    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  const start = (api) => {
    if (stopped || !api) return
    const tick = () => {
      if (stopped) return
      let rect = null
      try {
        rect = readForeground(api)
      } catch {
        return
      }
      if (rect) onRect(rect)
    }
    tick()
    timer = setInterval(tick, pollMs)
    if (typeof timer.unref === 'function') timer.unref()
  }
  if (options.api) {
    start(options.api)
    return stop
  }
  const loader = options.load || loadUser32
  Promise.resolve()
    .then(() => loader())
    .then((api) => start(api))
    .catch(() => {})
  return stop
}
