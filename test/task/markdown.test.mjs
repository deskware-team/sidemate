// 回话里的 Markdown 摊成块：标题、列表、表格、粗体、代码、链接、分隔线；不露星号。

import assert from 'node:assert/strict'
import test from 'node:test'
import { httpUrl, markdownBlocks } from '../../app/task/markdown.mjs'

const text = (blocks) => blocks.map((one) => one.segs.map((seg) => seg.text).join('')).join('')

test('标题：井号去掉，整行粗体', () => {
  const blocks = markdownBlocks('### 结构')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'h')
  assert.equal(blocks[0].level, 3)
  assert.equal(text(blocks), '结构')
})

test('列表：横排成 ul，编号成 ol', () => {
  const ul = markdownBlocks('- 一、流派概览\n- 二、病机')
  assert.equal(ul.length, 1)
  assert.equal(ul[0].type, 'ul')
  assert.equal(ul[0].items.length, 2)
  assert.equal(ul[0].items[0].map((one) => one.text).join(''), '一、流派概览')
  const ol = markdownBlocks('1. 表格 5 张\n2. 图 2 张')
  assert.equal(ol[0].type, 'ol')
  assert.equal(ol[0].items.length, 2)
})

test('表格：表头一行、数据若干行', () => {
  const blocks = markdownBlocks('| 文件 | 页 |\n| --- | --- |\n| 甲 | 3 |\n| 乙 | 5 |')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'table')
  assert.deepEqual(blocks[0].head.map((cell) => cell.map((one) => one.text).join('')), ['文件', '页'])
  assert.equal(blocks[0].rows.length, 2)
  assert.deepEqual(blocks[0].rows[1].map((cell) => cell.map((one) => one.text).join('')), ['乙', '5'])
})

test('粗体和代码：星号、反引号都不露出来', () => {
  const blocks = markdownBlocks('**写完了**，产出是 `中医文献综述.docx`。')
  const all = blocks.flatMap((one) => one.segs)
  assert.equal(all.some((one) => one.text.includes('*')), false)
  assert.equal(all.some((one) => one.text.includes('`')), false)
  assert.equal(all.find((one) => one.bold).text, '写完了')
  assert.equal(all.find((one) => one.code).text, '中医文献综述.docx')
})

test('段落和换行：空行分段，行内换行留着', () => {
  const blocks = markdownBlocks('第一段\n还是第一段\n\n第二段')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'p')
  assert.equal(blocks[1].type, 'p')
  assert.equal(blocks[0].segs.map((one) => one.text).join(''), '第一段\n还是第一段')
})

test('像 HTML 的字原样当字；代码块原样留着', () => {
  const html = markdownBlocks('<b>这不是粗体</b>')
  assert.equal(html[0].type, 'p')
  assert.equal(text(html), '<b>这不是粗体</b>')
  const code = markdownBlocks('```\nprint(1)\n```')
  assert.equal(code[0].type, 'code')
  assert.equal(code[0].text, 'print(1)')
})

test('chart 代码块：合法的 JSON 出 chart 块，字段都带着', () => {
  const json = JSON.stringify({
    type: 'bar',
    title: '三家门店本周客流',
    unit: '人次',
    categories: ['东湖店', '南站店', '西苑店'],
    series: [{ name: '本周', data: [2160, 1980, 1650] }],
    source: '门店客流.xlsx · Sheet1 B2:B4',
  })
  const blocks = markdownBlocks('```chart\n' + json + '\n```')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'chart')
  assert.equal(blocks[0].spec.type, 'bar')
  assert.equal(blocks[0].spec.title, '三家门店本周客流')
  assert.equal(blocks[0].spec.unit, '人次')
  assert.deepEqual(blocks[0].spec.categories, ['东湖店', '南站店', '西苑店'])
  assert.deepEqual(blocks[0].spec.series, [{ name: '本周', data: [2160, 1980, 1650] }])
  assert.equal(blocks[0].spec.source, '门店客流.xlsx · Sheet1 B2:B4')
})

