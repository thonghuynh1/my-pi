---
status: closed
labels: ready-for-agent
prd: ../PRD.md
adr: ../../../docs/adr/0004-accordion-chunked-compaction.md
---

# #01 — Walking skeleton: end-to-end deterministic chunked-compaction rollover on a 200 k session

## Parent

Parent PRD: [`.scratch/accordion-chunked-compaction/PRD.md`](../PRD.md).
Parent ADR: [`docs/adr/0004-accordion-chunked-compaction.md`](../../../docs/adr/0004-accordion-chunked-compaction.md).

## What to build

Implement the **walking skeleton** (`US-001`): on a 200 k-context session, once the pre-group crosses ~15 000 tokens on a safe boundary, `MyCustomizeConductor` emits **exactly one** `GroupCommand` whose `digest` is a deterministic pure function of the pre-group corpus, the engine applies it across the frozen boundary (per `#02`), the emission does **not** repeat on the immediately next `conduct()` pass, and re-running the same pass on identical input yields a **byte-identical** `digest` string. The extension's per-turn JSONL gains one `chunkedCompaction` block on the rollover turn.

This slice owns the end-to-end user-visible flow via real wiring — real `MyCustomizeConductor`, real engine store, real extension JSONL writer, no stubs of substances under test.

Covers:

- **User stories**: `US-001` (walking skeleton, PRIMARY), `US-002` (dashboard header pattern), `US-005` (small-context inert).
- **Required behaviors**: `RB-001`, `RB-002`, `RB-004`, `RB-005`, `RB-006`, `RB-008`.
- **Decisions**: `DEC-001` (four-zone rendering), `DEC-002` (pre-group sizing), `DEC-003` (groupability predicate), `DEC-004` (128 k gate), `DEC-005` (two-tier trigger + sync emission), `DEC-006` (min-savings gate), `DEC-007` (no failure path — enforced by absence), `DEC-008` (digest three-section shape), `DEC-010` (stable identity via determinism), `DEC-011` (pre-emit tool-pair trim), `DEC-013` (conductor mode-oblivious), `DEC-014` (strict per-session isolation), `DEC-015` (no persistence — enforced by absence), `DEC-016` **Site 2** (extension JSONL block), `DEC-017` (provider-agnostic v1), `DEC-019` (no LLM), `DEC-020` (immutability & DROP exclusion).
- **Areas**: 1 (pre-group derivation + rollover trigger), 2 (digest emission + tool-pair trim), 6 (extension JSONL block).
- **Test seams**: 1 (conductor emission unit tests), 2 (tool-pair invariant property + regression), plus a new extension-side test for the JSONL block.

Blocking-edge consumers (downstream slices depend on this one):

- `#03` (recall tail-append) consumes the `Members: {#code} …` footer format and the chunked-compaction `GroupCommand` marker.
- `#04` (`conductor/status` telemetry) consumes the `rolloverCount`, `tokensSavedByRollover`, `breakFrozenCount` instance-field counters and the emission trigger.
- `#05` (verification invariant) consumes the `chunkedCompaction.event === "rollover"` JSONL block.

## Implementation map

### Contract — new pure functions and helpers

All helpers are **pure functions** (no I/O, no clock, no PRNG) so replay is byte-identical (`RB-005`, `DEC-010`).

```ts
// Constants (new file)
// F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/constants.ts
export const DEFAULT_PRE_GROUP_TOKENS = 15_000;
export const PRE_GROUP_OVERFLOW_CAP = 1.25;              // hard ceiling = 15_000 * 1.25 = 18_750
export const MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000;
export const CHUNKED_COMPACTION_PREFIX = "⟨chunked-compaction ·";
```

