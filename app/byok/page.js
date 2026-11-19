// 这一页跑在沙箱渲染进程里，引不了带 node 模块的 first.mjs；
// 「能不能点」这条小规矩在这里照 first.mjs 的 canSubmit 再写一份，主进程那边也会再拦一遍。
import { paint, t } from '../copy/copy.mjs'

// 页面里写死的字换成文案表里的那一份（窗口第一次显示前调一次）
paint(document)

// 右上角的圆形关闭按钮：窗口没有系统标题栏，关窗走这里
document.getElementById('win-close').addEventListener('click', () => window.close())
function canSubmit(key, busy) {
  return busy !== true && String(key ?? '').trim() !== ''
}

const boot = await window.byok.boot()

function show(id) {
  for (const section of document.querySelectorAll('#wizard > section')) section.hidden = section.id !== id
}

// 第三步那句话：小岛冒的那一行，这里说同一句
function showHint(hint) {
  document.querySelector('#hint').textContent = hint || boot.hint
}

// 任何一种选成了：去第三步，放一次小岛开场
async function toIntro(message) {
  document.querySelector('#ok').textContent = message || ''
  show('intro')
  showHint(await window.byok.playIntro())
}

// 「测一下」「用它开始」一类按钮：能不能点照上面的 canSubmit 算，忙时不许再点；
// 不带钥匙框的按钮（如「配好了」）只看忙闲，传个非空的常量进去
function bindSubmit(button, input, result, run) {
  const current = () => (input ? input.value : t('firstRun.noKeyNeeded'))
  const refresh = () => {
    button.disabled = !canSubmit(current(), button.dataset.busy === '1')
  }
  if (input) input.addEventListener('input', refresh)
  button.addEventListener('click', async () => {
    if (!canSubmit(current(), button.dataset.busy === '1')) return
    button.dataset.busy = '1'
    refresh()
    if (result) result.textContent = t('firstRun.testing')
    try {
      await run()
    } finally {
      button.dataset.busy = ''
      refresh()
    }
  })
  refresh()
}

// 密钥获取教程小页：标题、开头、编号步骤、结尾；带链接的那步能开官方页面
async function showGuide(which, backTo) {
  const guide = await window.byok.guide(which)
  document.querySelector('#guide-title').textContent = guide.title
  document.querySelector('#guide-intro').textContent = guide.intro
  const list = document.querySelector('#guide-steps')
  list.replaceChildren()
  for (const step of guide.steps) {
    const item = document.createElement('li')
    const col = document.createElement('div')
    col.className = 'guide-col'
    const text = document.createElement('span')
    text.className = 'step-text'
    text.textContent = step.text
    col.append(text)
    if (step.url) {
      const open = document.createElement('button')
      open.className = 'link'
      open.type = 'button'
      open.textContent = t('guide.openOfficial')
      open.addEventListener('click', () => window.byok.openUrl(step.url))
      col.append(open)
    }
    item.append(col)
    list.append(item)
  }
  document.querySelector('#guide-outro').textContent = guide.outro
  document.querySelector('#guide-back').dataset.back = backTo
  show('guide')
}

// 第一步：「关于桌伴」三句（字在 page.html 的 data-t 里），看完点开始
function initAbout() {
  document.querySelector('#start').addEventListener('click', () => show('model'))
}

// 第二步：推荐一块 + 其他方式三块
function initModel() {
  const input = document.querySelector('#deepseek-key')
  const result = document.querySelector('#deepseek-result')
  bindSubmit(document.querySelector('#deepseek-test'), input, result, async () => {
    const back = await window.byok.saveDeepseek(input.value)
    if (!back.ok) {
      result.textContent = back.message
      return
    }
    input.value = ''
    await toIntro(back.message)
  })
  document.querySelector('#deepseek-guide').addEventListener('click', () => showGuide('deepseek', 'model'))
  document.querySelector('#to-zhipu').addEventListener('click', () => show('zhipu'))
  document.querySelector('#to-custom').addEventListener('click', () => {
    window.byok.openSettings()
    show('custom')
  })
  document.querySelector('#to-kilo').addEventListener('click', async () => {
    const back = await window.byok.useKilo()
    if (back && back.ok) await toIntro('')
  })
  document.querySelector('#guide-back').addEventListener('click', (event) => {
    show(event.currentTarget.dataset.back || 'model')
  })
}

// 智谱那一页
function initZhipu() {
  const input = document.querySelector('#zhipu-key')
  const result = document.querySelector('#zhipu-result')
  document.querySelector('#zhipu-back').addEventListener('click', () => show('model'))
  document.querySelector('#zhipu-guide').addEventListener('click', () => showGuide('zhipu', 'zhipu'))
  bindSubmit(document.querySelector('#zhipu-start'), input, result, async () => {
    const back = await window.byok.saveZhipu(input.value)
    if (!back.ok) {
      result.textContent = back.message
      return
    }
    input.value = ''
    await toIntro(back.message)
  })
}

// 「自己配置模型」：等设置那边配好、选为默认
function initCustom() {
  const result = document.querySelector('#custom-result')
  document.querySelector('#custom-back').addEventListener('click', () => show('model'))
  bindSubmit(document.querySelector('#custom-done'), null, result, async () => {
    const back = await window.byok.checkCustom()
    if (back && back.ok) {
      await toIntro('')
      return
    }
    result.textContent = (back && back.message) || t('firstRun.customNotReady')
  })
}

function initIntro() {
  document.querySelector('#done').addEventListener('click', () => window.byok.close())
}

initAbout()
initModel()
initZhipu()
initCustom()
initIntro()
document.querySelector('#hint').textContent = boot.hint
if (boot.step === 'intro') {
  show('intro')
  window.byok.playIntro().then((hint) => showHint(hint))
}
