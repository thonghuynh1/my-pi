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
# Also run 20 s after unlocking (scans are skipped while locked; this catches up at once).
$cls = Get-CimClass -Namespace 'ROOT\Microsoft\Windows\TaskScheduler' -ClassName MSFT_TaskSessionStateChangeTrigger
$unlock = New-CimInstance -CimClass $cls -ClientOnly
$unlock.StateChange = 8; $unlock.UserId = "$env:USERDOMAIN\$env:USERNAME"; $unlock.Delay = 'PT20S'; $unlock.Enabled = $true
Register-ScheduledTask -TaskName 'pr-watch' -Action $action -Trigger @($trigger, $unlock) -Settings $settings -Principal $principal `
  -Description 'Notify-only watcher for my open PRs (comments, reviews, failed CI). ~/.pi/agent/pr-watch' -Force | Out-Null
# prwatch:// protocol for the toast's "Triage in pi" button (current user only, no admin).
$key = 'HKCU:\Software\Classes\prwatch'
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:pr-watch triage'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value "wscript.exe `"$dir\run-hidden.vbs`" triage `"%1`""
Write-Output "pr-watch scheduled every $IntervalMinutes min. First run in ~1 min$(if (-not (Test-Path "$dir\state.json")) { ' (silent baseline)' }); also 20 s after each unlock. Log: $dir\pr-watch.log"
