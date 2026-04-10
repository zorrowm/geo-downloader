; Post-install: refresh Windows icon cache to ensure new icons display correctly
!macro NSIS_HOOK_POSTINSTALL
  ; Refresh shell icon cache
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
  ; Alternative method using ie4uinit
  nsExec::ExecToLog 'ie4uinit.exe -show'
!macroend
