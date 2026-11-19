// 设置窗「点击区域」体检用的那段页面脚本。
//
// 判定标准（照卡上那四条）:
//   1. 看着是一块的（行卡片、链接行、开关行、单选行）整块都要能点, 点边上也得有反应;
//      视觉块里不能有按了没反应的死角, 点不中的地方不能摆着手型。
//   2. 能点的东西点击区至少 32×32（视觉可以小, 用 padding / label 把点击区撑开）;
//      单选、勾选、开关连同它们的文字一起能点。
//   3. 能点的鼠标放上去是手型, 禁用的是默认箭头。
//   4. 同类控件的尺寸、圆角要一致。
//
// 这段代码在页面里跑（用 CDP 送进去执行）, 所以不能引用外面的东西, 自己带着全部工具。

export function auditFn() {
  const isVis = (n) => {
    if (!n || typeof n.getBoundingClientRect !== 'function') return false
    const r = n.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const s = getComputedStyle(n)
    if (s.visibility === 'hidden' || s.display === 'none') return false
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false
    if (n.closest && n.closest('[hidden]')) return false
    // 滚出去的（被滚动条那层裁掉的）不算看得见
    let a = n.parentElement
    while (a) {
      const as = getComputedStyle(a)
      if (as.overflowY !== 'visible' || as.overflowX !== 'visible') {
        const ar = a.getBoundingClientRect()
        if (r.bottom <= ar.top || r.top >= ar.bottom || r.right <= ar.left || r.left >= ar.right) return false
      }
      a = a.parentElement
    }
    return true
  }
  const tag = (n) => String((n && n.tagName) || '').toLowerCase()
  const name = (n) => {
    let s = tag(n)
    if (n.id) s += '#' + n.id
    const cn = typeof n.className === 'string' ? n.className.trim() : ''
    if (cn) s += '.' + cn.split(/\s+/).join('.')
    if (tag(n) === 'input') s += '[' + (n.type || '') + ']'
    return s
  }
  const rectOf = (n) => {
    const r = n.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const box = (list) => {
    const out = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity, w: 0, h: 0 }
    for (const one of list) {
      if (!one) continue
      out.l = Math.min(out.l, one.l)
      out.t = Math.min(out.t, one.t)
      out.r = Math.max(out.r, one.r)
      out.b = Math.max(out.b, one.b)
    }
    out.w = out.r - out.l
    out.h = out.b - out.t
    return out
  }
  const hasBorder = (n) => {
    const s = getComputedStyle(n)
    return s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none'
  }
  const hasBg = (n) => {
    const s = getComputedStyle(n)
    return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundImage === 'none'
  }
  const radiusOf = (n) => {
    const s = getComputedStyle(n)
    const r = parseFloat(s.borderTopLeftRadius) || 0
    return Number.isFinite(r) ? r : 0
  }
  // 输入框那一类: 光标是文字样, 不算「能点的小控件」
  const isField = (n) => {
    const t = tag(n)
    if (t === 'textarea' || t === 'select') return true
    if (t !== 'input') return false
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(n.type)
  }
  // 看得见的那块: 开关是轨条、单选是那个圆点、勾选框是那个小方块
  const visualBox = (n) => {
    const holder = n.closest ? n.closest('.switch') : null
    if (holder) {
      const track = holder.querySelector('.track')
      if (track && isVis(track)) return rectOf(track)
    }
    if (tag(n) === 'input' && (n.type === 'radio' || n.type === 'checkbox') && !hasBorder(n)) {
      const s = getComputedStyle(n, '::before')
      const w = parseFloat(s.width) || 0
      const h = parseFloat(s.height) || 0
      if (w > 0 && h > 0) {
        const r = rectOf(n)
        return { l: r.l + (r.w - w) / 2, t: r.t + (r.h - h) / 2, r: r.l + (r.w + w) / 2, b: r.t + (r.h + h) / 2, w, h }
      }
    }
    return rectOf(n)
  }
  // 开着弹窗的时候只量弹窗里那些, 背后的页面被遮罩盖着, 量了也没意义
  const overlays = [...document.querySelectorAll('.overlay')].filter(isVis)
  const scope = overlays.length ? overlays[overlays.length - 1] : document.body
  const inScope = (n) => scope.contains(n)
  // 页面里所有能点的东西
  const base = 'button, a[href], input, select, textarea, [role=button], [role=radio], [role=switch], [role=menuitem], [role=tab]'
  const candidates = []
  const seen = new Set()
  const add = (n) => {
    if (!n || seen.has(n) || !inScope(n)) return
    seen.add(n)
    candidates.push(n)
  }
  for (const n of scope.querySelectorAll(base)) add(n)
  for (const n of scope.querySelectorAll('label')) {
    const control = n.control || n.querySelector('input')
    if (!control) continue
    if (isField(control)) continue
    add(n)
  }
  // 光标是手型的, 但不能是别的控件里面的字（那些字跟着父控件走）
  for (const n of scope.querySelectorAll('body *')) {
    if (!inScope(n)) continue
    if (getComputedStyle(n).cursor !== 'pointer') continue
    if (n.closest(base) || n.closest('label')) continue
    add(n)
  }
  // 分组: 勾选框 / 单选框跟它的文字（label）算一个控件
  const groups = []
  const groupOf = new Map()
  const groupFor = (n) => {
    let g = groupOf.get(n)
    if (!g) {
      g = { members: [], activators: new Set(), labels: [] }
      groups.push(g)
      groupOf.set(n, g)
    }
    return g
  }
  const merge = (a, b) => {
    if (a === b) return a
    for (const m of b.members) {
      if (!a.members.includes(m)) a.members.push(m)
      groupOf.set(m, a)
    }
    for (const x of b.activators) a.activators.add(x)
    for (const l of b.labels) if (!a.labels.includes(l)) a.labels.push(l)
    const at = groups.indexOf(b)
    if (at >= 0) groups.splice(at, 1)
    return a
  }
  const labelOf = (input) => {
    const out = []
    if (input.id) {
      for (const l of document.querySelectorAll('label')) {
        if (l.getAttribute('for') === input.id) out.push(l)
      }
    }
    const own = input.closest ? input.closest('label') : null
    if (own && !out.includes(own)) out.push(own)
    return out
  }
  const controlOf = (label) => {
    if (label.control) return label.control
    return label.querySelector('input, select, textarea, button') || null
  }
  // 先把勾选框、单选框收成组
  for (const n of candidates) {
    if (tag(n) !== 'input') continue
    if (n.type !== 'checkbox' && n.type !== 'radio') continue
    const g = groupFor(n)
    g.members.push(n)
    for (const l of labelOf(n)) {
      if (!isVis(l) || !inScope(l)) continue
      g.members.push(l)
      g.labels.push(l)
      groupOf.set(l, g)
    }
  }
  // 再把 label 并到它那个控件上
  for (const n of candidates) {
    if (tag(n) !== 'label') continue
    if (!isVis(n)) continue
    const control = controlOf(n)
    if (control && isField(control)) continue
    if (control && groupOf.has(control)) {
      const g = groupOf.get(control)
      if (!g.members.includes(n)) g.members.push(n)
      if (!g.labels.includes(n)) g.labels.push(n)
      groupOf.set(n, g)
    } else {
      const g = groupFor(n)
      g.members.push(n)
      g.labels.push(n)
    }
  }
  // 剩下的是按钮一类的, 自己一个组
  for (const n of candidates) {
    if (groupOf.has(n)) continue
    if (!isVis(n)) continue
    const g = groupFor(n)
    g.members.push(n)
  }
  // 组里能点的节点（自己、里面的文字、跟它绑着的那个控件）
  for (const g of groups) {
    for (const m of g.members) {
      g.activators.add(m)
      for (const child of m.querySelectorAll('*')) g.activators.add(child)
    }
  }
  const owns = (g, hit) => {
    if (!hit) return false
    if (g.activators.has(hit)) return true
    for (const a of g.activators) if (a.contains && a.contains(hit)) return true
    return false
  }
  // 点到的是不是这个控件自己（或它里面的东西）
  const ownedBy = (m, hit) => {
    if (!hit) return false
    if (hit === m) return true
    if (m.contains && m.contains(hit)) return true
    return false
  }
  // 真正的命中区：从控件的四条边往外一格一格试，看还能不能点到它
  // （小控件靠透明的 ::after 撑开，这样量出来的是鼠标真能按到的那块）
  const probeOut = (m, r) => {
    const max = 24
    const hitAt = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null
      return document.elementFromPoint(x, y)
    }
    const grow = (points) => {
      let d = 1
      for (; d <= max; d++) {
        let ok = true
        for (const [x, y] of points(d)) {
          if (!ownedBy(m, hitAt(x, y))) { ok = false; break }
        }
        if (!ok) break
      }
      return d - 1
    }
    const up = grow((d) => [[r.l + r.w * 0.5, r.t - d + 0.5]])
    const down = grow((d) => [[r.l + r.w * 0.5, r.b + d - 0.5]])
    const left = grow((d) => [[r.l - d + 0.5, r.t + r.h * 0.5]])
    const right = grow((d) => [[r.r + d - 0.5, r.t + r.h * 0.5]])
    return { l: r.l - left, t: r.t - up, r: r.r + right, b: r.b + down, w: r.w + left + right, h: r.h + up + down }
  }
  // 控件自己的命中区：它自己的盒子加上它里面那些东西（按钮里的「›」也算点它）
  const hitRectOf = (g, m) => {
    const r = rectOf(m)
    if (![r.l, r.t, r.r, r.b].every(Number.isFinite)) return { ...r, w: r.w || 0, h: r.h || 0 }
    let b = { l: r.l, t: r.t, r: r.r, b: r.b }
    for (const child of m.querySelectorAll('*')) {
      if (!isVis(child)) continue
      const c = rectOf(child)
      if (![c.l, c.t, c.r, c.b].every(Number.isFinite)) continue
      b.l = Math.min(b.l, c.l); b.t = Math.min(b.t, c.t)
      b.r = Math.max(b.r, c.r); b.b = Math.max(b.b, c.b)
    }
    const grown = probeOut(m, { ...b, w: b.r - b.l, h: b.b - b.t })
    grown.w = grown.r - grown.l
    grown.h = grown.b - grown.t
    return grown
  }
  // 在视觉块里网格采样: 点到的必须是这个控件（圆角那几颗角上的点不算）
  const sample = (g, b, radius) => {
    const step = 3
    let dead = 0
    let total = 0
    const seenHit = new Set()
    for (let x = b.l + 1; x < b.r; x += step) {
      for (let y = b.t + 1; y < b.b; y += step) {
        const nearLeft = x - b.l < radius
        const nearRight = b.r - x < radius
        const nearTop = y - b.t < radius
        const nearBottom = b.b - y < radius
        if ((nearLeft || nearRight) && (nearTop || nearBottom)) continue
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue
        total++
        const hit = document.elementFromPoint(x, y)
        if (!owns(g, hit)) {
          dead++
          if (hit) seenHit.add(name(hit))
          else seenHit.add('nothing')
        }
      }
    }
    return { dead, total, others: [...seenHit].slice(0, 4) }
  }
  const rows = []
  // 灰着的（带 .off 的）算禁用：光标就该是默认箭头
  const looksDisabled = (m) => {
    if (m.disabled === true) return true
    if (m.getAttribute && m.getAttribute('aria-disabled') === 'true') return true
    const cn = typeof m.className === 'string' ? m.className.trim() : ''
    if (cn.split(/\s+/).includes('off')) return true
    if (m.closest && m.closest('.off')) return true
    return false
  }
  for (const g of groups) {
    const members = g.members.filter(isVis)
    if (!members.length) continue
    const visuals = members.map(visualBox)
    const visual = box(visuals)
    const hitRects = members.map((m) => hitRectOf(g, m))
    const click = box(hitRects)
    // 不含文字标签的那部分（真正的方块）
    const block = box(members.filter((m) => tag(m) !== 'label').map(rectOf))
    const disabled = members.some(looksDisabled)
    const field = members.every(isField)
    const first = members[0]
    const issues = []
    // 光标: 能点的是手型, 禁用的是默认箭头（每个成员各看各的中间）
    let cursor = ''
    for (const m of members) {
      const v = visualBox(m)
      const mid = { x: v.l + v.w / 2, y: v.t + v.h / 2 }
      let one = ''
      // 只露出一半的（滚出去一半）先不管, 等它整个露出来再量
      const whole = v.l >= 0 && v.t >= 0 && v.r <= innerWidth && v.b <= innerHeight
      if (whole) {
        const hit = document.elementFromPoint(mid.x, mid.y)
        one = hit ? getComputedStyle(hit).cursor : ''
      }
      if (!cursor) cursor = one
      if (field || !whole) continue
      if (looksDisabled(m)) {
        if (one === 'pointer') issues.push(name(m) + ' 禁用了还是手型')
      } else if (one !== 'pointer') {
        issues.push(name(m) + ' 光标是 ' + (one || 'none'))
      }
    }
    if (!field) {
      // 点击区至少 32×32（文字标签不算, 它是跟着控件的; 禁用的不用撑）
      if (!disabled) {
        for (const m of members) {
          if (tag(m) === 'label') continue
          const r = hitRectOf(g, m)
          if (r.w < 32 || r.h < 32) {
            issues.push('点击区太小 ' + Math.round(r.w) + '×' + Math.round(r.h))
            break
          }
        }
      }
      // 视觉块里不能有按了没反应的地方
      for (const m of members) {
        const s = sample(g, visualBox(m), radiusOf(m))
        if (s.dead > 0) {
          issues.push('视觉块里有 ' + s.dead + ' 个点不到（' + s.others.join('、') + '）')
          break
        }
      }
      // 外面那块（卡片、行）看着比能点的地方大
      let a = first.parentElement
      for (let depth = 0; a && depth < 5; depth++, a = a.parentElement) {
        if (!hasBg(a) && !hasBorder(a)) continue
        const ar = rectOf(a)
        const inside = groups.filter((other) => other !== g && other.members.some((m) => a.contains(m)))
        const others = inside.map((other) => box(other.members.filter(isVis).map(rectOf)))
        const allClick = box([click, ...others])
        const style = getComputedStyle(a)
        const contentLeft = ar.l + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
        const contentRight = ar.r - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
        const contentW = contentRight - contentLeft
        // 这一块是实的（白卡片那种）而里面只有这一个控件: 那它整块都得能点
        const onlyOne = hasBg(a) && inside.length === 0
        // 这一个控件撑满了内容区: 那外头那圈白边也得能点, 不然看着是一整块、点边上没反应
        const spans = hasBg(a) && block.w >= contentW * 0.85 && contentW > 40
        if (spans || onlyOne) {
          // 这个控件是一整块（卡片）里的全部内容：那卡片四边都得能点，
          // 不然看着是一整块、点边上没反应
          const gapL = allClick.l - ar.l
          const gapR = ar.r - allClick.r
          if (gapL > 8 || gapR > 8) {
            issues.push('外面 ' + name(a) + ' 边上 ' + Math.round(Math.max(gapL, gapR)) + 'px 点不到')
          }
        }
      }
    }
    rows.push({
      el: name(first),
      kind: field ? '输入框' : (tag(first) === 'label' ? '文字' : '控件'),
      text: (first.innerText || first.value || first.placeholder || first.getAttribute('aria-label') || first.title || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      visual: [Math.round(visual.l), Math.round(visual.t), Math.round(visual.w), Math.round(visual.h)],
      click: [Math.round(click.l), Math.round(click.t), Math.round(click.w), Math.round(click.h)],
      cursor,
      disabled,
      issues,
    })
  }
  // 同类控件的圆角要一致
  const kinds = [
    ['开关', '.switch .track', 'both'],
    ['开关盒子', '.switch', 'both'],
    ['单选', 'input[type=radio]', 'both'],
    ['勾选框', 'input[type=checkbox]:not(.switch input)', 'both'],
    ['小按钮', 'button.btn', 'h'],
    ['页面档位按钮', '.seg .seg-btn', 'h'],
    ['弹窗档位按钮', '.dialog .segbtn', 'h'],
    ['文字链接', 'button.link, .textlink, .addmanual, .guide-line .link', 'h'],
    ['小片', '.dialog .chip', 'h'],
    ['齿轮', '.dialog .gear', 'both'],
    ['弹窗小按钮', '.dialog .mini', 'h'],
    ['弹窗次按钮', '.dialog .ghost', 'h'],
    ['弹窗主按钮', '.dialog .primary', 'h'],
  ]
  const radiusNotes = []
  for (const [kind, sel, how] of kinds) {
    const values = new Set()
    const sizes = new Set()
    for (const n of document.querySelectorAll(sel)) {
      if (!isVis(n) || !inScope(n)) continue
      values.add(getComputedStyle(n).borderTopLeftRadius)
      const r = rectOf(n)
      sizes.add(how === 'both' ? Math.round(r.w) + '×' + Math.round(r.h) : '高 ' + Math.round(r.h))
    }
    if (values.size > 1) radiusNotes.push(kind + ' 的圆角有 ' + [...values].join('、'))
    if (sizes.size > 1) radiusNotes.push(kind + ' 的尺寸有 ' + [...sizes].join('、'))
  }
  return { rows, radiusNotes, size: [innerWidth, innerHeight] }
}

export const AUDIT_SOURCE = `(${auditFn.toString()})()`

// 把体检结果写成一张表（人看的）
export function toTable(pages) {
  const lines = ['| 页面 | 控件 | 视觉矩形 | 点击矩形 | 光标 | 问题 |', '|---|---|---|---|---|---|']
  for (const [name, result] of Object.entries(pages)) {
    for (const row of result.rows) {
      lines.push(`| ${name} | ${row.el}${row.text ? ' ' + row.text : ''} | ${row.visual.join('×')} | ${row.click.join('×')} | ${row.cursor} | ${row.issues.join('；') || '—'} |`)
    }
  }
  return lines.join('\n')
}
