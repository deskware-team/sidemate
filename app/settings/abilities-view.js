// 「能力」页和「加一个 MCP」弹窗：只管摆界面、收输入、调 IPC。
// 这一页跑在沙箱渲染进程里，引不了带 node 模块的文件，纯逻辑都在主进程那边，这里只 import 同目录的浏览器模块：
// 纯逻辑都在主进程那边（app/settings/abilities.mjs），这里只管看得见的样子。
// 样子：三张列表卡加弹窗，弹窗 480 宽、块间距 16、内边距 24、圆角 12。
// Esc 和滚动那条线这两件共用事放在 overlay.js 里，跟另外两个弹窗同一套。

import { makeEscStack, markScroll } from './overlay.js'
import { openAskDialog } from './ask-view.js'
import { t } from '../copy/copy.mjs'

// 跟 app/settings/abilities.mjs 里同一套话（渲染进程引不了那个文件，这里抄一份）
const MCP_EMPTY_TEXT = t('abilities.mcpEmpty')
const SAVED_KEY_PLACEHOLDER = t('mcp.keySaved')
const HOW_TO_FILL_TEXT = t('mcp.howToText')
const MCP_WARN_TEXT = t('mcp.warn')
// 每种放法默认的名字（跟 app/settings/abilities.mjs 里同一套，渲染进程引不了那个文件）
const AUTH_DEFAULT_NAME = { header: 'Authorization', query: 'key' }

// 摆一个节点：class / text / checked / disabled / value / on 开头的事件，其余走属性
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props || {})) {
    if (name === 'class') node.className = value
    else if (name === 'text') node.textContent = value
    else if (name === 'checked') node.checked = value === true
    else if (name === 'hidden') node.hidden = value === true
    else if (name === 'disabled') node.disabled = value === true
    else if (name === 'value') node.value = value ?? ''
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value)
  }
  node.append(...children.filter(Boolean))
  return node
}

// 开关：32×18 的轨条加圆点，勾上墨底白点滑到右边
function switchBox(checked, onChange, disabled = false) {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) })
  return el('label', { class: `switch${disabled ? ' off' : ''}` }, input, el('span', { class: 'track' }))
}

// —————————————————————————————— 页面 ——————————————————————————————

// 第二行：能点的那一段（仓库地址）单独摆一个按钮，其余就是字；几段之间用「，」（跟 abilities.mjs 拼 note 同一个）
function noteNode(row, handlers) {
  const parts = Array.isArray(row.parts) ? row.parts.filter(Boolean) : []
  if (parts.length === 0) {
    const props = { class: 'note', text: row.note || '' }
    if (row.note) props.title = row.note
    return el('p', props)
  }
  const node = el('p', { class: 'note' })
  parts.forEach((part, index) => {
    if (index > 0) node.append(document.createTextNode('，'))
    if (part.url) {
      node.append(el('button', {
        type: 'button',
        class: 'textlink',
        text: part.text,
        title: part.title || part.text,
        onclick: () => handlers?.onLink?.(part.url, row),
      }))
    } else {
      node.append(document.createTextNode(part.text))
    }
  })
  node.title = row.note || ''
  return node
}

// 一行：第一行名字加小标，第二行一句话（超长省略号，全文放 title）；右边小按钮和开关
function entryRow(row, handlers) {
  const text = el('div', { class: 'text' })
  const name = el('p', { class: 'name', text: row.name || '' })
  for (const badge of row.badges || []) name.append(el('span', { class: `tag${badge.kind === 'line' ? ' line' : ''}`, text: badge.text }))
  text.append(name, noteNode(row, handlers))
  const side = el('div', { class: 'side' })
  for (const one of row.buttons || []) {
    side.append(el('button', {
      type: 'button',
      class: 'btn',
      text: one.label,
      onclick: () => handlers?.onButton?.(one.id, row),
    }))
  }
  if (row.toggle !== false) side.append(switchBox(row.enabled === true, (on) => handlers?.onToggle?.(row, on), row.disabled === true))
  const item = el('li', {}, text, side)
  return item
}

