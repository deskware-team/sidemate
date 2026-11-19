// 「关于」页的纯函数：四份文档落在哪、同意状态那一行怎么写、外链只放行哪个地址。
// 不碰 electron，node --test 直接测。

import { dirname, join } from 'node:path'
import { t } from '../copy/copy.mjs'

// 四份文档：界面上一行一个，title 是那一行的字，name 用来找文件
export const DOCS = [
  { name: 'PRIVACY.md', title: t('aboutPage.docPrivacy') },
  { name: 'kilo-terms.md', title: t('consent.title') },
  { name: 'THIRD-PARTY-NOTICES.txt', title: t('aboutPage.docThirdParty') },
  { name: 'LICENSE', title: t('aboutPage.docLicense') },
]

// 源码仓库：外链只放行这一个地址。官网地址还没定，先留空，空着就不显示那一行。
export const SOURCE_URL = 'https://github.com/deskware-team/sidemate'
export const SITE_URL = ''

// 只认源码仓库这一个地址，别的（差一个字符、长得像的）都不放行
export function isSourceUrl(url) {
  return url === SOURCE_URL
}

// 文档落在哪：
//   Kilo 模型使用须知一直跟着 app/legal 走，开发和打包同一条路（appPath 是仓库根 / 应用目录）；
//   隐私声明和开源许可开发时在仓库根，打包后进应用目录，两种都在 appPath 下；
//   第三方组件声明开发时在仓库根，打包后被 extraFiles 放到 exe 旁边的安装目录。
export function docPath(name, { packaged = false, appPath = '', execPath = '' } = {}) {
  if (name === 'kilo-terms.md') return join(appPath, 'app', 'legal', 'kilo-terms.md')
  if (packaged && name === 'THIRD-PARTY-NOTICES.txt') return join(dirname(execPath), name)
  return join(appPath, name)
}

function dateLabel(at) {
  const date = new Date(at)
  const two = (n) => String(n).padStart(2, '0')
  return `${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

// 同意状态那一行：text 是全文页右上角的字（带日期），brief 是列表行里那一段短的；
// button 是「撤回同意」按钮，没有就是 null。四种情况：没同意过、已同意（默认模型还是
// Kilo 那条线路时加一句提醒）、同意的是旧条款、同意过又撤回了。
export function consentLine(status, { defaultIsFree = false } = {}) {
  const s = status || {}
  if (s.agreed) {
    const day = Number.isFinite(s.at) ? dateLabel(s.at) : ''
    const brief = t('aboutPage.agreed', { version: s.version ?? '' })
    // 记录里没有日子（文件被改过）就只说同意了哪一版
    const text = !day ? brief : defaultIsFree
      ? t('aboutPage.agreedFree', { version: s.version ?? '', date: day })
      : t('aboutPage.agreedFull', { version: s.version ?? '', date: day })
    return { text, brief, button: t('aboutPage.withdraw') }
  }
  if (s.stale) return { text: t('aboutPage.stale'), brief: t('aboutPage.staleShort'), button: null }
  // 撤回以后记录里还留着版本和时间：靠这个跟「从没同意过」分开
  if (s.at != null && s.version != null) {
    return { text: t('aboutPage.withdrawn'), brief: t('aboutPage.withdrawnShort'), button: null }
  }
  return { text: t('aboutPage.never'), brief: t('aboutPage.never'), button: null }
}