```ts
// New pure helpers (module placement: alongside my-customize-conductor.ts;
// exact file organisation left to the implementer)

// Returns 0 when the small-context gate fails, else opts.preGroupTokens ?? DEFAULT_PRE_GROUP_TOKENS.
// Encodes DEC-004.
effectivePreGroupTokens(view: ConductorView, opts: MyCustomizeConductorOpts): number

// Walk-back that mirrors extension/store.svelte.ts:824-847 (protected-tail algorithm shape).
// Starts at view.blocks[protectedFromIndex - 1], always includes it, walks backwards summing
// ViewBlock.tokens, stops when sum >= target OR next block would push sum > target * 1.25
// OR next block fails the groupability predicate. Returns the smallest index j such that
// [j .. protectedFromIndex - 1] is the pre-group slice.
// Encodes DEC-002.
computePreGroupFromIndex(view: ConductorView, target: number, isGroupBoundaryFn: (b: ViewBlock) => boolean): number

// Groupability predicate: !grouped && !held && !proactivelyCompressed. Consumed by walk-back
// and by noOpenToolPairAcrossPreGroupTail. Encodes DEC-003.
// (Also excludes user turns, MCP results, pstack recall results, and generic recall results:
// these are already captured by the existing isGroupBoundary(block, pstackByBlockId) module-level
// helper in my-customize-conductor.ts:~67 — REUSE that helper.)
isGroupBoundary(block: ViewBlock, pstackByBlockId: Map<string, PstackIdentity>): boolean

// True iff no callId has one half in [preGroupFromIndex .. protectedFromIndex - 1] and the
// other half in [protectedFromIndex .. tailEnd]. Consulted by the fast-path trigger.
// Encodes DEC-005 predicate half of DEC-011.
noOpenToolPairAcrossPreGroupTail(view: ConductorView, preGroupFromIndex: number): boolean

// Trim rule for the escape valve and pre-emit sanitation: for every callId with one half
// inside `ids` and its partner outside, remove the inside half. If |ids| < 2 after trim,
// return []. Encodes trim half of DEC-011.
trimOpenToolPairs(ids: string[], allBlocks: readonly ViewBlock[]): string[]

// Deterministic digest composition. Encodes DEC-008 shape and DEC-019 (no LLM).
digestHeader(corpusHash: string, N: number, turnRange: [number, number]): string
digestBody(blocks: readonly ViewBlock[]): string
digestMembersFooter(memberFoldCodes: readonly string[]): string
composeDigest(header: string, body: string, footer: string): string  // sections joined by "\n\n"

// Corpus content hash: SHA-256 over a canonically-normalised concatenation of member block
// payloads. Reuse the-conductor-v2's contentHash(block) shape at strategy.ts:~L1475-1483 as
// a reference; adapt for a corpus-level hash. Encodes DEC-010.
corpusContentHash(blocks: readonly ViewBlock[]): string

// Fold code derivation for group members: a deterministic function of ViewBlock.id (not random,
// not turn-scoped). Reuse the engine's existing foldCode(id) helper from
// F:/MyWork/my-pi/extensions/accordion/app/src/lib/engine/... (already used by resolveUnfold at
// plan.ts:127). Encodes DEC-009 footer contract; the resolver policy branch that consumes
// these codes ships in #03.
```

### Contract — `MyCustomizeConductor` trigger branch

Inside `conduct(view: ConductorView): Command[]`, **before** the existing epoch-gated frozen-grouping pressure valve (currently at `my-customize-conductor.ts:~226-236`), add the chunked-compaction trigger:

