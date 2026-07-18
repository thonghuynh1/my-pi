---
status: ready-for-agent
labels: ready-for-agent
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #05 — Verification invariant: JSONL rollover count matches cache-mismatch count (minus cold-start)

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

Add an integration test that drives a scripted multi-turn session through the real `MyCustomizeConductor` + real engine store + real extension JSONL writer, and verifies the load-bearing invariant `RB-010` / `DEC-018`:

```
count(chunkedCompaction.event == "rollover")
  == count(cacheDiagnostics.reason == "prefix-mismatch") − coldStartCount
```

where `coldStartCount ≤ 1` per session (the first-turn cold-start prefix-mismatch is explicitly excluded).

This is the primary downstream verification surface: it proves both `#01`'s single-emission guarantee (a rollover produces exactly one prefix-mismatch, not zero and not two) and `#01`'s JSONL author path (the `chunkedCompaction` block is written on rollover turns and only on rollover turns).

Covers:

- **User story**: `US-004` (Site 2 verification).
- **Required behavior**: `RB-010`.
- **Decision**: `DEC-018` (verification invariant with cold-start exclusion).
- **Test seam**: 3 (verification invariant integration test).

## Implementation map

### Contract — integration test shape

Add a new test file (implementer picks location under `F:/MyWork/my-pi/vendor/accordion/app/src/lib/` — the vitest config includes `src/lib/**/*.test.ts`). The test:

1. Constructs a real `MyCustomizeConductor` instance (no mocks of substances under test).
2. Constructs a real engine `AccordionStore` (no mocks).
3. Constructs a fake extension `writeContextDiagnostic` sink that captures each per-turn JSONL record into an in-memory array (the sink IS a mock — it stands in for the file system, but not for any substance-under-test logic).
4. Drives at least 3 turns:
   - **Turn 1**: cold-start; the pre-group is small; no chunked-compaction rollover fires.
   - **Turn 2**: still building; a normal turn.
   - **Turn 3**: the pre-group crosses ~15 000 tokens on a safe boundary; the trigger fires; exactly one chunked-compaction `GroupCommand` is emitted and applied.
5. After the final turn, evaluate the invariant against the captured JSONL records.

The test may generate additional turns to exercise the invariant across two rollovers (`R = 2`, `M − C = 2`), but a single-rollover case is sufficient for the primary assertion.

### Contract — invariant check inside the test

Implement the invariant as a pure function inside the test (or in a sibling helper module) that mirrors the shell one-liner from the PRD's `## Testing Decisions`:

```ts
function verifyInvariant(records: readonly Record<string, unknown>[]): {
    rollovers: number;
    mismatches: number;
    coldStarts: number;
    ok: boolean;
} {
    const rollovers = records.filter(
        (r) => (r as any).chunkedCompaction?.event === "rollover",
    ).length;
    const mismatches = records.filter(
        (r) => (r as any).cacheTracker?.reason === "prefix-mismatch",
    ).length;
    const coldStarts = records.filter(
        (r) => (r as any).cacheTracker?.reason === "cold-start",
    ).length;
    return { rollovers, mismatches, coldStarts, ok: rollovers === mismatches - coldStarts };
}
```

**Note on JSONL field naming**: `#01` writes the diagnostic under the top-level `cacheTracker` key (from `cacheTracker.getDiagnostics()` — see `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~1227`), whose payload includes `reason: CacheTrackerReason`. Verify the actual field path in the current extension code before writing the assertion. If the field path is different (e.g. `cacheDiagnostics` instead of `cacheTracker`), use the actual path from the current writer.

### Verified anchors

