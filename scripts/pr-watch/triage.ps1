<#
  Handler for prwatch://triage?prs=<Repo>:<n>[,<Repo>:<n>...]&since=<yyyy-MM-ddTHH:mm:ssZ>
  (the "Triage in pi" toast button). Opens pi with triage-prompt.md filled in:
  in a new herdr tab when herdr is running, otherwise in a new PowerShell window.
  Settings: config.json. -DryRun prints the plan instead of launching (tests).
#>
param([Parameter(Mandatory)][string]$Uri, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$Org = 'Aspia-MyBusiness'

function Write-Log([string]$msg) { Add-Content -Path (Join-Path $dir 'pr-watch.log') -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg) -Encoding UTF8 }
function Fail([string]$msg) {
  Write-Log "triage error: $msg"
  if ($DryRun) { throw $msg }
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($msg, 'pr-watch triage'); exit 1
}

try {
  # Any web page can open a prwatch:// link, so accept only the exact shape we generate.
  $m = [regex]::Match($Uri, '^prwatch://triage/?\?prs=((?:[A-Za-z0-9._-]{1,100}:\d{1,7})(?:,[A-Za-z0-9._-]{1,100}:\d{1,7}){0,7})&since=(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)$')
  if (-not $m.Success) { Fail "Rejected link: $Uri" }
  $prs = @($m.Groups[1].Value.Split(',') | ForEach-Object { $r, $n = $_.Split(':'); [pscustomobject]@{ repo = $r; number = [int]$n } })
  $since = $m.Groups[2].Value

  $cfg = Get-Content (Join-Path $dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $promptPath = if ([IO.Path]::IsPathRooted($cfg.promptFile)) { $cfg.promptFile } else { Join-Path $dir $cfg.promptFile }
  $list = ($prs | ForEach-Object { "- $($_.repo) #$($_.number): https://github.com/$Org/$($_.repo)/pull/$($_.number)" }) -join "`n"
  $prompt = (Get-Content $promptPath -Raw -Encoding UTF8).Replace('{{PRS}}', $list).Replace('{{SINCE}}', $since).Replace('{{ORG}}', $Org)

  $runs = Join-Path $dir 'runs'; New-Item -ItemType Directory -Force $runs | Out-Null
  Get-ChildItem $runs -Filter 'triage-*' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-7) | Remove-Item -ErrorAction SilentlyContinue
  $file = Join-Path $runs ('triage-{0:yyyyMMdd-HHmmss}.md' -f (Get-Date))
  Set-Content -Path $file -Value $prompt -Encoding UTF8

  $repos = @($prs.repo | Sort-Object -Unique)
  $cwd = $cfg.reposRoot
  if ($repos.Count -eq 1 -and (Test-Path (Join-Path $cfg.reposRoot $repos[0]))) { $cwd = Join-Path $cfg.reposRoot $repos[0] }
  $label = if ($prs.Count -eq 1) { "PR triage $($prs[0].repo)#$($prs[0].number)" } else { "PR triage ($($prs.Count) PRs)" }

  # The pi call goes into a launcher .ps1 so no quoted text crosses a command line
  # (herdr pane run / Start-Process drop inner quotes and split the message into words).
  $q = { param($s) "'" + ([string]$s -replace "'", "''") + "'" }
  $piArgs = @('--name', (& $q $label))
  if ($cfg.model)    { $piArgs += @('--model', (& $q $cfg.model)) }
  if ($cfg.thinking) { $piArgs += @('--thinking', (& $q $cfg.thinking)) }
  foreach ($a in @($cfg.piArgs)) { if ($a) { $piArgs += (& $q $a) } }
  $piArgs += @((& $q "@$file"), (& $q 'Follow the attached pr-watch triage instructions.'))
  $launcher = [IO.Path]::ChangeExtension($file, '.ps1')
  Set-Content -Path $launcher -Encoding UTF8 -Value @(
    "Set-Location -LiteralPath $(& $q $cwd)",
    ('pi ' + ($piArgs -join ' ')))
  if ($launcher -match '\s') { Fail "Launcher path must not contain spaces: $launcher" }
  $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File $launcher"

  $useHerdr = $false
  if ($cfg.open -ne 'window') {
    $herdr = Get-Command herdr -ErrorAction SilentlyContinue
    $useHerdr = $herdr -and ((& herdr status server 2>$null) -match 'status: running')
    if (-not $useHerdr -and $cfg.open -eq 'herdr') { Fail 'config.open is "herdr" but herdr is not running.' }
  }

  if ($useHerdr) {
    # Prefer the repo's main herdr workspace; otherwise herdr's focused workspace.
    $ws = $null
    if ($repos.Count -eq 1) {
      $wl = (& herdr workspace list | Out-String) | ConvertFrom-Json
      $ws = @($wl.result.workspaces | Where-Object { $_.worktree -and $_.worktree.repo_name -eq $repos[0] -and -not $_.worktree.is_linked_worktree })[0]
    }
    $tabArgs = @('tab', 'create', '--cwd', $cwd, '--label', $label, '--focus')
    if ($ws) { $tabArgs += @('--workspace', $ws.workspace_id) }
    if ($DryRun) { Write-Output "HERDR | herdr $($tabArgs -join ' ') | $cmd | $file"; return }
    $tab = (& herdr @tabArgs | Out-String) | ConvertFrom-Json
    $pane = $tab.result.root_pane.pane_id
    if (-not $pane) { Fail "herdr tab create returned no pane: $($tab | ConvertTo-Json -Compress)" }
    & herdr pane run $pane $cmd | Out-Null
    Write-Log "triage: herdr $pane ($label)"
  } else {
    if ($DryRun) { Write-Output "WINDOW | $cwd | $cmd | $file"; return }
    Start-Process powershell.exe -WorkingDirectory $cwd -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher)
    Write-Log "triage: window ($label)"
  }
} catch { Fail $_.Exception.Message }
