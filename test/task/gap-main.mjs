// 任务窗和小岛之间那道缝：整窗测试的主进程入口，做法照 test/pet/menu-main.mjs。
// electron 直接跑这个文件（不跑 app/）：起整个桌伴（隔离的 USERPROFILE 和 userData），
// 把首次运行那扇窗关掉，用真实鼠标点小岛打开任务窗，等垂下来的动画走完，
// 用两个窗口的内容区原点和页面里 #strip / #panel 的 getBoundingClientRect()
// 算「小条底边到面板顶边」的屏幕距离（DIP）；再查两个窗在 Windows 的 z 序里谁在前
// （任务窗要在小岛上面）；再截一张整屏的图（小岛 + 展开的任务窗，存 SIDEMATE_SHOTS），
// 最后点任务窗顶边（落在任务窗里，任务窗不能收）、点小条底边（收回任务窗）。
// 量出来的数和截图写到 SIDEMATE_GAP_RESULT 指的文件，自己 app.quit()。

// 默认导入再解构：纯 node 下 'electron' 只导出可执行文件路径（没有具名导出），
// 具名导入会在链接时就报错；这个文件会被 node --test 当测试扫到，纯 node 下不能炸。
import electron from 'electron'
const { app, BrowserWindow, desktopCapturer, screen } = electron
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const resultFile = process.env.SIDEMATE_GAP_RESULT
const shotsDir = process.env.SIDEMATE_SHOTS || ''
const state = { uncaught: [] }

process.on('uncaughtException', (error) => state.uncaught.push(`${error?.name}: ${error?.message}`))
process.on('unhandledRejection', (reason) => state.uncaught.push(`unhandledRejection: ${reason?.message || String(reason)}`))

// 页面里某个元素的矩形（CSS px，原点在窗的内容区左上）
const rectOf = async (win, selector) => JSON.parse(await win.webContents.executeJavaScript(
  `JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`,
))

// 跑一段 PowerShell：PowerShell 那边出错的时候错误信息有时写不出来（编码不对），
// 所以脚本结尾都写一句 exit 0，返回值看退出码和输出。
const pwsh = (script) => {
  // cwd 放临时目录：PowerShell 会往当前目录里写模块缓存（Microsoft\Windows\PowerShell），
  // 在仓库里跑会拉出一个没用的目录
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', cwd: tmpdir() })
  return {
    ok: run.status === 0,
    status: run.status,
    error: `${run.error?.message || ''}${run.stderr || ''}`.trim(),
    out: String(run.stdout || ''),
  }
}

// 真实鼠标点一下屏幕坐标：SetCursorPos + mouse_event（Win32 那套）。
// sendInputEvent 是把事件直接送进某个窗口的页面，测不出层级；真实点击才看得出
// 这一下到底落在哪个窗上（小岛在小岛那条透明的一截上面的话，点任务窗顶边会打到小岛）。
// 坐标是 DIP，先乘缩放成物理像素；子进程默认可能是 DPI 不感知的（坐标空间被虚拟化），
// 所以先把这条线程设成 per-monitor 感知，坐标才对得上。
const realClick = (x, y) => {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1
  const px = Math.round(x * scale)
  const py = Math.round(y * scale)
  const script = [
    "Add-Type @'",
    'using System;',
    'using System.Drawing;',
    'using System.Runtime.InteropServices;',
    'public class SidemateMouse {',
    '  [DllImport("user32.dll")] public static extern bool SetThreadDpiAwarenessContext(IntPtr v);',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);',
    '}',
    "'@",
    '[SidemateMouse]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null',
    `[SidemateMouse]::SetCursorPos(${px}, ${py}) | Out-Null`,
    'Start-Sleep -Milliseconds 200',
    '[SidemateMouse]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero)',
    'Start-Sleep -Milliseconds 100',
    '[SidemateMouse]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)',
    'exit 0',
  ].join('\n')
  return pwsh(script)
}

// 鼠标现在在哪儿（物理像素）：干完活把指针放回原来的地方
const cursorAt = () => {
  const script = [
    "Add-Type @'",
    'using System;',
    'using System.Drawing;',
    'using System.Runtime.InteropServices;',
    'public class SidemateCursor {',
    '  [DllImport("user32.dll")] public static extern bool SetThreadDpiAwarenessContext(IntPtr v);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '}',
    "'@",
    '[SidemateCursor]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null',
    '$p = New-Object System.Drawing.Point',
    '[SidemateCursor]::GetCursorPos([ref]$p) | Out-Null',
    'Write-Output "$($p.X) $($p.Y)"',
    'exit 0',
  ].join('\n')
  const run = pwsh(script)
  const [x, y] = run.out.trim().split(/\s+/).map(Number)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

