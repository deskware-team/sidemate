// 「加一个自定义模型」弹窗：只管摆界面、收输入、调 IPC。
// 这一页跑在沙箱渲染进程里，引不了带 node 模块的文件，纯逻辑都在主进程那边，这里只 import 同目录的浏览器模块：
// 思考档位、思考参数格式这些数据由主进程随表单带过来（custom.mjs 的 dialogPayload），
// 存盘前主进程还会用 custom.mjs 重新规整一遍，这里的份只管看得见的样子。
// Esc 和滚动那条线这两件共用事放在 overlay.js 里，跟另外两个弹窗同一套。
// 钥匙原文只在钥匙框里，跟着表单进出 IPC，不写进别处。
// 样子：第一层 520 宽、内边距 24、块间距 14、圆角 12。

import { makeEscStack, markScroll } from './overlay.js'
import { withAsk } from './ask-view.js'
import { t } from '../copy/copy.mjs'

const KEY_HINT_NEW = t('custom.keyPlaceholder')
const KEY_HINT_EDIT = t('mcp.keySaved')

// 摆一个节点：class / text / checked / disabled / readonly / value / on 开头的事件，其余走属性
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props || {})) {
    if (name === 'class') node.className = value
    else if (name === 'text') node.textContent = value
    else if (name === 'checked') node.checked = value === true
    else if (name === 'hidden') node.hidden = value === true
    else if (name === 'disabled') node.disabled = value === true
    else if (name === 'readonly') node.readOnly = value === true
    else if (name === 'value') node.value = value ?? ''
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value)
  }
  node.append(...children.filter(Boolean))
  return node
}

// 下拉：白底 1px 线边，箭头摆在框里右边
function dropdown({ items, current, onChange }) {
  const select = el('select', { onchange: () => onChange && onChange(select.value) })
  for (const item of items) select.append(el('option', { value: item.value, text: item.label }))
  select.value = items.some((item) => item.value === current) ? current : (items[0]?.value ?? '')
  const box = el(
    'span',
    { class: 'dd' },
    select,
    el('span', { class: 'caret', text: '▾', 'aria-hidden': 'true' }),
  )
  return { el: box, get: () => select.value, set: (value) => { select.value = value } }
}

// 数字：用户自己填的框，留空就是没填
function numberInput({ current }) {
  const input = el('input', { type: 'number', class: 'numinput small', min: '0', step: '1' })
  input.value = current == null ? '' : String(current)
  return {
    el: input,
    get: () => {
      const num = Number(input.value)
      return input.value.trim() === '' || !Number.isInteger(num) || num <= 0 ? null : num
    },
    set: (value) => { input.value = value == null ? '' : String(value) },
  }
}

// 一个数字框加一行小字：标准三项旁边那句「去哪里查」
function fieldWithHint(label, input, hintText) {
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'flabel', text: label }),
    input,
    el('span', { class: 'fine', text: hintText }),
  )
}

