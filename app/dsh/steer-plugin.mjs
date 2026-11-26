// 桌伴自己的 dsh 小插件：源码在这里生成，不进仓库。
// 起 dsh 时按 payload 的实际位置写一份到用户目录下的 patches/，
// 路径不写死在代码里（dsh 换版本、换安装位置都不用改代码）。
//
// 一个插件干四件事（常驻的 dsh 进程里只装一次），补丁还顺手挂上 Office 套件服务：
// 1. 插话：给 ACP 加一个 _sidemate/steer 方法，让插进来的话落到这一轮的下一步。
//    做法：桌伴起 dsh 时多挂一份自己的补丁——关掉原来那行 acp，插桌伴自己的插件行。
//    插件原样转调 @deepseek-ai/dsh-acp（只多给 ACP 加方法），里面按 sessionId 找到那个会话的 agent，调 agent.steer(...)。
// 2. 模式：给 ACP 加一个 _sidemate/mode 方法，把某一个会话切成 dsh 自己的沙箱模式
//    （完全访问）。做法：往那个会话的日志里追加一条 sandbox/mode 事件，
//    dsh 按会话记这条事件，重启后还在，别的会话不受影响。
// 3. 不起名：给 ACP 加一个 _sidemate/quiet_title 方法，把这个会话的名字钉住（用户给的），
//    dsh 就不会再为它多发那一次起名的请求（新闻那一轮用不上名字，省一次调用）。
// 4. 预览：给 ACP 加一个 _sidemate/preview 方法，Word / PPT / Excel 转 PDF、渲 PNG，
//    都交给这个进程里挂着的 Office 套件服务（officeKit），桌伴不自己转
//    （代码从原来的独立小样 preview-plugin.mjs 并进来——两个插件都关 acp 行，同用会抢行号）。
// 补丁里那行 office-kit 是给只挂这一个补丁的场合兜底（桌伴自己的全套补丁里 skill.patch.yml 也挂了它；两处同挂不冲突）。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWhenChanged } from './proc.mjs'

// 自定义方法的名字：只有桌伴自己知道，走的是 ACP 的扩展方法那一路
export const STEER_METHOD = '_sidemate/steer'
export const MODE_METHOD = '_sidemate/mode'
export const QUIET_TITLE_METHOD = '_sidemate/quiet_title'
export const PREVIEW_METHOD = '_sidemate/preview'

// dsh 认识的三个沙箱模式
export const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access']

// payload 里 dsh 的依赖目录：@deepseek-ai 那些包在 dsh/node_modules 下，ACP SDK 在 node_modules 根上
export function steerRoots(payloadRoot) {
  const modules = join(payloadRoot, 'dsh', 'node_modules')
  return { modules, packages: join(modules, '@deepseek-ai') }
}

