// 对话里的图片：![说明](地址)。
// 本地的（相对或绝对路径）由主进程核过工作区才给能用的地址；https 的直接显示。
// 显示不出来（不在工作区、文件没了、不是图片、加载失败）就摆一行灰字「[说明]」，不摆碎图。
// 页面代码：不引 node:、不引 electron。

import { imageKind } from './markdown.mjs'

// 摆不出来的时候：一行灰字
function fail(wrap, alt) {
  wrap.textContent = ''
  wrap.classList.add('mdfail')
  wrap.textContent = `[${alt}]`
}

// 图片那块：点一下在预览窗里看（本地文件走主进程那条路），右键弹系统的菜单
function picture(wrap, alt, src, onOpen, onMenu) {
  const img = document.createElement('img')
  img.className = 'mdpic'
  img.alt = alt
  img.src = src
  img.addEventListener('error', () => fail(wrap, alt))
  img.addEventListener('click', () => { if (onOpen) onOpen() })
  img.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (onMenu) onMenu()
  })
  wrap.append(img)
}

// 一个图片：说明是 alt，地址是 url
export function imageEl(alt, url, bridge) {
  const wrap = document.createElement('span')
  wrap.className = 'mdimg'
  const kind = imageKind(url)
  if (kind === 'https') {
    picture(wrap, alt, url, () => { if (bridge && bridge.openLink) bridge.openLink(url) },
      () => { if (bridge && bridge.imageMenu) bridge.imageMenu({ url }) })
    return wrap
  }
  // 本地的：等主进程核过工作区才给地址
  if (!bridge || typeof bridge.image !== 'function') { fail(wrap, alt); return wrap }
  void Promise.resolve(bridge.image(url)).then((hit) => {
    if (!hit || hit.ok !== true) { fail(wrap, alt); return }
    picture(wrap, alt, hit.src, () => { if (bridge.openChip) bridge.openChip(hit.path) },
      () => { if (bridge.imageMenu) bridge.imageMenu({ path: hit.path }) })
  }).catch(() => fail(wrap, alt))
  return wrap
}
