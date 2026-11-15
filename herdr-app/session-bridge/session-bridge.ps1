# session-bridge.ps1 - the whole herdr-app session-resume bridge in one file.
#
# herdr-core restores a lost terminal as a plain shell and never re-runs the
# original command. This script records each pane's agent session as terminal
# labels (resume.app / resume.session / resume.kind / resume.at) while agents run, so a
# restored shell can restart its agent automatically after a reboot, in any layout.
# The project-spaces mod also offers the same resume as a button as a fallback.
#
# One file, seven invocation modes:
#   . session-bridge.ps1                          (from $PROFILE) wrap shim agents with the env bridge
#   session-bridge.ps1 pane report-agent-session  (HERDR_BIN_PATH) Herdr hook shim
#   session-bridge.ps1 claude-hook                Claude SessionStart recorder (stdin JSON)
#   session-bridge.ps1 record <app> <session> <kind>   generic label writer (Pi/OpenCode stubs)
#   session-bridge.ps1 auto-resume <term> <pid>   restart a restored shell's recorded agent, once
#   session-bridge.ps1 -Install                   generate stubs, wire profile + Claude settings
#   session-bridge.ps1 cleanup [-DryRun] [-LiveDays n]  prune dead/stale resume labels + log
#
# Outside herdr-core (no HC_TERMINAL_ID, no hc address) every mode is a
# silent no-op, so this file is safe in any shell on any machine.

$ErrorActionPreference = "SilentlyContinue"
$script:Self = $MyInvocation.MyCommand.Path
$script:Dir = Split-Path $script:Self

# ---- Mode: dot-sourced from the PowerShell profile -------------------------
# Present the env Herdr's per-agent session hooks expect, routed to this file
# as the shim, scoped to the agent processes that use those hooks (Codex,
# Copilot, Cursor). Each wrapper sets the vars only while the agent runs, so
# the shell and everything else in the pane keep an honest herdr-core
# environment. Guarded: a real herdr TUI pane already has HERDR_PANE_ID.
if ($MyInvocation.InvocationName -eq '.') {
    if ($env:HC_TERMINAL_ID -and -not $env:HERDR_PANE_ID) {
        $bridge = $script:Self
        foreach ($name in @('codex', 'copilot', 'cursor-agent')) {
            $real = (Get-Command $name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1).Source
            if (-not $real) { continue }
            $wrapper = {
                $keys = @('HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_SOCKET_PATH', 'HERDR_BIN_PATH')
                $previous = @{}
                foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key) }
                try {
                    $env:HERDR_ENV = "1"
                    $env:HERDR_PANE_ID = $env:HC_TERMINAL_ID
                    $env:HERDR_SOCKET_PATH = "hc-session-bridge"
                    $env:HERDR_BIN_PATH = $bridge
                    if ($MyInvocation.ExpectingInput) { $input | & $real @args } else { & $real @args }
                } finally {
                    foreach ($key in $keys) {
                        if ($null -eq $previous[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
                        else { [Environment]::SetEnvironmentVariable($key, $previous[$key]) }
                    }
                }
            }.GetNewClosure()
            Set-Item -Path "Function:$name" -Value $wrapper
        }
        # Opportunistic retention: when a kept shell starts (including after a
        # reboot), launch at most one hidden cleanup per hour. The marker is
        # advanced before launch so simultaneous panes do not all start one.
        try {
            $marker = Join-Path $script:Dir "cleanup-state.json"
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $last = 0
            if (Test-Path $marker) { $last = [long](Get-Content $marker -Raw | ConvertFrom-Json).lastCleanupMs }
            if ($now - $last -ge 3600000) {
                [ordered]@{ lastCleanupMs = $now } | ConvertTo-Json -Compress | Set-Content -Path $marker
                Start-Process pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script:Self`"", 'cleanup') | Out-Null
            }
        } catch {}
        # Automatic resume: a shell that herdr-core restored (after a reboot
        # or a core restart) still carries resume.* labels, so restart its
        # agent without waiting for a button in any one layout. The hidden
        # job re-checks that this shell is still idle and unstamped before
        # it types anything, so a shell started for any other reason, or a
        # pane whose agent is already running, is left alone.
        try {
            Start-Process pwsh -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script:Self`"", 'auto-resume', $env:HC_TERMINAL_ID, $PID) | Out-Null
        } catch {}
    }
    return
}

