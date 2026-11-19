import { openCustomDialog } from './custom-view.js'
import { openAskDialog, withAsk } from './ask-view.js'
import { openMcpDialog, renderAbilities, renderImportProblems } from './abilities-view.js'
import { openNewsDialog, renderNews, renderNewsPrefs } from './news-view.js'
import { renderLoginItem } from './about-view.js'
import { renderDoc } from './doc-view.js'
import { renderDisplay } from './display-view.js'
import { paint, t } from '../copy/copy.mjs'

// 页面里写死的字换成文案表里的那一份（窗口第一次显示前调一次）
paint(document)

// 右上角的圆形关闭按钮：窗口没有系统标题栏，关窗走这里
document.getElementById('win-close').addEventListener('click', () => window.close())

// 链接右边那个小箭头：画一个 svg，不用 emoji
const ARROW_SVG = '<svg class="arrow" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 7.5L7.5 2.5M7.5 2.5H3.5M7.5 2.5v4" fill="none" stroke="currentColor" stroke-width="1.2"></path></svg>'

const PAGES = ['models', 'caps', 'news', 'usage', 'display', 'about']

const wanted = new URLSearchParams(location.search).get('page')
const initial = PAGES.includes(wanted) ? wanted : 'models'

function showPage(id) {
  for (const name of PAGES) {
    document.querySelector(`#page-${name}`).hidden = name !== id
  }
  for (const item of document.querySelectorAll('#menu .item')) {
    item.classList.toggle('active', item.dataset.page === id)
  }
  // 切到新闻页就重新问一遍主进程：别处刚配好钥匙或工具，这一页立刻能用
  if (id === 'news') refreshNews()
}

for (const item of document.querySelectorAll('#menu .item')) {
  item.addEventListener('click', () => showPage(item.dataset.page))
}

// 用量页：数字都在主进程那边格式化好，这里只摆上去（照 byok 设置页那一份）
async function initUsage() {
  const view = await window.settings.usage()
  const safe = view || { heading: '', total: '0', recent: [] }
  document.querySelector('#usage-heading').textContent = safe.heading
  document.querySelector('#usage-total').textContent = safe.total
  const list = document.querySelector('#usage-recent')
  for (const one of safe.recent) {
    const row = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = one.name
    const date = document.createElement('span')
    date.className = 'date'
    date.textContent = one.date
    const count = document.createElement('span')
    count.className = 'count'
    count.textContent = one.usage
    row.append(name, date, count)
    list.append(row)
  }
}

// 关于页：名字和版本、一句话、两摞卡片（声明和许可、官网和源码）、内嵌的全文页
let aboutData = null
let currentDoc = null

// 「撤回同意」按钮：列表里和全文页右上角各放一个，点了之后两处一起换字
function withdrawButton() {
  const undo = document.createElement('button')
  undo.type = 'button'
  undo.className = 'btn danger withdraw'
  undo.textContent = t('aboutPage.withdraw')
  undo.addEventListener('click', async () => {
    undo.disabled = true
    aboutData.line = await window.settings.withdraw()
    renderDocList()
    renderDocConsent()
  })
  return undo
}

// 「声明和许可」那一摞：一行一份文件，Kilo 须知那行带上同意状态和「撤回同意」
function renderDocList() {
  const list = document.querySelector('#doc-list')
  list.replaceChildren()
  for (const doc of aboutData.docs || []) {
    const row = document.createElement('li')
    const open = document.createElement('button')
    open.className = 'doc'
    open.type = 'button'
    open.textContent = doc.title
    open.addEventListener('click', () => openDoc(doc.name))
    // 右边那个「›」放在按钮里：点它也算点这一行（点在按钮里面的任何地方都算）
    const chev = document.createElement('span')
    chev.className = 'chev'
    chev.textContent = '›'
    open.append(chev)
    row.append(open)
    if (doc.name === 'kilo-terms.md') {
      const status = document.createElement('span')
      status.className = 'status'
      status.textContent = aboutData.line.brief
      row.append(status)
      if (aboutData.line.button) row.append(withdrawButton())
    }
    list.append(row)
  }
}

