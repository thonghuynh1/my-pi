param([switch]$Purge)
Unregister-ScheduledTask -TaskName 'repo-fetch' -Confirm:$false -ErrorAction SilentlyContinue
if ($Purge) { Remove-Item (Join-Path $PSScriptRoot 'repo-fetch.log'), (Join-Path $PSScriptRoot 'repo-fetch.log.tmp') -ErrorAction SilentlyContinue }
Write-Output 'repo-fetch task removed.'
