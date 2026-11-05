# Offline tests for pr-watch.ps1 (fixtures, -NoToast, temp state). Run: powershell -File test.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'pr-watch.ps1'
$tmp = Join-Path $env:TEMP ("pr-watch-test-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$fail = 0
function Check($name, $cond) { if ($cond) { "PASS $name" } else { "FAIL $name"; $script:fail++ } }

function New-Pr([string]$oid = 'aaa', $comments = @(), $reviews = @(), $threads = @(), $checks = @()) {
  @{ number = 812; title = 'Fix tickets'; url = 'https://github.com/Aspia-MyBusiness/Tickets/pull/812'; isDraft = $false
     repository = @{ nameWithOwner = 'Aspia-MyBusiness/Tickets' }
     comments = @{ nodes = @($comments) }; reviews = @{ nodes = @($reviews) }
     reviewThreads = @{ nodes = @($threads | ForEach-Object { @{ comments = @{ nodes = @($_) } } }) }
     commits = @{ nodes = @(@{ commit = @{ oid = $oid; statusCheckRollup = @{ state = 'FAILURE'; contexts = @{ nodes = @($checks) } } } }) } }
}
function Run($pr) {
  $f = Join-Path $tmp 'in.json'
  @{ data = @{ viewer = @{ login = 'me' }; search = @{ nodes = @($pr) } } } | ConvertTo-Json -Depth 20 | Set-Content $f -Encoding UTF8
  @(& $script -StateDir $tmp -InputJson $f -NoToast -Me 'me')
}
$c = { param($id, $login, $rev) @{ id = $id; author = @{ login = $login }; pullRequestReview = $(if ($rev) { @{ id = $rev } } else { $null }) } }
$okCheck  = @{ __typename = 'CheckRun'; name = 'Tickets (CI .NET)'; conclusion = 'SUCCESS' }
$badCheck = @{ __typename = 'CheckRun'; name = 'Tickets (CI .NET)'; conclusion = 'FAILURE' }

$out = Run (New-Pr 'aaa' @(& $c 'IC1' 'alice') @() @() @($okCheck))
Check 'baseline is silent' ($out.Count -eq 0 -and (Test-Path "$tmp\state.json"))

$pr2 = New-Pr 'aaa' @((& $c 'IC1' 'alice'), (& $c 'IC2' 'bob'), (& $c 'IC3' 'me')) `
  @(@{ id = 'R1'; state = 'CHANGES_REQUESTED'; author = @{ login = 'carol' } }, @{ id = 'R2'; state = 'COMMENTED'; author = @{ login = 'Copilot' } }, @{ id = 'R3'; state = 'APPROVED'; author = @{ login = 'me' } }) `
  @((& $c 'TC1' 'Copilot' 'R2'), (& $c 'TC2' 'Copilot' 'R2')) @($badCheck)
$out = Run $pr2
$t = $out -join "`n"
Check 'one toast for the PR' ($out.Count -eq 1)
Check 'changes requested' ($t -match 'Changes requested by @carol')
Check 'CI failed' ($t -match 'CI failed: Tickets \(CI \.NET\)')
Check 'comments incl bot, excl me and old' ($t -match '\+3 comments \(' -and $t -match '@Copilot x2' -and $t -match '@bob' -and $t -notmatch '@me' -and $t -notmatch '@alice')
Check 'Copilot inline review not double-counted' ($t -notmatch 'Reviewed by @Copilot')
Check 'own approval ignored' ($t -notmatch 'Approved')
Check 'toast links PR' ($t -match 'pull/812')

$out = Run $pr2
Check 'same data -> no repeat' ($out.Count -eq 0)

$pr3 = New-Pr 'bbb' @((& $c 'IC1' 'alice'), (& $c 'IC2' 'bob'), (& $c 'IC3' 'me')) $pr2.reviews.nodes @((& $c 'TC1' 'Copilot' 'R2'), (& $c 'TC2' 'Copilot' 'R2')) @($badCheck)
$out = Run $pr3
Check 'new commit still failing -> notify again' ($out.Count -eq 1 -and ($out -join '') -match 'CI failed' -and ($out -join '') -notmatch 'comment')

$pr4 = New-Pr 'ccc' @((& $c 'IC1' 'alice'), (& $c 'IC2' 'bob'), (& $c 'IC3' 'me')) ($pr2.reviews.nodes + @(@{ id = 'R4'; state = 'APPROVED'; author = @{ login = 'dave' } })) @((& $c 'TC1' 'Copilot' 'R2'), (& $c 'TC2' 'Copilot' 'R2')) @($okCheck)
$out = Run $pr4
Check 'approval by other notifies, green CI silent' ($out.Count -eq 1 -and ($out -join '') -match 'Approved by @dave' -and ($out -join '') -notmatch 'CI failed')

$pr5 = New-Pr 'ccc' @($pr4.comments.nodes + @(& $c 'IC4' 'erin')) $pr4.reviews.nodes $pr4.reviewThreads.nodes.comments.nodes @($okCheck)
$pr6 = New-Pr 'ddd' @((& $c 'IC10' 'alice'), (& $c 'IC11' 'alice')); $pr6.number = 813; $pr6.url = $pr6.url -replace '812', '813'
$out = Run @($pr5, $pr6)
$t = $out -join "`n"
Check 'several PRs -> one summary toast' ($out.Count -eq 1 -and $t -match '2 PRs with new activity \(\+3 comments\)')
Check 'summary toast has Triage-all link' ($t -match '\| prwatch://triage\?prs=Tickets:812,Tickets:813&since=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
Check 'summary lists +N by whom per PR' ($t -match 'Tickets #812: \+1 comment \(@erin\)' -and $t -match 'Tickets #813: \+2 comments \(@alice x2\)')

$f = Join-Path $tmp 'in.json'; '{ "errors": [ { "message": "Bad credentials" } ] }' | Set-Content $f
& powershell -NoProfile -File $script -StateDir $tmp -InputJson $f -NoToast -Me me | Out-Null
Check 'error exits 1 and is logged' ($LASTEXITCODE -eq 1 -and (Get-Content "$tmp\pr-watch.log" -Raw) -match 'Bad credentials')
Check 'state keeps ids only, no text' ((Get-Content "$tmp\state.json" -Raw) -notmatch 'Fix tickets')

$triage = Join-Path $PSScriptRoot 'triage.ps1'
$plan = & powershell -NoProfile -File $triage -Uri 'prwatch://triage?prs=Tickets:443&since=2026-11-05T09:00:00Z' -DryRun
$pf = (("$plan" -split ' \| ')[-1]).Trim(); $lf = [IO.Path]::ChangeExtension($pf, '.ps1')
Check 'triage plan: quote-free command runs launcher' ($LASTEXITCODE -eq 0 -and "$plan" -match '^(HERDR|WINDOW) \|' -and "$plan" -match "-File \S+triage-\d{8}-\d{6}\.ps1 \|" -and ("$plan" -split ' \| ')[2] -notmatch '["'']')
$lt = Get-Content $lf -Raw
Check 'launcher: one pi call, args quoted' ($lt -match "pi --name 'PR triage Tickets#443' '@.+\.md' 'Follow the attached pr-watch triage instructions\.'")
$tok = $null; [void][Management.Automation.Language.Parser]::ParseFile($lf, [ref]$tok, [ref]$null)
$piCall = @($tok | Where-Object { $_.Kind -eq 'StringLiteralExpandable' -or $_.Kind -eq 'StringLiteral' } | ForEach-Object Value)
Check 'launcher parses to whole message (not split words)' ($piCall -contains 'Follow the attached pr-watch triage instructions.' -and $piCall -contains 'PR triage Tickets#443')
Remove-Item $lf
$pt = Get-Content $pf -Raw
Check 'triage prompt filled' ($pt -match 'Tickets #443: https://github.com/Aspia-MyBusiness/Tickets/pull/443' -and $pt -match '2026-11-05T09:00:00Z' -and $pt -notmatch '\{\{')
Remove-Item $pf
$ErrorActionPreference = 'Continue'
& powershell -NoProfile -File $triage -Uri 'prwatch://triage?prs=Tickets:443;calc&since=2026-11-05T09:00:00Z' -DryRun 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
Check 'triage rejects crafted link' ($LASTEXITCODE -ne 0)

Remove-Item $tmp -Recurse -Force
if ($fail) { "$fail FAILED"; exit 1 } else { 'ALL PASSED' }
