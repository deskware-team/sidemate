// 开机启动：该不该登记、登记什么，都是纯函数，node --test 直接测。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LOGIN_ITEM_ARGS,
  LOGIN_ITEM_NAME,
  applyLoginItem,
  loginItemOpen,
  planLoginItem,
  preferredOpenAtLogin,
  readLoginItem,
  setLoginItem,
} from '../../app/main/login-item.mjs'

// 假的 app：记下写过什么，现状由用例定。
// Windows 上用自定义名字登记的时候，真返回的形状是：
//   { launchItems: [{ name, path, args, scope, enabled }],
//     executableWillLaunchAtLogin: 布尔, openAtLogin: 恒为假 }
function fakeItem({ name = LOGIN_ITEM_NAME, enabled = true } = {}) {
  return { name, path: 'C:\\app\\sidemate.exe', args: [], scope: 'user', enabled }
}

function fakeApp({ packaged = true, launchItems = [], executableWillLaunchAtLogin = false } = {}) {
  const writes = []
  const app = {
    isPackaged: packaged,
    writes,
    getLoginItemSettings() {
      return {
        launchItems: launchItems.map((one) => ({ ...one })),
        executableWillLaunchAtLogin,
        openAtLogin: false,
      }
    },
    setLoginItemSettings(settings) { writes.push(settings) },
  }
  return app
}

test('偏好：没记过就是默认开，记了 false 就是关', () => {
  assert.equal(preferredOpenAtLogin(undefined), true)
  assert.equal(preferredOpenAtLogin(null), true)
  assert.equal(preferredOpenAtLogin(true), true)
  assert.equal(preferredOpenAtLogin(false), false)
  assert.equal(planLoginItem({ packaged: true, pref: undefined }).want, true)
  assert.equal(planLoginItem({ packaged: true, pref: false }).want, false)
})

test('不是打包版：不登记', () => {
  const app = fakeApp({ packaged: false })
  const plan = applyLoginItem(app, { pref: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, false)
  assert.equal(plan.reason, 'not-packaged')
  assert.equal(app.writes.length, 0, '没往系统里写')
})

test('没登记：登记一次，名字和参数对得上', () => {
  const app = fakeApp({ packaged: true, launchItems: [] })
  const plan = applyLoginItem(app, { pref: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, true)
  assert.equal(plan.reason, 'not-registered')
  assert.equal(app.writes.length, 1)
  const written = app.writes[0]
  assert.equal(written.openAtLogin, true)
  assert.equal(written.name, LOGIN_ITEM_NAME)
  assert.equal(written.name, 'sidemate')
  assert.deepEqual(written.args, LOGIN_ITEM_ARGS)
  assert.deepEqual(written.args, ['--login'])
  assert.equal(written.path, 'C:\\app\\sidemate.exe')
})

test('已登记而且开着：不重写注册表', () => {
  const app = fakeApp({
    packaged: true,
    launchItems: [fakeItem({ enabled: true })],
    executableWillLaunchAtLogin: true,
  })
  const plan = applyLoginItem(app, { pref: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, false)
  assert.equal(plan.reason, 'same')
  assert.equal(app.writes.length, 0, '不用每次启动都写')
})

test('已登记但用户在任务管理器里禁了：不重写，也不动用户的决定', () => {
  const app = fakeApp({
    packaged: true,
    launchItems: [fakeItem({ enabled: false })],
    executableWillLaunchAtLogin: false,
  })
  const plan = applyLoginItem(app, { pref: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, false, '不重写')
  assert.equal(app.writes.length, 0)
  const state = readLoginItem(app, { execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(state.registered, true)
  assert.equal(state.enabled, false)
  assert.equal(loginItemOpen(state), false, '开关显示关')
})

test('偏好关了：登记着的写一次关掉', () => {
  const app = fakeApp({
    packaged: true,
    launchItems: [fakeItem({ enabled: true })],
    executableWillLaunchAtLogin: true,
  })
  const plan = applyLoginItem(app, { pref: false, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, true)
  assert.equal(plan.reason, 'differs')
  assert.equal(app.writes.length, 1)
  assert.equal(app.writes[0].openAtLogin, false)
  assert.equal(app.writes[0].name, LOGIN_ITEM_NAME)
})

test('偏好关了但系统里本来就没有：不用写', () => {
  const app = fakeApp({ packaged: true, launchItems: [] })
  const plan = applyLoginItem(app, { pref: false, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(plan.write, false)
  assert.equal(app.writes.length, 0)
})

test('读现状：按名字认自己那一条，不看 openAtLogin', () => {
  const seen = []
  const app = {
    isPackaged: true,
    getLoginItemSettings(options) {
      seen.push(options)
      return {
        launchItems: [fakeItem({ enabled: true })],
        executableWillLaunchAtLogin: true,
        openAtLogin: false,
      }
    },
  }
  const state = readLoginItem(app, { execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(state.registered, true)
  assert.equal(state.enabled, true)
  assert.equal(state.openAtLogin, false, 'Windows 上自定义名字登记时它恒为假')
  assert.equal(loginItemOpen(state), true)
  assert.equal(seen[0].path, 'C:\\app\\sidemate.exe')
  assert.deepEqual(seen[0].args, ['--login'])
  assert.equal(seen[0].name, LOGIN_ITEM_NAME)
})

test('读现状：launchItems 里没有自己那一条就是没登记', () => {
  const app = fakeApp({
    packaged: true,
    launchItems: [fakeItem({ name: '别的程序', enabled: true })],
    executableWillLaunchAtLogin: true,
  })
  const state = readLoginItem(app, { execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(state.registered, false)
  assert.equal(loginItemOpen(state), false)
})

test('开关显示的状态：登记着而且没被禁才是开', () => {
  assert.equal(loginItemOpen({ registered: true, enabled: true }), true)
  assert.equal(loginItemOpen({ registered: true, enabled: false }), false)
  assert.equal(loginItemOpen({ registered: false, enabled: false }), false)
  assert.equal(loginItemOpen({ registered: false, enabled: true }), false)
  assert.equal(loginItemOpen(null), false)
})

test('用户拨开关：重新登记一次', () => {
  const app = fakeApp({ packaged: true, launchItems: [] })
  const back = setLoginItem(app, { openAtLogin: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(back.ok, true)
  assert.equal(app.writes.length, 1)
  assert.equal(app.writes[0].openAtLogin, true)
  assert.equal(app.writes[0].name, 'sidemate')

  const off = fakeApp({ packaged: true, launchItems: [fakeItem({ enabled: true })] })
  const offBack = setLoginItem(off, { openAtLogin: false, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(offBack.ok, true)
  assert.equal(off.writes[0].openAtLogin, false)

  const dev = fakeApp({ packaged: false })
  const devBack = setLoginItem(dev, { openAtLogin: true, execPath: 'C:\\app\\sidemate.exe' })
  assert.equal(devBack.ok, false)
  assert.equal(dev.writes.length, 0, '开发时不登记')
})