- Existing `writeContextDiagnostic` payload with `cacheTracker: cacheTracker.getDiagnostics()`: `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~1227` (confirmed via grounding pass).
- `CacheTrackerDiagnostics` reasons enum (includes `"cold-start"`, `"prefix-match"`, `"prefix-mismatch"` per grounding): `F:/MyWork/my-pi/vendor/accordion/extension/cache-tracker.ts:17-23`.
- `chunkedCompaction.event = "rollover"` shape: added by `#01` (see `#01`'s AC-10).
- Cold-start behavior: `cacheTracker.reason === "cold-start"` on the very first turn of every session (an operational fact of the tracker); `coldStartCount === 1` per session unless the session is empty.

### Blocking-edge input — from `#01` (walking skeleton)

- **Producer output**: `#01` authors the `chunkedCompaction: { event: "rollover", ... }` field on the per-turn JSONL for rollover turns, and does **not** author it on non-rollover turns.
- **Consumer input**: this issue's test parses those records and computes `count(chunkedCompaction.event == "rollover")`.
- **Crossing contract**: JSONL record shape from `#01`'s AC-10 — top-level `chunkedCompaction` object present on rollover turns only.
- **Wiring owner (consumer)**: this issue's test harness — it captures the JSONL sink and evaluates the invariant.
- **Proof of connection**: **AC-1** below runs a real single-rollover session and asserts `rollovers === 1` **and** `mismatches - coldStarts === 1`. If `#01` fails to author the JSONL block, `rollovers === 0` and the AC fails.

### Blocking-edge input — from `#02` (engine group frozen-clamp bypass)

- **Producer output**: `#02` allows the group substitution to apply across the frozen boundary; without it, the group is clamped and no cache-mismatch is triggered by chunked compaction.
- **Consumer input**: this issue's test observes `cacheTracker.reason` transitioning from `"prefix-match"` to `"prefix-mismatch"` at the rollover turn.
- **Proof of connection**: covered by AC-1 (if `#02` is reverted, the group is clamped, no mismatch occurs, `mismatches - coldStarts === 0`, and the AC fails).

### Required edits

1. **New test file** (implementer picks location under `app/src/lib/`), containing:
   - The `verifyInvariant` helper (or an inline equivalent).
   - The multi-turn harness that drives real `MyCustomizeConductor` + real `AccordionStore` and captures the JSONL sink.
   - The three ACs below.
2. **No changes to production code.** This issue is a pure verification-test addition — it depends on `#01` and `#02` having landed, and does not introduce new source code outside `app/src/lib/**/*.test.ts`.

## Acceptance criteria

Working directory: `F:/MyWork/my-pi/vendor/accordion/app`.

- [ ] **AC-1** (invariant holds on a single-rollover session — `RB-010` primary, proves both blocking edges): after a scripted 3-turn session in which turn 3 fires exactly one chunked-compaction rollover, `verifyInvariant(records).ok === true` with `rollovers === 1`, `mismatches === 2` (cold-start + rollover), `coldStarts === 1`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "single rollover satisfies count(rollover) == count(prefix-mismatch) - coldStarts"`
  - Expected: the assertion passes with the exact counts above; the test fails immediately (with a diff-friendly message) if `rollovers`, `mismatches`, or `coldStarts` differ.

- [ ] **AC-2** (invariant holds on a two-rollover session — extends AC-1): after a scripted session that fires two chunked-compaction rollovers on well-separated turns, `verifyInvariant(records).ok === true` with `rollovers === 2`, `mismatches === 3` (cold-start + 2 rollovers), `coldStarts === 1`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "two rollovers satisfy the invariant"`
  - Expected: the assertion passes with the exact counts above.

- [ ] **AC-3** (invariant holds on a small-context session — verifies `RB-008` interaction): after a scripted session on a 32 k-context corpus that never fires a rollover, `verifyInvariant(records).ok === true` with `rollovers === 0`, `mismatches === 1` (cold-start only), `coldStarts === 1`. `mismatches - coldStarts === 0`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "small-context session has zero rollovers and zero non-cold-start mismatches"`
  - Expected: the assertion passes with `rollovers === 0` and `mismatches - coldStarts === 0`.

- [ ] **AC-4** (invariant is discriminating — anti-stub check): a deliberately-corrupted variant of the harness that drops the `chunkedCompaction` field from the rollover-turn record (simulating a `#01` regression) causes `AC-1` to **fail** with a clear counts-mismatch message.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "invariant fails when a rollover JSONL block is missing (discriminating check)"`
  - Expected: the corrupted-variant test **passes** by asserting the invariant returns `ok === false`; the assertion message shows `rollovers === 0, mismatches === 2, coldStarts === 1` and `0 !== 2 - 1`. This proves the invariant would catch a real `#01` regression and is not a tautology.

## Blocked by

- `01-walking-skeleton-deterministic-rollover.md` — required for AC-1, AC-2, AC-3 (the JSONL `chunkedCompaction` block is authored by `#01`).
- `02-engine-group-frozen-clamp-bypass.md` — required for AC-1 and AC-2 (without the bypass the group is clamped and no rollover-driven prefix-mismatch occurs).
