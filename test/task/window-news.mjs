// 任务窗「新闻」画面的料：一份三条的新闻页当回话、量样子的脚本。
// 单独放一个文件：window-main.mjs 有 800 行的限度，料放这边。

import { createTask, reduceTask, toTaskView } from '../../app/task/state.mjs'

// 一页新闻的样子：三条、条间细线、来源行。标题故意带着 ****（免费模型交上来的样子），
// 看页面把它解成粗体而不是露星号；来源行两行合成一段，看它变小号灰字。
export const NEWS_TEXT = [
  '# AI 行业 2026-11-12 新闻',
  '',
  '一件模型发布值得看，其余是融资和人事。',
  '',
  '## 今天',
  '',
  '****甲厂发布新模型，同尺寸能耗降三成****',
  '',
  '能耗降三成，两家都报了。',
  '',
  '来源：甲站 [甲厂发布新模型](https://a.example/news/new-model)',
  '来源：丙站 [丙站也报了](https://c.example/news/model-again)',
  '',
  '---',
  '',
  '****乙厂完成 B 轮融资****',
  '',
  'B 轮。',
  '',
  '来源：乙站 [乙厂完成 B 轮融资](https://b.example/news/funding)',
  '',
  '---',
  '',
  '**网上的一条**',
  '',
  '搜到的。',
  '',
  '来源：戊网 [网上的原文](https://w.example/news/x)',
  '',
  '共参考 4 个来源',
  '',
].join('\n')

// 用这一页当它说的回话
export function newsScene(opts) {
  let s = createTask()
  s = reduceTask(s, { type: 'send', text: '今天的新闻', runId: 'n1' }).state
  s = reduceTask(s, { type: 'reply', taskId: 'n1', text: NEWS_TEXT }).state
  s = reduceTask(s, { type: 'end', taskId: 'n1', status: 'done' }).state
  return toTaskView(s, opts)
}

// 量这一页：标题解成粗体（字重 ≥ 600）、星号不露；条间细线 2 条、上下间距 12px；
// 「来源：」段落 12px 小字、里面的链接还在
export const NEWS_METER = `(() => {
  const md = document.querySelector('.reply .md')
  const strong = md.querySelector('p strong')
  const hrs = [...md.querySelectorAll('hr')]
  const hr = hrs[0] ? getComputedStyle(hrs[0]) : null
  const src = md.querySelector('p.src')
  return {
    weight: strong ? getComputedStyle(strong).fontWeight : '0',
    stars: md.textContent.includes('*'),
    hrs: hrs.length,
    hrMargin: hr ? [hr.marginTop, hr.marginBottom] : [],
    srcSize: src ? getComputedStyle(src).fontSize : '',
    srcCount: md.querySelectorAll('p.src').length,
    srcLinks: src ? src.querySelectorAll('a').length : 0,
  }
})()`