```ts
// Pseudocode — encodes DEC-005 fast path + escape valve.
const preGroupTarget = effectivePreGroupTokens(view, this.opts);
if (preGroupTarget > 0) {
    const preGroupFromIndex = computePreGroupFromIndex(view, preGroupTarget, (b) => isGroupBoundary(b, pstackByBlockId));
    const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex);
    const preGroupTokens = preGroupBlocks.reduce((s, b) => s + b.tokens, 0);
    const preGroupEndsOnTurnBoundary =
        view.blocks[view.protectedFromIndex]?.kind === "user" || view.protectedFromIndex === view.blocks.length;
    const noOpen = noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex);

    const fastPathFires = preGroupTokens >= preGroupTarget && preGroupEndsOnTurnBoundary && noOpen;
    const escapeValveFires = preGroupTokens > preGroupTarget * PRE_GROUP_OVERFLOW_CAP;

    if (fastPathFires || escapeValveFires) {
        // Escape valve force-aligns backwards to the nearest safe boundary; fast path uses
        // preGroupFromIndex as-is. Both share the trim rule.
        const rawIds = preGroupBlocks.map((b) => b.id);
        const ids = trimOpenToolPairs(rawIds, view.blocks);   // DEC-011 — BEFORE cost estimation

        if (ids.length >= 2) {
            // Cost check AFTER trim (DEC-011 cost-honesty).
            const digestCost = estimateDefaultGroupDigestCost(view.blocks.filter((b) => ids.includes(b.id)));
            const trimmedTokens = view.blocks
                .filter((b) => ids.includes(b.id))
                .reduce((s, b) => s + b.tokens, 0);
            const estimatedGroupSaving = trimmedTokens - digestCost;
            const cap = availableCap(view);                    // existing helper
            const minSaving = Math.max(2_000, 0.05 * cap);     // DEC-006

            if (estimatedGroupSaving >= minSaving) {
                const digest = composeDigest(
                    digestHeader(
                        corpusContentHash(view.blocks.filter((b) => ids.includes(b.id))),
                        ids.length,
                        [firstTurnOf(view, ids[0]), lastTurnOf(view, ids[ids.length - 1])],
                    ),
                    digestBody(view.blocks.filter((b) => ids.includes(b.id))),
                    digestMembersFooter(ids.map(foldCode)),
                );
                // Bookkeeping (counters consumed by #04):
                this.rolloverCount += 1;
                this.tokensSavedByRollover += estimatedGroupSaving;
                this.lastEstimatedGroupSaving = estimatedGroupSaving;
                this.breakFrozenCount += 1;
                return [{ kind: "group", ids, digest } satisfies GroupCommand];  // synchronous, single emission
            }
        }
    }
}
// Fall through to the existing frozen-grouping pressure valve at my-customize-conductor.ts:~226-236.
```

Key invariants baked in:

- **Single synchronous emission** (`DEC-005`): one `conduct()` pass, one `GroupCommand`, no `host.complete()`, no `host.requestRerun()`, no `pendingRolloverHash`, no async broker.
- **Trim before cost, cost before digest** (`DEC-011`): the trim runs first so `estimateDefaultGroupDigestCost` is quoted on the post-trim set.
- **DROP is never used** (`DEC-020`): `digest` is always a non-empty string.
- **No failure path** (`DEC-007`): no try/catch, no `AbortController`, no timeout, no `lastSummaryError`. If the trigger predicate fails or the saving gate fails, fall through silently — the pre-existing pressure valve remains as the unshared hard-pressure fallback.
- **No persistence** (`DEC-015`): no file I/O; no writes under `~/.accordion/sessions/`.
- **Mode-oblivious** (`DEC-013`): no `broker-meta` consultation, no branch on session type.
- **Immutable groups** (`DEC-004`, `RB-004`): once emitted, the digest is fixed for the life of the group. No re-emission or re-summarisation. On subsequent `conduct()` passes, the group appears with `grouped: true` on its member blocks and the walk-back terminates at it via the groupability predicate.
- **Small-context inert** (`DEC-004`, `RB-008`): when `view.contextWindow < 128_000 || view.contextWindow === null`, `effectivePreGroupTokens` returns `0` and the whole branch short-circuits.

### Contract — digest header and footer format

The exact digest string (`DEC-008` normative snippet):

```text
⟨chunked-compaction · <N> blocks · turns <X>–<Y> · content-hash <hash>⟩

<deterministic body>

Members: {#<code1>} {#<code2>} …
```

