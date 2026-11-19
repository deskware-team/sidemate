// 气泡里的小块：用户发出去的材料，在这次任务工作区里的那份拷贝。
// 图片带缩略图，其它带文件图标 + 文件名；放不下收成「+N」，点「+N」摆全部。
// 点一下：让主进程用系统默认程序打开那份拷贝（路径由主进程核，页面只管发请求）。
// 样式跟输入区的小签同一套（class 里带着 tag），这里只多一个 chip 记号。

const MAX_VISIBLE = 3 // 收着的时候摆几个

export function createChipRow({ doc = globalThis.document, bridge = null, icon = null } = {}) {
  const thumbs = new Map() // path → Promise<dataURL>：同一张图只从主进程拿一次
  const expanded = new Set() // 展开了的气泡：key 是那一轮的编号

  function thumbOf(path) {
    if (thumbs.has(path)) return thumbs.get(path)
    const pending = (bridge && typeof bridge.thumb === 'function' ? bridge.thumb(path) : Promise.resolve('')).catch(() => '')
    thumbs.set(path, pending)
    return pending
  }

  // 文件图标：输入区那张文档图标（没有就摆一个空壳，样子由样式兜住）
  function iconEl() {
    if (icon && typeof icon.cloneNode === 'function') {
      const el = icon.cloneNode(true)
      if (typeof el.removeAttribute === 'function') el.removeAttribute('hidden')
      return el
    }
    const el = doc.createElement('span')
    el.className = 'tic'
    return el
  }

  // 灰着：拷贝不在了（任务文件夹被删、文件被改名），或者压根没拷进来
  function grey(el, one) {
    const gone = one.missing === true || !one.path
    if (!gone) return
    el.classList.add('gone')
    el.disabled = true
  }

  // 点一下：让主进程开那份拷贝。开不了（不在了、被主进程拒了）就灰着
  function openOne(one, el) {
    if (!bridge || typeof bridge.openChip !== 'function') return
    void Promise.resolve(bridge.openChip(one.path))
      .then((reply) => {
        if (reply && reply.ok === true) return
        el.classList.add('gone')
        el.disabled = true
      })
      .catch(() => {})
  }

  function chipEl(one) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.className = 'tag chip'
    el.dataset.path = one.path || ''
    if (one.thumb) {
      // 缩略图先摆一块底色占位，主进程给回 data: 再填上
      const img = doc.createElement('img')
      img.className = 'thumb'
      img.alt = ''
      el.append(img)
      void thumbOf(one.path).then((url) => { if (url) img.src = url })
    } else {
      el.append(iconEl())
    }
    const nm = doc.createElement('span')
    nm.className = 'nm'
    nm.textContent = one.label || one.name || ''
    nm.title = one.name || ''
    el.append(nm)
    grey(el, one)
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      if (one.missing === true || !one.path) return
      openOne(one, el)
    })
    return el
  }

  // 「+N」：藏起来的那几份，点开全部摆出来
  function moreEl(count, key, row, block) {
    const el = doc.createElement('button')
    el.type = 'button'
    el.className = 'tag more chip'
    el.textContent = `+${count}`
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      expanded.add(key)
      fill(row, block)
    })
    return el
  }

  function fill(row, block) {
    row.textContent = ''
    const files = Array.isArray(block.files) ? block.files : []
    if (!files.length) return
    const key = String(block.round ?? '')
    const open = expanded.has(key)
    const shown = open ? files : files.slice(0, MAX_VISIBLE)
    for (const one of shown) row.append(chipEl(one))
    if (!open && files.length > MAX_VISIBLE) row.append(moreEl(files.length - MAX_VISIBLE, key, row, block))
  }

  // 画一行的材料小块：没有材料就不画
  function render(block) {
    const files = Array.isArray(block?.files) ? block.files : []
    if (!files.length) return null
    const row = doc.createElement('div')
    row.className = 'chips'
    fill(row, block)
    return row
  }

  return { render }
}
