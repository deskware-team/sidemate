// 输入框里 Ctrl+V / 右键粘贴的分流（怎么分在 ./paste-plan.mjs）：
// 图片读出来交给主进程存成「贴的图-N.png」当材料；长文字存成「贴的文字-N.md」；
// 资源管理器复制的文件走拖放那个口子当材料；短字不拦，照旧贴进输入框。

import { pastePlan } from './paste-plan.mjs'

export function createPasteInput({ input, bridge }) {
  // 图片读成字节再发主进程：剪贴板里的图没有路径，Blob 也过不了隔离桥
  async function sendImages(images) {
    const list = []
    for (const one of images) {
      try {
        list.push({ bytes: new Uint8Array(await one.file.arrayBuffer()), mime: one.mime })
      } catch { /* 读不出来的那张跳过 */ }
    }
    if (list.length && typeof bridge.pasteImages === 'function') bridge.pasteImages(list)
  }

  input.addEventListener('paste', (event) => {
    if (!bridge || !event.clipboardData) return
    const data = event.clipboardData
    const images = []
    const files = []
    for (const item of data.items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file) continue
      if (typeof item.type === 'string' && item.type.startsWith('image/')) images.push({ file, mime: item.type })
      else if (file.size > 0) files.push(file)
    }
    const text = data.getData('text/plain')
    const plan = pastePlan({ images: images.length, files: files.length, text })
    if (plan === 'text' || plan === 'none') return // 普通短字照旧贴进输入框
    event.preventDefault()
    if (plan === 'images') void sendImages(images)
    else if (plan === 'files' && typeof bridge.drop === 'function') bridge.drop(files)
    else if (plan === 'longtext' && typeof bridge.pasteText === 'function') bridge.pasteText(text)
  })
}
