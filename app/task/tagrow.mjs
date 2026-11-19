// 小签行：文件、贴的图、贴的长文字都变成输入区上沿的小签。
// 图片小签带 28×28 缩略图（主进程缩好给 data:，这里缓存），第二行写「图片」；
// 贴的长文字小签第二行写字数，右键多一项「改回文字」（把字取回输入框）。
// 点 / 右键弹的小签菜单只有「去掉」（贴的长文字多一项「改回文字」）。
// 签多了收着：只摆前三个，剩下的收进「+N」，鼠标停上去能看见藏了哪几个文件名；
// 点「+N」全部摆出来（小签行换行、变高），最后一个签是「收起」，点了收回前三个。
// 干活中这一轮带着的小签锁住不弹菜单（视图里的 lock），干活中挂上、还没发出去的照样能去掉；
// 「+N」和「收起」还能点（只是看一眼）。

const MAX_VISIBLE = 3 // 收着的时候摆几个
const MAX_ROWS = 3 // 展开的时候最多摆几行，超出的在这一块里自己滚

import { t } from '../copy/copy.mjs'

export function createTagRow({ row, list, menu, act, bridge, view, onRestore }) {
  const thumbs = new Map() // path → Promise<dataURL>：同一张图只从主进程拿一次
  let expanded = false // 现在是收着还是展开
  let known = new Set() // 上一次摆出来的签（多了一个新文件就收回前三个）

  function thumbOf(path) {
    if (thumbs.has(path)) return thumbs.get(path)
    const pending = (bridge && typeof bridge.thumb === 'function' ? bridge.thumb(path) : Promise.resolve('')).catch(() => '')
    thumbs.set(path, pending)
    return pending
  }

  // 贴的长文字的图标：28×28 的底色块加一个小纸片
  function textIconEl() {
    const el = document.createElement('span')
    el.className = 'tic'
    el.innerHTML = '<svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true"><path d="M2.5 1h4.5L9.5 3.5V9h-7z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
    return el
  }

  function openTagMenu(anchor, tag) {
    const now = view()
    menu.textContent = ''
    const items = []
    // 贴的长文字才有「改回文字」：把字取回输入框、去掉这个小签
    if (tag.restore) items.push({ label: now.labels.tagRestore, restore: true })
    items.push({ label: now.labels.tagRemove, action: { type: 'remove', path: tag.path } })
    for (const one of items) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = one.label
      btn.addEventListener('click', () => {
        menu.hidden = true
        if (one.restore) {
          if (!bridge || typeof bridge.restore !== 'function') return
          bridge.restore(tag.path)
            .then((back) => { if (back && back.ok && typeof back.text === 'string') onRestore(back.text) })
            .catch(() => {})
          return
        }
        act(one.action)
      })
      menu.append(btn)
    }
    menu.hidden = false
    const box = anchor.getBoundingClientRect()
    menu.style.left = `${Math.max(4, Math.min(box.left, innerWidth - 130))}px`
    menu.style.top = `${box.bottom + 4}px`
  }

  function tagEl(tag) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `tag${tag.kind ? ` ${tag.kind}` : ''}`
    el.dataset.path = tag.path
    if (tag.thumb) {
      // 缩略图先摆一块底色占位，主进程给回 data: 再填上
      const img = document.createElement('img')
      img.className = 'thumb'
      img.alt = ''
      el.append(img)
      void thumbOf(tag.path).then((url) => { if (url) img.src = url })
    } else if (tag.kind) {
      el.append(textIconEl())
    }
    const nm = document.createElement('span')
    nm.className = 'nm'
    nm.textContent = tag.label
    nm.title = tag.name
    if (tag.sub) {
      const word = document.createElement('span')
      word.className = 'tword'
      const sub = document.createElement('span')
      sub.className = 'sub'
      sub.textContent = tag.sub
      word.append(nm, sub)
      el.append(word)
    } else {
      el.append(nm)
    }
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      // 干活中锁住：这一轮的文件不动
      if (tag.lock) return
      openTagMenu(el, tag)
    })
    // 右键弹的是同一个菜单，规矩跟左键一样（锁住的也不弹）
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (tag.lock) return
      openTagMenu(el, tag)
    })
    return el
  }

  // 「+N」：跟小签一样的一个按钮，字是灰的；鼠标停上去能看见藏起来的是哪几个文件
  function moreEl(hidden) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'tag more'
    el.textContent = `+${hidden.length}`
    el.title = hidden.map((one) => one.name || one.label).join('\n')
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      expanded = true
      render()
    })
    return el
  }

  // 「收起」：展开后最后一个签，点了回到只摆前三个
  function collapseEl() {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'tag collapse'
    el.textContent = t('tag.collapse')
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      expanded = false
      render()
    })
    return el
  }

  // 展开时最多摆三行，超出的在这一块里自己滚（量的是每行摆完后的实际位置）
  function limitRows() {
    list.style.maxHeight = ''
    if (!expanded) return
    const kids = [...(list.children || [])]
    // 一行里的签高度不一样（贴的图、贴的长文字那种高 38），但居中摆的时候
    // 同一行的签的中线是重合的，按中线分组就是按行分组
    const rows = []
    for (const el of kids) {
      const height = Number(el.offsetHeight) || 0
      const top = Number(el.offsetTop) || 0
      const center = top + height / 2
      const row = rows.find((one) => Math.abs(one.center - center) <= 2)
      if (row) {
        row.height = Math.max(row.height, height)
      } else {
        rows.push({ center, height })
      }
    }
    rows.sort((a, b) => a.center - b.center)
    if (rows.length <= MAX_ROWS) return
    // 三行的高度：第一行上沿到第三行下沿（行距也在里头），再多就在这一块里滚
    const top = rows[0].center - rows[0].height / 2
    const bottom = rows[MAX_ROWS - 1].center + rows[MAX_ROWS - 1].height / 2
    list.style.maxHeight = `${Math.round(bottom - top)}px`
  }

  function render() {
    const now = view()
    if (!now) return
    const tags = now.tags || []
    // 去掉一个还展开着（少了一个不算变）；多了一个新文件就收回前三个
    if (tags.some((one) => !known.has(one.path))) expanded = false
    known = new Set(tags.map((one) => one.path))
    row.hidden = tags.length === 0
    list.textContent = ''
    // 展开着就一直展开着：去掉一个也还展开；剩三个以内不显示「收起」（但状态留着）
    const shown = expanded ? tags : tags.slice(0, MAX_VISIBLE)
    for (const tag of shown) list.append(tagEl(tag))
    if (expanded) {
      if (tags.length > MAX_VISIBLE) list.append(collapseEl())
    } else if (tags.length > MAX_VISIBLE) {
      list.append(moreEl(tags.slice(MAX_VISIBLE)))
    }
    list.classList.toggle('expanded', expanded)
    limitRows()
  }

  return { render }
}
