import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pruneInspector } from '../../build/installer-assets.mjs'

test('ACP payload pruning removes only the unused inspector package', () => {
  const root = mkdtempSync(join(tmpdir(), 'sidemate-installer-'))
  try {
    const inspector = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-experimental-inspector')
    const sibling = join(root, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-acp-app')
    mkdirSync(join(inspector, 'lib', 'devtools'), { recursive: true })
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(inspector, 'lib', 'devtools', 'long.md'), 'unused')
    writeFileSync(join(sibling, 'index.js'), 'used')
    assert.equal(pruneInspector(root), inspector)
    assert.equal(existsSync(inspector), false)
    assert.equal(existsSync(join(sibling, 'index.js')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('真卸载只问一句：选是删整个 %LOCALAPPDATA%\\sidemate；升级和静默卸载不问也不删', () => {
  const script = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const body = script.match(/!macro customUnInstall([\s\S]*?)!macroend/)?.[1]
  assert.ok(body, 'installer.nsh 里找不到 customUnInstall')
  // 「不是升级」的分支：${ifNot} ${isUpdated} … 最后一个 ${EndIf}；分支外不许有任何删除和那一问
  const guarded = body.match(/\$\{ifNot\} \$\{isUpdated\}\s*\n([\s\S]*)\n\s*\$\{EndIf\}\s*$/)?.[1]
  assert.ok(guarded, 'customUnInstall 里没有「不是升级」的分支（${ifNot} ${isUpdated}）')
  const outside = body.replace(guarded, '')
  assert.doesNotMatch(outside, /RMDir|Delete|MessageBox/, '「不是升级」的分支外面不能删东西、不能问')
  // 开机启动的登记照旧：真卸载时删，升级时不删
  const always = [
    'DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "sidemate"',
    'DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "sidemate"',
  ]
  // 用户在那一问里点「是」才删的：整个 %LOCALAPPDATA%\sidemate
  const asked = guarded.match(/del_data:([\s\S]*?)keep_data:/)?.[1]
  assert.ok(asked, '没有「删数据」那一段（del_data … keep_data）')
  for (const line of always) {
    assert.ok(guarded.includes(line), `「${line}」不在「不是升级」的分支里`)
    assert.equal(asked.includes(line), false, `「${line}」应该不问就删，不该在 del_data 里`)
  }
  const onYes = ['RMDir /r "$LOCALAPPDATA\\sidemate"']
  for (const line of onYes) {
    assert.ok(asked.includes(line), `「${line}」要在用户点「是」以后才删`)
    // 删一次，删不掉再试一次；不多不少
    assert.equal(body.split(`${line}\n`).length - 1, 2, `「${line}」在 customUnInstall 里只许出现两次（删一次 + 再试一次）`)
  }
  // 整个数据目录不许不问就删
  assert.equal(guarded.replace(asked, '').includes('RMDir /r "$LOCALAPPDATA\\sidemate"\n'), false)
  // 那一问只有这一句，默认「否」
  const box = guarded.match(/MessageBox ([^\n]*)/)?.[1] || ''
  assert.match(box, /MB_DEFBUTTON2/)
  const text = box.match(/"([^"]*)"/)?.[1]
  assert.equal(text, '是否删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）', '那一问的字必须一字不差')
  // 静默卸载（/S）不问，也不删数据
  assert.match(guarded, /\$\{GetOptions\} \$R0 "\/S" \$R1\s*\n\s*\$\{If\} \$\{Errors\}/)
  // $LOCALAPPDATA 按当前用户取
  assert.match(guarded, /SetShellVarContext current/)
})

test('「应用」里卸载：注册表命令带 /S /ASK，由桌伴自己的框问（勾选删数据），框起不来退回两问', () => {
  const script = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const install = script.match(/!macro customInstall([\s\S]*?)!macroend/)?.[1] || ''
  assert.match(install, /WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" UninstallString '"\$INSTDIR\\\$\{UNINSTALL_FILENAME\}" \/currentuser \/S \/ASK'/)
  const init = script.match(/!macro customUnInit([\s\S]*?)!macroend/)?.[1] || ''
  assert.ok(init, 'installer.nsh 里找不到 customUnInit')
  // 升级不问
  assert.match(init, /\$\{ifNot\} \$\{isUpdated\}/)
  // 跑桌伴自己的框，照退出码走：0 不卸、2 删数据、1 留数据，别的退回系统的两问
  assert.match(init, /ExecWait '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" --uninstall-confirm' \$R2/)
  assert.match(init, /\$\{If\} \$R2 == "0"\s*\n\s*Quit/)
  assert.match(init, /\$\{ElseIf\} \$R2 == "2"\s*\n\s*StrCpy \$sidemateWipe "1"/)
  assert.match(init, /MessageBox MB_OKCANCEL "\$\(areYouSureToUninstall\)"/)
  // 卸的时候照框里勾没勾删
  const body = script.match(/!macro customUnInstall([\s\S]*?)!macroend/)?.[1] || ''
  assert.match(body, /\$\{GetOptions\} \$R0 "\/ASK" \$R1\s*\n\s*\$\{IfNot\} \$\{Errors\}[\s\S]*?StrCmp \$sidemateWipe "1" del_data keep_data/)
  // 变量只在卸载器那一遍里声明：安装器那一遍用不到，声明了会报「没用过的变量」
  assert.match(script, /!ifdef BUILD_UNINSTALLER\s*\n(?:;[^\n]*\n)*Var sidemateWipe\s*\n!endif/)
})

test('0.3 的卸载器不再碰以前的版本留下的目录', () => {
  const script = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  for (const gone of ['LocalLow\\桌伴', '$PROFILE\\桌伴', 'node-low']) {
    assert.equal(script.includes(gone), false, `脚本里不该再出现「${gone}」`)
  }
  assert.equal(script.includes('RMDir /r "$APPDATA\\sidemate"'), false, '不该再删以前版本的 %APPDATA%\\sidemate')
})

test('NSIS hooks avoid TEMP moves and localize missing Chinese messages', () => {
  const script = readFileSync(new URL('../../build/installer.nsh', import.meta.url), 'utf8')
  const check = script.match(/!macro customCheckAppRunning([\s\S]*?)!macroend/)?.[1]
  const remove = script.match(/!macro customRemoveFiles([\s\S]*?)!macroend/)?.[1]
  assert.match(check, /!insertmacro IS_POWERSHELL_AVAILABLE\s+!insertmacro _CHECK_APP_RUNNING[\s\S]*RMDir \/r "\$INSTDIR\\resources\\app\\payload"/)
  assert.doesNotMatch(check, /\$PLUGINSDIR|\$TEMP/)
  assert.match(remove, /SetOutPath \$TEMP/)
  assert.match(remove, /RMDir \/r "\$INSTDIR"/)
  assert.doesNotMatch(remove, /Rename|old-install|\$PLUGINSDIR/)
  for (const id of ['uninstallFailed', 'decompressionFailed', 'appClosing']) {
    assert.match(script, new RegExp(`LangString ${id} 2052`))
  }
})
