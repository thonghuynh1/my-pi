param([int]$IntervalMinutes = 15)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$dir\run-hidden.vbs`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'repo-fetch' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Fetches origin for selected repos in C:\GitRepos (config.json). C:\my-pi\scripts\repo-fetch' -Force | Out-Null
Write-Output "repo-fetch scheduled every $IntervalMinutes min. Log: $dir\repo-fetch.log"
