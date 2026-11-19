// Kilo 同意弹窗的页面脚本。
// 判断只有一份：app/consent/logic.mjs（页面脚本能直接 import，页面也照它测）。

import { canAgree, checksEnabled, plainTerms, reachedBottom } from './logic.mjs'
import { paint, t } from '../copy/copy.mjs'

// 页面里写死的字换成文案表里的那一份（窗口第一次显示前调一次）
paint(document)

// 右上角的圆形关闭按钮：窗口没有系统标题栏，关窗走这里（跟点「不同意」一样不记同意）
document.getElementById('win-close').addEventListener('click', () => window.close())

const api = window.consent
const summaryList = document.getElementById('summary')
const termsBox = document.getElementById('terms')
const versionBox = document.getElementById('version')
const checkTerms = document.getElementById('check-terms')
const checkCross = document.getElementById('check-cross')
const labelTerms = document.getElementById('label-terms')
const labelCross = document.getElementById('label-cross')
const message = document.getElementById('message')
const hint = document.getElementById('hint')
const agreeButton = document.getElementById('agree')
const cancelButton = document.getElementById('cancel')

// 到底了就一直算到底，滚回去也不锁
let reached = false

function refresh() {
  const enabled = checksEnabled(reached)
  checkTerms.disabled = !enabled
  checkCross.disabled = !enabled
  agreeButton.disabled = !canAgree({
    reached,
    terms: checkTerms.checked,
    crossBorder: checkCross.checked,
  })
}

function onScroll() {
  if (reached) return
  reached = reachedBottom({
    scrollTop: termsBox.scrollTop,
    clientHeight: termsBox.clientHeight,
    scrollHeight: termsBox.scrollHeight,
  })
  // 到底了：「滚动到底部后可勾选」那条提示收起来
  hint.hidden = reached
  refresh()
}

checkTerms.addEventListener('change', refresh)
checkCross.addEventListener('change', refresh)
termsBox.addEventListener('scroll', onScroll)

agreeButton.addEventListener('click', async () => {
  message.textContent = ''
  const result = await api.agree({ terms: checkTerms.checked, crossBorder: checkCross.checked })
  if (!result || result.ok !== true) {
    // 写盘失败：留着窗口，把话说清楚
    message.textContent = result?.message || t('consent.writeFailed')
  }
})

cancelButton.addEventListener('click', () => {
  api.cancel()
})

// 条款全文：第一行是标题（写成「《标题》」，版本号窗口顶上已经有了），空行分开的是一段段正文
function renderTerms(text, version) {
  const lines = String(text ?? '').split('\n')
  const firstIndex = lines.findIndex((line) => line.trim() !== '')
  if (firstIndex < 0) return
  const title = document.createElement('p')
  title.className = 'terms-title'
  title.textContent = t('consent.termsTitle', { title: lines[firstIndex].trim(), version })
  termsBox.appendChild(title)
  const body = lines.slice(firstIndex + 1).join('\n')
  // 版本已经在标题上写着，正文里重复的「版本 1.0」去掉，后面「生效日期」那半句留着
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rest = body.replace(new RegExp(`^\\s*${t('consent.versionWord')} ${escaped}[\\u3000\\s]*`), '')
  rest
    .split(/\n\s*\n/)
    .map((group) => group.trim())
    .filter((group) => group !== '')
    .forEach((group) => {
      const para = document.createElement('p')
      para.textContent = group.split('\n').join('')
      termsBox.appendChild(para)
    })
}

async function start() {
  const content = await api.content()
  const version = content?.version || '1.0'
  const summary = Array.isArray(content?.summary) ? content.summary : []
  summary.forEach((line) => {
    const item = document.createElement('li')
    item.textContent = line
    summaryList.appendChild(item)
  })
  versionBox.textContent = t('common.version', { version })
  renderTerms(plainTerms(content?.terms || ''), version)
  labelTerms.textContent = content?.checks?.terms || ''
  labelCross.textContent = content?.checks?.crossBorder || ''
  // 内容可能比框矮，这时不用滚就算读完了
  onScroll()
  refresh()
}

start()
