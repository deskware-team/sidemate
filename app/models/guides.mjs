// 「密钥获取教程」的结构化数据：首次运行和「自定义模型」弹窗里用它渲染步骤。
// 文字照抄定稿，界面只负责排版；链接只允许指向官方页面。

import { t } from '../copy/copy.mjs'

// 允许打开的官方域名：界面打开外链前先用 isGuideUrl 把关。
export const ALLOWED_HOSTS = Object.freeze([
  'platform.deepseek.com',
  'api-docs.deepseek.com',
  'bigmodel.cn',
  'docs.bigmodel.cn',
])

// 一步：文字和链接，链接没有就用 null。
function step(text, url) {
  return Object.freeze({ text, url: url ?? null })
}

// 一份教程：标题、开头、步骤、结尾和官方说明链接。
function guide(title, intro, steps, outro, docs) {
  return Object.freeze({
    title,
    intro,
    steps: Object.freeze(steps.map((item) => step(item[0], item[1]))),
    outro,
    docs: Object.freeze({ label: docs[0], url: docs[1] }),
  })
}

export const GUIDES = Object.freeze({
  deepseek: guide(
    t('guide.deepseekTitle'),
    t('guide.deepseekIntro'),
    [
      [t('guide.deepseekStep1'), 'https://platform.deepseek.com/'],
      [t('guide.deepseekStep2'), null],
      [t('guide.deepseekStep3'), 'https://platform.deepseek.com/api_keys'],
      [t('guide.deepseekStep4'), null],
      [t('guide.deepseekStep5'), null],
    ],
    t('guide.deepseekOutro'),
    [t('guide.deepseekDocs'), 'https://api-docs.deepseek.com/zh-cn/'],
  ),
  zhipu: guide(
    t('guide.zhipuTitle'),
    t('guide.zhipuIntro'),
    [
      [t('guide.zhipuStep1'), 'https://bigmodel.cn/'],
      [t('guide.zhipuStep2'), 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'],
      [t('guide.zhipuStep3'), null],
      [t('guide.zhipuStep4'), null],
      [t('guide.zhipuStep5'), null],
    ],
    t('guide.zhipuOutro'),
    [t('guide.zhipuDocs'), 'https://docs.bigmodel.cn/cn/guide/start/quick-start'],
  ),
})

// 只放行 https 且域名在表里的链接。
export function isGuideUrl(url) {
  if (typeof url !== 'string' || url === '') return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  // 带用户名或密码的地址不放行，免得看起来像官方页面。
  if (parsed.username !== '' || parsed.password !== '') return false
  return ALLOWED_HOSTS.includes(parsed.hostname)
}
