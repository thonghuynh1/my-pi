# Registers (or replaces) the "pr-watch" scheduled task: every N minutes, only while you are
# logged on (needed for gh's keyring login and for toasts). Remove with uninstall.ps1.
param([int]$IntervalMinutes = 10)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$dir\run-hidden.vbs`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'pr-watch' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Notify-only watcher for my open PRs (comments, reviews, failed CI). ~/.pi/agent/pr-watch' -Force | Out-Null
Write-Output "pr-watch scheduled every $IntervalMinutes min. First run in ~1 min (silent baseline). Log: $dir\pr-watch.log"
