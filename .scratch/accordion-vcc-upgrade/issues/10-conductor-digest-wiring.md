---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 4, ticket 07 (richer fold digests).

## What to build

Wire the `richDigest()` module into `MyCustomizeConductor`: pre-compute digest cache populated incrementally (50 blocks/pass), paired tool_call lookup for read/subagent, emit `ReplaceCommand { recoverable: true }` for blocks with cached digests at fold time instead of including them in `FoldCommand`.

Covers decisions: D20 (pre-computed cache), D27 (backwards scan for paired lookup), D30 (amortized cold-start + dirty advancement).

## Implementation map

### Key architecture insight: `healAndClearConductorState`

`store.svelte.ts:1102` clears `b.autoFolded` and `b.subst` for all blocks in the foldable range (between frozen prefix and protected tail) **every pass**. The conductor must re-emit fold/replace commands every pass. This means:
- No explicit "upgrade pass" needed
- Once a cache entry exists, the next dirty conduct() pass naturally uses `ReplaceCommand` instead of `FoldCommand`
- Marking `dirty = true` when cache advances forces recomputation on the next pass

### Modify: `conductors/my-customize-conductor/my-customize-conductor.ts`

**New class fields on `MyCustomizeConductor`:**
```ts
private digestCache = new Map<string, string | undefined>();
private lastPrecomputedIndex = 0;
private static readonly PRECOMPUTE_BATCH = 50;
```

**New method: `precomputeDigests(view)`**

Called at the top of `conduct(view)` BEFORE the dirty guard check (so it runs every pass):
```ts
private precomputeDigests(view: ConductorView): void {
  const batch = MyCustomizeConductor.PRECOMPUTE_BATCH;
  let computed = 0;
  const prevSize = this.digestCache.size;

  for (let i = this.lastPrecomputedIndex; i < view.blocks.length && computed < batch; i++) {
    const block = view.blocks[i];
    if (this.digestCache.has(block.id)) { this.lastPrecomputedIndex = i + 1; continue; }

    // Paired lookup for read/subagent
    let pairedArgs: Record<string, unknown> | undefined;
    if (block.toolName === "read" || block.toolName === "subagent") {
      pairedArgs = this.findPairedArgs(block.callId, view.blocks, i);
    }

    const digestBlock: ExtractableBlock = {
      kind: block.kind,
      toolName: block.toolName,
      isError: block.isError,
      text: block.text,
      tokens: block.tokens,
    };
    this.digestCache.set(block.id, richDigest(digestBlock, pairedArgs));
    this.lastPrecomputedIndex = i + 1;
    computed++;
  }

  // If cache grew, mark dirty so conduct() recomputes with new digests
  if (this.digestCache.size > prevSize) {
    this.dirty = true;
  }
}
```

**New method: `findPairedArgs(callId, blocks, resultIndex)`**

Backwards scan from `resultIndex` for a block with `id === callId` and `kind === "tool_call"`:
```ts
private findPairedArgs(callId: string | undefined, blocks: ViewBlock[], fromIndex: number): Record<string, unknown> | undefined {
  if (!callId) return undefined;
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (blocks[i].id === callId && blocks[i].kind === "tool_call") {
      // Parse args from block.text (JSON tool_call args)
      try { return JSON.parse(blocks[i].text ?? "{}"); } catch { return undefined; }
    }
  }
  return undefined;
}
```

**Modify fold emission paths:**

In `planFoldsToCap` and `planNormalPressure` (where `commands.push({ kind: "fold", ids: [block.id] })` is emitted):

```ts
// Before (existing):
commands.push({ kind: "fold", ids: [block.id] });

// After:
const cachedDigest = this.digestCache.get(block.id);
if (cachedDigest) {
  commands.push({ kind: "replace", id: block.id, content: cachedDigest, recoverable: true });
} else {
  commands.push({ kind: "fold", ids: [block.id] });
}
```

**Existing code locations to modify:**
- `planFoldsToCap` (line ~363): single-id FoldCommand emission loop
- `planNormalPressure` (line ~349): single-id FoldCommand emission
- Any other site that emits `{ kind: "fold", ids: [block.id] }` for individual blocks

**Do NOT modify:**
- Group formation paths (GroupCommand handles its own digest via buildSemanticDigest)
- MCP ReplaceCommand paths (planRollover, planHardCapEmergency, MCP-recovery) — these already have their own content generation
- Hard-cap emergency FoldCommands — these could optionally use cache but are not required

**Reset on detach:**
```ts
detach(): void {
  // existing cleanup...
  this.digestCache.clear();
  this.lastPrecomputedIndex = 0;
}
```

### ViewBlock.text availability

`precomputeDigests` needs `block.text` from `ViewBlock`. The conductor currently requests `wants: "full"` which provides text. Confirm this is already the case — no view mode change needed.

### Import

```ts
import { richDigest } from "../../app/src/lib/engine/block-digest";
// OR adjust path based on actual module resolution
```

### Test file: `app/src/lib/engine/conductor.my-customize-conductor.test.ts` (extend)

Add tests for:
- Pre-compute populates cache incrementally (batch of 50)
- Cached digest causes ReplaceCommand instead of FoldCommand
- Blocks without cache entry get FoldCommand (engine fallback)
- Cache advances mark dirty = true
- Paired lookup finds correct tool_call for read/subagent
- Detach clears cache

## Acceptance criteria

- [ ] Conductor emits `ReplaceCommand { recoverable: true }` with rich digest for a `read` tool_result when cache is populated
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: test verifies command kind is "replace" with content matching `📄 <path> (~Nk tok)` format
  - Fails when: conductor still emits FoldCommand for read blocks after cache is populated

- [ ] Pre-compute processes at most 50 blocks per conduct() call
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: with 200 blocks, first pass caches exactly 50, subsequent passes continue from high-water mark
  - Fails when: all blocks computed in one pass (no batch limit)

- [ ] Cache advancement marks conductor dirty, triggering recomputation
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: after cache grows, next conduct() recomputes plan (doesn't return stale lastPlan)
  - Fails when: dirty flag not set, conductor returns cached plan with old FoldCommands

- [ ] Paired tool_call lookup extracts path for read, task+type for subagent
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: ReplaceCommand content for a read block includes the file path from its paired tool_call
  - Fails when: pairedArgs is undefined or path missing from digest

- [ ] Blocks without cached digest still receive FoldCommand (engine fallback, not broken)
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: before cache catches up, fold commands emitted as today
  - Fails when: conductor errors or skips folding uncached blocks

- [ ] Detach clears cache and resets high-water mark
  - Run: `npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Expected: after detach + reattach, cache is empty and pre-compute restarts from 0
  - Fails when: stale cache persists across conductor lifecycle

## Blocked by

- `09-block-digest-module.md`
