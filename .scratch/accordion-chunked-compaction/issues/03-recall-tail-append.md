---
status: closed
labels: ready-for-agent
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #03 — Recall tail-append: unfolding a chunked-compaction group-member preserves the frozen prefix

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

Add a policy branch to the engine's fold-code resolver so that unfolding a chunked-compaction **group-member** fold code (either via agent `recall(<code>)` or human GUI unfold) **appends** the original member content into the Protected Tail as a synthesised `recall(<code>)` `tool_call` / `tool_result` pair, rather than restoring the member in place. The group summary block and the frozen prefix are **not** mutated; the KV cache is preserved. Repeated recalls of the same code produce repeated tail entries (no deduplication).

Covers:

- **User story**: `US-003` (developer recalls a specific group-member block without invalidating the frozen prefix).
- **Required behavior**: `RB-009`.
- **Decision**: `DEC-009`.
- **Area**: 5 (engine — fold-code resolver policy branch).
- **Test seam**: 5.

## Implementation map

### Contract — resolver policy branch

`resolveUnfold(store, codes)` at `F:/MyWork/my-pi/extensions/accordion/app/src/lib/live/plan.ts:105` gains a policy branch **inside the per-block match loop** (currently in the block-path body around `plan.ts:129–145`). Detection is: "the matched block is a member of a chunked-compaction `GroupCommand`" — implementer's choice among (a) a store-side lookup on the group registry checking whether the containing group's digest starts with `⟨chunked-compaction ·`, (b) a marker on the group (e.g. `group.kind === "chunked-compaction"` derived at group-creation time from the digest prefix), or (c) a `groupMemberOf` field on `ViewBlock`. Any deterministic, cheap approach is acceptable.

Behavior:

- **Group-member match** (new branch): call `store.appendToTail(b.id)` (new method — see next contract), which materialises a synthetic `recall(<code>)` `tool_call` / `tool_result` pair carrying the original member content and appends it to the Protected Tail. **Do not** call `store.unfold(b.id, "agent")` on that branch. The group summary block and every downstream block are left untouched; `frozenFromIndex` does not change.
- **Non-group-member match** (existing behavior — unchanged): fall through to the existing `store.unfold(b.id, "agent")` path at `plan.ts:~144`.
- **Whole-group unfold path** (existing behavior at `plan.ts:111-125` — unchanged for chunked-compaction): chunked-compaction groups **do not use** the whole-group unfold; the digest itself is fixed and the group is never unfolded as a whole. If a caller tries to unfold the group's own fold code (`foldCode(group.id)`), the existing path runs but is a no-op for chunked compaction because the group is under an agent-unfold lock and the group's `folded` state is not toggled. This is acceptable — the code enters `missing[]` and returns cleanly.

Repeated recalls of the same code append **repeated** tail entries. No dedup.

### Contract — `store.appendToTail(id)`

Add a new method on `AccordionStore` (name is left to the implementer — `appendToTail`, `synthesiseRecallForMember`, or similar):

```ts
/**
 * Materialise a synthetic recall(<code>) tool_call/tool_result pair for the given
 * group-member block and append it to the Protected Tail. The source group summary
 * and the frozen prefix are NOT mutated. Tail-appended blocks count against
 * liveTokens normally. Idempotency: NONE — each call appends a fresh pair.
 */
appendToTail(id: string): void
```

The synthesised pair carries the original member's content (retrievable from the store's own per-block payload state — the engine already retains it for group members via the `groupWire`/group registry, since chunked-compaction groups keep their members' original text available for the header/body composition upstream). The pair is a normal `tool_call` + `tool_result` in the store's block list, appended after the current tail-end index, with a synthetic `callId` derived deterministically from `(id, tail-append-count-for-this-id)` so repeat recalls produce distinct pairs.

Left to the implementer:

