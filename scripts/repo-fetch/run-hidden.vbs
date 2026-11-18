Dim shell, dir, cmd
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "
shell.Run cmd & """" & dir & "\repo-fetch.ps1""", 0, True