// 指针挪回某个物理坐标（干完活把用户的指针放回原处）
const cursorTo = (x, y) => {
  const script = [
    "Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class SidemateCursorBack {',
    '  [DllImport("user32.dll")] public static extern bool SetThreadDpiAwarenessContext(IntPtr v);',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '}',
    "'@",
    '[SidemateCursorBack]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null',
    `[SidemateCursorBack]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null`,
    'exit 0',
  ].join('\n')
  return pwsh(script)
}

// 两个窗在 Windows 的 z 序里谁在前：从最上面那个往下走一遍（GW_HWNDNEXT = 2，
// 取下一个 = 更下面那个），看两个窗各在第几位，号小的在前。
// Electron 没有查 z 序的接口，只能问 Windows 要。
const zOrder = (hwnds) => {
  const script = [
    "Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class SidemateZ {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);',
    '}',
    "'@",
    '$h = [SidemateZ]::GetTopWindow([IntPtr]::Zero)',
    '$i = 0',
    'while ($h -ne [IntPtr]::Zero -and $i -lt 400) {',
    '  Write-Output ("{0} {1}" -f $i, $h.ToInt64())',
    '  $h = [SidemateZ]::GetWindow($h, 2)',
    '  $i++',
    '}',
    'exit 0',
  ].join('\n')
  const run = pwsh(script)
  const order = []
  for (const line of run.out.split(/\r?\n/)) {
    const [index, hwnd] = line.trim().split(/\s+/)
    if (index !== undefined && hwnd) order.push(Number(hwnd))
  }
  const at = new Map()
  for (const hwnd of hwnds) at.set(Number(hwnd), order.indexOf(Number(hwnd)))
  return { at, size: order.size, error: run.error }
}

// 窗的原生句柄（Win32 的 HWND）
const hwndOf = (win) => {
  const buf = win.getNativeWindowHandle()
  return buf.length >= 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE()
}

