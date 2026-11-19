// 钥匙串：加密后的串（base64）直接存在 model.json 里对应的那一条、或 mcp.json 里对应的那一条。
// 钥匙串不建单独的目录，也不留单独的 .bin 文件。
// 加密走系统的 safeStorage（app/models/system-crypto.mjs 交进来）；这里只管存取。
// 钥匙原文只在这一个模块里解出来过：不进返回值、不进配置文件明文、不进日志。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { t } from '../copy/copy.mjs'
import { defaults } from './catalog.mjs'
import { appPaths } from '../paths.mjs'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
// mcp- 开头的 id 走 mcp.json，别的走 model.json
const MCP_PREFIX = 'mcp-'
const ENV_PREFIX = 'SIDEMATE_KEY_'
// 密文放在条目里的这个字段上
export const SEALED_FIELD = 'sealed'

// 钥匙文件在、但解不开（换了系统、换了用户、文件坏了）时的话。
// 这种不是「没填钥匙」，是填过的那把读不出来了。任务窗停工那句（Si101）和设置·模型页那行共用一句。
export const KEY_BROKEN_MESSAGE = t('stops.keyBroken')

// 钥匙在但读不出来：有密文、读不出。
export function keyBroken(keyring, id) {
  if (!keyring || typeof keyring.has !== 'function') return false
  try {
    if (keyring.has(id) !== true) return false
    return !keyring.read(id)
  } catch {
    return true
  }
}

// 密钥在界面上打码：去掉符号，只露头四个和尾四个
export function maskKey(key) {
  const text = String(key ?? '').trim()
  // 前缀（像 sk- 这种）留着，好让人一眼看出是哪家的
  const match = /^[a-zA-Z]{1,4}[-_]/.exec(text)
  const prefix = match ? match[0] : ''
  const chars = text.slice(prefix.length).replace(/[^0-9a-zA-Z]/g, '')
  if (chars.length < 5) return t('modelPage.maskedShort')
  return prefix + t('modelPage.maskedFormat', { head: chars.slice(0, 4), tail: chars.slice(-4) })
}

// id 只允许小写字母、数字和连字符，避免 '../' 这类路径穿越
function checkId(id) {
  const text = typeof id === 'string' ? id : ''
  if (!ID_RE.test(text)) throw new TypeError('bad key id')
  return text
}

// 环境变量名：c-zhipu-2 → SIDEMATE_KEY_C_ZHIPU_2
export function envName(id) {
  const text = typeof id === 'string' ? id : ''
  if (!ID_RE.test(text)) throw new TypeError('bad key id')
  return `${ENV_PREFIX}${text.toUpperCase().replace(/-/g, '_')}`
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// 先写临时文件再改名顶上：断电不会写坏文件
function writeJson(file, raw) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
}

// model.json 里那条目（模型清单）和 mcp.json 里那条目（外部工具服务）的存取。
// 两边都是「一个数组，条目里有 id」，密文放在条目自己身上。
function entriesIn(raw, listKey) {
  const list = Array.isArray(raw?.[listKey]) ? raw[listKey] : []
  return list
}

