// 卸载的时候，开机启动的登记也要删掉；但升级（--updated）时不能删。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const script = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8')

test('卸载时删掉开机启动的登记和任务管理器里的禁用标记', () => {
  const uninstall = script.match(/!macro customUnInstall([\s\S]*?)!macroend/)?.[1]
  assert.ok(uninstall, '找得到 customUnInstall')
  assert.match(
    uninstall,
    /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "sidemate"/,
  )
  assert.match(
    uninstall,
    /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "sidemate"/,
  )
  // 这两条都要在「不是升级」的分支里：升级时别把用户的开机启动关掉
  // 分支里面还套着别的 ${If}：取到最后那个 ${EndIf}
  const guarded = uninstall.replace(/\r\n/g, '\n').match(/\$\{ifNot\} \$\{isUpdated\}\s*\n([\s\S]*)\n\s*\$\{EndIf\}\s*$/)?.[1]
  assert.ok(guarded, 'customUnInstall 里没有「不是升级」的分支')
  assert.match(guarded, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "sidemate"/)
  assert.match(guarded, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "sidemate"/)
  // 升级时不删数据目录：数据全在 %LOCALAPPDATA%\sidemate，升级要留着
  const asked = guarded.match(/del_data:([\s\S]*?)keep_data:/)?.[1]
  assert.ok(asked, '没有「删数据」那一段（del_data … keep_data）')
  assert.equal(
    guarded.replace(asked, '').includes('RMDir /r "$LOCALAPPDATA\\sidemate"'),
    false,
    '数据目录不许不问就删',
  )
  // 以前的版本留下的目录一概不碰
  for (const gone of ['LocalLow\\桌伴', '$PROFILE\\桌伴', 'node-low']) {
    assert.equal(script.includes(gone), false, `脚本里不该再出现「${gone}」`)
  }
})