// 插件源码：把两个目录填进去，其余照原型那套。
// 插件自己 import payload 里的包，路径是起进程前算出来的实际位置，不是写死的。
export function steerPluginSource(roots) {
  const packages = String(roots?.packages || '').replace(/\\/g, '/')
  const modules = String(roots?.modules || '').replace(/\\/g, '/')
  return `// 桌伴自己的 ACP 桥插件（起 dsh 时生成，路径按 payload 的实际位置填进来）。
// 做的事：
//   1. 在 dsh-acp 建连接之前，给 ACP 加一个自定义请求方法 ${STEER_METHOD}，
//      参数 { sessionId, text, files }，内部按 sessionId 找到那个会话的 agent，调 agent.steer()。
//   2. 再加一个 ${MODE_METHOD}
//      参数 { sessionId, mode }，把那个会话切成 dsh 自己的沙箱模式。
//   3. 再加一个 ${QUIET_TITLE_METHOD}
//      参数 { sessionId, title }，把这个会话的名字钉住，dsh 不再为它多发那次起名的请求。
//   4. 再加一个 ${PREVIEW_METHOD}
//      参数 { path, kind: 'pdf' | 'images', sheet?, range?, pages?, dpi? }：
//      用这个 dsh 进程里挂着的 Office 套件服务（officeKit）把文件转成 PDF 或渲成 PNG，
//      返回输出文件路径和页数。拿不到服务就回明确的错，不自己另起 libreoffice。
//   其余行为完全交给原来的 @deepseek-ai/dsh-acp（这里只是把它的 apply 转手调一次）。
// 为什么这么绕：dsh-acp 自己 new 了一条 JSON-RPC 连接，连接对象没挂到 cordis 上，
// 外部插件拿不到它，也没有官方的「加扩展方法」的口子。ACP SDK 的 AgentApp 支持
// onRequest(自定义方法, 解析函数, 处理函数)，但那个 builder 是 dsh-acp 内部 new 的。
// 所以这里在 import 时把 AgentApp.prototype.connect 换一层：连接之前先注册我们的方法，然后照原样连。
// 这里不许出现钥匙。

import { basename, extname, join, resolve } from 'node:path'
import { mkdtemp, open, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const packagesRoot = resolve('${packages}')
const modulesRoot = resolve('${modules}')

const sdk = await import(pathToFileURL(join(modulesRoot, '@agentclientprotocol/sdk/dist/acp.js')).href)
const wire = await import(pathToFileURL(join(modulesRoot, '@agentclientprotocol/sdk/dist/jsonrpc.js')).href)
const acp = await import(pathToFileURL(join(packagesRoot, 'dsh-acp/lib/index.js')).href)
const llm = await import(pathToFileURL(join(packagesRoot, 'dsh-llm/lib/index.js')).href)

// 插件自己的 ctx（apply 里填）。注册方法时要用它找 agent、取 officeKit。
let bridge = null

// 处理一条插进来的话：找到会话的 agent，把这句话塞进这一轮的下一步。
// 插话带的那几份文件：跟开工时一样是资源链接（这里投成模型看得见的那段字）。
function steer(params) {
  const sessionId = params?.sessionId
  const text = params?.text
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required')
  if (typeof text !== 'string' || text.trim() === '') throw new Error('text is required')
  if (bridge === null) throw new Error('steer bridge is not ready')
  const agent = bridge.agents.get(sessionId)
  if (agent === undefined) throw new Error('unknown session: ' + sessionId)
  const content = [{ type: 'text', text }]
  for (const one of Array.isArray(params?.files) ? params.files : []) {
    const name = typeof one?.name === 'string' ? one.name : ''
    const uri = typeof one?.uri === 'string' ? one.uri : ''
    if (!name || !uri) continue
    content.push({ type: 'text', text: '\\n[resource_link name=' + JSON.stringify(name) + ' uri=' + JSON.stringify(uri) + ']\\n' })
  }
  const message = llm.createUserMessage({
    content,
    source: { kind: 'user' },
  })
  agent.steer(message)
  return { accepted: true }
}

// 切一个会话的沙箱模式：找到那个会话，往它的日志里追加一条 sandbox/mode 事件
function setMode(params) {
  try {
    const sessionId = params?.sessionId
    const mode = params?.mode
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required')
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(mode)) throw new Error('mode is required')
    if (bridge === null) throw new Error('mode bridge is not ready')
    const agent = bridge.agents?.get?.(sessionId)
    if (agent !== undefined && agent !== null) {
      agent.session.append('sandbox/mode', { mode })
      return { mode }
    }
    const session = bridge.sessions?.get?.(sessionId)
    if (session === undefined || session === null) throw new Error('unknown session: ' + sessionId)
    session.append('sandbox/mode', { mode })
    return { mode }
  } catch (error) {
    console.error('mode plugin failed: ' + (error && error.stack ? error.stack : String(error)))
    throw error
  }
}

// 把这个会话的名字钉住（当成用户改过的）：dsh 就不会再为它发那次起名的请求。
// 起名的服务不一定在（哪天组合里没有它）：那时候回 ok:false，不影响其余。
function quietTitle(params) {
  try {
    const sessionId = params?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId is required')
    if (bridge === null) throw new Error('title bridge is not ready')
    const session = bridge.sessions?.get?.(sessionId)
    if (session === undefined || session === null) throw new Error('unknown session: ' + sessionId)
    const title = typeof params?.title === 'string' && params.title.trim() !== '' ? params.title.trim() : 'sidemate'
    const service = bridge.get?.('sessionTitle')
    if (!service) return { ok: false }
    service.rename?.(session, title)
    return { ok: true }
  } catch (error) {
    console.error('quiet title plugin failed: ' + (error && error.stack ? error.stack : String(error)))
    return { ok: false }
  }
}

// 回一句看得懂的错：直接 throw new Error 会被连接那头并成「Internal error」，原文就丢了；
// 用 SDK 自己的 RequestError（带码 -32002，服务器自定义区间）才能把话原样带给调用方。
function reject(message) {
  throw new wire.RequestError(-32002, message)
}

// PDF 落在 Office 套件自己的输出存储里，归这个主顾（保留期/容量由套件自己管）
const OUTPUT_OWNER = 'sidemate-preview'
// 渲图片的几道上限：照 dsh-tool-office 的默认值（模型那边一次渲染也是这个量级）
// 像素上限取套件自己的天花板（16777216）：300 dpi 的一页 A4（约 2480×3508）在里面
const MAX_IMAGES = 20
const MAX_IMAGE_PIXELS = 16777216
const MAX_IMAGE_DIMENSION = 8192
const MAX_IMAGE_BYTES = 67108864

// Office 套件的错（OfficeKitError：码 + 原文）并成一句看得懂的话
function describe(error) {
  const code = error && typeof error.code === 'string' ? error.code : ''
  const text = error && typeof error.message === 'string' ? error.message : String(error)
  return code === '' ? text : code + ': ' + text
}

// 输出文件名：取原件的名字，去掉扩展名换上新的；路径分隔符那些字符换成下划线
function outputName(file, suffix) {
  const full = basename(file)
  const dot = full.lastIndexOf('.')
  const stem = dot > 0 ? full.slice(0, dot) : full
  let safe = ''
  for (const ch of stem === '' ? 'document' : stem) {
    const code = ch.codePointAt(0)
    safe += code < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch
  }
  return safe + suffix
}

// 一份原件的读取凭据：版本号用 mtime+size，读之前再核一遍，换了就当源变了。
// dsh-tool-office 走 ctx.fs 的授权读；这里的预览由桌伴自己点名文件，直接用 node:fs 读，
// key 里不带会话号（桌伴的预览不属于哪一个会话），同一个文件两次预览照样共享套件里按内容算的缓存。
function makeSource(file, info) {
  const version = info.mtimeMs + ':' + info.size
  return {
    key: JSON.stringify(['sidemate-preview', file]),
    version,
    bytes: info.size,
    async read(signal, maxBytes) {
      if (signal && typeof signal.throwIfAborted === 'function') signal.throwIfAborted()
      const again = await stat(file)
      if (again.mtimeMs + ':' + again.size !== version) throw new Error('source-changed: the file changed while reading')
      if (again.size > maxBytes) throw new Error('input-too-large: the source exceeds the reserved read capacity')
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(again.size)
        let length = 0
        while (length < again.size) {
          const part = await handle.read(buffer, length, again.size - length, null)
          if (part.bytesRead === 0) break
          length += part.bytesRead
        }
        if (length !== again.size) throw new Error('source-changed: the file changed while reading')
        return { bytes: buffer, version }
      } finally {
        await handle.close()
      }
    },
  }
}

// 一条预览请求：找到 Office 套件服务，转 PDF 或渲 PNG。
// pdf：套件的 convertTo(format: 'pdf')，PDF 落在套件自己的输出存储里（保留期到了它自己删）。
// images：套件的 renderImages()，PNG 字节写进系统临时目录；xlsx 带图表时转 PDF 会把图表切到两页，
// 所以 xlsx 走这一路；工作表默认渲的是已用区域，图表比已用区域大时要用 sheet+range 点一块更大的区域。
async function preview(params) {
  const raw = typeof params?.path === 'string' ? params.path.trim() : ''
  if (raw === '') reject('path is required')
  const kind = params?.kind
  if (kind !== 'pdf' && kind !== 'images') reject("kind must be 'pdf' or 'images'")
  if (bridge === null) reject('preview bridge is not ready')
  const kit = typeof bridge.get === 'function' ? bridge.get('officeKit') : undefined
  if (kit === undefined || kit === null) {
    reject('office kit is not available in this dsh process (mount @deepseek-ai/dsh-office-kit)')
  }
  const file = resolve(raw)
  let info
  try {
    info = await stat(file)
  } catch {
    reject('cannot read the file: ' + raw)
  }
  if (!info.isFile()) reject('not a regular file: ' + raw)
  const extension = extname(file).slice(1).toLowerCase()
  const source = makeSource(file, info)
  const sheet = typeof params?.sheet === 'string' && params.sheet !== '' ? params.sheet : undefined
  const range = typeof params?.range === 'string' && params.range.trim() !== '' ? params.range.trim().toUpperCase() : undefined
  const pages = Array.isArray(params?.pages)
    ? params.pages.filter((one) => Number.isInteger(one) && one > 0)
    : undefined
  const dpiNumber = Number(params?.dpi)
  const dpi = Number.isFinite(dpiNumber) && dpiNumber > 0 ? Math.floor(dpiNumber) : undefined
  try {
    if (kind === 'pdf') {
      const result = await kit.convertTo({
        extension,
        source,
        format: 'pdf',
        output: { owner: OUTPUT_OWNER, name: outputName(file, '.pdf') },
      })
      return {
        kind: 'pdf',
        path: result.path,
        pages: Number(result.pageCount) || 0,
        bytes: Number(result.bytes) || 0,
        missingFonts: Array.isArray(result.missingFonts) ? result.missingFonts : [],
      }
    }
    const result = await kit.renderImages({
      extension,
      source,
      ...(pages === undefined ? {} : { pages }),
      ...(sheet === undefined ? {} : { sheet }),
      ...(range === undefined || sheet === undefined ? {} : { range }),
      ...(dpi === undefined ? {} : { dpi }),
      maxImages: MAX_IMAGES,
      maxPixels: MAX_IMAGE_PIXELS,
      maxDimension: MAX_IMAGE_DIMENSION,
      maxBytes: MAX_IMAGE_BYTES,
    })
    const dir = await mkdtemp(join(tmpdir(), 'sidemate-preview-'))
    const images = []
    let index = 0
    for (const one of result.images) {
      index += 1
      const target = join(dir, 'image-' + String(index).padStart(4, '0') + '.png')
      await writeFile(target, one.png)
      images.push({
        file: target,
        bytes: one.png.byteLength,
        width: one.width,
        height: one.height,
        ...(one.page === undefined ? {} : { page: one.page }),
        ...(one.sheet === undefined ? {} : { sheet: one.sheet }),
        ...(one.range === undefined ? {} : { range: one.range }),
      })
    }
    return {
      kind: 'images',
      dir,
      pages: Number(result.pageCount) || images.length,
      dpi: Number(result.dpi) || 0,
      images,
      missingFonts: Array.isArray(result.missingFonts) ? result.missingFonts : [],
    }
  } catch (error) {
    reject('preview failed: ' + describe(error))
  }
}

// 在 dsh-acp 建连接之前挂上我们的方法。
const originalConnect = sdk.AgentApp.prototype.connect
sdk.AgentApp.prototype.connect = function connectWithSidemate(target, options) {
  this.onRequest('${STEER_METHOD}', (params) => params, ({ params }) => steer(params))
  this.onRequest('${MODE_METHOD}', (params) => params, ({ params }) => setMode(params))
  this.onRequest('${QUIET_TITLE_METHOD}', (params) => params, ({ params }) => quietTitle(params))
  this.onRequest('${PREVIEW_METHOD}', (params) => params, ({ params }) => preview(params))
  return originalConnect.call(this, target, options)
}

export const name = acp.name
// 起名的服务不在这儿声明（inject）：它不一定在，声明了会让整个 ACP 插件起不来。
// 用的时候再取（ctx.get）：取不到就当没有起名这一说。
export const inject = [...(acp.inject || [])]
export const Config = acp.Config

export function apply(ctx, config) {
  bridge = ctx
  return acp.apply(ctx, config)
}
`
}

