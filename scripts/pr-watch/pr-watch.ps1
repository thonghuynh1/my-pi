<#
  pr-watch: local, notify-only PR watcher (Mimer-like trigger, no agent).
  Every run: read my open PRs in Aspia-MyBusiness via gh, compare with state.json,
  show a Windows toast for anything new:
    - comments from anyone except me (humans and bots): conversation, inline, review bodies
    - reviews from anyone except me (changes requested, approved, commented)
    - CI on the PR head turning failed (once per head commit + failing set)
  Stores only ids/keys, never comment text. First run is a silent baseline.
  Windows PowerShell 5.1 (toasts need its WinRT types).

  -InputJson <file>   use a saved GraphQL response instead of calling gh (tests)
  -NoToast            print notifications instead of showing toasts (tests)
  -TestToast          show one sample toast and exit
#>
param(
  [string]$StateDir = (Join-Path $env:USERPROFILE '.pi\agent\pr-watch'),
  [string]$Org = 'Aspia-MyBusiness',
  [string]$InputJson,
  [string]$Me,
  [switch]$NoToast,
  [switch]$TestToast
)
$ErrorActionPreference = 'Stop'
$statePath = Join-Path $StateDir 'state.json'
$logPath   = Join-Path $StateDir 'pr-watch.log'

function Write-Log([string]$msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  if ((Get-Item $logPath).Length -gt 512KB) {
    Get-Content $logPath -Tail 500 | Set-Content "$logPath.tmp" -Encoding UTF8; Move-Item "$logPath.tmp" $logPath -Force
  }
}

function Show-Toast([string]$title, [string]$body, [string]$url) {
  if ($NoToast) { Write-Output "TOAST | $title | $body | $url"; return }
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $esc = { param($s) [Security.SecurityElement]::Escape($s) }
  $xml = @"
<toast activationType="protocol" launch="$(& $esc $url)" scenario="reminder">
  <visual><binding template="ToastGeneric"><text>$(& $esc $title)</text><text>$(& $esc $body)</text></binding></visual>
  <actions><action content="Open PR" activationType="protocol" arguments="$(& $esc $url)"/><action content="Dismiss" activationType="system" arguments="dismiss"/></actions>
</toast>
"@
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument; $doc.LoadXml($xml)
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show((New-Object Windows.UI.Notifications.ToastNotification $doc))
}

if ($TestToast) { Show-Toast 'pr-watch' 'Test notification - click to open GitHub.' 'https://github.com/pulls'; return }

$query = @'
query($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes { ... on PullRequest {
      number title url isDraft repository { nameWithOwner }
      comments(last: 50) { nodes { id author { login } } }
      reviews(last: 50) { nodes { id state author { login } } }
      reviewThreads(last: 50) { nodes { comments(last: 30) { nodes { id author { login } pullRequestReview { id } } } } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup {
        state
        contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name conclusion }
          ... on StatusContext { context state }
        } }
      } } } }
    } }
  }
}
'@

function Get-Data {
  if ($InputJson) { return Get-Content $InputJson -Raw -Encoding UTF8 | ConvertFrom-Json }
  $q = "is:pr is:open author:@me org:$Org"
  $raw = & gh api graphql -f "query=$query" -f "q=$q" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh api graphql failed (exit $LASTEXITCODE): $(($raw | Out-String).Trim() -replace '\s+',' ')" }
  return ($raw | Out-String) | ConvertFrom-Json
}

function Get-Login($node) { if ($node.author) { [string]$node.author.login } else { 'ghost' } }

# Pure: PR + previous state -> events + new state entry. Exposed for tests via dot-sourcing.
function Get-PrEvents($pr, $prev, [string]$me) {
  $seen = @{}; if ($prev -and $prev.seen) { foreach ($id in $prev.seen) { $seen[[string]$id] = $true } }
  $comments = New-Object System.Collections.ArrayList
  $reviews  = New-Object System.Collections.ArrayList
  $allIds   = New-Object System.Collections.ArrayList
  $reviewIdsWithThreadComment = @{}

  foreach ($t in @($pr.reviewThreads.nodes)) { foreach ($c in @($t.comments.nodes)) {
    if (-not $c) { continue }
    [void]$allIds.Add($c.id)
    $login = Get-Login $c
    if ($login -ne $me -and -not $seen.ContainsKey($c.id)) {
      [void]$comments.Add($login)
      if ($c.pullRequestReview) { $reviewIdsWithThreadComment[$c.pullRequestReview.id] = $true }
    }
  } }
  foreach ($c in @($pr.comments.nodes)) {
    if (-not $c) { continue }
    [void]$allIds.Add($c.id); $login = Get-Login $c
    if ($login -ne $me -and -not $seen.ContainsKey($c.id)) { [void]$comments.Add($login) }
  }
  foreach ($r in @($pr.reviews.nodes)) {
    if (-not $r) { continue }
    [void]$allIds.Add($r.id); $login = Get-Login $r
    if ($login -eq $me -or $seen.ContainsKey($r.id) -or $r.state -eq 'PENDING') { continue }
    # A COMMENTED review that only wraps inline comments is already counted as comments.
    if ($r.state -eq 'COMMENTED' -and $reviewIdsWithThreadComment.ContainsKey($r.id)) { continue }
    [void]$reviews.Add([pscustomobject]@{ login = $login; state = [string]$r.state })
  }

  $ciKey = $null; $failing = @()
  $commit = @($pr.commits.nodes)[0].commit
  if ($commit -and $commit.statusCheckRollup) {
    foreach ($n in @($commit.statusCheckRollup.contexts.nodes)) {
      if (-not $n) { continue }
      if ($n.__typename -eq 'CheckRun' -and @('FAILURE','TIMED_OUT','CANCELLED','STARTUP_FAILURE','ACTION_REQUIRED') -contains $n.conclusion) { $failing += [string]$n.name }
      if ($n.__typename -eq 'StatusContext' -and @('FAILURE','ERROR') -contains $n.state) { $failing += [string]$n.context }
    }
    $failing = @($failing | Sort-Object -Unique)
    if ($failing.Count -gt 0) { $ciKey = $commit.oid + '|' + ($failing -join ',') }
  }
  $ciNew = $ciKey -and (-not $prev -or $prev.ci -ne $ciKey)

  [pscustomobject]@{
    comments = @($comments); reviews = @($reviews)
    failing  = if ($ciNew) { $failing } else { @() }
    state    = [pscustomobject]@{ seen = @($allIds); ci = $ciKey }
  }
}

