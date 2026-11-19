// 桌伴自己的 dsh 小插件：读链接默认不碰本机和局域网。
// dsh 的 web_fetch 不拦本机和内网地址：用户拖进来的文档里
// 藏一句「去读 http://127.0.0.1:xxx」之类的话，模型就能摸到用户内网里的服务。
// 这里在每次 web_fetch 之前拦一道：主机名先解析成 IP，落在本机、内网、云元数据这些范围里就拒。
// 查不出地址（DNS 查不到、超时）也拒：判断不了就不放行。
// 拦的时候给模型一句原因（app/copy/harness.mjs 里的 web.localNetDenied、web.localNetUnresolved），模型会转述给用户。
//
// shortcut: 这里只拦「读网页」这一个工具。不防 DNS 换绑（同一个域名一会儿解析到公网、一会儿到本机，
// 这里查到的是公网，真正取网页时连到本机）；也不管模型自己在 PowerShell、Python 脚本里联网。
//
// 装法：app/dsh/local-net.mjs 把这个文件插进 dsh 的插件表（--patch 那一段）。
// 「允许访问本地网络」那个开关打开时不挂这个插件（app/abilities/launch.mjs 决定挂不挂）。
//
// 判断地址的规矩在 ./net-guard.mjs（纯逻辑，单测直接测那个文件）。
// 这里不许出现钥匙。

import { lookup } from 'node:dns/promises'
import { t } from '../copy/copy.mjs'
import { hostFromUrl, isBlockedHost, isBlockedIp, isIpLiteral } from './net-guard.mjs'

export const name = 'sidemate-local-net'
export const inject = ['tools']

// 域名解析最多等这么久：解析不动就当查不到（拦下来）
const RESOLVE_TIMEOUT_MS = 3000

// 主机名解析成所有地址：查不到（解析失败、超时）就返回 null
async function resolveAll(host) {
  let timer = null
  try {
    const found = await Promise.race([
      lookup(host, { all: true }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS) }),
    ])
    if (!Array.isArray(found)) return null
    const list = found.map((one) => String(one?.address ?? '')).filter((one) => one !== '')
    return list.length ? list : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 这个地址要不要拦：写出来的地址直接判，域名查一遍 DNS，所有地址都看
// 返回：blocked 落在要拦的范围里，unknown 查不到地址，ok 不拦
async function blockedByUrl(url) {
  const host = hostFromUrl(url)
  if (host === '') return 'ok'
  if (isBlockedHost(host)) return 'blocked'
  if (isIpLiteral(host)) return 'ok'
  const addresses = await resolveAll(host)
  if (!addresses) return 'unknown'
  return addresses.some((one) => isBlockedIp(one)) ? 'blocked' : 'ok'
}

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    // 判断放在 try 外面算：next() 只能调一次，报错也不该再调一次
    let verdict = 'ok'
    try {
      if (exec?.name === 'web_fetch') {
        const url = typeof exec.arguments?.url === 'string' ? exec.arguments.url : ''
        if (url !== '') verdict = await blockedByUrl(url)
      }
    } catch {
      // 判断不出来就当查不到：拦下来
      verdict = 'unknown'
    }
    if (verdict === 'blocked') return { kind: 'deny', reason: t('web.localNetDenied') }
    if (verdict === 'unknown') return { kind: 'deny', reason: t('web.localNetUnresolved') }
    return next()
  })
}
