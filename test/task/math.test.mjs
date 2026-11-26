// 对话里的公式：单独一段的 $$...$$、\[...\]、```math 块，和行内的 $...$、\(...\)。
// 行内的 $ 有三条规矩：开头的 $ 后面不能是空格；结尾的 $ 前面不能是空格；
// 结尾的 $ 后面不能紧跟数字（「花了 $5 和 $10」不算公式）。代码里的不算，没闭合的照普通字。

import assert from 'node:assert/strict'
import test from 'node:test'
import { findMath } from '../../app/task/inline.mjs'
import { markdownBlocks } from '../../app/task/markdown.mjs'

const segsOf = (text) => markdownBlocks(text).flatMap((one) => one.segs ?? [])
const mathOf = (text) => segsOf(text).filter((one) => one.math)

test('行内公式：$...$ 和 \\(...\\) 认出来，前后的话都留着', () => {
  const all = segsOf('公式是 $x^2 + y^2 = z^2$ 这样')
  const math = all.filter((one) => one.math)
  assert.equal(math.length, 1)
  assert.equal(math[0].text, 'x^2 + y^2 = z^2')
  assert.equal(all.map((one) => one.text).join(''), '公式是 x^2 + y^2 = z^2 这样')
  const brackets = segsOf('写成 \\(a+b\\) 就行')
  assert.equal(brackets.filter((one) => one.math)[0].text, 'a+b')
  // $$...$$ 走行内也是公式
  assert.equal(mathOf('看 $$E=mc^2$$ 这条')[0].text, 'E=mc^2')
})

test('价格不误伤：花了 $5 和 $10 不是公式', () => {
  const all = segsOf('这个月花了 $5 和 $10 的钱')
  assert.equal(all.some((one) => one.math), false)
  assert.equal(all.map((one) => one.text).join(''), '这个月花了 $5 和 $10 的钱')
  // 结尾的 $ 后面紧跟数字：不算
  assert.equal(mathOf('价格 $20$5 元').length, 0)
  // 开头的 $ 后面是空格、结尾的 $ 前面是空格：都不算
  assert.equal(mathOf('写 $ x $ 吗').length, 0)
  assert.equal(mathOf('写 $x $ 吗').length, 0)
})

test('没闭合的照普通字（还在出字的那一段）', () => {
  assert.equal(mathOf('还没写完 $x^2').length, 0)
  assert.equal(mathOf('还没写完 \\(x^2').length, 0)
  // 单独一段的 $$ 没闭合：照普通段落
  assert.equal(markdownBlocks('$$x^2')[0].type, 'p')
  // 闭合了就成公式
  assert.equal(markdownBlocks('$$x^2$$')[0].type, 'math')
})

test('代码里的不算公式', () => {
  const all = segsOf('`$x^2$` 是代码')
  assert.equal(all.some((one) => one.math), false)
  assert.equal(all.find((one) => one.code).text, '$x^2$')
})

test('单独一段的公式居中显示：$$...$$ 和 \\[...\\]', () => {
  const dollars = markdownBlocks('$$\n\\frac{a}{b}\n$$')
  assert.equal(dollars.length, 1)
  assert.equal(dollars[0].type, 'math')
  assert.equal(dollars[0].text, '\\frac{a}{b}')
  const brackets = markdownBlocks('\\[a^2+b^2=c^2\\]')
  assert.equal(brackets[0].type, 'math')
  assert.equal(brackets[0].text, 'a^2+b^2=c^2')
  // 跟别的字挤在一段里：不是单独一段，走行内
  assert.equal(markdownBlocks('看 $$x$$ 这个')[0].type, 'p')
})

test('```math 代码块：写完了才是公式，还没写完照旧当代码块', () => {
  const done = markdownBlocks('```math\n\\frac{a}{b}\n```')
  assert.equal(done[0].type, 'math')
  assert.equal(done[0].text, '\\frac{a}{b}')
  const open = markdownBlocks('```math\n\\frac{a}{b}')
  assert.equal(open[0].type, 'code')
})

test('findMath：从哪儿起找，找不到就是没有', () => {
  assert.deepEqual(findMath('$x$', 0), { text: 'x', end: 3 })
  assert.equal(findMath('$ x$', 0), null)
  assert.equal(findMath('$x', 0), null)
  assert.equal(findMath('x$', 0), null)
  assert.equal(findMath('\\(x\\)', 0).text, 'x')
  assert.equal(findMath('\\(x', 0), null)
})
