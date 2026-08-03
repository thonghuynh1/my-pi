---
status: closed
---

# 02 — Simplify hardCap emergency brake to oldest-first sort

Status: ready-for-agent

## Parent

`.scratch/conductor-rollover-only-strategy/PRD.md`

## What to build

Simplify the hardCap emergency brake (the only remaining fold/group path outside rollover) to use oldest-first sorting instead of the reachability-based `sortCandidates` comparator. After issue #01 removes `sortCandidates` and the reachability graph from the main path, the hardCap path needs its own simple sort.

**Covers**: DEC-009, DEC-007 (hardCap-specific), RB-002, RB-006 (FOLDABLE_KINDS gate on hardCap path)

## Implementation map

### hardCap emergency brake — `my-customize-conductor.ts`

**File**: `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`

**Frozen prefix folds** (lines 483–486 — GROUND-006):
```ts
// Current (after #01 removes sortCandidates):
if (live > hardCap) {
    for (const b of sortCandidates(allCandidates.filter(
        (b) => b.order < view.frozenFromIndex && !alreadyPlanned.has(b.id)
    ))) {
```

Replace with:
```ts
if (live > hardCap) {
    const frozenCandidates = allCandidates
        .filter((b) => b.order < view.frozenFromIndex && !alreadyPlanned.has(b.id))
        .sort((a, b) => a.order - b.order);  // oldest-first
    for (const b of frozenCandidates) {
```

**Frozen prefix grouping** (lines 541–560 — GROUND-006):
- Already sorts by position implicitly (`groupRuns` walks in order). No sort change needed here, but verify it uses block order.

**Cleanup**: After this change, if `sortCandidates`, `buildGraph`, `markReachable`, and the garbage-collector import are no longer used anywhere in the file, remove them entirely.

**Producer from #01**: Issue #01 removes the normal fold loop and reachability graph from the main `conduct()` path. After #01, the hardCap brake is the only remaining consumer of `allCandidates` and `applyCandidate`. The `sortCandidates` function may already be removed by #01 or left as dead code — this issue cleans up the hardCap path either way.

### Test

**File**: `app/src/lib/engine/conductor.my-customize-conductor.test.ts`
**Command**: `cd extensions/accordion/app && npx vitest run`

**New test — hardCap emergency**:
Construct `ConductorView` where `liveTokens = 210_000`, `hardCap = 200_000` (context window), `cap = 70_000`. Place 5 blocks in the frozen prefix (order < frozenFromIndex) with varying token sizes. Call `conduct()`. Assert:
- Fold/group commands are emitted for frozen-prefix blocks
- Blocks are processed in ascending `order` (oldest-first), not by reachability or kind ranking
- `live` drops to `≤ hardCap`
- This proves RB-002 and DEC-009

### Blocking edge from #01

- **Producer**: `01-rollover-only-conduct.md` — removes `sortCandidates` and reachability graph from main path
- **Consumer**: This issue replaces the hardCap path's sort with `a.order - b.order`
- **Contract**: After #01, `sortCandidates` is either removed or unused on the main path. This issue ensures the hardCap path has its own sort and cleans up any remaining dead code.
- **Wiring owner**: This issue owns the cleanup of `sortCandidates`, `buildGraph`/`markReachable` imports if they become fully unused after both changes.

## Acceptance criteria

- [ ] **AC-02-1**: hardCap brake folds frozen-prefix blocks in oldest-first order
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"hardCap emergency oldest-first"` (planned)
  - Expected: When `liveTokens > hardCap`, the returned plan contains fold/group commands for frozen-prefix blocks processed in ascending `order`. The first folded block has the lowest `order` value among candidates.
  - Fails when: blocks are sorted by reachability (`markReachable`) or kind (`FOLD_RANK`) instead of `order`

- [ ] **AC-02-3**: FOLDABLE_KINDS gate preserved on hardCap path (RB-006)
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Test: `conductor.my-customize-conductor.test.ts` → `"hardCap respects FOLDABLE_KINDS"` (planned)
  - Expected: When `liveTokens > hardCap`, the hardCap brake filters candidates through `FOLDABLE_KINDS`. Blocks with `kind === "tool_call"` or `kind === "user"` are never included in fold commands.
  - Fails when: a `tool_call` or `user` block appears in the fold command IDs

- [ ] **AC-02-4**: Dead reachability code removed
  - Run: `grep -n "buildGraph\|markReachable\|sortCandidates" extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Expected: Zero matches (no references to `buildGraph`, `markReachable`, or `sortCandidates` in the file)
  - Fails when: dead code from the old reachability-based sort remains

- [ ] **AC-02-5**: Blocking edge — hardCap path works after #01's removals
  - Run: `cd extensions/accordion/app && npx vitest run`
  - Expected: All tests pass including the new hardCap emergency test and all tests from #01
  - Fails when: hardCap path references a function removed by #01 (e.g., `sortCandidates`)

## Blocked by

- `01-rollover-only-conduct.md`
