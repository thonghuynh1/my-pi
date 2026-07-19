---
status: closed
labels: ready-for-agent
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #04 — Live conductor/status telemetry: `attach(host)` + per-pass status frame

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

`MyCustomizeConductor` implements `attach(host: ConductorHost): void`, stores the host reference, and on **every** `conduct()` pass calls `host.setStatus(text, metrics, details)` with a payload describing the current pre-group fill and cumulative rollover counters. On rollover passes, the `text` transitions to a rollover-aware form. This is the "live badge" surface (`DEC-016` Site 1) that a dashboard consumes to show live progress, distinct from the static JSONL surface (Site 2) owned by `#01`.

Covers:

- **User story**: `US-004` (Site 1 live status).
- **Required behavior**: `RB-007`.
- **Decision**: `DEC-016` **Site 1** (the `conductor/status` frame shape).
- **Area**: 3 (conductor — `attach(host)` and `conductor/status` telemetry).

## Implementation map

### Contract — `MyCustomizeConductor.attach(host)`

Add:

```ts
class MyCustomizeConductor implements Conductor {
    private host: ConductorHost | null = null;

    attach(host: ConductorHost): void {
        this.host = host;
    }
}
```

**Important**: `Conductor.attach(host)` is called by the extension during conductor construction. Verify the current `Conductor` interface at `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts` — if `attach` is an optional method, mark it accordingly; if it's a required method previously implemented as a no-op elsewhere, add it here with the storage behavior above.

### Contract — per-pass `setStatus` emission

At the end of every `conduct(view)` pass (both when a rollover fires and when it does not), call `this.host?.setStatus(text, metrics, details)`.

**Metrics payload** (identical shape for rollover and non-rollover passes; all integers):

```ts
{
    preGroupTokens: number,             // current sum of pre-group ViewBlock.tokens (0 if inert)
    preGroupFillPct: number,            // integer, 0-100+ (overflow >100 is visible)
    rolloverCount: number,              // cumulative since attach()
    tokensSavedByRollover: number,      // cumulative sum of estimatedGroupSaving
    lastEstimatedGroupSaving: number,   // most recent rollover's saving; 0 if none yet
    breakFrozenCount: number,           // cumulative # of emitted GroupCommands with digest !== null
}
```

**Text payload**:

- Non-rollover pass:
  ```
  chunked · <preGroupFillPct>% pregroup · <rolloverCount> rollovers · <humanTokens(tokensSavedByRollover)> saved
  ```
- Rollover pass (the pass that emits the `GroupCommand`):
  ```
  chunked · rollover · <rolloverCount> rollover(s) · <humanTokens(tokensSavedByRollover)> saved · pregroup <before> → <after>
  ```
  where `<before>` is the pre-emit `preGroupTokens` and `<after>` is 0 (the just-emitted pre-group is now the head of the immutable groups zone, and the new pre-group starts empty).

**`details` payload**: pass `null` in v1 (no additional JSON payload). The `ConductorHost.setStatus` signature is `setStatus(text, metrics?, details?)`; the third argument is `JSONValue` intended for structured diagnostics — not required for this issue.

**Small-context inert case** (`RB-008` interaction): when the small-context gate at `#01` short-circuits `effectivePreGroupTokens` to 0, this issue still emits a status frame each pass, with `preGroupTokens = 0`, `preGroupFillPct = 0`, and `rolloverCount = 0` (never incremented). The `text` is `chunked · 0% pregroup · 0 rollovers · 0 saved`.

### Contract — `humanTokens(n)` helper

New pure helper:

```ts
// Format a token count as a compact human-readable string.
// Examples: 42 → "42", 1500 → "1.5k", 15338 → "15.3k", 1_050_000 → "1.05m"
humanTokens(n: number): string
```

Placement: alongside the constants file from `#01` (`conductors/my-customize-conductor/constants.ts`), or in a sibling `format.ts`. Exact rounding rule left to the implementer as long as it's deterministic.

### Verified anchors

- `ConductorHost` interface: `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`. The method is **`host.setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void`** (three arguments). PRD `DEC-016` (post to-issues correction) specifies `setStatus`; use it.
- `MyCustomizeConductor` class body: `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:74`. Currently has **no** `attach(host)` and **no** host reference field — both are fresh additions.
- Instance-field counters `rolloverCount`, `tokensSavedByRollover`, `lastEstimatedGroupSaving`, `breakFrozenCount`: added by `#01` (walking skeleton). This issue **consumes** them.

### Blocking-edge input — from `#01` (walking skeleton)

- **Producer output**: `#01` adds and increments the instance-field counters `rolloverCount`, `tokensSavedByRollover`, `lastEstimatedGroupSaving`, `breakFrozenCount` inside `conduct()` on every rollover pass.
- **Consumer input**: this issue reads those counters (and computes `preGroupTokens`, `preGroupFillPct` from the same `preGroupFromIndex` derivation) at the end of every `conduct()` pass and passes them to `host.setStatus`.
- **Crossing contract**: private instance state on `MyCustomizeConductor` — no wire-protocol change; no cross-module contract.
- **Wiring owner (consumer)**: this issue's `attach(host)` implementation stores the host; the `conduct()` end-of-pass emission is a small addition inside the same method that `#01` extends.
- **Proof of connection**: **AC-1** below spies on the host's `setStatus` and observes the counters incrementing across rollover passes (proving `#01`'s counter increments reach this issue's emission code).

### Required edits

