' Runs pr-watch.ps1 with no console window flash (Task Scheduler entry point).
Dim shell, dir
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & dir & "\pr-watch.ps1""", 0, True
