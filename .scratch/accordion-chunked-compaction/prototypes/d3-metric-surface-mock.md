# Prototype — D3 metric surface mock

**Purpose:** side-by-side sample rendering of Options A / B / C from ticket 05 grill turn 2, so the human can react to concrete artifacts before choosing.

**Method:** simulate a 6-turn session where the pre-group fills across turns 1-4, rolls over on turn 4, then fills again. Show what each option emits at each turn.

**Not code.** Throwaway markdown; captures the observable shape only.

---

## Synthetic session timeline

Constants: `preGroupTokens_soft = 15_000`, `overflow = 18_750`, `min_savings = 2_000`, `contextWindow = 200_000`, `cap = 180_000`.

| Turn | Pre-group tokens | Trigger fires? | Group emitted? | Notes |
|------|------------------|----------------|----------------|-------|
| 1 | 4 200 | no | no | building |
| 2 | 8 700 | no | no | building |
| 3 | 13 100 | no | no | just under soft |
| 4 | 15 850 | **yes** (fast path — turn boundary, no open tool pair, saving 15 350 ≥ 9 000) | **yes** — digest ~500 tokens | KV-cache prefix break #1 |
| 5 | 3 800 | no | no | pre-group reset after rollover |
| 6 | 7 100 | no | no | rebuilding |

Cache-tracker sees `frozenFromIndex` drop from N to 0 exactly once — between turns 4 and 5. `matchedPrefix` reason at turn 5 = `prefix-mismatch`. All other turns = `prefix-match`.

---

## Option A — `conductor/status` only

**Turn 1 (badge text):**
> 🪗 chunked · 28% pregroup · 0 rollovers · 0 tokens saved

**Turn 4 (rollover turn):**
> 🪗 chunked · rollover · 1 rollover · 15.4k saved · pregroup 15.9k → 0.5k

**Turn 5 (after rollover):**
> 🪗 chunked · 25% pregroup · 1 rollover · 15.4k saved

**Metrics payload emitted every `conduct()` pass:**
```json
{
  "type": "conductor/status",
  "text": "chunked · 25% pregroup · 1 rollover · 15.4k saved",
  "metrics": {
    "preGroupTokens": 3800,
    "preGroupFillPct": 25,
    "rolloverCount": 1,
    "tokensSavedByRollover": 15350,
    "lastEstimatedGroupSaving": 15350,
    "breakFrozenCount": 1
  }
}
```

**What an analyst reconstructing turn 4 gets:** the metrics snapshot at turn 5 tells you rollovers = 1 and tokens saved = 15 350, but nothing about *when in the session* the rollover fired, what the pre-group looked like before, or which blocks it swept. To verify the ≤1-break invariant you need to have been listening live.

---

## Option B — JSONL only

**Turn 1 through Turn 3:** no new JSONL fields added (chunked compaction is silent when not firing).

**Turn 4 — per-turn JSONL record gets a new `chunkedCompaction` block:**
```jsonl
{
  "turn": 4,
  "context": { /* existing fields */ },
  "chunkedCompaction": {
    "event": "rollover",
    "preGroupTokensBefore": 15850,
    "preGroupBlockCount": 47,
    "preGroupTurnRange": [17, 31],
    "digestTokens": 512,
    "estimatedGroupSaving": 15338,
    "frozenFromIndexBefore": 22,
    "frozenFromIndexAfter": 68,
    "cacheTrackerReasonBefore": "prefix-match",
    "cacheTrackerReasonAfter": "prefix-mismatch",
    "digestContentHash": "sha256:abcd1234..."
  }
}
```

**Turn 5:** no `chunkedCompaction` field (nothing fired). Cache-tracker's normal per-turn record still shows `reason: "prefix-mismatch"` (the tail rebuilt around the new digest).

**What a live human sees in the extension badge:** nothing — the badge is still the pre-existing static `🪗 accordion`. Postmortem is rich; live view is invisible.

**Invariant verification:** `jq '.chunkedCompaction.event' session.jsonl | grep rollover | wc -l` vs `jq '.cacheDiagnostics.reason' session.jsonl | grep prefix-mismatch | wc -l` — the difference must be ≤ session's cold-start count (typically 1). Testable via a one-line grep on a session log.

---

## Option C — Both

Same live badge and status metrics as A. Same JSONL record as B on rollover turns.

**Turn 4 emits both:**
- `conductor/status` frame with `text: "chunked · rollover · 1 rollover · 15.4k saved · pregroup 15.9k → 0.5k"` and metrics.
- JSONL turn-4 record with the full `chunkedCompaction` block above.

**Turn 5 emits only the status frame** (per-pass metric snapshot); no JSONL rollover record (nothing rolled over).

---

## Side-by-side answers

| Question | A | B | C |
|---|---|---|---|
| Live human sees rollover event? | ✅ badge changes | ❌ silent | ✅ badge changes |
| Postmortem replayable? | ⚠ metrics snapshot only; no per-event history | ✅ full per-rollover record | ✅ full per-rollover record |
| Downstream test seam for ≤1-break invariant? | ⚠ requires live capture harness | ✅ one-line grep on JSONL | ✅ one-line grep on JSONL |
| New code sites in extension? | `attach(host)` + status emit | JSONL field extension in `accordion.ts` | both |
| Standing preference match ("conductor emits `conductor/status` telemetry")? | ✅ | ❌ | ✅ |
| Map-destination match ("provable by a downstream implementer with a test")? | ⚠ needs live capture | ✅ static replay | ✅ static replay |

---

## Question surfaced by the mock

Reading these side-by-side, the interesting sub-question is **who owns the JSONL record**: the conductor (which would need a new upward channel — ticket 04 D6 forbids Broker API additions) or the extension (`accordion.ts` already writes the JSONL and already has `cacheTracker.getDiagnostics()` in scope — the natural author).

Answer: the extension owns the JSONL record. It correlates conductor-emitted `GroupCommand`s with cache-tracker's per-turn diagnostics. No new upward channel needed; the extension already has both sides of the correlation.

That's a clean layering: conductor emits a `GroupCommand` (already legal), extension observes it via its plan-applied hook (already exists), extension writes the JSONL record (already writes per-turn JSONL). Conductor is not aware of JSONL.

---

## Verdict slot (fill in on human reaction)

- Chosen option: _____
- Rationale: _____
- Downstream: this pins D5 (verification surface) — grep on JSONL is the natural test if B or C wins; unit test on `conduct()` emission shape is the natural test if A wins.
