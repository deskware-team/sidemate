// 权限卡上给用户看的那一行：写文件的工具给路径，跑命令的给命令（只留第一行），
// 模型自己给的理由（justification）带上，太长截掉。
// 这些是纯逻辑，不用起 dsh。

import assert from 'node:assert/strict'
import test from 'node:test'
import { outsideWorkspace, permissionReason, permissionTarget } from '../../app/dsh/permission.mjs'

test('卡上那句话：写文件的给路径，跑命令的给命令', () => {
  assert.equal(permissionTarget({ file_path: 'D:\\成品\\周报.docx' }), 'D:\\成品\\周报.docx')
  assert.equal(permissionTarget({ filePath: 'D:\\成品\\周报.docx' }), 'D:\\成品\\周报.docx')
  assert.equal(permissionTarget({ path: '稿子.md' }), '稿子.md')
  assert.equal(permissionTarget({ command: 'Get-ChildItem C:\\Windows' }), 'Get-ChildItem C:\\Windows')
  // 多行的命令只留第一行
  assert.equal(permissionTarget({ command: 'Get-ChildItem C:\\Windows\n| Select-Object Name' }), 'Get-ChildItem C:\\Windows')
  assert.equal(permissionTarget({}), '')
  assert.equal(permissionTarget(null), '')
})

test('模型给的理由：没有就空着，太长截掉', () => {
  assert.equal(permissionReason({ justification: ' 看看系统目录里有哪些文件 ' }), '看看系统目录里有哪些文件')
  assert.equal(permissionReason({ command: 'whoami' }), '')
  assert.equal(permissionReason(null), '')
  const cut = permissionReason({ justification: 'a'.repeat(200) })
  assert.equal(cut.length, 121)
  assert.ok(cut.endsWith('…'))
})

test('路径在不在任务文件夹里：相对路径按任务文件夹算，不按桌伴当前目录', () => {
  const ws = 'D:\\任务\\周报'
  assert.equal(outsideWorkspace('稿子.md', ws), false)
  assert.equal(outsideWorkspace('子目录\\稿子.md', ws), false)
  assert.equal(outsideWorkspace('D:\\成品\\周报.docx', ws), true)
  assert.equal(outsideWorkspace('..\\别的\\稿子.md', ws), true)
  assert.equal(outsideWorkspace('', ws), false)
  assert.equal(outsideWorkspace('稿子.md', ''), false)
})