- Header MUST start with the literal `⟨chunked-compaction ·` (U+27E8, U+00B7). Dashboards pattern-match on this prefix to recognise chunked-compaction groups (`US-002`); this is a `MyCustomizeConductor`-private convention, not a wire field.
- Body composition is **left to the implementer** as long as the composition is a deterministic pure function of the member `ViewBlock` payloads. Load-bearing property: byte-identical output on byte-identical input (`RB-005`). The reference reuse candidate is per-block `host.digestOf(id)` outputs concatenated with a stable delimiter, or a structural aggregation, or both. **DO NOT** call `host.complete()` (`DEC-019`) or any other async broker.
- Footer MUST match `Members: (\{#[a-z0-9]+\} ?)+` where each code is derived deterministically from the member `ViewBlock.id` via the engine's existing `foldCode(id)` helper.

### Contract — extension JSONL `chunkedCompaction` block (Site 2)

At `F:/MyWork/my-pi/extensions/accordion/extension/accordion.ts:~1227` (the `applyPlan(originalMessages, plan.ops, plan.groups)` call site), the `writeContextDiagnostic({...})` payload gains one optional field, populated **only** when `plan.groups` contains at least one `GroupCommand` whose `digest` starts with the literal `⟨chunked-compaction ·` prefix:

```jsonc
{
    // ... existing fields (event, timestamp, sessionId, reqId, pid, cwd, model, full,
    //     blocksTotal, freshBlocks, originalMessageCount, appliedMessageCount,
    //     foldOpsRequested, groupOpsRequested, changed, originalTokensApprox,
    //     appliedTokensApprox, foldMarkersInAppliedPayload, foldMarkersInOriginalPayload,
    //     frozenFromIndex, cacheTracker, payloadAudit) ...
    "chunkedCompaction": {
        "event": "rollover",
        "preGroupTokensBefore": 15850,      // integer: sum of member tokens before rollover
        "preGroupBlockCount": 47,           // integer: |group.ids|
        "preGroupTurnRange": [17, 31],      // [number, number]: [firstTurn, lastTurn]
        "digestTokens": 512,                // integer: countTokens(group.digest)
        "estimatedGroupSaving": 15338,      // integer: preGroupTokensBefore - digestTokens
        "frozenFromIndexBefore": 22,        // integer: cacheTracker.getFrozenFromIndex() BEFORE apply
        "frozenFromIndexAfter": 68,         // integer: cacheTracker.getFrozenFromIndex() AFTER apply
        "cacheTrackerReasonBefore": "prefix-match",   // string from CacheTrackerReason union
        "cacheTrackerReasonAfter":  "prefix-match",    // may remain match when an earlier prefix survives
        "digestContentHash": "sha256:..."    // string: parsed out of the digest header
    }
}
```

Field types: all integers except `event` (string, always `"rollover"` in v1), `preGroupTurnRange` (`[number, number]`), `cacheTrackerReasonBefore/After` (strings drawn from `CacheTrackerReason` union at `F:/MyWork/my-pi/extensions/accordion/extension/cache-tracker.ts:17-23`), `digestContentHash` (string with `sha256:` or equivalent prefix, as parsed from the digest header).

Absent on non-rollover turns (`RB-006`).

The extension is JSONL-author and pattern-matches the digest prefix; the conductor stays JSONL-oblivious.

### Verified anchors