// 补丁文字：关掉原来的 acp 行，插 Office 套件服务那一行和桌伴自己的插件行。
// 插件行的 config 照原样那行写（模型还是原来那个，运行时再切）。
export function steerPatchYaml(pluginPath, config = {}) {
  const provider = typeof config.provider === 'string' && config.provider ? config.provider : 'deepseek-official'
  const model = typeof config.model === 'string' && config.model ? config.model : 'deepseek-v4-flash'
  return [
    '# 桌伴自己的 dsh 补丁：挂上 Office 套件服务，把 acp 那一行换成我们的小插件，',
    '# 给 ACP 加 _sidemate/steer、_sidemate/mode、_sidemate/quiet_title、_sidemate/preview 扩展方法。',
    '- id: acp',
    '  disabled: true',
    '',
    '- insert:',
    "    - id: office-kit",
    "      name: '@deepseek-ai/dsh-office-kit'",
    '',
    '    - id: sidemate-acp',
    `      name: ${JSON.stringify(String(pluginPath))}`,
    '      inject: [acpAppStartup]',
    '      config:',
    `        provider: ${JSON.stringify(provider)}`,
    `        model: ${JSON.stringify(model)}`,
    '',
  ].join('\n')
}

// 日志里不出现 steer / inject 这类内部词：看得懂的就行
export function plainLogText(text) {
  return String(text ?? '')
    .replace(/_sidemate\/steer/gi, 'message')
    .replace(/\bsteer\b/gi, 'message')
    .replace(/\binject\b/gi, 'connect')
}

// 把插件写进 <home>/patches/，返回 { pluginPath, patchText }；写不动就返回 null（这一轮没有插话功能）。
export function writeSteerPlugin({ home, payloadRoot, config } = {}) {
  if (typeof home !== 'string' || home === '') return null
  if (typeof payloadRoot !== 'string' || payloadRoot === '') return null
  const dir = join(home, 'patches')
  const pluginPath = join(dir, 'steer-plugin.mjs')
  try {
    mkdirSync(dir, { recursive: true })
    writeWhenChanged(pluginPath, steerPluginSource(steerRoots(payloadRoot)))
  } catch {
    return null
  }
  return { pluginPath, patchText: steerPatchYaml(pluginPath, config) }
}