function Get-Hc {
    $hc = (Get-Command hc -ErrorAction SilentlyContinue).Source
    if (-not $hc) { $hc = Join-Path $env:LOCALAPPDATA "Programs\herdr-core\hc.exe" }
    return $hc
}

function Set-ResumeLabels($Addr, $App, $Session, $Kind) {
    if ([string]::IsNullOrWhiteSpace($Addr) -or [string]::IsNullOrWhiteSpace($App) -or [string]::IsNullOrWhiteSpace($Session)) { return }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    & (Get-Hc) label $Addr "resume.app=$App" "resume.session=$Session" "resume.kind=$Kind" "resume.at=$now" 2>$null | Out-Null
}

function Remove-ResumeLabels($Addr) {
    & (Get-Hc) label $Addr "resume.app=" "resume.session=" "resume.kind=" "resume.at=" 2>$null | Out-Null
}

function Limit-ClaudeHookLog {
    try {
        $log = Join-Path $script:Dir "claude-hook-log.jsonl"
        if ((Test-Path $log) -and (Get-Item $log).Length -gt 65536) {
            $tail = @(Get-Content $log -Tail 200)
            $tail | Set-Content -Path $log
        }
    } catch {}
}

$mode = $args[0]

# ---- Mode: Herdr hook shim --------------------------------------------------
# Herdr's PowerShell integrations (codex, copilot, cursor) run:
#   herdr pane report-agent-session <pane> --agent <app> --agent-session-id <id>
# Translate to labels. Every other herdr command is a successful no-op:
# state reporting in herdr-app flows over OSC 7501, not through this binary.
if ($mode -eq "pane") {
    if ($args.Count -lt 3 -or $args[1] -ne "report-agent-session") { exit 0 }
    # The pane argument wins when it looks like an hc address (t + base36);
    # the profile bridge sets HERDR_PANE_ID to exactly that. A real herdr TUI
    # invocation (numeric pane ids, no HC_TERMINAL_ID) is never hijacked.
    $addr = $null
    if ($args[2] -match '^t[0-9a-z]+$') { $addr = $args[2] }
    elseif (-not [string]::IsNullOrWhiteSpace($env:HC_TERMINAL_ID)) { $addr = $env:HC_TERMINAL_ID }
    else { exit 0 }
    $app = $null; $session = $null; $kind = $null
    for ($i = 3; $i -lt $args.Count - 1; $i++) {
        switch ($args[$i]) {
            "--agent" { $app = $args[$i + 1] }
            "--agent-session-id" { $session = $args[$i + 1]; $kind = "id" }
            "--agent-session-path" { $session = $args[$i + 1]; $kind = "path" }
        }
    }
    Set-ResumeLabels $addr $app $session $kind
    exit 0
}

# ---- Mode: generic recorder (Pi / OpenCode stubs call this) -----------------
if ($mode -eq "record") {
    Set-ResumeLabels $env:HC_TERMINAL_ID $args[1] $args[2] $args[3]
    exit 0
}

# ---- Mode: Claude SessionStart hook -----------------------------------------
# Claude passes JSON on stdin ({session_id, cwd, source, ...}).
if ($mode -eq "claude-hook") {
    if ([string]::IsNullOrWhiteSpace($env:HC_TERMINAL_ID)) { exit 0 }
    $inputText = [Console]::In.ReadToEnd()
    try { $payload = $inputText | ConvertFrom-Json } catch { exit 0 }
    $session = $payload.session_id
    if ([string]::IsNullOrWhiteSpace($session)) { exit 0 }
    # Only a human-started interactive Claude owns the pane's resume slot.
    # Claude subprocesses (model backends such as pi's claude-bridge) report
    # entrypoint sdk-ts/sdk-cli and must never overwrite it.
    if ($env:CLAUDE_CODE_ENTRYPOINT -and $env:CLAUDE_CODE_ENTRYPOINT -ne "cli") { exit 0 }
    # Small debug log: one line per accepted start.
    try {
        $line = [ordered]@{
            t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            terminal = $env:HC_TERMINAL_ID
            session = $session
            source = $payload.source
            cwd = $payload.cwd
            entrypoint = $env:CLAUDE_CODE_ENTRYPOINT
        } | ConvertTo-Json -Compress
        Add-Content -Path (Join-Path $script:Dir "claude-hook-log.jsonl") -Value $line
    } catch {}
    Limit-ClaudeHookLog
    Set-ResumeLabels $env:HC_TERMINAL_ID "claude" $session "id"
    exit 0
}