// 打开弹窗：payload 由主进程给（表单 + 思考档位 + 思考参数格式），存好了回调 onSaved 重画模型页
export function openCustomDialog(payload, { onSaved } = {}) {
  const safe = payload || {}
  const state = {
    form: { ...(safe.form || {}) },
    efforts: Array.isArray(safe.efforts) ? safe.efforts : [],
    formats: Array.isArray(safe.thinkingFormats) ? safe.thinkingFormats : [],
    busy: false,
  }
  const model = {
    id: '',
    contextWindow: null,
    maxTokens: null,
    efforts: [],
    effortValues: {},
    vision: false,
    thinkingFormat: null,
    ...(state.form.model && typeof state.form.model === 'object' ? state.form.model : {}),
  }
  state.form = { ...state.form, model }

  const overlay = el('div', { class: 'overlay' })
  // 三种情形：新建一个条目、改这个条目里的某个模型、给这个条目再加一个模型
  const adding = state.form.mode === 'add'
  const editing = Boolean(state.form.entryId) && !adding
  const preset = typeof state.form.preset === 'string' ? state.form.preset : null
  // Esc：一次只关最上面那一层
  const stack = makeEscStack(document)
  let release = () => {}
  const close = () => {
    overlay.remove()
    release()
  }
  release = stack.push({ close })

  const title = el('h2', {
    text: adding
      ? t('custom.titleAddModel')
      : editing
        ? t('common.titleEdit', { name: state.form.name || '' })
        : t('custom.titleAdd'),
  })

  const nameInput = el('input', { type: 'text', value: state.form.name, spellcheck: 'false' })

  // 格式：两块按钮装在一个白框里，选中的墨底反白
  let protocol = state.form.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const openaiButton = el('button', {
    type: 'button', class: 'segbtn', text: t('modelPage.formatOpenai'),
    onclick: () => { protocol = 'openai'; syncSeg() },
  })
  const anthropicButton = el('button', {
    type: 'button', class: 'segbtn', text: t('modelPage.formatAnthropic'),
    onclick: () => { protocol = 'anthropic'; syncSeg() },
  })
  function syncSeg() {
    openaiButton.classList.toggle('on', protocol === 'openai')
    anthropicButton.classList.toggle('on', protocol === 'anthropic')
  }

  const baseInput = el('input', { type: 'text', value: state.form.baseUrl, spellcheck: 'false' })
  const keyInput = el('input', {
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: state.form.id && safe.hasKey === true ? KEY_HINT_EDIT : KEY_HINT_NEW,
  })
  // 加模型时条目那几样是定死的：地址和格式照旧，钥匙用存着的那把（填了新的才换）
  if (adding) {
    nameInput.readOnly = true
    baseInput.readOnly = true
    openaiButton.disabled = true
    anthropicButton.disabled = true
  }

  // 标准三项：模型 ID、上下文窗口、最大输出，都不预填
  const idInput = el('input', { type: 'text', value: model.id, spellcheck: 'false' })
  const ctxInput = numberInput({ current: model.contextWindow })
  const maxInput = numberInput({ current: model.maxTokens })

  // 高级里的输入类型：文本一直在，图片可勾
  const visionBox = el('input', { type: 'checkbox', checked: model.vision === true })

  // 高级里的推理等级：每档一个档位和一个「发送值」
  const effortRows = el('div', { class: 'efforts' })
  const efforts = Array.isArray(model.efforts) ? model.efforts.slice() : []
  const effortValues = { ...(model.effortValues || {}) }

  function renderEfforts() {
    effortRows.replaceChildren()
    efforts.forEach((level, index) => {
      const picker = dropdown({
        items: state.efforts.map((one) => ({ value: one.id, label: one.label })),
        current: level,
        onChange: (value) => {
          efforts[index] = value
          // 换了档位，发送值跟着回到这一档的名字（off 留空）
          effortValues[value] = value === 'off' ? '' : value
          renderEfforts()
        },
      })
      const value = el('input', {
        type: 'text',
        class: 'numinput small',
        value: Object.prototype.hasOwnProperty.call(effortValues, level) ? effortValues[level] : (level === 'off' ? '' : level),
        placeholder: t('custom.effortValue'),
      })
      value.addEventListener('input', () => { effortValues[level] = value.value })
      const drop = el('button', {
        type: 'button',
        class: 'link',
        text: t('custom.effortRemove'),
        onclick: () => {
          efforts.splice(index, 1)
          delete effortValues[level]
          renderEfforts()
        },
      })
      effortRows.append(el('div', { class: 'lrow' }, picker.el, value, drop))
    })
  }
  renderEfforts()

  const addEffort = el('button', {
    type: 'button',
    class: 'link',
    text: t('custom.effortAdd'),
    onclick: () => {
      const used = new Set(efforts)
      const next = state.efforts.find((one) => !used.has(one.id))
      if (!next) return
      efforts.push(next.id)
      effortValues[next.id] = next.id === 'off' ? '' : next.id
      renderEfforts()
    },
  })

  // 高级里的思考参数格式：默认「自动」，就是不写这一项
  const formatSelect = dropdown({
    items: [
      { value: '', label: t('custom.auto') },
      ...state.formats.map((one) => ({ value: one, label: one })),
    ],
    current: model.thinkingFormat || '',
    onChange: () => {},
  })

  const result = el('span', { class: 'result', role: 'status' })
  function say(text, ok = false) {
    result.textContent = text
    result.classList.toggle('ok', ok === true)
  }

  // 随时把输入框里的值收成一份表单
  function collectForm() {
    return {
      ...state.form,
      name: nameInput.value,
      protocol,
      baseUrl: baseInput.value,
      key: keyInput.value,
      model: {
        ...model,
        id: idInput.value.trim(),
        name: idInput.value.trim(),
        contextWindow: ctxInput.get(),
        maxTokens: maxInput.get(),
        efforts: efforts.slice(),
        effortValues: { ...effortValues },
        vision: visionBox.checked === true,
        thinkingFormat: formatSelect.get() === '' ? null : formatSelect.get(),
      },
    }
  }

  const testButton = el('button', { class: 'ghost', type: 'button', text: t('custom.test'), onclick: runTest })
  async function runTest() {
    if (state.busy) return
    state.busy = true
    testButton.disabled = true
    say(t('custom.testing'))
    state.form = collectForm()
    try {
      const back = await window.settings.probe(state.form)
      say(back?.message || (back?.ok ? t('common.probeOk') : ''), back?.ok === true)
    } finally {
      state.busy = false
      testButton.disabled = false
      updateSaveState()
    }
  }

  const saveButton = el('button', { class: 'primary', type: 'button', text: t('common.testSave'), onclick: runSave })
  async function runSave() {
    if (saveButton.disabled || state.busy) return
    state.busy = true
    saveButton.disabled = true
    say(t('custom.testing'))
    try {
      const back = await withAsk(await window.settings.saveCustom(collectForm()), (confirmed) => window.settings.saveCustom(collectForm(), { confirmed }))
      if (!back || !back.ok) {
        say(back?.message || t('stops.saveFailed'))
        return
      }
      close()
      if (typeof onSaved === 'function') onSaved(back)
    } finally {
      state.busy = false
      updateSaveState()
    }
  }

  // 保存按钮的状态只看标准三项齐不齐；缺哪一项，鼠标停上去说明
  function updateSaveState() {
    const form = collectForm()
    const missing = []
    // 预设带来的那几项是我们自己写的，不用用户填；加模型时照旧必填
    if (!preset || adding) {
      if (!form.model.id) missing.push(t('custom.needId'))
      if (form.model.contextWindow == null) missing.push(t('custom.needContext'))
      if (form.model.maxTokens == null) missing.push(t('custom.needMaxOutput'))
    }
    const ok = missing.length === 0 && state.busy !== true
    saveButton.disabled = !ok
    saveButton.title = ok ? '' : missing.join('，')
  }
  idInput.addEventListener('input', updateSaveState)
  ctxInput.el.addEventListener('input', updateSaveState)
  maxInput.el.addEventListener('input', updateSaveState)

  // 弹窗分三段：标题在上、中间自己滚、底下按钮那一排永远露在弹窗里
  const body = el('div', { class: 'dialog-body' })
  const advanced = el('details', { class: 'advanced' })
  advanced.append(
    el('summary', { text: t('custom.advanced') }),
    el('div', { class: 'lrow' }, el('span', { class: 'llabel', text: t('custom.labelInputType') }),
      el('label', { class: 'checkpair' }, el('input', { type: 'checkbox', checked: true, disabled: true }), el('span', { text: t('custom.inputText') })),
      el('label', { class: 'checkpair' }, visionBox, el('span', { text: t('custom.inputImage') }))),
    el('div', { class: 'lrow' }, el('span', { class: 'llabel', text: t('custom.labelThinking') }), effortRows),
    el('div', { class: 'lrow' }, addEffort),
    el('div', { class: 'lrow' }, el('span', { class: 'llabel', text: t('custom.labelThinkingFormat') }), formatSelect.el),
  )
  body.append(
    el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('common.name') }), nameInput),
    el('div', { class: 'field' }, el('span', { class: 'flabel', text: t('custom.labelFormat') }),
      el('div', { class: 'seg', role: 'group' }, openaiButton, anthropicButton)),
    el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('custom.labelUrl') }), baseInput),
    el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('custom.labelKey') }), keyInput),
    fieldWithHint(t('custom.labelModelId'), idInput, t('custom.hintModelId')),
    fieldWithHint(t('custom.labelContext'), ctxInput.el, t('custom.hintWhere')),
    fieldWithHint(t('custom.labelMaxTokens'), maxInput.el, t('custom.hintWhere')),
    el('div', { class: 'testrow' }, testButton, result),
    advanced,
  )
  const dialog = el(
    'div',
    { class: 'dialog' },
    title,
    body,
    el('div', { class: 'actions' },
      el('button', { class: 'ghost', type: 'button', text: t('common.cancel'), onclick: close }),
      saveButton),
  )
  overlay.append(dialog)
  document.body.append(overlay)
  markScroll(dialog, body)
  updateSaveState()
}