function Format-Events($pr, $ev) {
  $parts = @()
  $changes = @($ev.reviews | Where-Object state -eq 'CHANGES_REQUESTED')
  if ($changes.Count) { $parts += 'Changes requested by ' + ((@($changes.login | Sort-Object -Unique) | ForEach-Object { "@$_" }) -join ', ') }
  if ($ev.failing.Count) { $parts += 'CI failed: ' + (($ev.failing | Select-Object -First 3) -join ', ') + $(if ($ev.failing.Count -gt 3) { " +$($ev.failing.Count - 3) more" } else { '' }) }
  if ($ev.comments.Count) {
    $by = $ev.comments | Group-Object | ForEach-Object { "@$($_.Name)" + $(if ($_.Count -gt 1) { " x$($_.Count)" } else { '' }) }
    $parts += "+$($ev.comments.Count) comment$(if ($ev.comments.Count -gt 1) { 's' }) (" + ($by -join ', ') + ')'
  }
  $other = @($ev.reviews | Where-Object state -ne 'CHANGES_REQUESTED')
  foreach ($g in ($other | Group-Object state)) {
    $label = switch ($g.Name) { 'APPROVED' { 'Approved' } 'COMMENTED' { 'Reviewed' } 'DISMISSED' { 'Review dismissed' } default { $g.Name } }
    $parts += "$label by " + ((@($g.Group.login | Sort-Object -Unique) | ForEach-Object { "@$_" }) -join ', ')
  }
  $parts
}

if ($MyInvocation.InvocationName -eq '.') { return }   # dot-sourced by tests: functions only

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
try {
  $data = Get-Data
  if ($data.errors) { throw "GraphQL errors: $((@($data.errors) | ForEach-Object message) -join '; ')" }
  if (-not $Me) { $Me = [string]$data.data.viewer.login }
  $state = $null
  if (Test-Path $statePath) { $state = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json }
  $baseline = -not $state
  $newPrs = @{}; $notifications = @()
  foreach ($pr in @($data.data.search.nodes)) {
    if (-not $pr -or -not $pr.number) { continue }
    $key = "$($pr.repository.nameWithOwner)#$($pr.number)"
    $prev = if ($state -and $state.prs) { $state.prs.$key } else { $null }
    $ev = Get-PrEvents $pr $prev $Me
    $newPrs[$key] = $ev.state
    if ($baseline) { continue }
    $lines = @(Format-Events $pr $ev)
    if ($lines.Count) {
      $repo = $pr.repository.nameWithOwner.Split('/')[1]
      $notifications += [pscustomobject]@{ title = "$repo #$($pr.number): $($pr.title)"; short = "$repo #$($pr.number)"
        lines = $lines; comments = $ev.comments.Count; url = $pr.url }
    }
  }
  # Write state before toasting so a toast failure never repeats notifications.
  [pscustomobject]@{ version = 1; me = $Me; lastRun = (Get-Date).ToString('o'); prs = $newPrs } |
    ConvertTo-Json -Depth 6 | Set-Content -Path $statePath -Encoding UTF8

  if ($baseline) { Write-Log "baseline: $($newPrs.Count) open PRs, no notifications"; return }
  # One toast per scan: a single PR gets its own detail toast; several PRs get one summary toast.
  if ($notifications.Count -eq 1) {
    $n = $notifications[0]; Show-Toast $n.title ($n.lines -join "`n") $n.url
  } elseif ($notifications.Count -gt 1) {
    $total = [int](($notifications | Measure-Object comments -Sum).Sum)
    $title = "$($notifications.Count) PRs with new activity" + $(if ($total) { " (+$total comments)" } else { '' })
    $max = 4
    $body = @($notifications | Select-Object -First $max | ForEach-Object { "$($_.short): $($_.lines -join " $([char]0x00B7) ")" })
    if ($notifications.Count -gt $max) { $body += "+$($notifications.Count - $max) more PRs" }
    Show-Toast $title ($body -join "`n") "https://github.com/pulls?q=is%3Apr+is%3Aopen+author%3A%40me+org%3A$Org"
  }
  Write-Log "ok: $($newPrs.Count) open PRs, $($notifications.Count) notified"
} catch {
  Write-Log "error: $($_.Exception.Message)"
  $errFlag = Join-Path $StateDir 'last-error-notified'
  # Toast an error at most once per 6 hours (e.g. gh logged out, network/VPN down).
  if (-not (Test-Path $errFlag) -or ((Get-Date) - (Get-Item $errFlag).LastWriteTime).TotalHours -ge 6) {
    try { Show-Toast 'pr-watch failed' $_.Exception.Message 'https://github.com/pulls'; Set-Content $errFlag (Get-Date).ToString('o') } catch { }
  }
  exit 1
}
