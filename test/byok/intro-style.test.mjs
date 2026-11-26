// 首次运行各屏（#about/#model/#guide/#zhipu/#custom/#intro）的样式：
// 共用一条居中规则 —— 整块内容在窗口里上下居中，内容超高时不裁切、不顶出窗口。
// 只读 page.css，断言几条关键规则在。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('../../app/byok/page.css', import.meta.url), 'utf8')

// 取某个选择器的规则体（{ ... }）
function rule(selector) {
  const match = new RegExp(`(^|[,}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
  assert.ok(match, `page.css 里找不到 ${selector} 的规则`)
  return match[2]
}

test('html/body/main 高度链是通的', () => {
  assert.match(rule('html, body'), /height:\s*100%/)
  const main = rule('main')
  assert.match(main, /box-sizing:\s*border-box/)
  assert.match(main, /min-height:\s*100%/)
  assert.doesNotMatch(main, /(?<!min-)height:\s*100%/) // 不用固定 height
})

test('六屏共用的 #wizard > section 规则：整块内容上下居中', () => {
  const section = rule('#wizard > section')
  assert.match(section, /justify-content:\s*(safe\s+center|center)/) // 上下居中
  assert.match(section, /flex:\s*1 0 auto/) // 占满窗口可用高度
  assert.match(section, /min-height:\s*calc\(100vh\s*-\s*48px\)/) // 用 min-height 不裁切
  assert.doesNotMatch(section, /(?<!min-)height:\s*(?!100vh)/) // 不用固定 height
})

test('居中用 safe 对齐：内容比窗口高时退回从上往下排，不顶出窗口', () => {
  const section = rule('#wizard > section')
  assert.match(section, /justify-content:\s*safe\s+center/)
})

test('hidden 的屏不占位', () => {
  assert.match(rule('#wizard > section[hidden]'), /display:\s*none/)
})

test('居中规则是六屏公用的：#intro 自己不再单写一份', () => {
  const own = /(^|[,}\\n])\s*#intro\s*\{([^}]*)\}/.exec(css)
  if (own) {
    assert.doesNotMatch(own[2], /justify-content/)
    assert.doesNotMatch(own[2], /min-height/)
  }
})

test('#intro 的文字左对齐、「确定」靠右照旧', () => {
  assert.match(rule('#intro #done'), /align-self:\s*flex-end/)
})

test('第一屏 #about 的「开始」靠右照旧', () => {
  assert.match(rule('#about #start'), /align-self:\s*flex-end/)
})