# ---- Mode: automatic resume ---------------------------------------------------
# Invoked hidden from the profile when a herdr-core shell starts:
#   session-bridge.ps1 auto-resume <terminal> <shell-pid>
# Types the recorded agent's resume line into the pane, once per shell and
# once per recorded session. Every guard must hold at send time: the terminal
# is live, it is still the same shell process, no agent status is reported,
# the foreground is that shell, and a path session still exists on disk.
if ($mode -eq "auto-resume") {
    $addr = $args[1]; $shellPid = [int]$args[2]
    if ([string]::IsNullOrWhiteSpace($addr)) { exit 0 }
    $logResume = { param($what) try { Add-Content -Path (Join-Path $script:Dir "auto-resume-log.jsonl") -Value ([ordered]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); terminal = $addr; shell = $shellPid; what = $what } | ConvertTo-Json -Compress) } catch {} }
    & $logResume "start"
    $lines = @{
        pi = { param($s, $k) if ($k -eq "path") { "pi --session `"$s`"" } else { "pi --session $s" } }
        claude = { param($s, $k) "claude --resume $s" }
        codex = { param($s, $k) "codex resume $s" }
        copilot = { param($s, $k) "copilot --resume=$s" }
        cursor = { param($s, $k) "cursor-agent --resume $s" }
        opencode = { param($s, $k) "opencode --session $s" }
        antigravity = { param($s, $k) "agy --conversation $s" }
        gemini = { param($s, $k) "gemini --resume $s" }
    }
    Start-Sleep -Seconds 2
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try { $record = (& (Get-Hc) get $addr --json 2>$null | Out-String | ConvertFrom-Json) } catch { exit 0 }
        if (-not $record -or $record.state -ne "live") { exit 0 }
        $app = $record.labels."resume.app"; $session = $record.labels."resume.session"
        $kind = $record.labels."resume.kind"; $at = $record.labels."resume.at"
        if ([string]::IsNullOrWhiteSpace($app) -or [string]::IsNullOrWhiteSpace($session) -or -not $lines.ContainsKey($app)) { exit 0 }
        if ($record.status) { exit 0 }
        if ([int]$record.pid -ne $shellPid) { exit 0 }
        # The foreground can never be the shell itself while this job lives:
        # the job is a child of that shell in the same terminal, so the core
        # reports a transient child pid instead. Accept any PowerShell in
        # front (the shell, this job, a nested shell); a real program the
        # user started by hand is none of those and keeps the pane.
        $fgName = [string]$record.foreground.name
        if (-not $record.foreground -or $fgName -notin @("pwsh.exe", "powershell.exe", "pwsh", "powershell")) {
            Start-Sleep -Seconds 1; continue
        }
        if ($kind -eq "path" -and -not (Test-Path $session)) { exit 0 }
        $stamp = Join-Path $script:Dir "auto-resume-$addr-$shellPid.json"
        if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq "$at") { exit 0 }
        "$at" | Set-Content -Path $stamp
        $line = & $lines[$app] $session $kind
        & $logResume "send $app"
        & (Get-Hc) send $addr $line 2>$null | Out-Null
        # send pastes at once but holds its Enter behind draft protection
        # (draft_wait), which can leave the line sitting at the prompt for up
        # to a minute. Press Enter until the agent reports, so the resume is
        # prompt; an Enter that lands after it started is an empty Enter in
        # the agent's window, a no-op.
        for ($i = 0; $i -lt 6; $i++) {
            Start-Sleep -Seconds 2
            try { $after = (& (Get-Hc) get $addr --json 2>$null | Out-String | ConvertFrom-Json) } catch { break }
            if (-not $after -or $after.status) { break }
            $afterFg = [string]$after.foreground.name
            if (-not $after.foreground -or $afterFg -notin @("pwsh.exe", "powershell.exe", "pwsh", "powershell")) { break }
            & (Get-Hc) keys $addr enter 2>$null | Out-Null
        }
        exit 0
    }
    exit 0
}

# ---- Mode: cleanup ------------------------------------------------------------
# Retention is deliberately bounded and only ever removes this bridge's four
# labels. It never removes a terminal or an agent's own session file.
# Default cleanup:
#   - strip labels from finished terminals (closed pane/space: unactionable)
#   - strip live path records whose session file no longer exists locally,
#     but only once no agent status is reported (a new session path can be
#     known before its file has been flushed)
#   - for duplicate live records of one session, keep only the newest
#   - cap the Claude debug log
# Optional -LiveDays n also expires inactive live records after n days.
if ($mode -eq "cleanup") {
    $dryRun = $args -contains "-DryRun"
    $liveDays = 0
    for ($i = 1; $i -lt $args.Count - 1; $i++) {
        if ($args[$i] -eq "-LiveDays") { $liveDays = [int]$args[$i + 1] }
    }
    $hcPath = Get-Hc
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $records = @()
    try {
        $list = (& $hcPath ls --all --json 2>$null | Out-String | ConvertFrom-Json)
        foreach ($summary in @($list.terminals)) {
            try { $records += (& $hcPath get $summary.address --json 2>$null | Out-String | ConvertFrom-Json) } catch {}
        }
    } catch {}

    $labelled = @($records | Where-Object { $_.labels."resume.app" -and $_.labels."resume.session" })
    $remove = @{}
    $reason = @{}
    foreach ($record in $labelled) {
        $session = $record.labels."resume.session"
        $kind = $record.labels."resume.kind"
        if ($record.state -eq "finished") {
            $remove[$record.address] = $true; $reason[$record.address] = "finished terminal"
        } elseif ($kind -eq "path" -and -not $record.status -and $record.address -match '^t[0-9a-z]+$' -and -not (Test-Path $session)) {
            $remove[$record.address] = $true; $reason[$record.address] = "session file missing"
        }
    }

    # Duplicate live records: retain the newest activity for an app+session.
    $live = @($labelled | Where-Object { $_.state -ne "finished" -and -not $remove.ContainsKey($_.address) })
    $activity = @{}
    foreach ($record in $live) {
        $score = [long]($record.labels."resume.at" ?? $record.status_ms ?? $record.created_ms ?? 0)
        $activity[$record.address] = $score
    }
    foreach ($group in @($live | Group-Object { "$($_.labels.'resume.app')`n$($_.labels.'resume.session')" })) {
        if ($group.Count -lt 2) { continue }
        $keep = $group.Group | Sort-Object { $activity[$_.address] } -Descending | Select-Object -First 1
        foreach ($record in $group.Group) {
            if ($record.address -ne $keep.address) {
                $remove[$record.address] = $true; $reason[$record.address] = "older duplicate"
            }
        }
    }

    if ($liveDays -gt 0) {
        $cutoff = $now - ([long]$liveDays * 86400000)
        foreach ($record in $live) {
            if ($remove.ContainsKey($record.address)) { continue }
            $state = if ($record.status) { $record.status.state } else { $null }
            if ($state -notin @("working", "blocked") -and $activity[$record.address] -lt $cutoff) {
                $remove[$record.address] = $true; $reason[$record.address] = "inactive over $liveDays days"
            }
        }
    }

    foreach ($address in @($remove.Keys | Sort-Object)) {
        if ($dryRun) { Write-Host "Would clean $address ($($reason[$address]))" }
        else { Remove-ResumeLabels $address }
    }
    if (-not $dryRun) {
        Limit-ClaudeHookLog
        try { [ordered]@{ lastCleanupMs = $now } | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $script:Dir "cleanup-state.json") } catch {}
    }
    $verb = if ($dryRun) { "Would clean" } else { "Cleaned" }
    Write-Host "$verb $($remove.Count) resume record(s); kept $($labelled.Count - $remove.Count)."
    exit 0
}