// 全文页右上角的同意状态：只在 Kilo 模型使用须知那一页出现，带日期的那一长句
function renderDocConsent() {
  const box = document.querySelector('#doc-consent')
  box.querySelector('.withdraw')?.remove()
  if (!aboutData || currentDoc !== 'kilo-terms.md') {
    box.hidden = true
    return
  }
  box.querySelector('.status').textContent = aboutData.line.text
  if (aboutData.line.button) box.append(withdrawButton())
  box.hidden = false
}

async function openDoc(name) {
  currentDoc = name
  const doc = await window.settings.doc(name)
  document.querySelector('#doc-title').textContent = doc.title
  // .md 的照 Markdown 排好（不露 # 和 **），许可证原样摆；文件缺了只写一句
  const box = document.querySelector('#doc-text')
  if (doc.ok) renderDoc(box, name, doc.text)
  else renderDoc(box, '', t('aboutPage.docMissing'))
  box.scrollTop = 0
  renderDocConsent()
  document.querySelector('#about-home').hidden = true
  document.querySelector('#doc-view').hidden = false
}

// 关于页里「开机时自动打开桌伴」那一行：开关拨了走 IPC 到主进程，回来重画这一行
const loginHandlers = {
  onToggle(on) {
    window.settings.loginItemToggle(on === true).then((back) => {
      renderLoginItem(back, loginHandlers)
    })
  },
}

async function initAbout() {
  aboutData = await window.settings.about()
  document.querySelector('#about-version').textContent = t('common.version', { version: aboutData.version })
  renderDocList()
  renderLoginItem(await window.settings.loginItem(), loginHandlers)
  document.querySelector('#doc-back').addEventListener('click', () => {
    document.querySelector('#doc-view').hidden = true
    document.querySelector('#about-home').hidden = false
  })
  document.querySelector('#source').addEventListener('click', () => window.settings.openSource())
  const siteRow = document.querySelector('#site-row')
  if (aboutData.site) {
    siteRow.hidden = false
    siteRow.querySelector('#site').addEventListener('click', () => window.settings.openSite())
  }
}

// 主进程说「先问一句」：弹窗问用户。点「继续保存/继续删除」才照旧做，点了「取消」就不了。
// 返回最后一份模型页数据；用户取消了就还是原来那一份。

// 模型页：一行一个条目（圆点、名字加小标、小字、右边按钮），DeepSeek 那行带钥匙框
function rowButton(row, one, keyform) {
  if (one.id === 'guide') {
    // 没同意过就先弹同意弹窗，同意过了直接跳「关于」页看条款全文
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'link'
    link.textContent = one.label
    link.addEventListener('click', async () => {
      const back = await window.settings.kiloConsent()
      if (back.action === 'doc') {
        showPage('about')
        await openDoc('kilo-terms.md')
        return
      }
      renderModels(back)
    })
    return link
  }
  const button = document.createElement('button')
  button.type = 'button'
  const danger = one.id === 'remove-key' || one.id === 'remove'
  button.className = danger ? 'btn danger' : 'btn'
  button.textContent = one.label
  if (one.id === 'change-key') {
    button.addEventListener('click', () => keyform?.expand())
  } else if (one.id === 'add-model') {
    button.addEventListener('click', () => openCustom(row.id, { mode: 'add' }))
  } else if (one.id === 'remove-key') {
    button.addEventListener('click', async () => {
      renderModels(await withAsk(await window.settings.removeKey(row.id), (confirmed) => window.settings.removeKey(row.id, { confirmed })))
    })
  } else if (one.id === 'remove') {
    button.addEventListener('click', async () => {
      if (row.kind === 'kilo') {
        if (!window.confirm(t('modelPage.removeKiloConfirm'))) return
        renderModels(await withAsk(await window.settings.removeKilo(), (confirmed) => window.settings.removeKilo({ confirmed })))
        return
      }
      if (!window.confirm(t('modelPage.removeConfirm', { name: row.name }))) return
      renderModels(await withAsk(await window.settings.removeCustom(row.id), (confirmed) => window.settings.removeCustom(row.id, { confirmed })))
    })
  }
  return button
}