// files 给的是 model.json 和 mcp.json 的路径；只给 root 时按程序数据目录算出来。
export function createKeyring({ root, files, crypto } = {}) {
  const paths = files || appPaths(root)
  const catalogFile = String(paths.catalog ?? paths.model ?? '')
  const mcpFile = String(paths.mcp ?? '')

  // 读一条目的密文：null 表示这条没有钥匙
  function sealedOf(raw, listKey, id) {
    const one = entriesIn(raw, listKey).find((entry) => entry && entry.id === id)
    const value = one ? one[SEALED_FIELD] : ''
    return typeof value === 'string' && value !== '' ? value : ''
  }

  // 把密文写进某一条目；条目不在就当没这把钥匙
  function putSealed(raw, listKey, id, sealed) {
    const list = entriesIn(raw, listKey)
    const index = list.findIndex((entry) => entry && entry.id === id)
    if (index < 0) return false
    const next = list.slice()
    if (sealed === null) delete next[index][SEALED_FIELD]
    else next[index] = { ...next[index], [SEALED_FIELD]: sealed }
    raw[listKey] = next
    return true
  }

  // 这一把钥匙在哪个文件里：mcp- 开头的在 mcp.json，别的在 model.json
  function targetOf(id) {
    return id.startsWith(MCP_PREFIX)
      ? { file: mcpFile, listKey: 'mcp' }
      : { file: catalogFile, listKey: 'entries' }
  }

  function available() {
    try {
      return typeof crypto?.available === 'function' && crypto.available() === true
    } catch {
      return false
    }
  }

  // model.json 可能还没有（第一次用），这时从初始清单起头，deepseek 那条总在
  function catalogRaw() {
    const raw = readJson(catalogFile)
    if (Array.isArray(raw.entries)) return raw
    if (existsSync(catalogFile)) return raw
    const base = defaults()
    return { version: 1, default: base.default, entries: base.entries }
  }

  function readSealed(id) {
    const { file, listKey } = targetOf(id)
    if (!file) return ''
    const raw = listKey === 'entries' ? catalogRaw() : readJson(file)
    return sealedOf(raw, listKey, id)
  }

  function writeSealed(id, sealed) {
    const { file, listKey } = targetOf(id)
    if (!file) return false
    const raw = listKey === 'entries' ? catalogRaw() : readJson(file)
    if (!putSealed(raw, listKey, id, sealed)) return false
    writeJson(file, raw)
    return true
  }

  function hasSealed(id) {
    return readSealed(id) !== ''
  }

  function decryptSealed(sealed) {
    if (!sealed || !available()) return null
    try {
      const text = crypto.decrypt(Buffer.from(sealed, 'base64'))
      return text ? String(text) : null
    } catch {
      return null
    }
  }

  function listIds() {
    const ids = new Set()
    const catalog = readJson(catalogFile)
    for (const entry of entriesIn(catalog, 'entries')) {
      if (entry && typeof entry.id === 'string' && entry[SEALED_FIELD]) ids.add(entry.id)
    }
    const mcp = readJson(mcpFile)
    for (const entry of entriesIn(mcp, 'mcp')) {
      if (entry && typeof entry.id === 'string' && entry[SEALED_FIELD]) ids.add(entry.id)
    }
    return [...ids].sort()
  }

  return {
    files: { catalog: catalogFile, mcp: mcpFile },

    // 存一把钥匙：空钥匙、加密不可用、密文里带明文都拒，不落明文
    save(id, key) {
      const name = checkId(id)
      const text = String(key ?? '').trim()
      if (!text) return { ok: false, message: t('probe.empty') }
      if (!available()) return { ok: false, message: t('stops.keyStoreFailed') }
      let sealed
      try {
        sealed = Buffer.from(crypto.encrypt(text))
      } catch {
        return { ok: false, message: t('stops.keyStoreFailed') }
      }
      if (!sealed.length) return { ok: false, message: t('stops.keyStoreFailed') }
      if (sealed.includes(Buffer.from(text, 'utf8'))) {
        return { ok: false, message: t('stops.keyStoreFailed') }
      }
      if (!writeSealed(name, sealed.toString('base64'))) {
        return { ok: false, message: t('stops.keyStoreFailed') }
      }
      return { ok: true }
    },

    // 读一把钥匙：解不开、加密不可用、没有，都返回 null
    read(id) {
      const name = checkId(id)
      return decryptSealed(readSealed(name))
    },

    // 有没有这把钥匙
    has(id) {
      return hasSealed(checkId(id))
    },

    // 删一把钥匙
    remove(id) {
      const name = checkId(id)
      if (!hasSealed(name)) return false
      return writeSealed(name, null)
    },

    // 有钥匙的 id，排序
    list() {
      return listIds()
    },

    // 把有钥匙的 id 变成环境变量表，没钥匙的不出现
    env(ids) {
      const wanted = Array.isArray(ids) ? ids : listIds()
      const out = {}
      for (const id of wanted) {
        const name = checkId(id)
        if (!hasSealed(name)) continue
        const key = decryptSealed(readSealed(name))
        if (!key) continue
        out[envName(name)] = key
      }
      return out
    },
  }
}
