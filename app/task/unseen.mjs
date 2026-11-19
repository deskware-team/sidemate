// 输入框上方那句话要的两样：现在的模型自己看不了图时，带着的哪几份它读不了内容——
// 图片，和没有文字层的 PDF（扫描件、手机拍了转成的 PDF）。要读文件，只在主进程里用。
// 模型看不看得了图不在这儿判断：只看干活模型自己的看图标记（shell.mjs 的 visionOf）。
//
// 扫描件的算法：整份读不出字、只有图，才算扫描件。
// 这里只做「拦不拦」的判断，不改一个字。

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { inflateSync } from 'node:zlib'

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
// 太大的不翻（认不出就当它有字，不乱提醒）；一个压缩流最多解这么多
const MAX_BYTES = 20 * 1024 * 1024
const MAX_INFLATE = 8 * 1024 * 1024
const FONT = '/Font'
const IMAGE_MARK = /\/Subtype\s*\/Image/
// Office 里的图放在这几个目录下（zip 里的文件名是明文，搜得到）
const MEDIA = { '.docx': 'word/media/', '.pptx': 'ppt/media/', '.xlsx': 'xl/media/' }
const known = new Map() // 路径 → { stamp, scanned, image }：文件没变就不再翻

// 带着的这几份里，现在的模型读不了内容的：图片、扫描的 PDF。给整份。
// sees 问现在的模型自己看不看得了图：没带图和 PDF 就不问；看得了就一份都不算，PDF 也不用翻
export function unseenFiles(files, { sees = () => false, scanned = looksScanned } = {}) {
  const list = (Array.isArray(files) ? files : []).filter(Boolean).map((one) => {
    const path = typeof one.path === 'string' ? one.path : ''
    const name = typeof one.name === 'string' && one.name ? one.name : basename(path)
    return { path, name, ext: extname(name).toLowerCase() }
  }).filter((one) => IMAGE.has(one.ext) || one.ext === '.pdf')
  if (!list.length || sees() === true) return []
  return list.filter((one) => one.ext !== '.pdf' || scanned(one.path))
}

// 一样的判断，只要名字（界面上点名用）
export function unseenNames(files, options = {}) {
  return unseenFiles(files, options).map((one) => one.name)
}

// 这份 PDF 像不像扫描件：哪儿都找不到字体（明文里、压缩的对象流和内容流里都没有）就算。
// 打不开、加了密、太大的认不出，一律当它有字。
export function looksScanned(path) {
  return readOne(path).scanned
}

// 这份文件里夹着图没有：Word / PPT / Excel（zip 里的 media 目录）、PDF（图片对象）。
// 当前模型看不了图时，夹着图的那几份照常发，只读文字，界面上补一句 St407。
export function fileHasImage(path) {
  return readOne(path).image
}

// 读一份文件，认两样：是不是扫描件、里面有没有图。认不出的一律当有字、没图。
function readOne(path) {
  const empty = { scanned: false, image: false }
  try {
    const st = statSync(path)
    const stamp = `${st.size}:${st.mtimeMs}`
    const hit = known.get(path)
    if (hit && hit.stamp === stamp) return hit
    const ext = extname(String(path)).toLowerCase()
    let out = empty
    if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) {
      const buf = readFileSync(path)
      if (ext === '.pdf') {
        const scan = scanPdf(buf)
        out = { scanned: !scan.text, image: scan.image }
      } else if (MEDIA[ext]) {
        out = { scanned: false, image: buf.toString('latin1').includes(MEDIA[ext]) }
      }
    }
    known.set(path, { stamp, ...out })
    return out
  } catch {
    return empty
  }
}

// 一份 PDF 里有没有文字层、有没有图：明文先看一遍，再翻压缩的对象流和内容流
function scanPdf(buf) {
  if (buf.includes('/Encrypt')) return { text: true, image: false } // 加密的认不出，当它有字
  const out = { text: buf.includes(FONT), image: IMAGE_MARK.test(buf.toString('latin1')) }
  let at = 0
  while ((at = buf.indexOf('stream', at)) >= 0) {
    // endstream 里也有 stream：跳过
    if (at >= 3 && buf.toString('latin1', at - 3, at) === 'end') { at += 6; continue }
    let start = at + 6
    if (buf[start] === 0x0d) start += 1
    if (buf[start] === 0x0a) start += 1
    const end = buf.indexOf('endstream', start)
    if (end < 0) break
    // 这个流的字典：从它的「N 0 obj」到 stream；图片流不解
    const head = buf.toString('latin1', Math.max(0, buf.lastIndexOf('obj', at)), at)
    if (/\/FlateDecode/.test(head) && !IMAGE_MARK.test(head)) {
      try {
        const body = inflateSync(buf.subarray(start, end), { maxOutputLength: MAX_INFLATE }).toString('latin1')
        // 对象流里的字体，或者内容流里设字体的 Tf
        if (body.includes(FONT) || /\sTf\b/.test(body)) out.text = true
        if (IMAGE_MARK.test(body)) out.image = true
      } catch { /* 解不开的跳过 */ }
    }
    at = end + 9
  }
  return out
}