async function main() {
  // 用户原来把指针放在哪儿：干完活放回去
  const cursor0 = cursorAt()

  // 起整个桌伴
  await import(new URL('../../app/main/main.mjs', import.meta.url).href)

  // 等小岛窗口加载完（最多约 20 秒）
  let pet = null
  for (let i = 0; i < 100 && !pet; i++) {
    await sleep(200)
    pet = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed() && one.webContents.getURL().includes('pet.html') && !one.webContents.isLoading())
  }
  if (!pet) {
    state.uncaught.push('没等到小岛窗口')
    return finish()
  }

  // 首次运行那扇窗（byok 的 page.html）关掉：只留小岛，截图里也干净
  for (const one of BrowserWindow.getAllWindows()) {
    if (one === pet || one.isDestroyed()) continue
    const url = one.webContents.getURL()
    if (!url.includes('task.html')) one.close()
  }

  // 等小岛露脸（出场动画走完再点，不然那一下点在还没出现的地方）
  for (let i = 0; i < 60 && !pet.isVisible(); i++) await sleep(200)
  // 等小岛停稳：位置还在变说明它还在滑，这一下会点空
  let lastBox = ''
  let stable = 0
  for (let i = 0; i < 100 && stable < 3; i++) {
    const box = pet.getContentBounds()
    const key = `${box.x},${box.y},${box.width},${box.height}`
    stable = key === lastBox ? stable + 1 : 0
    lastBox = key
    await sleep(200)
  }
  await sleep(500)

  // 真实鼠标点小岛正中：和真人按一下是同一条路
  const [width, height] = pet.getContentSize()
  const petBox0 = pet.getContentBounds()
  state.open = realClick(petBox0.x + Math.floor(width / 2), petBox0.y + Math.floor(height / 2))

  // 等任务窗露脸（建窗到页面说准备好了才 show，最多约 20 秒）
  let task = null
  for (let i = 0; i < 100 && !task; i++) {
    await sleep(200)
    task = BrowserWindow.getAllWindows().find((one) => !one.isDestroyed() && one.isVisible() && one.webContents.getURL().includes('task.html') && !one.webContents.isLoading())
  }
  if (!task) {
    state.uncaught.push('点了小岛没等到任务窗露脸')
    return finish()
  }
  // 等垂下来的动画走完（win-drop 260ms，留足余量）
  await sleep(1200)

  // 量缝：页面坐标加上窗内容区的原点就是屏幕坐标（DIP），
  // 小条底边和面板顶边各算一条，差就是看得见的那道缝
  const petBox = pet.getContentBounds()
  const taskBox = task.getContentBounds()
  const strip = await rectOf(pet, '#strip')
  const panel = await rectOf(task, '#panel')
  const stripBottom = petBox.y + strip.bottom
  const panelTop = taskBox.y + panel.top
  state.gap = Math.round((panelTop - stripBottom) * 10) / 10
  state.measure = {
    petBox, taskBox,
    stripBottom, panelTop,
    strip: { bottom: strip.bottom, height: strip.height },
    panel: { top: panel.top, height: panel.height },
  }

  // 整屏截一张：小岛 + 展开的任务窗都进画面（SIDEMATE_SHOTS 指到工作区外）
  if (shotsDir) {
    try {
      const bounds = screen.getPrimaryDisplay().bounds
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: bounds.width, height: bounds.height } })
      const pick = sources.find((one) => one.display_id === String(screen.getPrimaryDisplay().id)) || sources[0]
      if (!pick) throw new Error('desktopCapturer 没给出屏幕')
      mkdirSync(shotsDir, { recursive: true })
      state.shot = join(shotsDir, '小岛和任务窗的缝.png')
      writeFileSync(state.shot, pick.thumbnail.toPNG())
    } catch (error) {
      state.shotError = error?.message || String(error)
    }
  }

  // 层级：任务窗要在小岛上面。小岛自己抢了层级（这里模拟一下：小岛提到最前），
  // 任务窗得抢回来，不然小岛那条透明的一截压着任务窗顶边，点任务窗顶边会打到小岛。
  const petHwnd = hwndOf(pet)
  const taskHwnd = hwndOf(task)
  const zBefore = zOrder([petHwnd, taskHwnd])
  state.zBefore = { pet: zBefore.at.get(petHwnd), task: zBefore.at.get(taskHwnd), error: zBefore.error }
  pet.setAlwaysOnTop(false)
  pet.setAlwaysOnTop(true, 'screen-saver')
  pet.moveTop()
  await sleep(400)
  const zMid = zOrder([petHwnd, taskHwnd])
  state.zMid = { pet: zMid.at.get(petHwnd), task: zMid.at.get(taskHwnd), error: zMid.error }
  state.focusMid = task.isDestroyed() ? false : task.isFocused()
  state.visibleMid = task.isDestroyed() ? false : task.isVisible()
  await sleep(3000)
  const zAfter = zOrder([petHwnd, taskHwnd])
  state.focusAfter = task.isDestroyed() ? false : task.isFocused()
  state.zAfter = { pet: zAfter.at.get(petHwnd), task: zAfter.at.get(taskHwnd), error: zAfter.error }
  // 号小的在前：任务窗的号得比小岛的小
  state.taskAbove = state.zAfter.task >= 0 && state.zAfter.pet >= 0 && state.zAfter.task < state.zAfter.pet

  // 点任务窗顶边往下 2 DIP：这一下落在任务窗里（面板顶边就贴着窗顶），任务窗不能收
  state.topClick = realClick(taskBox.x + Math.floor(taskBox.width / 2), taskBox.y + 2)
  await sleep(900)
  state.openAfterTopClick = task.isDestroyed() ? false : task.isVisible()
  state.focusAfterTopClick = task.isDestroyed() ? false : task.isFocused()

  // 点看得见的小条底边往上 2 DIP：这一下落在小岛上，任务窗收得回去
  state.barClick = realClick(petBox.x + Math.floor(petBox.width / 2), stripBottom - 2)
  await sleep(1200)
  state.closed = task.isDestroyed() || !task.isVisible()
  // 指针放回原处
  if (cursor0) cursorTo(cursor0.x, cursor0.y)
  finish()
}

function finish() {
  try { writeFileSync(resultFile, `${JSON.stringify(state, null, 2)}\n`) } catch { /* 写不进就算了 */ }
  app.quit()
}

// 只在 Electron 里起窗；纯 node（node --test 把本文件当测试扫）下什么都不做，退出码 0
if (process.versions.electron) {
  // userData 要在 ready 之前换到隔离目录
  if (process.env.SIDEMATE_GAP_USER_DATA) {
    app.setPath('userData', process.env.SIDEMATE_GAP_USER_DATA)
    mkdirSync(process.env.SIDEMATE_GAP_USER_DATA, { recursive: true })
  }
  app.whenReady().then(() => main().catch((error) => { console.error(error); finish() }))
}