test('chart 代码块：折线、饼图也认；多组系列一起收下', () => {
  const json = JSON.stringify({
    type: 'line',
    categories: ['周一', '周二'],
    series: [{ name: '本周', data: [1, 2] }, { name: '上周', data: [3, 4] }],
  })
  const blocks = markdownBlocks('```chart\n' + json + '\n```')
  assert.equal(blocks[0].type, 'chart')
  assert.equal(blocks[0].spec.series.length, 2)
  const pie = markdownBlocks('```chart\n{"type":"pie","categories":["甲"],"series":[{"name":"","data":[1]}]}\n```')
  assert.equal(pie[0].type, 'chart')
  assert.equal(pie[0].spec.type, 'pie')
})

test('chart 代码块：JSON 坏了、字段不对、长度对不上、没闭合，都退回普通代码块', () => {
  const broken = markdownBlocks('```chart\n{"type":"bar",\n```')
  assert.equal(broken[0].type, 'code')
  assert.ok(broken[0].text.includes('{"type":"bar"'))
  // 字段不对：type 不认识、categories 不是字符串、data 不是数
  assert.equal(markdownBlocks('```chart\n{"type":"donut","categories":["甲"],"series":[{"data":[1]}]}\n```')[0].type, 'code')
  assert.equal(markdownBlocks('```chart\n{"type":"bar","categories":[1],"series":[{"data":[1]}]}\n```')[0].type, 'code')
  assert.equal(markdownBlocks('```chart\n{"type":"bar","categories":["甲"],"series":[{"data":["1"]}]}\n```')[0].type, 'code')
  assert.equal(markdownBlocks('```chart\n{"type":"bar","categories":["甲"],"series":[]}\n```')[0].type, 'code')
  // 每组 data 的长度得跟 categories 一样
  assert.equal(markdownBlocks('```chart\n{"type":"bar","categories":["甲","乙"],"series":[{"data":[1]}]}\n```')[0].type, 'code')
  // 块还没闭合（回话还在一个字一个字出来）：当普通代码块
  const open = markdownBlocks('```chart\n{"type":"bar","categories":["甲"],"series":[{"data":[1]}]}')
  assert.equal(open[0].type, 'code')
})

test('别的代码块不受影响：``` 还是代码块', () => {
  const blocks = markdownBlocks('```json\n{"a":1}\n```')
  assert.equal(blocks[0].type, 'code')
  assert.equal(blocks[0].text, '{"a":1}')
})

test('空字符串不炸', () => {
  assert.deepEqual(markdownBlocks(''), [])
  assert.deepEqual(markdownBlocks(null), [])
})

test('链接：只显示文字，地址是原网址，前后的字都在', () => {
  const url = 'https://www.chinanews.com.cn/sh/2026/11-10/10294571.shtml'
  const blocks = markdownBlocks(`看[新华社报道](${url})了`)
  const all = blocks.flatMap((one) => one.segs ?? [])
  const link = all.find((one) => one.link)
  assert.equal(link.text, '新华社报道')
  assert.equal(link.link, url)
  assert.equal(all.map((one) => one.text).join(''), '看新华社报道了')
  // 粗体里的链接还是链接，也还是粗体
  const bold = markdownBlocks('**[报道](https://example.com/a)**').flatMap((one) => one.segs).find((one) => one.link)
  assert.equal(bold.bold, true)
  assert.equal(bold.link, 'https://example.com/a')
})

test('链接：javascript: 和 file: 不成链接；[文字](不是网址) 只留文字', () => {
  const blocks = markdownBlocks('[点我](javascript:alert(1)) 和 [文件](file:///C:/秘密.txt)')
  const all = blocks.flatMap((one) => one.segs ?? [])
  assert.equal(all.some((one) => one.link), false)
  assert.equal(all.map((one) => one.text).join(''), '[点我](javascript:alert(1)) 和 文件')
})

test('链接：模型指着任务文件夹里的文件（[摘要.docx](摘要.docx)）只显示文件名，不露方括号', () => {
  const blocks = markdownBlocks('摘要稿已经生成并交付：[两份中医资料内容摘要.docx](两份中医资料内容摘要.docx)（共 5 页）。')
  const all = blocks.flatMap((one) => one.segs ?? [])
  assert.equal(all.some((one) => one.link), false)
  assert.equal(all.map((one) => one.text).join(''), '摘要稿已经生成并交付：两份中医资料内容摘要.docx（共 5 页）。')
})

