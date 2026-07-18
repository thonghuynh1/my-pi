---
labels: wayfinder:grilling
status: done
assignee: agent (this session)
map: ../MAP.md
blocks: [02-four-zone-layout, 03-rollover-trigger-policy]
---

# Cache-invalidation accounting

## Question

Formalize the economics of rollover so the trigger policy has a defensible break-even rule:

- What model of cache-write vs cache-read cost do we adopt? A simple "future_requests × tokens_saved > summarize_cost + tail_rebuild_cost" heuristic, or something richer?
- Should we track observed prefix-match rates via `extension/cache-tracker.ts` and surface them to the conductor? Or is the current `frozenFromIndex` snapshot enough?
- Do we expose a diagnostic metric (e.g. "rollovers so far, cache breaks so far, tokens saved per rollover") in the accordion GUI or logs?
- Are there provider-specific rules (Anthropic prompt cache vs OpenAI vs Gemini) that change the math meaningfully?

## Resolution

### D1 — Break-even model (A: reuse T03 gate)

The ADR reuses ticket-03's gate `estimatedGroupSaving ≥ max(2_000, 0.05 * cap)` unchanged and states **that gate is the break-even rule**. Justification prose in the ADR:

> A ~15 k pre-group flushed into a ~500-token digest saves ~14.5 k tokens per rollover. Against a ~10× cache-miss premium on the ~20 k tail (per ADR-0010's attention-conductor analysis), the one-time KV-break penalty is ≤ ~2 k tokens — which the 2 000-token floor dominates on any conversation with ≥1 subsequent turn. No new formula, no new symbol, no per-provider math.

Rejected shapes:
- **B**: explicit `expected_future_requests × tokens_saved > digest_cost + kv_break_penalty` — `expected_future_requests` isn't observable at trigger time; would force plumbing already ruled out by T04 D6.
- **C**: instrument-first — defers material decisions past the map boundary.

### D2 — Observed prefix-match rate (A: no plumbing)

No change to `ConductorView`. The conductor consults only `view.frozenFromIndex` (already present). `cache-tracker.ts`'s observed `matchedPrefix` / `reason` / `frozenFromIndex` stay on the existing JSONL + sync-frame paths and are **never fed back into conductor policy**. This foreclosure is a consequence of D1: with the T03 gate as the whole break-even rule, policy has no need for hit-rate history. Also blocked at the protocol level by T04 D6 (no `ConductorView` change).

### D3 — Diagnostic metric surface (C: both)

Two write-sites, structurally distinct:

**Site 1 — `conductor/status` from `my-customize-conductor`** (adds `attach(host)`, its first). Emitted every `conduct()` pass:

```ts
{
  type: "conductor/status",
  text: `chunked · ${preGroupFillPct}% pregroup · ${rolloverCount} rollovers · ${humanTokens(tokensSavedByRollover)} saved`,
  metrics: {
    preGroupTokens,           // current pre-group token total
    preGroupFillPct,          // 0–100+ (overflow visible)
    rolloverCount,            // cumulative since session start
    tokensSavedByRollover,    // cumulative sum of estimatedGroupSaving across successful rollovers
    lastEstimatedGroupSaving, // most recent rollover's saving
    breakFrozenCount          // cumulative count of emitted breakFrozen:true GroupCommands
  }
}
```

On a rollover turn, `text` transitions to `"chunked · rollover · ${rolloverCount} rollover(s) · ${humanTokens(tokensSavedByRollover)} saved · pregroup ${before} → ${after}"` for that one pass.

**Site 2 — `chunkedCompaction` block appended to per-turn JSONL by `accordion.ts`** on rollover turns only:

```jsonc
{
  "turn": <n>,
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
    "digestContentHash": "sha256:..."
  }
}
```

**Layering — who authors the JSONL record?** The extension (`accordion.ts`), not the conductor. Rationale: the extension already sees both sides of the correlation — emitted `GroupCommand`s via its plan-applied hook, and `cacheTracker.getDiagnostics()` in scope. The conductor stays JSONL-oblivious; no new upward channel; T04 D6 respected (no Broker API expansion).

### D4 — Provider-specific rules (A: provider-agnostic v1)

Same policy for all providers. All cache-cost math continues to be delegated to Pi SDK (`usage.cost.cacheRead` / `usage.cost.cacheWrite` — verified: no `cache_control` breakpoints in this codebase, no per-provider multipliers). Only existing provider-specific branch is `cache-tracker.ts:89`'s OpenAI system-message layout adjustment, which is orthogonal to chunked compaction.

Per-provider tuning (different `preGroupTokens_soft` for OpenAI's larger auto-cache or Gemini's explicit context caching) is **out of scope for this map** and would spawn a future map if ever motivated.

### D5 — Verification surface (B: JSONL-grep static replay)

The ADR names as its testable invariant:

> Over any session's JSONL:
> `count(chunkedCompaction.event == "rollover") == count(cacheDiagnostics.reason == "prefix-mismatch") − coldStartCount`
> where `coldStartCount ≤ 1` per session.
>
> Any deviation is a bug in either the conductor's single-emission guarantee (T03 α) or the extension's JSONL author path.

**Cold-start caveat, normative:** the invariant excludes the initial cold-start break (a legitimate session-start break, not caused by a rollover). The ADR must state this explicitly so the grep test is unambiguous.

Unit tests on the conductor's emission shape (assert `conduct()` emits at most one `breakFrozen:true GroupCommand` per pass) are an implementer choice — not prescribed at ADR level, since single-pass emission is already guaranteed by T03 α by construction.

### Consequences on the map

- **Ticket 11 (draft ADR-0004)** must include verbatim: the D1 break-even prose, the D3 dual write-sites and their exact payload shapes, the D5 grep-based verification claim including the cold-start caveat, and the explicit statements that D2 and D4 are foreclosed by D1.
- **Ticket 12 (compile PRD)** must specify the implementer-facing details: exact `attach(host)` addition to `my-customize-conductor`, exact `chunkedCompaction` field types and where in `accordion.ts` the block is appended, the plan-applied hook that observes `GroupCommand`s.
- **No new tickets** surface from this resolution. No fog in **Not yet specified** graduates — the four items there (level-2 rollover, code-skeleton interaction, digest composition rule, `session_before_compact` behaviour) are all untouched by ticket 05's answers.
- **Ticket 05 blocks 02 and 03** — those were already closed; this ticket resolves the remaining accounting-shape work that stood on their decisions. With 05 closed, ticket 11's last blocker is cleared.

### Artifacts

- Grill ledger: `.scratch/grills/t05-cache-acct/ledger.md`
- Repo grounding: `.scratch/grills/t05-cache-acct/grounding.md`
- Prototype (D3 side-by-side mock): `.scratch/accordion-chunked-compaction/prototypes/d3-metric-surface-mock.md`