- `MyCustomizeConductor` class declaration: `F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:74` (field initialisers only; no explicit constructor today — the implementer adds one to accept `preGroupTokens?: number`).
- `conduct(view)` signature: same file, ~line 82.
- Existing `isGroupBoundary(block, pstackByBlockId)` free function: same file, ~line 67 (**REUSE**, do not duplicate).
- Existing frozen-grouping pressure valve (**unchanged** — remains as hard-pressure fallback): same file, ~lines 217–237.
- Existing `Math.max(2_000, 0.05 * cap)` gate expression: same file, **line 279** (PRD's stated line 233 is drifted; current anchor is 279). May stay inline or move to constants — cosmetic per `DEC-006`.
- Existing `estimateDefaultGroupDigestCost` helper: same file, ~line 49 (**REUSE**; call **after** trim per `DEC-011` cost-honesty).
- Protected-tail walk-back reference algorithm to mirror: `F:/MyWork/my-pi/extensions/accordion/extension/store.svelte.ts:824-847`.
- `GroupCommand` type: `F:/MyWork/my-pi/extensions/accordion/conductors/contract/conductor.ts:254-259`. `digest?: string | null` — `undefined` = host default, `null | ""` = DROP, non-empty = verbatim.
- Engine dispatch to `groupCmd`: `F:/MyWork/my-pi/extensions/accordion/app/src/lib/engine/store.svelte.ts:1077-1079`.
- Extension `writeContextDiagnostic` writer: `F:/MyWork/my-pi/extensions/accordion/extension/accordion.ts:~433` (private nested function inside the extension's outer scope).
- Extension `applyPlan` call site with `cacheTracker.getDiagnostics()` in scope: `F:/MyWork/my-pi/extensions/accordion/extension/accordion.ts:~1227`. **Anchor drift note**: PRD cites `~1215`; current line is `~1227`. There is also a parallel passthrough branch (~lines 1207-1225) that also calls `writeContextDiagnostic`, but it fires only when `plan.groups.length === 0` — no rollover can occur on that branch, so no JSONL block is required there.
- `CacheTrackerDiagnostics` shape: `F:/MyWork/my-pi/extensions/accordion/extension/cache-tracker.ts:17-23`.
- `cacheTracker.getDiagnostics()` accessor: same file, ~line 67.
- `CONDUCTOR_PROTOCOL_VERSION = 3` (must stay `3`): `F:/MyWork/my-pi/extensions/accordion/conductors/contract/protocol.ts:32`.

### Blocking-edge input — from `#02` (engine group frozen-clamp bypass)

- **Producer output**: `groupCmd` at `store.svelte.ts:1166` accepts a `GroupCommand` whose `ids` include blocks with `order < frozenFromIndex` when `digest !== null && digest !== ""`, without requiring `hasHardContextPressure()`.
- **Consumer input**: this issue's `conduct()` emits exactly that shape (`ids` include frozen blocks, `digest` starts with `⟨chunked-compaction ·`).
- **Crossing contract**: `GroupCommand` from `conductors/contract/conductor.ts:254-259` — unchanged fields; the semantic contract (frozen bypass condition) is enforced by `#02`.
- **Wiring owner (consumer)**: this issue's `conduct()` return value flows through the engine's `case "group"` dispatch at `store.svelte.ts:1077-1079` (unchanged) to `groupCmd`.
- **Proof of connection**: **AC-2** below runs the full applyPlan path against a real engine store and asserts `store.groups.length === 1` after the rollover pass — this fails if `#02` is stubbed or if the engine's clamp is still active on group-with-non-null-digest.

### Existing behavior

- `MyCustomizeConductor.conduct()` today groups the non-frozen suffix on `block.order >= view.frozenFromIndex`, breaks at user / held / protected / grouped / MCP / recall boundaries via the module-level `isGroupBoundary` helper, and gates emission on `estimatedGroupSaving ≥ Math.max(2_000, 0.05 * cap)` (line 279). The frozen-grouping pressure valve at lines 217–237 fires only when `view.liveTokens > hardCap`. There is no chunked-compaction trigger, no pre-group derivation, and no explicit constructor. The class is stateful for epoch gating (`lastPlan`, `lastFrozenGroupEpochKey`, `lastSemanticKey`, `lastViewKey`).
- Extension `writeContextDiagnostic` today writes existing fields per apply-plan turn; `cacheTracker.getDiagnostics()` is already in scope at the target call site.

### Required edits

1. **New file** `F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/constants.ts` exporting `DEFAULT_PRE_GROUP_TOKENS`, `PRE_GROUP_OVERFLOW_CAP`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION`.
2. **New file** or additional exports alongside `my-customize-conductor.ts` for the pure helpers: `effectivePreGroupTokens`, `computePreGroupFromIndex`, `noOpenToolPairAcrossPreGroupTail`, `trimOpenToolPairs`, `digestHeader`, `digestBody`, `digestMembersFooter`, `composeDigest`, `corpusContentHash`. Placement (single file vs. split) is left to the implementer.
3. **Modify** `MyCustomizeConductor`:
   - Add a constructor accepting `opts?: { preGroupTokens?: number }` and store as `private readonly opts: Required<MyCustomizeConductorOpts>` (with `DEFAULT_PRE_GROUP_TOKENS` fallback).
   - Add instance fields: `private rolloverCount = 0`, `private tokensSavedByRollover = 0`, `private lastEstimatedGroupSaving = 0`, `private breakFrozenCount = 0`. These are consumed by `#04`.
   - Add the trigger branch at the top of `conduct()`, before the pre-existing epoch-gated frozen-grouping path.
4. **Modify** `F:/MyWork/my-pi/extensions/accordion/extension/accordion.ts` at the applyPlan branch (~line 1227):
   - After `const messagesForModel = applyPlan(...)`, snapshot `cacheTracker.getFrozenFromIndex()` and `cacheTracker.getDiagnostics().reason` BEFORE `applyPlan` (i.e., save them before the call) and AFTER.
   - Detect chunked-compaction rollover by `plan.groups.some((g) => (g.digest ?? "").startsWith("⟨chunked-compaction ·"))`.
   - When true, compose the `chunkedCompaction` block from the detected group and the before/after snapshots; append to the `writeContextDiagnostic({...})` payload.

### Grounding evidence

Verified during grounding:

- No `constants.ts` currently exists under `conductors/my-customize-conductor/` (fresh file).
- No `preGroupTokens` symbol exists anywhere in the vendor codebase (fresh identifier).
- No `attach(host)` exists on `MyCustomizeConductor` today — but `attach` is out of scope for this issue (owned by `#04`).
- No explicit constructor exists today — this issue adds one.
- Line 279 (not 233 as PRD states) contains `const threshold = Math.max(2_000, 0.05 * cap);` — an anchor drift, contract intact.
- Extension `applyPlan` call site is at ~line 1227 (not 1215 as PRD states) — anchor drift, contract intact.

## Acceptance criteria

Test file: extend `F:/MyWork/my-pi/extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts`. Working directory for every command below: `F:/MyWork/my-pi/extensions/accordion/app`.

- [ ] **AC-1** (walking skeleton emission — `US-001` first half): a synthesised `ConductorView` with `contextWindow = 200_000`, harnessOverhead ~5 000, and a pre-group summing to ~15 850 tokens on a turn boundary with no open tool pair, yields exactly one `GroupCommand` from `conductor.conduct(view)`.
  - Run: `pnpm vitest run conductor.compaction-naive -t "walking skeleton emits one chunked-compaction group"`
  - Expected: `plan` is a length-1 array; `plan[0].kind === "group"`; `plan[0].ids.length === /* pre-group size */`; `plan[0].digest.startsWith("⟨chunked-compaction ·")`; `plan[0].digest.includes("Members: {#")` and matches `/Members: \{#[a-z0-9]+\}/`.

- [ ] **AC-2** (engine applies the group across the frozen boundary — proves the `#02` blocking edge is real, not stubbed): using a real engine store fixture, apply the walking-skeleton `plan` and observe the group is registered.
  - Run: `pnpm vitest run conductor.compaction-naive -t "walking skeleton group is applied by the engine across the frozen boundary"`
  - Expected: after `store.apply(plan.map(c => ({ ...c, by: "conductor" })))`, `store.groups.length === 1`, the new group's `memberIds.length === plan[0].ids.length`, and the returned `reports` array contains **no** entry with `reason === "frozen"`. Additionally, the same test with `#02` reverted (frozen clamp still active for group) fails with a `"frozen"` clamp report — verify by temporarily commenting out the bypass and re-running; the test must fail. (This anti-stub check is a review criterion; do not commit the reverted state.)

- [ ] **AC-3** (deterministic replay — `US-001` second half, `RB-005`, `DEC-010`): running the same `conduct()` twice on byte-identical input yields a byte-identical `digest` string.
  - Run: `pnpm vitest run conductor.compaction-naive -t "chunked-compaction digest is byte-identical on replay"`
  - Expected: given two fresh `MyCustomizeConductor` instances and the same view, `first.conduct(view)[0].digest === second.conduct(view)[0].digest` (strict `===`).

- [ ] **AC-4** (immutability — no re-emission on the next pass): immediately after AC-1's rollover, feeding a follow-up view where the just-grouped blocks have `grouped: true` returns **zero** chunked-compaction `GroupCommand`s.
  - Run: `pnpm vitest run conductor.compaction-naive -t "no repeat chunked-compaction emission on next conduct pass"`
  - Expected: `plan2.filter(c => c.kind === "group" && (c.digest ?? "").startsWith("⟨chunked-compaction ·")).length === 0`. Existing frozen-grouping behavior on the non-chunked-compaction suffix is unaffected (regression check).

- [ ] **AC-5** (tool-pair invariant, `RB-002`, `DEC-011`): a view where the boundary would straddle a `tool_call`/`tool_result` pair emits `ids` that either contain both halves or neither; the trailing inside-half is trimmed out and stays live for the next cycle.
  - Run: `pnpm vitest run conductor.compaction-naive -t "chunked-compaction trims open tool pairs before cost estimation"`
  - Expected: (a) for a view with `protectedFromIndex - 1 = tool_call` and `protectedFromIndex = tool_result`, `plan[0].ids` **excludes** the trailing `tool_call` block; (b) a spy on `estimateDefaultGroupDigestCost` confirms it is called with the **post-trim** `ids` set, not the pre-trim set; (c) the trimmed `tool_call` block appears in the raw block list on the next `conduct()` pass with `grouped: false`.

- [ ] **AC-6** (small-context inert, `US-005`, `RB-008`, `DEC-004`): with `contextWindow = 32_000`, no chunked-compaction group is emitted regardless of pre-group size. Same with `contextWindow = null`.
  - Run: `pnpm vitest run conductor.compaction-naive -t "chunked-compaction inert on contextWindow < 128k or null"`
  - Expected: for `contextWindow ∈ {32_000, 64_000, null}` with an identical block corpus to AC-1, `plan.filter(c => c.kind === "group" && (c.digest ?? "").startsWith("⟨chunked-compaction ·")).length === 0` on every case.

- [ ] **AC-7** (walking-skeleton pressure valve fallback still works — regression): with `contextWindow = 200_000` **and** `view.liveTokens > hardCap` but pre-group not yet at threshold, the pre-existing frozen-grouping pressure valve at lines 217–237 still fires and emits its own group(s).
  - Run: `pnpm vitest run conductor.compaction-naive -t "pre-existing frozen-grouping pressure valve is unaffected"`
  - Expected: at least one `GroupCommand` is emitted whose `digest` does **not** start with `⟨chunked-compaction ·`, confirming the pre-existing path remains as the unshared hard-pressure fallback (`DEC-007`).

- [ ] **AC-8** (superseded v0 assertion replacement — `DEC-008`): the pre-existing v0 assertion at `conductor.compaction-naive.test.ts:336-338` (`expect(g.digest).not.toMatch(/\{#\w+\s+FOLDED\}/)`) is replaced with `expect(g.digest).toMatch(/^⟨chunked-compaction ·/)` and `expect(g.digest).toMatch(/Members: \{#\w+\}/)` for the chunked-compaction test case.
  - Run: `pnpm vitest run conductor.compaction-naive`
  - Expected: the file compiles; the old assertion is removed; the new assertions pass on the chunked-compaction case. `git blame` on the changed lines points at this issue's commit.

- [ ] **AC-9** (tool-pair property, `RB-002`): for 100 randomised views (seeded), every emitted chunked-compaction `GroupCommand` satisfies "every `callId` referenced by any block in `group.ids` has both halves present in `group.ids` or neither."
  - Run: `pnpm vitest run conductor.compaction-naive -t "chunked-compaction group.ids has balanced tool pairs (property)"`
  - Expected: property holds for all 100 seeded views; failures print the offending view for reproducibility.

- [ ] **AC-10** (extension JSONL block on rollover — `RB-006`, `DEC-016` Site 2): a scripted rollover through the extension's real `applyPlan` path appends exactly one JSONL record whose `chunkedCompaction.event === "rollover"` and whose fields match the shape above; a non-rollover turn on the same session appends a record with no `chunkedCompaction` key.
  - Run: `pnpm vitest run accordion.chunkedCompactionJsonl` (new test file: `F:/MyWork/my-pi/extensions/accordion/app/src/lib/... or extension test suite`, whichever hosts extension-side unit tests — implementer chooses; add to `app/vitest.config.ts` if needed but do NOT create a new runner)
  - Expected: after two turns (one rollover, one passthrough), `readFileSync(sessionJsonlPath).toString().trim().split("\n").map(JSON.parse)` yields two records; `records[0].chunkedCompaction.event === "rollover"`, `records[0].chunkedCompaction.preGroupBlockCount === plan.groups[0].ids.length`, `records[0].chunkedCompaction.frozenFromIndexBefore !== records[0].chunkedCompaction.frozenFromIndexAfter`, `records[0].chunkedCompaction.digestContentHash.startsWith("sha256:")`; `records[1].chunkedCompaction === undefined`.

- [ ] **AC-11** (no wire-protocol change, `RB-001`): the diff of this issue's commit touches **zero** files under `conductors/contract/`.
  - Run: `cd F:/MyWork/my-pi/extensions/accordion && git diff --stat conductors/contract/ && cat conductors/contract/protocol.ts | grep -E "CONDUCTOR_PROTOCOL_VERSION"`
  - Expected: `0 files changed` (or empty output from git diff), and `export const CONDUCTOR_PROTOCOL_VERSION = 3;` still present in `protocol.ts`.

- [ ] **AC-12** (no persistence, `DEC-015`, `RB-005`): the diff of this issue's commit adds no writes under `~/.accordion/sessions/` or any group-summary cache file, and grep for `fs.writeFileSync` / `fs.appendFileSync` in the new/changed code shows only the existing JSONL writer path.
  - Run: `cd F:/MyWork/my-pi/extensions/accordion && git diff HEAD~1 HEAD | grep -E "writeFileSync|appendFileSync|group-summar|\.accordion/sessions" | grep -v "context.jsonl"`
  - Expected: empty output (no persistence added).

- [ ] **AC-13** (no LLM at rollover, `DEC-019`): the diff of this issue's commit does not add any `host.complete(` call in the chunked-compaction code path.
  - Run: `cd F:/MyWork/my-pi/extensions/accordion && git diff HEAD~1 HEAD -- conductors/my-customize-conductor/ | grep -E "host\.complete\("`
  - Expected: empty output.

## Blocked by

- `02-engine-group-frozen-clamp-bypass.md` — required for AC-2 and every downstream assertion that involves engine application of the emitted group.
