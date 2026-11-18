param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'),
  [string]$LogPath = (Join-Path $PSScriptRoot 'repo-fetch.log')
)
$ErrorActionPreference = 'Stop'

function Write-Log([string]$msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  if ((Get-Item $LogPath).Length -gt 512KB) {
    Get-Content $LogPath -Tail 500 | Set-Content "$LogPath.tmp" -Encoding UTF8; Move-Item "$LogPath.tmp" $LogPath -Force
  }
}

function Get-OriginRefs([string]$path) {
  $refs = & git.exe -C $path for-each-ref '--format=%(refname) %(objectname)' refs/remotes/origin
  if ($LASTEXITCODE -ne 0) { throw "Could not read origin refs in $path (exit $LASTEXITCODE)" }
  return ($refs -join "`n")
}

try {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $config = Get-Content -Path $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $timeoutMs = [int]($config.timeoutSeconds * 1000)
  if ($timeoutMs -le 0) { throw 'timeoutSeconds must be positive' }
  $repos = @($config.repos)
  $ok = 0
  $changed = @()
  $failed = @()

  foreach ($name in $repos) {
    $path = Join-Path $config.reposRoot $name
    if (-not (Test-Path -LiteralPath (Join-Path $path '.git') -PathType Container)) {
      $failed += "${name}: missing"
      continue
    }

    $before = Get-OriginRefs $path
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = 'git.exe'
    $start.Arguments = "-C `"$path`" fetch --prune --quiet origin"
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardOutput = $true
    $start.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $start.EnvironmentVariables['GCM_INTERACTIVE'] = 'never'
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
      [void]$process.Start()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      if (-not $process.WaitForExit($timeoutMs)) {
        try { $process.Kill() } catch { }
        $failed += "${name}: timeout"
        continue
      }
      $stderr = $stderrTask.GetAwaiter().GetResult()
      [void]$stdoutTask.GetAwaiter().GetResult()
      if ($process.ExitCode -ne 0) {
        $reason = (($stderr -split "`r?`n", 2)[0] -replace '\s+', ' ').Trim()
        if (-not $reason) { $reason = "exit $($process.ExitCode)" }
        $failed += "${name}: $reason"
        continue
      }
    } finally {
      $process.Dispose()
    }

    $after = Get-OriginRefs $path
    if ($before -cne $after) { $changed += $name }
    $ok++
  }

  $timer.Stop()
  $changedText = if ($changed.Count) { $changed -join ', ' } else { '-' }
  $failedText = if ($failed.Count) { $failed -join '; ' } else { '-' }
  Write-Log ('ok={0}/{1} changed={2} failed={3}  ({4:F1}s)' -f $ok, $repos.Count, $changedText, $failedText, $timer.Elapsed.TotalSeconds)
  if ($failed.Count) { exit 1 }
  exit 0
} catch {
  try { Write-Log ("error: " + ($_.Exception.Message -replace '\s+', ' ').Trim()) } catch { [Console]::Error.WriteLine("Could not write log: $($_.Exception.Message)") }
  exit 1
}
