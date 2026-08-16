; Custom NSIS wiring for DeepSeek Harness.
;
; The stock CHECK_APP_RUNNING derives $INSTDIR from the previous install's
; registry entry and prefix-matches every process path against it. When that
; registry entry lacks InstallLocation, the empty prefix matches EVERY process
; with a path, so the installer looped on "cannot be closed" forever with
; nothing actually running — and its Stop-Process sweep then hit unrelated
; processes. Since 0.1.0-rc.12 the Harness runtime runs from the user data
; directory, so only the Electron exe itself can hold the install directory
; open, and the app already quits itself before the installer starts
; (prepareForInstall). Kill any straggler by exact image name — taskkill needs
; no WMI, works when the process is gone (prints an error, harmless), and we
; never prompt.
!macro customCheckAppRunning
  ${if} ${isUpdated}
    # The app quits itself before the installer starts; give it a beat.
    Sleep 500
  ${endIf}
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 300
!macroend
