import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const PET_SHELL = new URL('../../app/pet/shell.mjs', import.meta.url)

test('小岛「打开文件夹」在资源管理器里选中那份成品', () => {
  const text = readFileSync(PET_SHELL, 'utf8')
  assert.match(text, /if \(state\.artifact\) \{ void shell\.showItemInFolder\(state\.artifact\); return \}/)
  // 不再只开文件夹、不选中文件
  assert.equal(text.includes('shell.openPath(dirname(state.artifact))'), false)
})
