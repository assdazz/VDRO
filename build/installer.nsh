!macro customHeader
  !undef UNINSTALL_FILENAME
  !define UNINSTALL_FILENAME "VDRO卸载程序.exe"
!macroend

; Override the stock force-termination flow. The selected path and registered
; old installation are checked independently so changing the destination does
; not skip protection for a running old copy.
!macro customCheckAppRunning
  Push $R0
  Push $R1
  Push $R2
  InitPluginsDir
  File /oname=$PLUGINSDIR\vdro-upgrade-check.ps1 "${BUILD_RESOURCES_DIR}\..\build\upgrade-check.ps1"
  ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${Do}
    nsExec::ExecToStack '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\vdro-upgrade-check.ps1" -InstallDirectory "$INSTDIR" -PreviousInstallDirectory "$R2"'
    Pop $R0
    Pop $R1
    ${If} $R0 == 0
      ${ExitDo}
    ${EndIf}
    ${If} ${Silent}
      ${If} $R0 == 10
        SetErrorLevel 1618
      ${Else}
        SetErrorLevel 1603
      ${EndIf}
      Quit
    ${EndIf}
    StrCpy $R1 "cancel"
    ${If} $R0 == 10
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "VDRO 或音频处理任务仍在运行。$\r$\n$\r$\n请先保存需要保留的片段，并退出旧版 VDRO，再点击“重试”。$\r$\n安装程序不会强制终止进程。$\r$\n$\r$\nVDRO or a media task is still running. Save your clips, exit VDRO, then choose Retry. Processes will not be forcibly terminated." /SD IDCANCEL IDRETRY +2
      Goto +2
      StrCpy $R1 "retry"
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法确认旧版 VDRO 是否已退出。$\r$\n$\r$\n请确认 Windows PowerShell 和进程查询可用，然后点击“重试”，或取消安装。$\r$\n$\r$\nUnable to verify running processes. Check that Windows PowerShell and process queries are available, then choose Retry, or cancel." /SD IDCANCEL IDRETRY +2
      Goto +2
      StrCpy $R1 "retry"
    ${EndIf}
    ${If} $R1 != "retry"
      SetErrorLevel 1602
      Quit
    ${EndIf}
  ${Loop}
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customInstall
  DetailPrint "VDRO 安装完成。设置、素材库及已保留片段继续存放在用户数据目录中。"
!macroend