// DeepSeek 的钥匙框：没钥匙直接展开，有钥匙点了「换钥匙」才展开；测通了才存
function keyForm(open) {
  const form = document.createElement('div')
  form.className = 'keyform'
  form.hidden = !open
  const input = document.createElement('input')
  input.type = 'password'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.placeholder = t('modelPage.keyPlaceholder')
  const test = document.createElement('button')
  test.type = 'button'
  test.className = 'btn'
  test.textContent = t('common.testSave')
  const result = document.createElement('span')
  result.className = 'result'
  test.addEventListener('click', async () => {
    if (test.dataset.busy === '1') return
    test.dataset.busy = '1'
    result.textContent = t('custom.testing')
    try {
      const back = await window.settings.deepseekSave(input.value)
      if (back.ask) {
        const again = await withAsk(back, (confirmed) => window.settings.deepseekSave(input.value, { confirmed }))
        if (again !== back) input.value = ''
        renderModels(again)
        return
      }
      if (!back.ok) {
        result.textContent = back.message
        return
      }
      input.value = ''
      renderModels(back)
    } finally {
      test.dataset.busy = ''
    }
  })
  const guide = document.createElement('button')
  guide.className = 'link'
  guide.type = 'button'
  guide.textContent = t('firstRun.guide')
  guide.insertAdjacentHTML('beforeend', ARROW_SVG)
  guide.addEventListener('click', () => window.settings.openGuide())
  form.append(input, test, result, guide)
  return {
    el: form,
    expand() {
      form.hidden = false
      input.focus()
    },
  }
}

// 「加一个自定义模型」弹窗：表单、预设和档位由主进程一包给齐，存好了用返回的行重画这一页
// id 是条目，options 是 { mode: 'add' } 或者 { modelIndex: 第几个模型 }
async function openCustom(id, options) {
  const back = await window.settings.customForm(id, options)
  if (!back || !back.ok) return
  openCustomDialog(back, { onSaved: (view) => renderModels(view) })
}

function modelRow(row) {
  const item = document.createElement('li')
  const dot = document.createElement('input')
  dot.type = 'radio'
  dot.name = 'models-default'
  // 名字那行是个 label，点了它就等于点了这个单选框
  dot.id = 'models-default-' + String(row.id || '').replace(/[^\w-]/g, '_')
  dot.checked = row.isDefault === true
  dot.disabled = row.canBeDefault !== true
  if (dot.disabled) dot.title = row.whyNot || ''
  dot.addEventListener('change', async () => {
    renderModels(await window.settings.chooseDefault(row.id))
  })
  const text = document.createElement('div')
  text.className = 'text'
  const name = document.createElement('label')
  name.className = row.canBeDefault === true ? 'name' : 'name off'
  name.htmlFor = dot.id
  if (dot.disabled) name.setAttribute('aria-disabled', 'true')
  name.append(row.name)
  for (const tag of row.tags || []) {
    const badge = document.createElement('span')
    badge.className = tag === t('modelPage.tagDefault') ? 'tag dark' : 'tag'
    badge.textContent = tag
    name.append(badge)
  }
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = row.note
  text.append(name, note)
  // 这一把钥匙底下的模型：模型名加一个「改」，点开就是那个模型的表单
  const models = document.createElement('div')
  models.className = 'models'
  ;(row.models || []).forEach((model, index) => {
    const link = document.createElement('button')
    link.type = 'button'
    link.className = 'link'
    link.textContent = model.name || model.id
    link.title = t('modelPage.modify')
    link.addEventListener('click', () => openCustom(row.id, { modelIndex: index }))
    const drop = document.createElement('button')
    drop.type = 'button'
    drop.className = 'link'
    drop.textContent = t('modelPage.remove')
    drop.addEventListener('click', async () => {
      renderModels(await withAsk(await window.settings.removeModel(row.id, model.id), (confirmed) => window.settings.removeModel(row.id, model.id, { confirmed })))
    })
    const one = document.createElement('span')
    one.append(link, drop)
    models.append(one)
  })
  if (models.childElementCount > 0) text.append(models)
  const side = document.createElement('div')
  side.className = 'side'
  const keyform = row.kind === 'deepseek' ? keyForm(row.withKey !== true) : null
  for (const one of row.buttons || []) side.append(rowButton(row, one, keyform))
  item.append(dot, text, side)
  if (keyform) item.append(keyform.el)
  if (row.canSetConcurrency === true) item.append(concurrencyField(row))
  return item
}

