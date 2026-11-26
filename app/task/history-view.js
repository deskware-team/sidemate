// 任务窗「历史」的页面这头：顶栏「▾」弹出的「历史记录」下拉（宽 320），和点「看全部…」
// 换出来的「全部对话」整页。只建节点、管显隐、拿列表；列哪几条、怎么分组都在
// ./history-view.mjs，打开一条走外面给的 open，列表走外面给的 list。

import { dropdownGroups, emptyText, listParams, markerOf, openFailedText, pageGroups, statusChanged } from './history-view.mjs'
import { t } from '../copy/copy.mjs'

// 输入即搜：停这么一下再拿列表，别按一个键拿一次
const SEARCH_WAIT = 140
const PAGE_WAIT = 220

function el(tag, cls, text) {
  const one = document.createElement(tag)
  if (cls) one.className = cls
  if (text != null) one.textContent = text
  return one
}

// where：顶栏文件夹那一块（下拉挂在它下面）；panel：面板（整页盖在上面）。
// list(payload) → Promise<{ items } | null>；open(id) → Promise<{ ok, message } | null>。
export function createHistoryView({ where, panel, list, open }) {
  // —— 下拉：搜框 · 按天分组的行 · 细线 · 看全部… ——
  const menu = el('div')
  menu.id = 'histmenu'
  menu.hidden = true
  const search = el('div', 'hsearch')
  const searchInput = document.createElement('input')
  searchInput.type = 'text'
  searchInput.placeholder = t('history.search')
  search.append(searchInput)
  const body = el('div', 'hbody')
  const menuHint = el('div', 'hhint')
  menuHint.hidden = true
  const sep = el('div', 'hsep')
  const seeAll = el('button', 'hrow hall')
  seeAll.type = 'button'
  seeAll.append(el('span', 'htitle', t('history.seeAll')))
  menu.append(search, body, menuHint, sep, seeAll)
  where.append(menu)

  // —— 整页：‹ 全部对话 · 搜框 · 分段 · 能滚的列表 ——
  const page = el('div')
  page.id = 'allpage'
  page.hidden = true
  const head = el('div', 'aphead')
  const back = el('button', 'apback', '‹')
  back.type = 'button'
  back.title = t('history.back')
  head.append(back, el('span', 'aptitle', t('history.title')))
  const top = el('div', 'aptop')
  const pageSearchWrap = el('div', 'apsearch')
  const pageSearch = document.createElement('input')
  pageSearch.type = 'text'
  pageSearch.placeholder = t('history.search')
  pageSearchWrap.append(pageSearch)
  const seg = el('div', 'apseg')
  const segButtons = [['', t('history.filterAll')], ['task', t('history.filterTask')], ['news', t('history.filterNews')]].map(([kind, label]) => {
    const btn = el('button', '', label)
    btn.type = 'button'
    btn.dataset.kind = kind
    seg.append(btn)
    return btn
  })
  const hint = el('div', 'aphint')
  hint.hidden = true
  const listEl = el('div', 'aplist')
  top.append(pageSearchWrap, seg, hint)
  page.append(head, top, listEl)
  panel.append(page)

  let currentId = ''
  let drawnId = '' // 下拉最近一次画的时候标的那条：没变就不重画，免得点下去按钮换了
  let menuOpen = false
  let query = ''
  let lastItems = [] // 下拉最近一次拿到的，视图来了好把「当前那条」重描
  let menuSeq = 0
  let searchTimer = 0
  let pageOn = false
  let pageQuery = ''
  let pageKind = ''
  let pageItems = []
  let pageSeq = 0
  let pageTimer = 0
  let lastSig = '' // 上次看到的状态签名：变了才重新要列表

  function rowEl(row) {
    const btn = el('button', row.now ? 'hrow now' : 'hrow')
    btn.type = 'button'
    btn.dataset.id = row.id
    const title = el('span', 'htitle', row.title)
    title.title = row.title
    btn.append(title, metaEl(row, row.time))
    btn.addEventListener('click', () => { void pick(row.id) })
    return btn
  }

  // 右边那截：状态标记（在跑的是转圈、跑完还没看的是绿点）在时间左边，别的没有
  function metaEl(row, time) {
    const meta = el('span', 'hmeta')
    const mark = markerOf(row.status)
    if (mark) meta.append(markEl(mark))
    meta.append(el('span', '', time))
    return meta
  }

  // 状态标记本身：一个小转圈或一个小绿点，鼠标停上去有那句话
  function markEl(mark) {
    const node = el('span', `hmark ${mark.cls}`, '')
    node.title = mark.label
    return node
  }

  function renderMenu(items) {
    lastItems = items
    drawnId = currentId
    body.textContent = ''
    const groups = dropdownGroups(items, currentId)
    groups.forEach((group, at) => {
      const bar = el('div', at === 0 ? 'hgroup first' : 'hgroup')
      bar.append(el('span', 'hglabel', group.label), el('span', 'hgline'))
      body.append(bar)
      for (const row of group.rows) body.append(rowEl(row))
    })
    if (!groups.length) body.append(el('div', 'hempty', emptyText({ query })))
  }

  async function fetchMenu() {
    const mine = ++menuSeq
    let data = null
    try { data = await list(listParams({ query, kind: 'task' })) } catch { data = null }
    if (mine !== menuSeq || !menuOpen) return
    renderMenu(Array.isArray(data?.items) ? data.items : [])
  }

  function openMenu() {
    menuOpen = true
    menu.hidden = false
    query = ''
    searchInput.value = ''
    menuHint.hidden = true
    body.textContent = ''
    lastItems = []
    void fetchMenu()
    try { searchInput.focus() } catch { /* 聚不上也能用 */ }
  }

  function closeMenu() {
    if (!menuOpen) return
    menuOpen = false
    menuSeq += 1 // 在途的那次回来别再画
    clearTimeout(searchTimer)
    menu.hidden = true
  }

  function pageRowEl(row) {
    const btn = el('button', 'hrow')
    btn.type = 'button'
    btn.dataset.id = row.id
    const title = el('span', 'htitle', row.title)
    title.title = row.title
    // 文件夹和时间各一截，中间的空白由样式给（.parts）；状态标记在时间左边
    const meta = el('span', 'hmeta parts')
    const parts = row.meta.slice()
    const time = parts.pop()
    for (const part of parts) meta.append(el('span', '', part))
    const mark = markerOf(row.status)
    if (mark) meta.append(markEl(mark))
    if (time) meta.append(el('span', '', time))
    btn.append(title, meta)
    btn.addEventListener('click', () => { void pick(row.id) })
    return btn
  }

  function renderPage() {
    listEl.textContent = ''
    const groups = pageGroups(pageItems)
    groups.forEach((group, at) => {
      const bar = el('div', at === 0 ? 'hgroup first' : 'hgroup')
      bar.append(el('span', 'hglabel', group.label), el('span', 'hgline'))
      listEl.append(bar)
      for (const row of group.rows) listEl.append(pageRowEl(row))
    })
    if (!groups.length) listEl.append(el('div', 'apempty', emptyText({ query: pageQuery, kind: pageKind })))
  }

  async function fetchPage() {
    const mine = ++pageSeq
    let data = null
    try { data = await list(listParams({ query: pageQuery, kind: pageKind })) } catch { data = null }
    if (mine !== pageSeq || !pageOn) return
    pageItems = Array.isArray(data?.items) ? data.items : []
    renderPage()
  }

  function setSeg() {
    for (const btn of segButtons) btn.classList.toggle('on', btn.dataset.kind === pageKind)
  }

  function openPage() {
    pageOn = true
    page.hidden = false
    pageQuery = ''
    pageKind = ''
    pageSearch.value = ''
    pageItems = []
    hint.hidden = true
    setSeg()
    listEl.textContent = ''
    void fetchPage()
    try { pageSearch.focus() } catch { /* 聚不上也能用 */ }
  }

  function closePage() {
    if (!pageOn) return
    pageOn = false
    pageSeq += 1 // 在途的那次回来别再画
    clearTimeout(pageTimer)
    page.hidden = true
  }

  // 点一条 = 打开那条对话；不让打开的那句话写在开着的那层里
  async function pick(id) {
    let back = null
    try { back = await open(id) } catch { back = null }
    if (!back) return
    if (back.ok) {
      closeMenu()
      closePage()
      return
    }
    const text = openFailedText(back.message)
    if (pageOn) {
      hint.textContent = text
      hint.hidden = false
    } else if (menuOpen) {
      menuHint.textContent = text
      menuHint.hidden = false
    }
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void fetchMenu() }, SEARCH_WAIT)
  })
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    closeMenu()
  })
  seeAll.addEventListener('click', () => {
    closeMenu()
    openPage()
  })
  back.addEventListener('click', closePage)
  pageSearch.addEventListener('input', () => {
    pageQuery = pageSearch.value
    clearTimeout(pageTimer)
    pageTimer = setTimeout(() => { void fetchPage() }, PAGE_WAIT)
  })
  pageSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    closePage()
  })
  for (const btn of segButtons) {
    btn.addEventListener('click', () => {
      if (pageKind === btn.dataset.kind) return
      pageKind = btn.dataset.kind
      hint.hidden = true
      setSeg()
      void fetchPage()
    })
  }
  // 视图来了：当前那条换了才把开着的下拉重描（干活中也能切去看别的，那条在后台接着跑）
  function setView(next) {
    if (next && typeof next.currentId === 'string') currentId = next.currentId
    if (menuOpen && currentId !== drawnId) renderMenu(lastItems)
    // 状态真的变了才重新要一遍列表（每来一个字都要一次太吵）
    if (next && typeof next.statusSig === 'string') {
      const changed = statusChanged(lastSig, next.statusSig)
      lastSig = next.statusSig
      if (changed) {
        if (menuOpen) void fetchMenu()
        if (pageOn) void fetchPage()
      }
    }
  }

  // 点了外面：收下拉；整页不是浮层，不收
  function outside(target) {
    if (menuOpen && !menu.contains(target)) closeMenu()
  }

  // Esc：先收下拉，再退整页
  function onEscape() {
    if (menuOpen) { closeMenu(); return true }
    if (pageOn) { closePage(); return true }
    return false
  }

  return {
    toggle: () => (menuOpen ? closeMenu() : openMenu()),
    closeMenu,
    outside,
    onEscape,
    setView,
    openPage,
    closePage,
    isOpen: () => menuOpen,
    isPageOpen: () => pageOn,
  }
}
