---
status: closed
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #05 — Verification invariant: rollover count matches cache-break count minus cold start

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

Add an integration test that drives scripted multi-turn sessions through the real `MyCustomizeConductor`, real `AccordionStore`, real plan mapping, real cache tracker, and real chunked-compaction diagnostic builder. The only mock is an in-memory append sink for JSONL lines.

Verify `RB-010` and `DEC-018` in a stable-provider session where chunked compaction is the only operation that rewrites provider-visible messages:

```text
prefixRewrite(record)
  = record.cacheTracker.previousMessageCount > 0
    && record.cacheTracker.matchedPrefix < record.cacheTracker.previousMessageCount

cacheBreak(record)
  = record.cacheTracker.reason == "cold-start" || prefixRewrite(record)

count(chunkedCompaction.event == "rollover")
  == count(cacheBreak(record)) − coldStartCount
```

`coldStartCount` is the count of records whose reason is `cold-start` and is at most one in the scripted session.

The numeric prefix comparison is load-bearing. `cacheTracker.reason === "prefix-mismatch"` means `matchedPrefix === 0`, not that every cached-prefix rewrite started at message zero. A later rollover normally preserves earlier immutable group summaries, reports `prefix-match`, and still satisfies `matchedPrefix < previousMessageCount`.

## Corrected production contract

`computeGroupOps()` emits all folded groups in the current plan, including older chunked-compaction groups. The extension must not author another rollover block for an older group repeated in a later plan.

The extension owns a per-session set of chunked-compaction group ids selected for rollover diagnostics. It:

1. Selects the first chunked-compaction group whose id is not in that set.
2. Builds and appends one `chunkedCompaction` diagnostic for that group.
3. Adds the id after the diagnostic is built.
4. Clears the set on session start and shutdown.

The engine preserves chunked-compaction groups across conductor passes even when their first member sits exactly at `frozenFromIndex`. This enforces `RB-004` immutability and prevents the next build turn from expanding the summary back into raw messages.

## Test seam

Test file: `vendor/accordion/extension/chunked-compaction-invariant.test.ts`.

The invariant harness uses:

- Real `MyCustomizeConductor`.
- Real `AccordionStore` and frozen-group bypass.
- Real `computeFoldOps()` and `computeGroupOps()`.
- Real `applyPlan()`.
- Real `cacheTracker.observeMessages()` and `cacheTracker.getDiagnostics()`.
- Real `buildUnreportedChunkedCompactionDiagnostic()` and `formatContextDiagnostic()`.
- An in-memory append sink instead of filesystem writes.

`vendor/accordion/extension/accordion.chunkedCompactionJsonl.test.ts` separately drives the real `accordionLive` hook, WebSocket plan path, filesystem writer, and repeated-old-group suppression.

Each rollover corpus is sent below threshold on one turn before a later turn crosses the threshold. This ensures the rollover rewrites messages that were visible to the provider rather than compacting unseen messages on cold start.

## Invariant result shape

```ts
interface InvariantResult {
    rollovers: number;
    coldStarts: number;
    prefixRewrites: number;
    cacheBreaks: number;
    ok: boolean;
}
```

`cacheBreaks = coldStarts + prefixRewrites` and `ok = rollovers === cacheBreaks - coldStarts`.

## Required edits

1. Add `vendor/accordion/extension/chunked-compaction-invariant.test.ts`.
2. Add typed selection and build helpers in `vendor/accordion/extension/chunked-compaction-diagnostic.ts` for the first unreported chunked-compaction group.
3. Update `vendor/accordion/extension/accordion.ts` to own and reset the per-session reported-group set.
4. Preserve immutable chunked-compaction groups in `AccordionStore.clearConductorState()`.
5. Extend `accordion.chunkedCompactionJsonl.test.ts` to run through the real writer and prove repeated groups do not produce repeated rollover fields.
6. Amend `RB-010`, `DEC-018`, ADR-0004, and this issue to use numeric prefix-rewrite accounting.
7. Do not change `cache-tracker.ts` reason semantics and do not fabricate diagnostics.

## Acceptance criteria

Working directory: `vendor/accordion/app`.

- [x] **AC-1. Single rollover.** A stable-provider session produces `rollovers === 1`, `prefixRewrites === 1`, `coldStarts === 1`, `cacheBreaks === 2`, and `ok === true`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "single rollover satisfies count(rollover) == cacheBreaks - coldStarts"`

- [x] **AC-2. Two rollovers.** Two well-separated rollover cycles produce `rollovers === 2`, `prefixRewrites === 2`, `coldStarts === 1`, `cacheBreaks === 3`, and `ok === true`.
  - The intervening build turn has no `chunkedCompaction` field.
  - The two rollover records have two distinct digest content hashes.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "two rollovers satisfy the invariant without repeating old-group diagnostics"`

- [x] **AC-3. Zero rollovers.** A below-threshold session produces `rollovers === 0`, `prefixRewrites === 0`, `coldStarts === 1`, `cacheBreaks === 1`, and `ok === true`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "zero rollovers satisfy the invariant"`

- [x] **AC-4. Discriminating check.** Removing the `chunkedCompaction` field from a real rollover record preserves the observed prefix rewrite and produces `rollovers === 0`, `prefixRewrites === 1`, `cacheBreaks === 2`, and `ok === false`.
  - Run: `pnpm vitest run chunked-compaction-invariant -t "invariant fails when a rollover JSONL block is missing (discriminating check)"`

- [x] **AC-5. No production diagnostic fabrication.** The implementation uses the existing `matchedPrefix` and `previousMessageCount` fields. It does not alter tracker reasons or inject synthetic `prefix-mismatch` records.

## Verification

Focused result:

```text
Invariant test files  1 passed (1)
Invariant tests       4 passed (4)
Writer test files     1 passed (1)
Writer tests          1 passed (1)
```

The original red two-rollover result reported rollover flags `[false, true, true, true]`, three rollover records, two prefix rewrites, and `ok === false`. The per-session reported-group set changed the flags to `[false, true, false, true]` and restored the invariant.

## Blocked by

- `01-walking-skeleton-deterministic-rollover.md`.
- `02-engine-group-frozen-clamp-bypass.md`.
