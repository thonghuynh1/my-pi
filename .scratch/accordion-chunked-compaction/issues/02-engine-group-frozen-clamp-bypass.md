---
status: ready-for-agent
labels: ready-for-agent
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #02 — Engine: bypass the group frozen-region clamp for chunked-compaction substitutions

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

Change the engine's frozen-region clamp on group substitutions so that a `GroupCommand` with a **non-null, non-empty** `digest` may substitute a run that begins before `frozenFromIndex`, **without** requiring `hasHardContextPressure()`. `FoldCommand`, `ReplaceCommand`, and `GroupCommand` with `digest: null | ""` (DROP) remain clamped exactly as today. No `breakFrozen` flag is introduced — the bypass rule **is** the flag.

Covers: **`DEC-012`**, **`RB-003`**.

This is an enabling change: it has no user-visible behavior on its own (no conductor emits such a group yet), but every downstream slice — starting with the walking skeleton `#01` — depends on it. Named consumer: `#01` (walking skeleton) emits a `GroupCommand` whose `ids` include blocks with `order < frozenFromIndex` and whose `digest` starts with `⟨chunked-compaction ·`; without this bypass the engine returns a `"frozen"` clamp report and the group is not applied.

## Implementation map

### Contract

The engine's frozen-region clamp for group substitutions is bypassed **when and only when** `kind === "group" && digest !== null && digest !== ""`. All other clamps on the same code path (`invalid-group`, `human-override`, and any downstream clamps in `createGroup`) are unchanged. The pre-existing `hasHardContextPressure()` DROP escape valve remains as-is for `group` with `digest: null | ""`.

### Decided implementation

Modify the frozen check inside `groupCmd` at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1174-1176`. **Anchor drift note**: PRD `DEC-012` cites `substOne` at `store.svelte.ts:1113-1116`, but that method's `kind` parameter is typed `"fold" | "replace"` only — group commands are dispatched via `case "group"` at `store.svelte.ts:1077-1079` to the separate `groupCmd(ids, by, reports, digest)` method at line 1166. The contract (frozen clamp bypass for group with non-null digest) is intact; the current anchor is `groupCmd`. Use the current anchor.

Left to the implementer: whether to extract a named helper `isChunkedCompactionSubst(cmd)` or inline the disjunct at the call site. Both preserve `RB-003`.

### Verified anchors

Existing dispatch (unchanged):
```ts
// store.svelte.ts:1077-1079
case "group":
    this.groupCmd(c.ids, by, reports, c.digest);
    break;
```

Existing `groupCmd` frozen clamp (**this is the target of the change**):
```ts
// store.svelte.ts:1166-1179 (VERIFIED anchor as of grounding pass)
private groupCmd(ids: string[], by: Actor, reports: ClampReport[], digest?: string | null): void {
    if (ids.length < 1) return void reports.push(clamp("group", ids, "invalid-group", "a group needs ≥1 block"));
    const range = this.snappedRange(ids[0], ids[ids.length - 1]);
    if (range) {
        const held = range.filter((id) => this.get(id)?.override != null);
        if (held.length)
            return void reports.push(clamp("group", ids, "human-override", `would collapse ${held.length} human-held block(s)`));
        const frozen = range.some((id) => (this.get(id)?.order ?? this.frozenFromIndex) < this.frozenFromIndex);
        if (frozen && !this.hasHardContextPressure())
            return void reports.push(clamp("group", ids, "frozen", "would rewrite the provider's cached prefix"));
    }
    const g = this.createGroup(ids[0], ids[ids.length - 1], by, digest);
    if (!g) reports.push(clamp("group", ids, "invalid-group", "not a valid contiguous, ungrouped run older than the protected tail"));
}
```

Existing `substOne` clamp for fold/replace (**unchanged by this issue**):
```ts
// store.svelte.ts:1113-1116
if (b.order < this.frozenFromIndex && (!breakFrozen || !this.hasHardContextPressure()))
    return void reports.push(
        clamp(kind, [id], "frozen", `block ${id} is in the provider's cached prefix (order ${b.order} < frozen ${this.frozenFromIndex})`),
    );
```

### Required edit — normative snippet

Amend the `frozen` clamp inside `groupCmd`:

```ts
// store.svelte.ts, inside groupCmd, replacing lines 1174-1176:
const frozen = range.some((id) => (this.get(id)?.order ?? this.frozenFromIndex) < this.frozenFromIndex);
if (frozen) {
    const isChunkedCompactionSubst = digest !== null && digest !== undefined && digest !== "";
    if (!isChunkedCompactionSubst && !this.hasHardContextPressure())
        return void reports.push(clamp("group", ids, "frozen", "would rewrite the provider's cached prefix"));
}
```

Rationale: preserves the DROP path (`digest: null | ""`) as clamped-unless-hard-pressure, and adds a single disjunct on the accept side for chunked compaction. No new flag on the wire, no protocol change (`RB-001`).

### Wiring

Single-file engine change. No new registrations. No dispatch path is added — `case "group"` already routes to `groupCmd`.

## Acceptance criteria

- [ ] **AC-1**: A `GroupCommand` whose `ids` include a block with `order < frozenFromIndex` and whose `digest` is a non-empty string is **applied** (not clamped) even when `hasHardContextPressure()` returns `false`.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run store.svelte`
  - Expected: a new test case named `"groupCmd bypasses frozen clamp when digest is non-empty"` passes; after `apply(cmd)`, the resulting `reports` array contains **no** `"frozen"` entry for the group and `store.groups` contains a new group covering the target ids.

- [ ] **AC-2**: A `GroupCommand` with `digest: null` on a frozen range is **still clamped** when `hasHardContextPressure()` returns `false`.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run store.svelte`
  - Expected: a new test case named `"groupCmd still clamps frozen when digest is null (DROP)"` passes; `reports` contains one entry with `kind === "group"` and `reason === "frozen"`; `store.groups.length` is unchanged.

- [ ] **AC-3**: A `GroupCommand` with `digest: ""` on a frozen range is **still clamped** when `hasHardContextPressure()` returns `false`.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run store.svelte`
  - Expected: a new test case named `"groupCmd still clamps frozen when digest is empty string (DROP)"` passes; identical shape to AC-2.

- [ ] **AC-4**: A `FoldCommand` on a frozen block is **still clamped** (regression: no accidental spillover from the group bypass).
  - Run: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run store.svelte`
  - Expected: a new test case named `"substOne still clamps fold on frozen block"` passes; `reports` contains one entry with `kind === "fold"` and `reason === "frozen"`.

- [ ] **AC-5**: A `ReplaceCommand` on a frozen block is **still clamped**.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run store.svelte`
  - Expected: a new test case named `"substOne still clamps replace on frozen block"` passes; `reports` contains one entry with `kind === "replace"` and `reason === "frozen"`.

- [ ] **AC-6**: No changes to the wire protocol.
  - Run: `cd F:/MyWork/my-pi/vendor/accordion && git diff --stat conductors/contract/`
  - Expected: `0 files changed` (empty output). `CONDUCTOR_PROTOCOL_VERSION` at `conductors/contract/protocol.ts:32` remains `= 3`.

## Blocked by

- None — can start immediately.
