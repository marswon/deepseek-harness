; Custom NSIS wiring for DeepSeek Harness.
;
; The stock CHECK_APP_RUNNING derives $INSTDIR from the previous install's
; registry entry and prefix-matches every process path against it. When that
; registry entry lacks InstallLocation, the empty prefix matches EVERY process
; with a path, so the installer looped on "cannot be closed" forever with
; nothing actually running — and its Stop-Process sweep then hit unrelated
; processes. Since 0.1.0-rc.12 the Harness runtime runs from the user data
; directory, so only Electron can hold the install directory open. The updater
; launches NSIS only after Electron exits; this macro still kills and polls an
; exact image-name straggler before replacement. taskkill needs no WMI, works
; when the process is gone (prints an error, harmless), and never prompts.
;
; electron-builder's allowOnlyOneInstallerInstance.nsh picks this up via
; `!ifmacrodef customCheckAppRunning`, replacing the stock macro for both the
; installer and the uninstaller.
!macro customCheckAppRunning
  !define /redef dsh_wait_label ${__LINE__}
  ${if} ${isUpdated}
    # The app's detached updater waiter starts this installer after Electron exits.
    Sleep 500
  ${endIf}
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  # taskkill returning does not guarantee that Windows has released every
  # Electron child handle. Poll the exact image name before replacing files.
  StrCpy $0 0
  dsh_wait_for_app_exit_${dsh_wait_label}:
  nsExec::ExecToStack `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /NH ^| findstr /I /C:"${APP_EXECUTABLE_FILENAME}"`
  Pop $1
  StrCmp $1 1 dsh_app_exited_${dsh_wait_label}
  IntOp $0 $0 + 1
  IntCmp $0 20 dsh_app_exited_${dsh_wait_label}
  Sleep 250
  Goto dsh_wait_for_app_exit_${dsh_wait_label}
  dsh_app_exited_${dsh_wait_label}:
  !undef dsh_wait_label
!macroend