test('裸网址：成链接，显示原网址；句尾的句读不算进网址', () => {
  const blocks = markdownBlocks('详见 https://example.com/a?b=1#c 再看 https://example.com/长。')
  const all = blocks.flatMap((one) => one.segs ?? [])
  const links = all.filter((one) => one.link)
  assert.equal(links.length, 2)
  assert.equal(links[0].text, 'https://example.com/a?b=1#c')
  assert.equal(links[0].link, 'https://example.com/a?b=1#c')
  assert.equal(links[1].text, 'https://example.com/长')
  assert.equal(links[1].link, 'https://example.com/长')
  assert.equal(all.map((one) => one.text).join(''), '详见 https://example.com/a?b=1#c 再看 https://example.com/长。')
})

test('分隔线：单独一行的 ---、***、___ 不露字符', () => {
  assert.deepEqual(markdownBlocks('---'), [{ type: 'hr' }])
  for (const bar of ['---', '***', '___', '----------']) {
    assert.deepEqual(markdownBlocks(`上段\n\n${bar}\n\n下段`).map((one) => one.type), ['p', 'hr', 'p'])
    assert.deepEqual(markdownBlocks(`上段\n${bar}\n下段`).map((one) => one.type), ['p', 'hr', 'p'])
  }
})

test('三个以上星号包住的字在段里也是粗体，单独一行的 *** 还是分隔线', () => {
  const blocks = markdownBlocks('****中芯国际三季度净利 73.14 亿元****')
  assert.equal(blocks[0].type, 'p')
  const segs = blocks[0].segs
  assert.equal(segs.some((one) => one.text.includes('*')), false)
  assert.equal(segs.find((one) => one.bold).text, '中芯国际三季度净利 73.14 亿元')
  assert.deepEqual(markdownBlocks('***').map((one) => one.type), ['hr'])
})

test('以「来源：」开头的段落带 src 标记，几行来源合成的一段也算', () => {
  const one = markdownBlocks('来源：甲站 [报道](https://a.example/1)')
  assert.equal(one[0].type, 'p')
  assert.equal(one[0].src, true)
  // 连续几行来源合成的一段：只给整个段落一个标记，里面的链接照旧拆出来
  const merged = markdownBlocks('来源：甲站 [报道](https://a.example/1)\n来源：丙站 [转载](https://c.example/2)')
  assert.equal(merged.length, 1)
  assert.equal(merged[0].src, true)
  assert.equal(merged[0].segs.filter((seg) => seg.link).length, 2)
  // 别的段落不带
  const plain = markdownBlocks('来源在后：另一段\n\n来源：甲站 [报道](https://a.example/1)')
  assert.equal(plain[0].src, undefined)
  assert.equal(plain[1].src, true)
  // 列表、引用里的来源不给
  const bullet = markdownBlocks('- 来源：甲站')
  assert.equal(bullet[0].type, 'ul')
  assert.equal(bullet[0].src, undefined)
})

test('开链接：主进程那边只认 http(s)，带空白和控制字符的一律不开', () => {
  // 算数的：返回解析器规范化后的 href，不是原字符串
  assert.equal(httpUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(httpUrl('http://example.com'), 'http://example.com/')
  assert.equal(httpUrl('HTTPS://EXAMPLE.COM'), 'https://example.com/')
  // 带空格、换行、控制字符的一律不开：new URL 会默默吞掉这些，得先自己查
  assert.equal(httpUrl('https://evil .com'), null)
  assert.equal(httpUrl('https://evil\n.com'), null)
  assert.equal(httpUrl('  https://example.com '), null)
  assert.equal(httpUrl('https://evil\u0000.com'), null)
  // 没有 // 的 https:evil 会被 new URL 拼成 https://evil/，得先看开头
  assert.equal(httpUrl('https:evil'), null)
  assert.equal(httpUrl('javascript:alert(1)'), null)
  assert.equal(httpUrl('file:///C:/x.txt'), null)
  assert.equal(httpUrl(''), null)
  assert.equal(httpUrl(null), null)
})
