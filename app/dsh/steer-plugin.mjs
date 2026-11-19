// 桌伴自己的 dsh 小插件：源码在这里生成，不进仓库。
// 起 dsh 时按 payload 的实际位置写一份到用户目录下的 patches/，
// 路径不写死在代码里（dsh 换版本、换安装位置都不用改代码）。
//
// 一个插件干两件事（常驻的 dsh 进程里只装一次）：
// 1. 插话：给 ACP 加一个自定义方法，让插进来的话落到这一轮的下一步。
//    做法：桌伴起 dsh 时多挂一份自己的补丁——关掉原来那行 acp，插桌伴自己的插件行。
//    插件原样转调 @deepseek-ai/dsh-acp（只多给 ACP 加一个 _sidemate/steer 方法），
//    里面按 sessionId 找到那个会话的 agent，调 agent.steer(...)。
// 2. 模式：给 ACP 加一个 _sidemate/mode 方法，把某一个会话切成 dsh 自己的沙箱模式
//    （完全访问）。做法：往那个会话的日志里追加一条 sandbox/mode 事件，
//    dsh 按会话记这条事件，重启后还在，别的会话不受影响。
// 3. 不起名：给 ACP 加一个 _sidemate/quiet_title 方法，把这个会话的名字钉住（用户给的），
//    dsh 就不会再为它多发那一次起名的请求（新闻那一轮用不上名字，省一次调用）。

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeWhenChanged } from './proc.mjs'

// 自定义方法的名字：只有桌伴自己知道，走的是 ACP 的扩展方法那一路
export const STEER_METHOD = '_sidemate/steer'
export const MODE_METHOD = '_sidemate/mode'
export const QUIET_TITLE_METHOD = '_sidemate/quiet_title'

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
//   3. 其余行为完全交给原来的 @deepseek-ai/dsh-acp（这里只是把它的 apply 转手调一次）。
// 为什么这么绕：dsh-acp 自己 new 了一条 JSON-RPC 连接，连接对象没挂到 cordis 上，
// 外部插件拿不到它，也没有官方的「加扩展方法」的口子。ACP SDK 的 AgentApp 支持
// onRequest(自定义方法, 解析函数, 处理函数)，但那个 builder 是 dsh-acp 内部 new 的。
// 所以这里在 import 时把 AgentApp.prototype.connect 换一层：连接之前先注册我们的方法，然后照原样连。
// 这里不许出现钥匙。

import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const packagesRoot = resolve('${packages}')
const modulesRoot = resolve('${modules}')

const sdk = await import(pathToFileURL(join(modulesRoot, '@agentclientprotocol/sdk/dist/acp.js')).href)
const acp = await import(pathToFileURL(join(packagesRoot, 'dsh-acp/lib/index.js')).href)
const llm = await import(pathToFileURL(join(packagesRoot, 'dsh-llm/lib/index.js')).href)

// 插件自己的 ctx（apply 里填）。注册方法时要用它找 agent。
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

// 在 dsh-acp 建连接之前挂上我们的方法。
const originalConnect = sdk.AgentApp.prototype.connect
sdk.AgentApp.prototype.connect = function connectWithSteer(target, options) {
  this.onRequest('${STEER_METHOD}', (params) => params, ({ params }) => steer(params))
  this.onRequest('${MODE_METHOD}', (params) => params, ({ params }) => setMode(params))
  this.onRequest('${QUIET_TITLE_METHOD}', (params) => params, ({ params }) => quietTitle(params))
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

// 补丁文字：关掉原来的 acp 行，插桌伴自己的插件行。
// 插件行的 config 照原样那行写（模型还是原来那个，运行时再切）。
export function steerPatchYaml(pluginPath, config = {}) {
  const provider = typeof config.provider === 'string' && config.provider ? config.provider : 'deepseek-official'
  const model = typeof config.model === 'string' && config.model ? config.model : 'deepseek-v4-flash'
  return [
    '# 桌伴自己的 dsh 补丁：把 acp 那一行换成我们的小插件，给 ACP 加一个 _sidemate/steer 扩展方法。',
    '- id: acp',
    '  disabled: true',
    '',
    '- insert:',
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
