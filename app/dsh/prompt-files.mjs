// 用户给的文件怎么交给 dsh：ACP 的资源链接（file:// 的 URI）。
// 看图的模型再带上图片内容块（模型自己看得见图，不用先转成文字）。
// 只给主进程用（读字节、算 URI），页面那边不碰。

import { readFileSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// ACP 认的图片类型就这几种（app 那头也只放这几种）
const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

// 一个文件的资源链接：名字是任务文件夹里的相对路径（模型照它找得到），
// URI 是规范的文件链接（file:///…）。
export function fileLink(workspace, path) {
  const abs = resolve(String(path || ''))
  const rel = relative(resolve(String(workspace || '')), abs)
  // 相对路径用 / 分开（Windows 上也是）：模型照这个去找得到
  const name = rel && !rel.startsWith('..') ? rel.split(sep).join('/') : basename(abs)
  return { type: 'resource_link', name, uri: pathToFileURL(abs).href }
}

// 模型用 present 交出来的文件：工具参数里就是路径（相对任务文件夹的按那儿算）
export function presentedFiles(rawInput) {
  const list = rawInput && typeof rawInput === 'object' && Array.isArray(rawInput.files) ? rawInput.files : []
  const out = []
  for (const one of list) {
    const path = typeof one?.path === 'string' ? one.path.trim() : ''
    if (!path) continue
    out.push({ path, description: typeof one?.description === 'string' ? one.description : '' })
  }
  return out
}

// 这几份文件的内容块：一份文件一个资源链接；images 为真时，图另带一个图片内容块
export function fileBlocks(workspace, files, { images = false } = {}) {
  const blocks = []
  for (const one of Array.isArray(files) ? files : []) {
    const path = typeof one?.path === 'string' ? one.path : ''
    if (!path) continue
    blocks.push(fileLink(workspace, path))
    if (!images) continue
    const mime = IMAGE_MIME.get(extname(path).toLowerCase())
    if (!mime) continue
    try {
      blocks.push({ type: 'image', mimeType: mime, data: readFileSync(path).toString('base64') })
    } catch {
      // 读不出字节就只给链接（模型照链接自己找）
    }
  }
  return blocks
}
