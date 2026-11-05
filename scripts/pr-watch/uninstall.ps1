# Removes the scheduled task. Pass -Purge to also delete state.json and the log.
param([switch]$Purge)
Unregister-ScheduledTask -TaskName 'pr-watch' -Confirm:$false -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item (Join-Path $PSScriptRoot 'state.json'), (Join-Path $PSScriptRoot 'pr-watch.log'), (Join-Path $PSScriptRoot 'last-error-notified') -ErrorAction SilentlyContinue }
Write-Output 'pr-watch task removed.'