1. **Modify** `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`:
   - Add `private host: ConductorHost | null = null;`.
   - Add `attach(host: ConductorHost): void { this.host = host; }`.
   - At the end of `conduct(view)`, before `return plan`, compose the metrics + text and call `this.host?.setStatus(text, metrics, null)`. This applies to **all** `conduct()` passes (not only rollover passes).
2. **Add** the `humanTokens(n)` helper (placement per the contract above).

### Normative snippet

```ts
// In MyCustomizeConductor
attach(host: ConductorHost): void {
    this.host = host;
}

// End of conduct(view), replacing `return plan;`:
if (this.host) {
    const preGroupTokens = /* re-use the preGroupTokens computed for the trigger (issue #01) */;
    const preGroupTarget = effectivePreGroupTokens(view, this.opts) || 1; // avoid div-by-0 on inert
    const preGroupFillPct = Math.round((preGroupTokens / preGroupTarget) * 100);
    const rolloverJustFired = plan.some(
        (c) => c.kind === "group" && (c.digest ?? "").startsWith("⟨chunked-compaction ·"),
    );
    const text = rolloverJustFired
        ? `chunked · rollover · ${this.rolloverCount} rollover(s) · ${humanTokens(this.tokensSavedByRollover)} saved · pregroup ${preGroupTokens} → 0`
        : `chunked · ${preGroupFillPct}% pregroup · ${this.rolloverCount} rollovers · ${humanTokens(this.tokensSavedByRollover)} saved`;
    this.host.setStatus(text, {
        preGroupTokens,
        preGroupFillPct,
        rolloverCount: this.rolloverCount,
        tokensSavedByRollover: this.tokensSavedByRollover,
        lastEstimatedGroupSaving: this.lastEstimatedGroupSaving,
        breakFrozenCount: this.breakFrozenCount,
    }, null);
}
return plan;
```

## Acceptance criteria

Test file: extend `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` (or a sibling file for host-integration tests). Working directory: `F:/MyWork/my-pi/vendor/accordion/app`.

- [ ] **AC-1** (`setStatus` fires on every `conduct()` pass with the correct metrics shape — `RB-007` primary, proves the `#01` counter-input blocking edge): after two `conduct()` passes on a 200 k session (one non-rollover, one rollover), a spy on the mock host's `setStatus` has been called exactly twice with metrics matching the shape above.
  - Run: `pnpm vitest run conductor.compaction-naive -t "attach and setStatus fire on every conduct pass"`
  - Expected: `spy.callCount === 2`; both calls have `metrics.preGroupTokens: number`, `metrics.rolloverCount: number`, `metrics.tokensSavedByRollover: number`, `metrics.lastEstimatedGroupSaving: number`, `metrics.breakFrozenCount: number`, `metrics.preGroupFillPct: number`; the rollover-pass call has `metrics.rolloverCount === 1` and `metrics.breakFrozenCount === 1` (proving `#01`'s counter increments reach this issue's emission code); the non-rollover call has both counters at `0` or the pre-rollover value.

- [ ] **AC-2** (rollover-pass text template — `DEC-016` Site 1): the rollover-pass `setStatus` call receives a `text` matching `/^chunked · rollover · \d+ rollover\(s\) · [\d.]+[kmb]? saved · pregroup \d+ → 0$/`.
  - Run: `pnpm vitest run conductor.compaction-naive -t "rollover-pass setStatus text uses the rollover template"`
  - Expected: the rollover-pass `text` string matches the regex; the non-rollover call's `text` matches `/^chunked · \d+% pregroup · \d+ rollovers · [\d.]+[kmb]? saved$/`.

- [ ] **AC-3** (small-context inert emits with zero counters — `DEC-016` × `RB-008` interaction): on a `contextWindow = 32_000` session, `setStatus` is still called each pass; `metrics.preGroupTokens === 0`, `metrics.rolloverCount === 0`, `metrics.tokensSavedByRollover === 0`, `metrics.breakFrozenCount === 0` on every call.
  - Run: `pnpm vitest run conductor.compaction-naive -t "setStatus fires on small-context sessions with zero counters"`
  - Expected: after N `conduct()` passes on a 32 k session, `spy.callCount === N`; every call has all four counter fields at `0`; `text` is `chunked · 0% pregroup · 0 rollovers · 0 saved`.

- [ ] **AC-4** (`attach` is idempotent and the last host wins): calling `attach(host1)` then `attach(host2)` routes subsequent `setStatus` calls to `host2` only.
  - Run: `pnpm vitest run conductor.compaction-naive -t "attach replaces the current host"`
  - Expected: after two `attach` calls and one `conduct` pass, `host1.setStatus` has been called 0 times and `host2.setStatus` has been called exactly once.

- [ ] **AC-5** (no `lastBrokerLatencyMs`, `lastSummaryError`, or `summaryErrors` fields are emitted — `DEC-007` × `DEC-016`): the metrics payload contains **only** the six fields specified above; grep of the diff for any of those forbidden field names returns empty.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion && git diff HEAD~1 HEAD -- conductors/my-customize-conductor/ | grep -E "lastBrokerLatencyMs|lastSummaryError|summaryErrors|pendingSummaryHashes|groupSummaryCache"`
  - Expected: empty output.

## Blocked by

- `01-walking-skeleton-deterministic-rollover.md` — required for AC-1's rollover-pass metrics (needs the counter-increment code inside `conduct()` that `#01` installs).
