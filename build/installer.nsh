; 装法：payload 随包带成 resources/payload.7z，装时用随包 7za 直解到 resources/app/payload。
; NSIS 默认装法先把 7z 解到临时目录再用 CopyFiles 逐个复制，两万多个文件要 5 分钟，直解一分多。
; 卸载：安装目录 NSIS 自己删；配置和记录全在 %LOCALAPPDATA%\sidemate\ 里。
; 从「应用」里点卸载：注册表里的卸载命令带着 /S /ASK，系统那句「确定卸载吗」不弹，
; 由桌伴自己弹一个框（sidemate.exe --uninstall-confirm）：「确定卸载桌伴吗？」加一个勾选
; 「同时删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）」，默认不勾；
; 勾了就整个删干净，没勾一个都不删。桌伴的框起不来时退回系统的两问。
; 直接双击卸载器：系统先问「确定卸载吗」，再问一句删不删数据，默认「否」。
; 以前的版本留下的数据目录一概不碰：只删 %LOCALAPPDATA%\sidemate，别的目录不碰。
; 升级不算卸载：electron-builder 装新版时先静默跑上一个版本的卸载器（命令行带 --updated，isUpdated 为真），
; 那时什么都不删（配置、记录、开机启动的登记都留着），也不问。
; 注意：one-click 卸载器在用户确认后会 SetSilent silent，${Silent} 永远为真，
; 所以改看命令行里有没有真的 /S、/ASK（只有 /S = 静默卸载，不问也不删数据）。

; 自定义运行检查会替代默认分支，因此补上默认分支原本负责加载的进程助手和全局 pid。
!include "getProcessInfo.nsh"
Var pid

; electron-builder 的 messages.yml 没有这三条 zh_CN；自定义 include 先于 MUI_LANGUAGE，故用简体中文 LCID 2052。
; 覆盖内置英文兜底会触发 6030，只在这段关掉“重复定义”警告（electron-builder 把警告当错误）。
!pragma warning disable 6030
LangString uninstallFailed 2052 "有文件没能删干净。请再运行一次安装包；还不行就重启电脑后再试。"
LangString decompressionFailed 2052 "安装文件解压失败。请再运行一次安装包。"
LangString appClosing 2052 "正在关闭 ${PRODUCT_NAME}……"
!pragma warning enable 6030

; customCheckAppRunning 包裹原检查：安装段在 uninstallOldVersion 之前调用它，此时 $INSTDIR 已是旧目录。
; 早期版本的卸载器会逐文件搬到 %TEMP%；确认桌伴已关后再删会重装的 payload，避免长路径和取消后留下残缺。
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    RMDir /r "$INSTDIR\resources\app\payload"
  !endif
!macroend

!macro customInstall
  nsExec::ExecToLog '"$INSTDIR\resources\7za.exe" x -y "-o$INSTDIR\resources\app\payload" "$INSTDIR\resources\payload.7z"'
  Pop $R0
  ${If} $R0 != 0
    DetailPrint "payload 解压失败（退出码 $R0），安装中止"
    MessageBox MB_OK|MB_ICONSTOP "装到一半没成：payload 解压失败（退出码 $R0）。请关掉别的程序再装一次；还不行就把这个码发给桌伴。" /SD IDOK
    Abort
  ${EndIf}
  Delete "$INSTDIR\resources\payload.7z"
  Delete "$INSTDIR\resources\7za.exe"
  Delete "$INSTDIR\resources\7za-LICENSE.txt"
  Delete "$INSTDIR\resources\7za-COPYING.txt"
  ; 「应用」里点卸载用的命令：带 /S /ASK，系统的「确定卸载吗」不弹，由桌伴自己的框问（见 customUnInit）。
  ; 升级时只从这条里取引号里的卸载器路径，后面的参数不影响升级。
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser /S /ASK'
!macroend

!ifdef BUILD_UNINSTALLER
; 桌伴那个框里勾没勾「同时删除全部配置和记录」：1 勾了
Var sidemateWipe
!endif

!macro customUnInit
  StrCpy $sidemateWipe "0"
  ${ifNot} ${isUpdated}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/ASK" $R1
    ${IfNot} ${Errors}
      ; 桌伴自己的框：退出码 0 不卸、1 卸载留数据、2 卸载并删数据
      ClearErrors
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-confirm' $R2
      ${If} ${Errors}
        StrCpy $R2 "none"
      ${EndIf}
      ; 等那个框的进程全退干净，后面删安装目录才不会碰上占用
      Sleep 800
      ${If} $R2 == "0"
        Quit
      ${ElseIf} $R2 == "2"
        StrCpy $sidemateWipe "1"
      ${ElseIf} $R2 != "1"
        ; 桌伴的框没起来：退回系统的两问
        MessageBox MB_OKCANCEL "$(areYouSureToUninstall)" IDOK +2
        Quit
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）" IDNO +2
        StrCpy $sidemateWipe "1"
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend

; 卸载器不走 atomicRMDir：不要逐文件改名到 $PLUGINSDIR\old-install（它位于 %TEMP%）。
; 沿用卸载器 un.onInit 的先关闭检查；移出当前目录后直接删，避免路径变长。
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r "$INSTDIR"
!macroend

!macro customUnInstall
  ; 升级（--updated）时什么都不动，也不问：配置、记录和开机启动的登记都是用户的设置。
  ; 真卸载（用户自己从「应用」里卸）才删开机启动的登记、才问数据那一问。
  ; 以前的版本留下的数据目录一概不碰：只删 %LOCALAPPDATA%\sidemate，别的目录不碰。
  ${ifNot} ${isUpdated}
    ; 开机启动的登记也一并删掉：启动项和任务管理器里的禁用标记
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "sidemate"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "sidemate"
    ; $LOCALAPPDATA 按当前用户取，不碰别的用户、也不碰 ProgramData
    SetShellVarContext current
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/ASK" $R1
    ${IfNot} ${Errors}
      ; 从「应用」里卸的：照桌伴那个框里勾没勾（customUnInit 里记的）
      StrCmp $sidemateWipe "1" del_data keep_data
    ${EndIf}
    ; 直接双击卸载器：数据只问一句，默认「否」；命令行只带 /S（静默卸载）不问，也不删数据
    ClearErrors
    ${GetOptions} $R0 "/S" $R1
    ${If} ${Errors}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否删除全部配置和记录（包括任务里生成的文件，删除后无法恢复）" IDYES del_data IDNO keep_data
    ${EndIf}
    Goto keep_data
    del_data:
      ; 删完还在就再试一次；还不行也不报错（用户下次卸载还能再删）
      RMDir /r "$LOCALAPPDATA\sidemate"
      IfFileExists "$LOCALAPPDATA\sidemate\*" 0 +2
        RMDir /r "$LOCALAPPDATA\sidemate"
    keep_data:
  ${EndIf}
!macroend