# ---- Mode: install ------------------------------------------------------------
# Generates the two runtime stubs (Pi extension, OpenCode plugin), points the
# Claude SessionStart hook at this file, and reduces the profile to one
# dot-source line. Idempotent; backs up anything it rewrites once.
if ($mode -eq "-Install" -or $mode -eq "install") {
    $ErrorActionPreference = "Continue"
    $self = $script:Self

    $piStub = @'
// Generated by session-bridge.ps1 -Install. Do not edit: all logic lives in
// __BRIDGE__ (mode: record). Reports this terminal's Pi session file.
// @ts-nocheck
import { execFile } from "node:child_process";
const bridge = "__BRIDGE__";
export default function (pi) {
  if (!process.env.HC_TERMINAL_ID) return;
  const publish = (_event, ctx) => {
    if (ctx?.mode && ctx.mode !== "tui") return;
    try {
      const file = ctx?.sessionManager?.getSessionFile?.();
      if (file) execFile("pwsh", ["-NoProfile", "-File", bridge, "record", "pi", file, "path"], { windowsHide: true }, () => {});
    } catch {}
  };
  pi.on("session_start", publish);
  pi.on("agent_start", publish);
}
'@
    $ocStub = @'
// Generated by session-bridge.ps1 -Install. Do not edit: all logic lives in
// __BRIDGE__ (mode: record). Reports this terminal's root OpenCode session.
import { execFile } from "node:child_process";
const bridge = "__BRIDGE__";
let recorded;
export const HcSessionLabelPlugin = async () => {
  if (!process.env.HC_TERMINAL_ID) return {};
  const children = new Set();
  const label = (sessionID) => {
    if (!sessionID || sessionID === recorded || children.has(sessionID)) return;
    recorded = sessionID;
    try { execFile("pwsh", ["-NoProfile", "-File", bridge, "record", "opencode", sessionID, "id"], { windowsHide: true }, () => {}); } catch {}
  };
  return {
    "chat.message": async ({ sessionID }) => label(sessionID),
    event: async ({ event }) => {
      const properties = event?.properties ?? {};
      if (properties.info?.id && properties.info.parentID) children.add(properties.info.id);
      if (event?.type === "session.created" || event?.type === "session.updated") label(properties.sessionID);
    },
  };
};
'@
    $piPath = Join-Path $env:USERPROFILE ".pi\agent\extensions\hc-session-label.ts"
    $ocPath = Join-Path $env:USERPROFILE ".config\opencode\plugins\hc-session-label.js"
    New-Item -ItemType Directory -Force (Split-Path $piPath), (Split-Path $ocPath) | Out-Null
    $escaped = $self.Replace('\', '\\')
    Set-Content -Path $piPath -Value $piStub.Replace('__BRIDGE__', $escaped)
    Set-Content -Path $ocPath -Value $ocStub.Replace('__BRIDGE__', $escaped)
    Write-Host "Pi stub        $piPath"
    Write-Host "OpenCode stub  $ocPath"

    # Claude settings: one SessionStart hook pointing at this file.
    $claudeSettings = Join-Path $env:USERPROFILE ".claude\settings.json"
    if (Test-Path $claudeSettings) {
        Copy-Item $claudeSettings "$claudeSettings.bak-session-bridge" -Force
        $settings = Get-Content $claudeSettings -Raw | ConvertFrom-Json -AsHashtable
        if (-not $settings) { $settings = @{} }
        # pwsh, not powershell: this file uses PowerShell 7 syntax (??), which
        # Windows PowerShell 5.1 cannot even parse, so a 5.1 hook records nothing.
        $command = "pwsh -NoProfile -ExecutionPolicy Bypass -File `"$self`" claude-hook"
        $found = $false
        foreach ($group in @($settings.hooks.SessionStart)) {
            foreach ($hook in @($group.hooks)) {
                if ($hook.command -like "*session-bridge*") { $hook.command = $command; $found = $true }
            }
        }
        if (-not $found) {
            if (-not $settings.hooks) { $settings.hooks = @{} }
            $settings.hooks.SessionStart = @(@($settings.hooks.SessionStart) + @{ hooks = @(@{ type = "command"; command = $command; timeout = 10 }) })
        }
        Set-Content -Path $claudeSettings -Value ($settings | ConvertTo-Json -Depth 12)
        Write-Host "Claude hook    $claudeSettings (backup .bak-session-bridge)"
    }

    # Profile: replace any older bridge block with one dot-source line.
    # Create the profile when it is missing (a fresh machine, or Documents
    # redirected to a folder that has none): skipping it silently would leave
    # the codex/copilot/cursor wrappers uninstalled while reporting success.
    $profilePath = $PROFILE.CurrentUserCurrentHost
    if (-not (Test-Path $profilePath)) {
        New-Item -ItemType Directory -Force (Split-Path $profilePath) | Out-Null
        New-Item -ItemType File -Force $profilePath | Out-Null
    }
    if (Test-Path $profilePath) {
        Copy-Item $profilePath "$profilePath.bak-session-bridge" -Force
        $text = (Get-Content $profilePath -Raw) ?? ""
        $text = $text -replace "(?ms)\r?\n# herdr-app session bridge:.*?^}\r?\n", "`n"
        $line = ". `"$self`""
        if ($text -notlike "*$line*") {
            $text = $text.TrimEnd() + "`n`n# herdr-app session bridge (dot-source sets the env bridge inside herdr-core terminals)`n$line`n"
        }
        Set-Content -Path $profilePath -Value $text
        Write-Host "Profile        $profilePath (backup .bak-session-bridge)"
    }

    Write-Host "Done. Recorders activate at each agent's next launch (Pi also needs a restart or /reload)."
    exit 0
}

exit 0