// 并发上限：同一把密钥同时能发几个请求，0 表示不限
function concurrencyField(row) {
  const wrap = document.createElement('div')
  wrap.className = 'conc'
  const label = document.createElement('span')
  label.className = 'conc-label'
  label.textContent = t('modelPage.concurrency')
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '0'
  input.step = '1'
  input.className = 'conc-input'
  input.value = String(row.concurrency || 0)
  input.title = t('modelPage.concurrencyHint')
  input.addEventListener('change', async () => {
    renderModels(await window.settings.setConcurrency(row.id, Number(input.value)))
  })
  // 框后面一句小字：0 是不限
  const hint = document.createElement('span')
  hint.className = 'conc-hint'
  hint.textContent = t('modelPage.concurrencyHint')
  wrap.append(label, input, hint)
  return wrap
}

// 画整张列表
function renderModels(view) {
  const safe = view || { rows: [], warning: null, message: '' }
  const list = document.querySelector('#models-list')
  list.replaceChildren()
  const rows = safe.rows || []
  for (const row of rows) list.append(modelRow(row))
  // 清单里没有 Kilo 的时候，才摆「添加 Kilo 模型」那个按钮
  const addKilo = document.querySelector('#models-add-kilo')
  if (addKilo) addKilo.hidden = rows.some((row) => row.kind === 'kilo')
  const warn = document.querySelector('#models-warn')
  warn.hidden = !safe.warning
  warn.textContent = safe.warning || ''
  document.querySelector('#models-message').textContent = safe.message || ''
}

async function initModels() {
  renderModels(await window.settings.models())
  document.querySelector('#models-add').addEventListener('click', () => openCustom(null, null))
  document.querySelector('#models-add-kilo').addEventListener('click', async () => {
    renderModels(await withAsk(await window.settings.addKilo(), (confirmed) => window.settings.addKilo({ confirmed })))
  })
}

// 新闻页：主题列表一行一个主题；加、删、改和开关都走主进程，回来重画这一页
let newsData = { rows: [], hasKey: false, ready: false, busy: '', prefs: { catchUp: true, notify: true } }

function newsMessage(text) {
  const box = document.querySelector('#news-message')
  if (box) box.textContent = text || ''
}

function drawNews() {
  renderNews(newsData, newsHandlers)
  renderNewsPrefs(newsData.prefs, newsPrefsHandlers)
}

function afterNewsSave(back, options = {}) {
  newsData = back && back.rows ? back : newsData
  drawNews()
  newsMessage('')
  // 「保存并生成一份」：存好了，接着走这一行的「现在生成」
  if (options.generate === true) {
    const id = String(back?.topic?.id || options.topicId || '')
    if (id) generateNow({ id })
  }
}

// 「现在生成」：点一下这一行就变「生成中…」，跑完了恢复；跑不出来第二行末尾写红字
async function generateNow(row) {
  const id = String(row?.id || '')
  if (!id || newsData.busy) return
  newsData = { ...newsData, busy: id }
  drawNews()
  try {
    const back = await window.settings.newsGenerate(id)
    const view = back && back.rows ? back : newsData
    newsData = { ...view, busy: '' }
    // 失败那句主进程已经写在那一行末尾了（带回了列表）：列表下面不重复一遍
    const inRow = Boolean(back && back.rows)
    newsMessage(back?.ok === true || inRow ? '' : (back?.message || t('newsPage.failed')))
  } catch {
    newsData = { ...newsData, busy: '' }
    newsMessage(t('stops.newsError'))
  }
  drawNews()
}

async function refreshNews() {
  const view = await window.settings.newsList()
  // 正在生成的那一行别忘了：刷新完了它还是「生成中…」
  newsData = { ...view, busy: newsData.busy }
  drawNews()
}

// 删一个主题：弹窗里那个「删掉这个主题」走这里
function removeNewsTopic(row, close) {
  if (!window.confirm(t('newsPage.removeConfirm', { name: row.name }))) return
  window.settings.newsRemove(row.id).then((back) => {
    if (typeof close === 'function') close()
    newsData = back && back.rows ? back : newsData
    drawNews()
  })
}

