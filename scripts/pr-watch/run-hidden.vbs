' Hidden PowerShell entry point (no console flash).
'   run-hidden.vbs                   -> pr-watch.ps1 (Task Scheduler)
'   run-hidden.vbs triage "<uri>"    -> triage.ps1 -Uri <uri> (prwatch:// protocol)
Dim shell, dir, cmd
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "
If WScript.Arguments.Count >= 2 Then
  If WScript.Arguments(0) = "triage" Then
    shell.Run cmd & """" & dir & "\triage.ps1"" -Uri """ & Replace(WScript.Arguments(1), """", "") & """", 0, False
  End If
Else
  shell.Run cmd & """" & dir & "\pr-watch.ps1""", 0, True
End If