// 画一整张列表：没条目时摆一句空状态的话
function renderList(selector, rows, emptyText, handlers) {
  const list = document.querySelector(selector)
  if (!list) return
  list.replaceChildren()
  if (!rows || rows.length === 0) {
    list.append(el('li', { class: 'empty', text: emptyText || '' }))
    return
  }
  for (const row of rows) list.append(entryRow(row, handlers))
}

// 画整页：技能、联网搜索、MCP 三张卡
export function renderAbilities(view, handlers = {}) {
  const safe = view || {}
  renderList('#ab-skills', safe.skills, '', {
    onButton: (id, row) => handlers?.onSkillButton?.(id, row),
    onToggle: (row, on) => handlers?.onSkillToggle?.(row, on),
    onLink: (url, row) => handlers?.onSkillLink?.(url, row),
  })
  renderList('#ab-tools', safe.tools, '', {
    onToggle: (row, on) => handlers?.onToolToggle?.(row, on),
  })
  renderList('#ab-mcp', safe.mcp, safe.mcpEmptyText || MCP_EMPTY_TEXT, {
    onButton: (id, row) => handlers?.onMcpButton?.(id, row),
    onToggle: (row, on) => handlers?.onMcpToggle?.(row, on),
  })
}

// 导入失败的问题清单：摆在「＋ 导入技能」按钮下面，一行一句红字
export function renderImportProblems(problems) {
  const box = document.querySelector('#ab-import-problems')
  if (!box) return
  box.replaceChildren()
  for (const one of Array.isArray(problems) ? problems : []) {
    box.append(el('li', { text: String(one ?? '') }))
  }
}

// —————————————————————————————— 弹窗 ——————————————————————————————

