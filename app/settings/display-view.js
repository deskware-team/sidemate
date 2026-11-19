// 「显示」页里那两组档位按钮（字号、小岛大小）：做法照 about-view.js——
// 页面那段在 page.html，这里把按钮摆上去、点了报给壳。选中的深底白字，其余白底灰边；
// 按钮点击区至少 44×28，键盘 Tab 能到，左右方向键在组里切。

import { t } from '../copy/copy.mjs'

export const FONT_CHOICES = [
  { value: 0.9, label: t('display.small') },
  { value: 1, label: t('display.standard') },
  { value: 1.15, label: t('display.large') },
  { value: 1.3, label: t('display.xlarge') },
]

export const ISLAND_CHOICES = [
  { value: 0.85, label: t('display.small') },
  { value: 1, label: t('display.standard') },
  { value: 1.25, label: t('display.large') },
]

// 一组按钮：摆上去、标好选中的那颗；左右（上下）方向键往前后档切
function renderGroup(host, kind, choices, current, onPick) {
  const buttons = choices.map((one) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'seg-btn'
    button.textContent = one.label
    button.setAttribute('role', 'radio')
    const on = one.value === current
    button.setAttribute('aria-checked', String(on))
    button.classList.toggle('on', on)
    button.addEventListener('click', () => onPick(kind, one.value))
    return button
  })
  host.replaceChildren(...buttons)
  // 键盘刚切过：重画完把焦点挪到选中的那颗上，方向键才接得上
  if (host.__segKeyboard) {
    const on = buttons.find((one) => one.classList.contains('on'))
    if (on && typeof on.focus === 'function') on.focus()
  }
  // 重画时把上一回挂的键盘监听换掉，别描一次多一个
  if (host.__segKeys) host.removeEventListener('keydown', host.__segKeys)
  const onKey = (event) => {
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : 0
    if (!dir) return
    host.__segKeyboard = true
    const at = buttons.findIndex((one) => one.classList.contains('on'))
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, at + dir))]
    if (!next) return
    next.click()
    if (typeof next.focus === 'function') next.focus()
    event.preventDefault()
  }
  host.__segKeys = onKey
  host.addEventListener('keydown', onKey)
}

// view 是壳给的那份 { fontScale, islandScale }；onPick(kind, value) 点了哪组哪档
export function renderDisplay(view, onPick) {
  const safe = view || {}
  renderGroup(document.querySelector('#font-seg'), 'font', FONT_CHOICES, safe.fontScale, onPick)
  renderGroup(document.querySelector('#island-seg'), 'island', ISLAND_CHOICES, safe.islandScale, onPick)
}