- Whether tail-appended synthetic `recall` results carry a `proactivelyCompressed` marker to prevent immediate re-grouping in the next `conduct()` cycle. Both choices are correct and reversible per PRD `## Unresolved Gaps`. Recommendation: **do** carry the marker (it aligns with ADR-0003's A1 exemption list — `recall` results are already exempt from proactive compression on that list), which also matches the groupability predicate in `#01` (`DEC-003`) that excludes `proactivelyCompressed` blocks from the pre-group by construction. This makes the tail-append naturally free from re-grouping churn.
- The synthetic `callId` scheme (e.g. `recall:${id}:${count}`).
- Whether the mechanism dispatches through the existing engine `appendBlocks` path or through a dedicated synthetic-block insertion path.

### Verified anchors

- `resolveUnfold(store, codes)` entry point: `F:/MyWork/my-pi/extensions/accordion/app/src/lib/live/plan.ts:105` (verified).
- Whole-group unfold path (unchanged): `plan.ts:~111–125` (`for (const g of store.groups)` loop with `foldCode(g.id) === code` and `store.unfoldGroup(g.id, "agent")`).
- Per-block match loop (**insertion point for the new branch**): `plan.ts:129–145` (`const matches = store.blocks.filter(...)` at line 129 and the subsequent `for (const b of matches)` at line 130; policy branch fires **inside** that loop, **before** the existing `store.unfold(b.id, "agent")` call at line 139).
- Existing in-place restore path (unchanged for non-group-member fold codes): `F:/MyWork/my-pi/extensions/accordion/app/src/lib/engine/store.svelte.ts:1439-1456` (`store.unfold(id, by)`); the call from `resolveUnfold` is at `plan.ts:139`.
- Group registry / `store.groups` (source of truth for group membership + digest): `store.svelte.ts` — the `groups` accessor and `groupById` / `groupOf` helpers are already exercised by `resolveUnfold`; reuse the same accessors.
- Chunked-compaction digest prefix (**pattern to match on for detection**): the literal `⟨chunked-compaction ·` (produced by `#01`'s `digestHeader`).

### Existing behavior

`resolveUnfold` today restores blocks in place via `store.unfold(b.id, "agent")` after group-fold gating (`plan.ts:~127`). Both mutators (`unfold` and `unfoldGroup`) are no-ops under the `agent-unfold` lock; the resolver verifies each unfold "took" and falls through to `missing[]` when a verified-false restore occurs.

### Blocking-edge input — from `#01` (walking skeleton)

- **Producer output**: `#01` emits `GroupCommand`s whose `digest` starts with `⟨chunked-compaction ·` and whose `Members: {#code} …` footer lists deterministic fold codes derived from member ids via the engine's existing `foldCode(id)` helper.
- **Consumer input**: this issue's resolver branch matches on "block is a member of a group whose digest starts with the chunked-compaction prefix" (or on the chosen equivalent marker).
- **Crossing contract**: the group registry (`store.groups` array of `{ id, memberIds, digest, folded, ... }`) — no wire-protocol change, no new engine field beyond `appendToTail`.
- **Wiring owner (consumer)**: this issue adds `store.appendToTail(id)` and the resolver branch. The resolver's callers (`plan.ts`'s downstream consumers for agent `recall` and human GUI unfold) are unchanged; both invoke `resolveUnfold` and receive the same `{ restored, missing }` shape.
- **Proof of connection**: **AC-1** below runs the full `#01` walking-skeleton rollover, then calls `resolveUnfold(store, [code])` for a member code, and asserts the tail-append shape.

### Required edits

1. **Modify** `F:/MyWork/my-pi/extensions/accordion/app/src/lib/engine/store.svelte.ts`:
   - Add `appendToTail(id: string): void` (or equivalent name).
   - The method retrieves the original member content from the group registry, constructs a synthetic `tool_call` + `tool_result` pair with a fresh synthetic `callId` (per the scheme above), and appends both blocks to the store's block list at the tail-end. Optionally marks them `proactivelyCompressed = true` per the recommendation above.
2. **Modify** `F:/MyWork/my-pi/extensions/accordion/app/src/lib/live/plan.ts`:
   - Inside the per-block match loop in `resolveUnfold` (line 130 `for (const b of matches)`), add a branch: if the matched block is a member of a chunked-compaction group (detection per the chosen mechanism), call `store.appendToTail(b.id)`, push a `restored` entry `{ code, kind: b.kind, label: `recall(${code}) → tail`, ids: [b.id] }`, set `hit = true`, and `continue` (skip the existing `store.unfold` path at line 139). Otherwise fall through to existing behavior.

### Normative snippet

```ts
// inside resolveUnfold, per-block match loop (plan.ts:130)
for (const b of matches) {
    if (isChunkedCompactionGroupMember(store, b)) {
        store.appendToTail(b.id);
        restored.push({ code, kind: b.kind, label: `recall(${foldCode(b.id)}) → tail`, ids: [b.id] });
        hit = true;
        continue;
    }
    // ... existing store.unfold path unchanged ...
}
```

## Acceptance criteria

Test file: extend `F:/MyWork/my-pi/extensions/accordion/app/src/lib/live/plan.test.ts` (or the closest existing test suite for `plan.ts` — the implementer verifies against the current vendor test layout). Working directory: `F:/MyWork/my-pi/extensions/accordion/app`.

- [ ] **AC-1** (tail-append on group-member unfold — `RB-009` primary, proves the `#01` blocking edge): after `#01`'s walking-skeleton rollover, calling `resolveUnfold(store, [<memberCode>])` for one member's fold code appends a synthetic `recall(<code>)` `tool_call` / `tool_result` pair to the tail; the group summary block is unchanged; `frozenFromIndex` is unchanged.
  - Run: `pnpm vitest run plan -t "resolveUnfold appends tail entry for chunked-compaction group member"`
  - Expected: after the call, `store.blocks.length` has grown by exactly 2 (one `tool_call`, one `tool_result`); the two new blocks live **after** the original tail-end (i.e. their `order` values exceed the pre-call max `order`); the group's `digest` string is byte-identical before and after; `store.frozenFromIndex` is byte-identical before and after; `restored[0].kind === b.kind` and `restored[0].label` matches `/recall\(\{?#?[a-z0-9]+\}?\) → tail/`; `missing` is empty.

- [ ] **AC-2** (in-place restore still works for normal fold codes — regression): calling `resolveUnfold(store, [<normalFoldCode>])` for a non-group-member folded block behaves exactly as today.
  - Run: `pnpm vitest run plan -t "resolveUnfold still restores non-group-member fold codes in place"`
  - Expected: `store.blocks.length` is unchanged; the target block's `folded` state transitions to `false`; `restored[0].ids === [b.id]`; no tail-append occurs.

- [ ] **AC-3** (repeated recalls produce repeated tail entries, no dedup — `RB-009`): calling `resolveUnfold(store, [<memberCode>])` twice on the same member code produces two distinct tail-appended pairs.
  - Run: `pnpm vitest run plan -t "repeated recall of a group-member code appends repeated tail entries"`
  - Expected: after two calls, `store.blocks.length` has grown by exactly 4 (two `tool_call`, two `tool_result`); the four new blocks have distinct `callId`s and distinct `order` values; the group summary and frozen prefix remain byte-identical.

- [ ] **AC-4** (human GUI unfold uses the same tail-append shape — `US-003` completeness): the human-GUI unfold path (also routed through `resolveUnfold`) exhibits identical tail-append behavior for group-member codes.
  - Run: `pnpm vitest run plan -t "human GUI unfold of a chunked-compaction group member appends to tail (same as agent recall)"`
  - Expected: the same assertions as AC-1 hold when the caller-context is the human GUI (constructed identically — `resolveUnfold` does not branch on caller today, so this AC verifies the branch remains caller-agnostic).

- [ ] **AC-5** (tail-appended blocks count against liveTokens normally): after AC-1, `store.liveTokens` has grown by approximately the sum of the two new blocks' `tokens` (within the engine's normal accounting tolerance).
  - Run: `pnpm vitest run plan -t "tail-appended recall blocks count against liveTokens"`
  - Expected: `store.liveTokens_after - store.liveTokens_before` ≈ `newBlocks[0].tokens + newBlocks[1].tokens` (equal to the sum, given the engine's deterministic token counter).

- [ ] **AC-6** (no re-grouping churn on the next `conduct()` — walking-skeleton-preserving): after AC-1, running `MyCustomizeConductor.conduct(view)` on the resulting view emits **zero** new chunked-compaction `GroupCommand`s whose `ids` overlap with the tail-appended blocks.
  - Run: `pnpm vitest run conductor.compaction-naive -t "tail-appended recall blocks are not immediately re-grouped"`
  - Expected: `plan.filter(c => c.kind === "group" && (c.digest ?? "").startsWith("⟨chunked-compaction ·") && c.ids.some(id => tailAppendedIds.includes(id))).length === 0`. (If the implementer chose to mark tail-appended blocks `proactivelyCompressed = true` per the recommendation above, this AC follows from `DEC-003`'s groupability predicate. If not, the implementer must arrange the same result by another means.)

## Blocked by

- `01-walking-skeleton-deterministic-rollover.md` — required for AC-1 (needs a chunked-compaction group in `store.groups` to unfold a member of).