// 一小段哈希：给表单算指纹用（只在这里和页面内存里过一下，不往外传）
function shortHash(text) {
  let h = 5381
  for (const ch of String(text)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0
  return h.toString(36)
}

// 「加一个 MCP」弹窗：改条目也用它。payload.form 由主进程给，存好了回调 onSaved 重画这一页。
export function openMcpDialog(payload, { onSaved, onRemove } = {}) {
  const safe = payload || {}
  const form = { ...(safe.form || {}) }

  const overlay = el('div', { class: 'overlay' })
  // Esc 关这个弹窗；关掉时把 keydown 监听撤掉
  const stack = makeEscStack(document)
  let release = () => {}
  const close = () => {
    overlay.remove()
    release()
  }
  release = stack.push({ close })

  const title = el('h2', { text: form.id ? t('common.titleEdit', { name: form.name || '' }) : t('mcp.titleAdd') })

  // 现在的表单连钥匙一起算个指纹；跟测过那次的指纹一样，「存下」才能点。
  // 跟主进程 app/settings/abilities.mjs 的 formFingerprint 同口径：值空着又没旧钥匙时放法当 none。
  let tested = null
  function argLines() {
    return argsArea.value.split(/\r?\n/).map((one) => one.trim()).filter((one) => one !== '')
  }
  function fingerprint() {
    if (transport() === 'stdio') {
      const secret = localSecretInput.value
      const kind = secret === '' && form.hasSavedKey !== true ? 'none' : 'env'
      return ['stdio', commandInput.value.trim(), argLines().join('\n'), kind, envNameInput.value.trim(), secret.length, shortHash(secret)].join('|')
    }
    const secret = secretInput.value
    const kind = secret === '' && form.hasSavedKey !== true ? 'none' : authKind
    return [urlInput.value.trim(), kind, authNameInput.value.trim(), secret.length, shortHash(secret)].join('|')
  }
  function syncSave() {
    saveButton.disabled = !(tested && tested.ok === true && tested.fingerprint === fingerprint())
  }

  // 怎么连：填网址 / 本机程序 / 粘贴配置
  const MODES = ['url', 'local', 'paste']
  let mode = form.transport === 'stdio' ? 'local' : 'url'
  // 现在填的是哪一种：本机程序那一页是 stdio，别的是网址型
  const transport = () => (mode === 'local' ? 'stdio' : 'http')
  const modeButtons = [
    { id: 'url', label: t('mcp.modeUrl') },
    { id: 'local', label: t('mcp.modeLocal') },
    { id: 'paste', label: t('mcp.modeConfig') },
  ].map((one) => el('button', {
    type: 'button',
    class: 'segbtn',
    text: one.label,
    onclick: () => pickMode(one.id),
  }))
  const modeSeg = el('div', { class: 'seg', role: 'group' }, ...modeButtons)
  function pickMode(value) {
    mode = value
    modeButtons.forEach((button, index) => button.classList.toggle('on', MODES[index] === value))
    pasteBox.hidden = value !== 'paste'
    urlField.hidden = value !== 'url'
    keyField.hidden = value !== 'url'
    localFields.forEach((one) => { one.hidden = value !== 'local' })
    pasteResult.replaceChildren()
    if (value === 'paste') pasteArea.value = ''
    // 换了一页，上一次「测试」的结果（红字、几个工具）作废：收起来
    probeCard.hidden = true
    syncSave()
  }

  // 名字和网址
  const nameInput = el('input', { type: 'text', value: form.name || '', spellcheck: 'false', oninput: syncSave })
  const urlInput = el('input', { type: 'text', value: form.url || '', spellcheck: 'false', oninput: syncSave })
  const nameField = el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('common.name') }), nameInput)
  const urlField = el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('mcp.labelUrl') }), urlInput)

  // 粘贴配置那一页：名字下面换成一个多行框，贴进去自动解析
  const pasteArea = el('textarea', { class: 'area', rows: '4', spellcheck: 'false', placeholder: t('mcp.configPlaceholder') })
  const pasteResult = el('div', { class: 'pasteresult' })
  const pasteBox = el('label', { class: 'field', hidden: true },
    el('span', { class: 'flabel', text: t('mcp.labelConfig') }),
    pasteArea,
    pasteResult)
  let pasteTimer = 0
  pasteArea.addEventListener('input', () => {
    clearTimeout(pasteTimer)
    pasteTimer = setTimeout(runPaste, 350)
  })
  async function runPaste() {
    const text = pasteArea.value.trim()
    pasteResult.replaceChildren()
    if (!text) return
    const back = await window.settings.abilitiesParse(text)
    const parsed = back && typeof back === 'object' ? back : {}
    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(Boolean) : []
    const problems = (Array.isArray(parsed.problems) ? parsed.problems : []).filter(Boolean)
    for (const one of problems) {
      pasteResult.append(el('p', { class: 'bad', text: `${one.name ? `${one.name}：` : ''}${one.message ?? ''}` }))
    }
    if (entries.length === 0) return
    // 第一个条目和它的钥匙填回「填网址」或「本机程序」那一页
    const first = entries[0]
    const auth = first.auth && typeof first.auth === 'object' ? first.auth : {}
    const secret = String((parsed.secrets && parsed.secrets[first.name]) ?? '')
    nameInput.value = String(first.name ?? '')
    if (first.transport === 'stdio') {
      commandInput.value = String(first.command ?? '')
      argsArea.value = (Array.isArray(first.args) ? first.args : []).map((one) => String(one)).join('\n')
      envNameInput.value = auth.kind === 'env' ? String(auth.name ?? '') : ''
      localSecretInput.value = secret
      // 不是钥匙的那些环境变量原样带着，页面上不改
      form.env = first.env && typeof first.env === 'object' && !Array.isArray(first.env) ? { ...first.env } : {}
      pickMode('local')
    } else {
      urlInput.value = String(first.url ?? '')
      pickAuth(auth.kind === 'query' ? 'query' : 'header')
      authNameInput.value = String(auth.name ?? '') || AUTH_DEFAULT_NAME[authKind]
      secretInput.value = secret
      pickMode('url')
    }
    if (entries.length > 1) {
      // 切回填写那一页以后提示还有几个没加，摆在底下按钮旁边
      problem.textContent = t('mcp.multiPaste', { count: entries.length })
    }
    syncSave()
  }

  // 钥匙放在哪：请求头 / 网址参数，总选中一个（默认请求头）；名字预填对应的默认名，
  // 用户自己改过名字就不动它。值空着就当不要钥匙。
  let authKind = form.authKind === 'query' ? 'query' : 'header'
  const authButtons = [
    { id: 'header', label: t('mcp.keyInHeader') },
    { id: 'query', label: t('mcp.keyInQuery') },
  ].map((one) => el('button', {
    type: 'button',
    class: 'segbtn',
    text: one.label,
    onclick: () => pickAuth(one.id),
  }))
  const authSeg = el('div', { class: 'seg', role: 'group' }, ...authButtons)
  function pickAuth(value) {
    const plain = authNameInput.value === '' || authNameInput.value === AUTH_DEFAULT_NAME[authKind]
    authKind = value
    authButtons.forEach((button, index) => button.classList.toggle('on', ['header', 'query'][index] === value))
    if (plain) authNameInput.value = AUTH_DEFAULT_NAME[value]
    syncSave()
  }

  // 一排「名字」150 宽和「值」框；值是钥匙，用不回显的输入框，有旧钥匙就写占位话
  const authNameInput = el('input', { type: 'text', value: form.authName || '', spellcheck: 'false', oninput: syncSave })
  const secretInput = el('input', {
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: syncSave,
  })
  secretInput.placeholder = form.hasSavedKey === true ? SAVED_KEY_PLACEHOLDER : ''
  const keyRow = el('div', { class: 'keyrow' },
    el('label', { class: 'keyname' }, el('span', { class: 'klabel', text: t('common.name') }), authNameInput),
    el('label', { class: 'keyvalue' }, el('span', { class: 'klabel', text: t('mcp.labelKeyValue') }), secretInput))
  // 这一行不摆占位按钮（多请求头那个「＋」永远灰着，鼠标停上去只写一句「还没接上」）：
  // 点不中的别像按钮，所以右边也不留空框。
  const keyField = el('div', { class: 'field' },
    el('span', { class: 'flabel', text: t('mcp.labelKeyWhere') }),
    authSeg,
    keyRow)

  // 本机程序那一页：程序（完整路径或 npx 这类名字）、参数一行一个、钥匙放进哪个环境变量
  const commandInput = el('input', { type: 'text', value: form.command || '', spellcheck: 'false', placeholder: t('mcp.commandPlaceholder'), oninput: syncSave })
  const argsArea = el('textarea', { class: 'area', rows: '3', spellcheck: 'false', oninput: syncSave })
  argsArea.value = form.args || ''
  const envNameInput = el('input', { type: 'text', value: form.envName || '', spellcheck: 'false', oninput: syncSave })
  const localSecretInput = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', oninput: syncSave })
  localSecretInput.placeholder = form.hasSavedKey === true ? SAVED_KEY_PLACEHOLDER : ''
  const localFields = [
    el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('mcp.labelCommand') }), commandInput),
    el('label', { class: 'field' }, el('span', { class: 'flabel', text: t('mcp.labelArgs') }), argsArea),
    el('div', { class: 'field' },
      el('span', { class: 'flabel', text: t('mcp.labelEnvKey') }),
      el('div', { class: 'keyrow' },
        el('label', { class: 'keyname' }, el('span', { class: 'klabel', text: t('mcp.labelEnvName') }), envNameInput),
        el('label', { class: 'keyvalue' }, el('span', { class: 'klabel', text: t('mcp.labelKeyValue') }), localSecretInput))),
  ]
  // 这一次「测一下」/「存下」交给主进程的那份：哪种、填了什么
  function formPayload() {
    const base = { id: form.id || '', name: nameInput.value, enabled: form.enabled !== false, hasSavedKey: form.hasSavedKey === true }
    if (transport() === 'stdio') {
      return { ...base, transport: 'stdio', command: commandInput.value.trim(), args: argsArea.value, envName: envNameInput.value, env: form.env || {}, secret: localSecretInput.value }
    }
    return { ...base, transport: 'http', url: urlInput.value.trim(), authKind, authName: authNameInput.value, secret: secretInput.value }
  }

  // 测了以后的白卡：通了勾一下写有几个工具，没通写红字原因；没测时不显示
  const probeCard = el('div', { class: 'probe', hidden: true })
  function showProbe(result) {
    probeCard.hidden = false
    probeCard.replaceChildren()
    if (result.ok === true) {
      probeCard.append(
        el('p', { class: 'okline', text: t('mcp.testOk', { count: (result.tools || []).length }) }),
        el('p', { class: 'tools', text: (result.tools || []).join('、') }),
      )
    } else {
      probeCard.append(el('p', { class: 'badline', text: result.message || t('stops.mcpOther') }))
    }
  }

  // 底下：改条目时最左边「删掉这个 MCP」；「怎么填？」点开一段说明；右边「测一下」「存下」
  const problem = el('span', { class: 'result bad', role: 'status' })
  const removeLink = form.id
    ? el('button', { type: 'button', class: 'textlink deletelink', text: t('mcp.removeLink'), onclick: async () => {
        const yes = await openAskDialog({ text: t('mcp.removeConfirm', { name: form.name || form.id }), ok: t('common.delete'), cancel: t('common.cancel'), danger: true })
        if (!yes) return
        if (typeof onRemove === 'function') onRemove(form, close)
      } })
    : null
  const howtoText = el('p', { class: 'howto', text: HOW_TO_FILL_TEXT, hidden: true })
  const howtoLink = el('button', { type: 'button', class: 'textlink', text: t('mcp.howTo'), onclick: () => {
    howtoText.hidden = !howtoText.hidden
  } })
  const testButton = el('button', { class: 'ghost', type: 'button', text: t('common.test'), onclick: runTest })
  const saveButton = el('button', { class: 'primary', type: 'button', text: t('mcp.save'), onclick: runSave })

  async function runTest() {
    if (testButton.disabled) return
    const missing = transport() === 'stdio'
      ? (commandInput.value.trim() ? '' : t('mcp.testNeedCommand'))
      : (urlInput.value.trim() ? '' : t('mcp.testNeedUrl'))
    if (missing) {
      showProbe({ ok: false, message: missing })
      tested = null
      syncSave()
      return
    }
    testButton.disabled = true
    problem.textContent = ''
    try {
      const back = await window.settings.abilitiesProbe(formPayload())
      const result = back && typeof back === 'object' ? back : {}
      showProbe(result)
      // 回来以后拿现在这份表单的指纹记下；之后一改输入就不算数
      tested = { ok: result.ok === true, tools: result.tools || [], message: String(result.message ?? ''), fingerprint: fingerprint() }
    } finally {
      testButton.disabled = false
      syncSave()
    }
  }

  async function runSave() {
    if (saveButton.disabled) return
    saveButton.disabled = true
    problem.textContent = ''
    try {
      const back = await window.settings.abilitiesMcpSave(formPayload(), tested)
      if (!back || back.ok !== true) {
        problem.textContent = (back && back.errors && back.errors[0]) || t('stops.saveFailed')
        return
      }
      close()
      if (typeof onSaved === 'function') onSaved(back)
    } finally {
      saveButton.disabled = false
    }
  }

  // 弹窗分三段：标题在上、中间自己滚、底下按钮那一排永远露在弹窗里
  const body = el('div', { class: 'dialog-body' })
  body.append(
    el('div', { class: 'field' }, el('span', { class: 'flabel', text: t('mcp.labelHow') }), modeSeg),
    nameField,
    urlField,
    ...localFields,
    pasteBox,
    keyField,
    probeCard,
    el('p', { class: 'ab-warn', text: MCP_WARN_TEXT }),
  )
  const dialog = el('div', { class: 'dialog ab-dialog' },
    title,
    body,
    el('div', { class: 'actions' },
      removeLink,
      howtoLink,
      el('span', { class: 'grow' }),
      problem,
      testButton,
      saveButton),
    // 「怎么填？」点开的那段说明放在按钮排底下，一直看得见
    howtoText)
  overlay.append(dialog)

  pickMode(mode)
  pickAuth(authKind)
  document.body.append(overlay)
  markScroll(dialog, body)
}
