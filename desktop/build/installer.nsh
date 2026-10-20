; Per-user install only (no "all users" page, no UAC prompt). The directory page still lets the user pick a folder.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