const newsHandlers = {
  onEdit(row) {
    openNewsDialog(
      { form: row.form },
      { onSaved: afterNewsSave, onRemove: removeNewsTopic },
    )
  },
  onToggle(row, on) {
    window.settings.newsToggle(row.id, on === true).then(refreshNews)
  },
  onGenerate(row) {
    generateNow(row)
  },
}

// 整页的那两项设置：错过补不补、好了说不说
const newsPrefsHandlers = {
  onToggle(key, on) {
    const prefs = { ...(newsData.prefs || {}), [key]: on === true }
    window.settings.newsSavePrefs(prefs).then((back) => {
      newsData = { ...newsData, prefs: (back && back.prefs) || prefs }
      renderNewsPrefs(newsData.prefs, newsPrefsHandlers)
    })
  },
}

async function initNews() {
  document.querySelector('#news-add').addEventListener('click', () => {
    // 模型不能联网搜时这个按钮是灰的，这里再挡一道
    if (newsData.ready !== true) return
    openNewsDialog({ form: null }, { onSaved: afterNewsSave })
  })
  await refreshNews()
}

// 能力页：技能、联网搜索、MCP 三张卡，加、删、改和开关都走主进程，回来重画这一页
async function refreshAbilities() {
  const view = await window.settings.abilitiesList()
  abData = view || abData
  renderAbilities(abData, abHandlers)
}

async function openMcpDialogFor(id) {
  const payload = await window.settings.abilitiesMcpForm(id || null)
  if (!payload || payload.ok !== true) return
  openMcpDialog(payload, {
    onSaved: () => refreshAbilities(),
    onRemove: (form, close) => {
      window.settings.abilitiesMcpRemove(form.id).then(() => {
        close()
        refreshAbilities()
      })
    },
  })
}

const abHandlers = {
  onSkillButton(id, row) {
    if (id !== 'remove') return
    if (!window.confirm(t('abilities.removeConfirm', { name: row.name }))) return
    window.settings.abilitiesSkillRemove(row.id).then(() => refreshAbilities())
  },
  // 第二行里的仓库地址：用系统浏览器打开（主进程那边只放行 GitHub 仓库地址）
  onSkillLink(url) {
    window.settings.abilitiesOpenRepo(url)
  },
  onSkillToggle(row, on) {
    window.settings.abilitiesSkillToggle(row.source, row.id, on === true).then(refreshAbilities)
  },
  onToolToggle(row, on) {
    window.settings.abilitiesToolToggle(row.id, on === true).then(refreshAbilities)
  },
  onMcpButton(id, row) {
    if (id === 'edit') openMcpDialogFor(row.id)
  },
  onMcpToggle(row, on) {
    window.settings.abilitiesMcpToggle(row.id, on === true).then(refreshAbilities)
  },
}

let abData = { skills: [], tools: [], mcp: [], mcpEmpty: true }

async function initAbilities() {
  document.querySelector('#ab-import').addEventListener('click', async () => {
    const back = await window.settings.abilitiesImport()
    const safe = back && typeof back === 'object' ? back : {}
    if (safe.canceled === true) return
    renderImportProblems(safe.ok === true ? [] : safe.problems || [safe.message || t('abilities.importFailed')])
    refreshAbilities()
  })
  document.querySelector('#ab-open-folder').addEventListener('click', async () => {
    await window.settings.abilitiesOpenFolder()
  })
  document.querySelector('#ab-mcp-add').addEventListener('click', () => openMcpDialogFor(null))
  await refreshAbilities()
}

// 显示页：两组档位按钮；点了发 IPC 给主进程，回来重画（开着的窗那边自己变）
function pickDisplay(kind, value) {
  window.settings.zoomSet(kind, value).then((view) => renderDisplay(view, pickDisplay))
}

async function initDisplay() {
  renderDisplay(await window.settings.zoom(), pickDisplay)
}

showPage(initial)
initUsage()
initAbout()
initModels()
initNews()
initAbilities()
initDisplay()
