# Remove the Orca bundle: everything in manifest.json, nothing else.
# Safe while Herdr runs: it switches away from Orca first if needed.
$ErrorActionPreference = "Stop"
$herdrHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config/herdr-app" }
$manifest = Get-Content (Join-Path $PSScriptRoot "manifest.json") -Raw | ConvertFrom-Json

# 0. Stop the legacy automations scheduler and its logon task, if an older
# install left them behind. Automations is no longer part of the bundle.
Unregister-ScheduledTask -TaskName "HerdrOrcaAutomations" -Confirm:$false -ErrorAction SilentlyContinue
Get-Process herdr-automations -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 1. Leave the layout before deleting its files.
$status = herdr-app status | ConvertFrom-Json
if ($status.layout -eq "orca") {
  herdr-app do layout.switch "{\"name\":\"$($manifest.switch_back_layout)\"}" | Out-Null
  Write-Host "Switched to $($manifest.switch_back_layout)"
}

# 2. Layout files, mods, and their data folders.
foreach ($f in $manifest.layout_files) { Remove-Item (Join-Path $herdrHome $f) -Force -ErrorAction SilentlyContinue }
foreach ($mod in $manifest.mods) {
  Remove-Item (Join-Path $herdrHome "mods/$mod") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $herdrHome "data/$mod") -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. Keys: the whole layout:orca section is this bundle's.
$keysPath = Join-Path $herdrHome "keys.json"
$keys = Get-Content $keysPath -Raw | ConvertFrom-Json
$keys.PSObject.Properties.Remove($manifest.keys.section)
$keys | ConvertTo-Json -Depth 10 | Set-Content $keysPath

# 4. Outside folders the bundle owns (kept mod settings), plus the legacy
# automations config and state folders from older installs.
foreach ($dir in $manifest.extra_dirs) {
  Remove-Item ($dir -replace '^~', $HOME) -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $HOME "AppData/Roaming/herdr/plugins/config/dnzzl.automations") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $HOME ".local/state/herdr/plugins/dnzzl.automations") -Recurse -Force -ErrorAction SilentlyContinue

# 5. The bundle folder itself (this script's home).
Remove-Item (Join-Path $herdrHome "bundles/orca") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Orca bundle removed. Your other layouts, mods, and Spaces were not touched."
