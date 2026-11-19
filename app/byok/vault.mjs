// 设置文件（settings.json）记四件事：小岛开场放过没有、开机时自动打开桌伴（openAtLogin）、
// 字号和小岛大小两档显示偏好（fontScale / islandScale，档位表在 app/main/zoom.mjs）。
// 钥匙不在这里，在 app/models/keys.mjs 的钥匙串（密文存在 model.json / mcp.json 里）。
// 文件放在程序数据目录 data\ 下，路径从 app/paths.mjs 拿。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { appPaths } from '../paths.mjs'

export function createVault({ root }) {
  const settingsPath = appPaths(root).settings

  function readSettings() {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function writeSettings(patch) {
    mkdirSync(dirname(settingsPath), { recursive: true })
    // 一项一项认：写一项不冲掉别的，别的不写也不删文件
    const current = readSettings()
    const body = {}
    if (current.introPlayed === true || patch.introPlayed === true) body.introPlayed = true
    const open = patch.openAtLogin !== undefined ? patch.openAtLogin : current.openAtLogin
    if (typeof open === 'boolean') body.openAtLogin = open
    for (const key of ['fontScale', 'islandScale']) {
      const value = patch[key] !== undefined ? patch[key] : current[key]
      if (typeof value === 'number' && Number.isFinite(value)) body[key] = value
    }
    writeFileSync(settingsPath, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  }

  return {
    root,
    introPlayed() {
      return readSettings().introPlayed === true
    },
    markIntro() {
      writeSettings({ introPlayed: true })
    },
    // 开机时自动打开桌伴：没这一项 = 默认开（返回 undefined 表示还没记过）
    openAtLogin() {
      const value = readSettings().openAtLogin
      return typeof value === 'boolean' ? value : undefined
    },
    setOpenAtLogin(value) {
      writeSettings({ openAtLogin: value === true })
    },
    // 显示偏好：字号和小岛大小两档。这里只存取原值，档位认不认在 app/main/zoom.mjs 那边判
    fontScale() {
      return readSettings().fontScale
    },
    setFontScale(value) {
      writeSettings({ fontScale: value })
    },
    islandScale() {
      return readSettings().islandScale
    },
    setIslandScale(value) {
      writeSettings({ islandScale: value })
    },
  }
}
