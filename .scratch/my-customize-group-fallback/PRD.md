Status: ready-for-agent

# PRD: Keel-Style Group Fallback for Accordion My Customize Conductor

## Problem Statement

`my-customize-conductor` can fold and replace many old blocks, but it currently does not collapse message structure. In long broker-dashboard sessions this leaves large framing overhead even when many tool results are individually folded. The user observed sessions where Accordion had many fold operations but `groupOpsRequested` stayed at `0`, so the context stayed expensive.

This PRD is intentionally sequenced **after** `F:/MyWork/my-pi/.scratch/better-accordion-fold-summaries/PRD.md`. That prior PRD should be implemented first because it changes selected non-MCP tool results from generic folds into rich recoverable replacements. This PRD defines how `my-customize-conductor` should group already-folded/replaced non-MCP content under pressure without regressing MCP/pstack/recall behavior.

## Solution

Add a deterministic, Keel-style group fallback to `my-customize-conductor`:

1. Keep the prior PRD's rich recoverable summaries for `read`, `grep`, `find`, `ls`, and `subagent` when those blocks are selected for folding.
2. Preserve MCP/pstack/recall special handling ahead of generic tool behavior.
3. If the projected context still exceeds the available cap after folds/replacements, group safe contiguous non-MCP/non-user runs.
4. Group only when grouping is a net token win against the **current planned residue**, not the original full block size.
5. Use the host's default recoverable group digest. Do not use LLM summaries or drop groups.
6. Group frozen provider-cache prefix only as a rare, epoch-batched pressure valve with a significant-savings threshold.

## User Stories

1. As a broker-dashboard user, I want old folded tool-heavy regions to collapse into groups under pressure, so that framing overhead stops dominating my context cost.
2. As an Accordion user, I want `My Customize` to preserve MCP/pstack recall guidance, so that folded skills and principles remain recoverable and identifiable.
3. As an agent, I want rich summaries for `read/grep/find/ls/subagent` to happen before grouping, so that selected tool results are actionable before any structural fallback.
4. As an agent, I want grouping to avoid spanning user messages, so that user intent is not hidden inside unrelated bloat groups.
5. As an agent, I want grouping to avoid spanning MCP or recall blocks, so that pstack/provenance flows remain visible.
6. As a cost-conscious user, I want grouping to be Keel-style net-win only, so that a group is not emitted when its digest would cost more than the folded/replaced residue.
7. As a long-session user, I want old frozen folded regions to be groupable when the savings is significant, so that sessions can escape the “folded but framing-heavy forever” trap.
8. As a provider-cache-conscious user, I want frozen-prefix grouping to happen rarely, so that Accordion does not invalidate prompt cache every turn for tiny savings.
9. As a maintainer, I want group fallback to be deterministic and synchronous, so that tests do not need network calls, LLM completions, timers, or UI state.
10. As an implementer, I want group fallback isolated to `my-customize-conductor`, so that engine default digest behavior and other conductors do not change.
11. As a tester, I want focused Vitest coverage for group planning behavior, so that future conductor changes do not accidentally group pstack, recall, user, or token-negative runs.

## Accepted Decision Register

- `DEC-001`
  - Decision: This PRD is sequenced after the rich-summary PRD at `F:/MyWork/my-pi/.scratch/better-accordion-fold-summaries/PRD.md`.
  - Lens: scope
  - Rationale: The grouping logic must reason against the residue after rich recoverable replacements exist.
  - Rejected alternatives: Implement grouping before rich summaries; merge both PRDs into one implementation pass.
  - Downstream impact: Implementation issues for this PRD should assume the prior PRD's `read/grep/find/ls/subagent` summaries and exact-code MCP/pstack updates are already present.

- `DEC-002`
  - Decision: Rich summaries/folds run first; grouping is a pressure fallback after projected tokens still exceed cap.
  - Lens: runtime
  - Rationale: Grouping changes message structure and may hide individual per-tool summaries inside a group, so it should not be the first action.
  - Rejected alternatives: Group target tools freely before rich summaries; proactively group whenever possible.
  - Downstream impact: `MyCustomizeConductor.conduct()` must compute fold/replace candidates first, then build group candidates only if `projected > cap`.

- `DEC-003`
  - Decision: Grouping uses Keel-style net-win against current planned residue.
  - Lens: runtime
  - Rationale: A group should only be emitted if its default digest beats the already-folded/replaced contribution of its members.
  - Rejected alternatives: Compare against original full token cost; group whenever `projected > cap` regardless of residue.
  - Downstream impact: Group planning needs a `plannedContribution(block)` helper that returns replacement summary cost, folded cost, or full cost depending on the already-planned command state.

- `DEC-004`
  - Decision: MCP, recall, and pstack identity blocks break group runs.
  - Lens: contract
  - Rationale: The pstack/recall flow carries special identity and recovery semantics that must remain individually visible.
  - Rejected alternatives: Let host range snapping span over MCP/recall blocks; include MCP in groups when pair-balanced.
  - Downstream impact: Group-run construction must flush the current run before any `toolName === "mcp"`, `toolName === "recall"`, or pstack identity/provenance block.

- `DEC-005`
  - Decision: User messages break group runs.
  - Lens: contract
  - Rationale: User instructions and intent should not be hidden in bloat groups by this conductor.
  - Rejected alternatives: Allow default group digest to quote user messages inside a group.
  - Downstream impact: `kind === "user"` is a hard group-run boundary.

- `DEC-006`
  - Decision: Non-MCP tool pairs may be grouped when they are inside a safe contiguous run.
  - Lens: contract
  - Rationale: Tool-heavy sessions are the cost problem; excluding all tool calls/results would leave most framing bloat untouched.
  - Rejected alternatives: Group prose/thinking only; group all tool pairs including MCP.
  - Downstream impact: `tool_call` and `tool_result` for non-MCP/non-recall tools can be eligible. The host still defensively re-checks whole-message snapping and pair balance.

- `DEC-007`
  - Decision: Group output uses the host default recoverable group digest only.
  - Lens: contract
  - Rationale: Default group digests carry `{#code FOLDED}` recovery, are deterministic, and avoid new summary generation paths.
  - Rejected alternatives: LLM-generated group summaries; `digest: null` drop groups; custom lossy summaries.
  - Downstream impact: Emit `{ kind: "group", ids: [...] }` without `digest`; never emit `digest: null` from My Customize group fallback.

- `DEC-008`
  - Decision: Grouping is deterministic and synchronous.
  - Lens: runtime
  - Rationale: This conductor should remain cheap, testable, and independent of LLM completion availability.
  - Rejected alternatives: Async `host.complete()` group summaries; background summarization.
  - Downstream impact: No new `attach(host)`, `detach()`, inflight completion state, or completion cache is required for this PRD.

- `DEC-009`
  - Decision: Frozen provider-cache prefix grouping is allowed only as epoch-batched significant-savings fallback.
  - Lens: ops
  - Rationale: Never grouping frozen prefix can leave old individually-folded blocks framing-heavy forever. Grouping frozen prefix too often can repeatedly invalidate provider prompt cache. Epoch batching pays cache churn rarely for durable savings.
  - Rejected alternatives: Never group frozen prefix; group frozen prefix whenever net-win says yes.
  - Downstream impact: Implement a stateful frozen-group epoch guard with a significant-savings threshold such as `max(2000 tokens, 5% of cap)`.

- `DEC-010`
  - Decision: Unknown non-MCP tools remain plain recoverable folds unless the prior rich-summary PRD explicitly supports them.
  - Lens: scope
  - Rationale: The prior PRD scopes rich summaries to `read/grep/find/ls/subagent`. Unknown tool identity extraction is more error-prone.
  - Rejected alternatives: Generic rich summaries for arbitrary tools.
  - Downstream impact: Group fallback may group unknown non-MCP tool content later, but unknown tools do not get new rich replacement summaries from this PRD.

## Implementation Plan

### Area: `MyCustomizeConductor` planning pipeline

- **Decision IDs**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-007`, `DEC-008`, `DEC-010`
- **Current code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Symbols: `MyCustomizeConductor.conduct()`, local `applyCandidate()`, `lastPlan`, `lastSavings`, `lastSemanticKey`, `isMcpResult()`, `isRecallResult()`
- **Existing behavior**: The conductor greedily selects fold/recoverable-replace candidates until `live <= availableCap(view)`. It emits only `replace`, `fold`, and `fold` with `breakFrozen`; it never emits `group`.
- **Required edits**:
  - Preserve the existing candidate ranking and MCP/recall/pstack summary priority from the prior PRD.
  - Track the planned residue of each selected block after rich `replace` or `fold` is chosen.
  - If projected live tokens are still above `availableCap(view)`, invoke group fallback.
  - Emit group commands before fold commands or remove grouped member IDs from fold commands so a member is not both grouped and folded in the same desired state.
  - Keep the conductor synchronous; do not add host completion calls.
- **Snippet(s)**:

```ts
// current code anchor — existing command vocabulary emitted today; normative seam to extend
const cmds: Command[] = [...replaces];
if (foldIds.length) cmds.push({ kind: "fold", ids: foldIds });
if (breakFoldIds.length) cmds.push({ kind: "fold", ids: breakFoldIds, breakFrozen: true });
```

```ts
// decision artifact — illustrative pipeline, normative order
// 1. Plan rich replace/fold candidates using existing ranking.
// 2. If projected <= cap, emit replaces + folds.
// 3. Else build safe group runs.
// 4. Emit only net-win groups using default digest.
// 5. Remove grouped ids from per-block fold commands.
```

- **Tests to extend**:
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`
  - Add tests proving a run is grouped only after fold/replace residue still exceeds cap.
  - Add tests proving grouped member IDs are not also present in emitted `fold` commands.
  - Run command:
    ```sh
    cd F:/MyWork/my-pi/vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
    ```
  - Passing output should show the target test file passing with zero failed tests.
- **Wiring/build notes**: `my-customize-conductor` is already registered in `F:/MyWork/my-pi/vendor/accordion/conductors/index.ts`; no new conductor registration is needed.

### Area: Safe contiguous group-run construction

- **Decision IDs**: `DEC-004`, `DEC-005`, `DEC-006`, `DEC-010`
- **Current code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`
  - Symbols: `ViewBlock`, `GroupCommand`, `ViewBlock.kind`, `ViewBlock.toolName`, `ViewBlock.held`, `ViewBlock.protected`, `ViewBlock.grouped`
- **Existing behavior**: No group-run construction exists in My Customize. The conductor filters fold candidates to non-held, non-protected, non-grouped foldable kinds. It treats MCP and recall specially for replacement summaries.
- **Required edits**:
  - Add a pure helper that walks `view.blocks` in order and returns safe contiguous runs.
  - Hard boundaries: user blocks, MCP blocks, recall blocks, pstack identity/provenance blocks, held blocks, protected blocks, already grouped blocks.
  - Non-MCP `tool_call` and `tool_result` blocks may be members of a safe run; the host apply path will still enforce pair-balance and whole-message safety.
  - Runs must not cross a hard boundary. Do not rely on host snapping to avoid MCP/recall/user inclusion.
- **Snippet(s)**:

```ts
// current code anchor — GroupCommand contract; normative shape
export interface GroupCommand {
  kind: "group";
  ids: string[];
  digest?: string | null;
}
```

```ts
// decision artifact — normative group boundaries
function isGroupBoundary(b: ViewBlock): boolean {
  if (b.kind === "user") return true;
  if (b.held || b.protected || b.grouped) return true;
  const tool = (b.toolName ?? "").trim().toLowerCase();
  return tool === "mcp" || tool === "recall" || isPstackIdentityBlock(b);
}
```

- **Tests to extend**:
  - Test that a user block splits two otherwise groupable runs.
  - Test that MCP and recall blocks split runs and are not included in any group command.
  - Test that non-MCP tool call/result pairs can be grouped.
  - Test that held/protected/grouped blocks split or exclude runs.
  - Same run command as above.
- **Wiring/build notes**: Keep helpers pure and local or in a small conductor-adjacent module. Do not import Svelte store code into conductor helpers.

### Area: Keel-style net-win residue accounting

- **Decision IDs**: `DEC-003`, `DEC-007`
- **Current code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/keel/budget.ts`
  - Symbols: `oldestContiguousRun()`, group fallback stages, `groupHeadCost()` pattern
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts`
  - Symbol: `estSummaryTokens()`
- **Existing behavior**: Keel has precedent for grouping only when the group head is cheaper than current contributions. My Customize currently records savings for fold/replace but has no group-cost decision.
- **Required edits**:
  - Add a pure `plannedContribution(block)` helper for current planned residue:
    - rich/identity `replace` => `estSummaryTokens(replace.content)`
    - plain fold => `block.foldedTokens`
    - untouched => `block.tokens`
  - Estimate default group digest cost conservatively. The exact host cost is computed by the store; conductor-side estimate is only for planning. Use a named constant or helper so tests can reason about it.
  - Emit a group only when `sum(plannedContribution(run)) - estimatedGroupDigestCost > 0`.
  - Update projected live tokens by the estimated saving, and stop grouping once projected `<= cap`.
- **Snippet(s)**:

```ts
// current code anchor — Keel precedent, normative concept not exact code to copy
const saving = runLive - headCost;
if (saving <= 0) continue;
groups.push({ kind: "group", ids: run.map((b) => b.id) });
projected -= saving;
```

```ts
// decision artifact — normative residue rule
currentResidue = Σ plannedContribution(member)
groupCost = estimateDefaultGroupDigestCost(run)
saving = currentResidue - groupCost
emit group iff saving > 0
```

- **Tests to extend**:
  - Test that a run with residue lower than the estimated group digest is not grouped.
  - Test that a run with residue higher than the group digest is grouped.
  - Test that replacement residue, not original full tokens, controls the net-win calculation.
  - Same run command as above.
- **Wiring/build notes**: Do not call store methods such as `groupDigestTokens()` directly from conductor code if that would create engine/store coupling. A conservative local estimate is acceptable; the host remains authoritative.

### Area: Frozen-prefix epoch batching

- **Decision IDs**: `DEC-009`
- **Current code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - Symbols: `view.frozenFromIndex`, `lastPlan`, `lastSavings`, `lastSemanticKey`, `SavedFold`
  - `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`
  - `ViewBlock.order`, `ConductorView.frozenFromIndex`, `FoldCommand.breakFrozen`, `ReplaceCommand.breakFrozen`
- **Existing behavior**: My Customize first folds only blocks with `order >= view.frozenFromIndex`; if that cannot meet cap, it can fold old cached-prefix blocks with `breakFrozen: true`. It has no group equivalent.
- **Required edits**:
  - Run non-frozen grouping before frozen grouping.
  - Frozen grouping may consider blocks with `order < view.frozenFromIndex` only if projected tokens remain over cap after non-frozen planning.
  - Require significant total frozen-group savings, e.g. `saving >= max(2000, 0.05 * cap)`.
  - Add epoch guard state so the conductor does not emit new frozen-prefix group rewrites on every pass for tiny additions.
  - Reuse the existing semantic key invalidation for Poteto mode; frozen grouping epoch state must reset when the semantic key changes or when live tokens fit under cap.
- **Snippet(s)**:

```ts
// current code anchor — frozen prefix meaning from contract; normative field
/** Index of the first block the conductor may fold. Blocks before this
 *  index are in the provider's prompt cache prefix. */
frozenFromIndex: number;
```

```ts
// decision artifact — normative frozen grouping gate
allowFrozenGrouping iff:
  projected > cap after non-frozen planning
  && totalFrozenGroupSaving >= max(2000, 0.05 * cap)
  && !sameFrozenGroupingEpochAlreadyEmitted
```

- **Tests to extend**:
  - Test that frozen blocks are not grouped when non-frozen planning reaches cap.
  - Test that frozen grouping does not happen for small net savings below threshold.
  - Test that frozen grouping happens when still over cap and savings exceeds threshold.
  - Test that a second identical pass returns/holds the same plan rather than creating a new frozen regroup epoch.
  - Test that semantic changes such as Poteto beacon state changes invalidate the held epoch as existing plan holding already does.
  - Same run command as above.
- **Wiring/build notes**: This logic is stateful inside the conductor instance, like `lastPlan` and `lastSavings`. Keep the state minimal and inspectable through external behavior tests rather than exposing internals.

### Area: Wire/store group application compatibility

- **Decision IDs**: `DEC-006`, `DEC-007`
- **Current code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts`
  - Symbols: `groupCmd()`, `createGroup()`, `groupSummary()`, `isDropGroup()`
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts`
  - Symbol: `computeGroupOps(store)`
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/mapping.ts`
  - Symbol: `applyPlan(messages, ops, groups)`
- **Existing behavior**: The host applies group commands, emits default summaries when `digest` is omitted, and defensively re-derives whole-message and tool-pair safety on the wire. `computeGroupOps()` sends folded groups to the extension; `mapping.applyPlan()` collapses whole-message runs into one provider-safe summary message.
- **Required edits**:
  - No direct store/wire code changes are expected for this PRD.
  - My Customize must emit default group commands (`digest` omitted) so existing `groupSummary()` and `computeGroupOps()` paths handle recoverability.
  - Do not emit drop groups (`digest: null` or `""`).
- **Snippet(s)**:

```ts
// current code anchor — host default group summary; normative boundary
if (this.isDropGroup(g)) return "";
if (typeof g.digest === "string" && g.digest) return g.digest;
const c = this.classifyGroup(g);
return groupDigest(g, c.collapsedMembers.length ? c.collapsedMembers : c.members);
```

```ts
// current code anchor — wire safety in mapping; normative host responsibility
// GroupOp removes/collapses only whole messages and re-checks tool-pair balance.
export function applyPlan(messages: PiMessage[], ops: FoldOp[], groups: GroupOp[] = []): PiMessage[]
```

- **Tests to extend**:
  - Existing store/plan/mapping tests likely cover group mechanics. Add conductor-level tests unless implementation reveals a host mismatch.
  - Optional focused integration test can instantiate `AccordionStore`, attach `MyCustomizeConductor`, and assert `groups.length > 0` plus no drop group if existing test setup is lightweight.
- **Wiring/build notes**: Normal Accordion and broker dashboard both consume store `computeGroupOps()`; no broker-specific implementation should be added.

## Global Build & Wiring Notes

- Primary test command for this PRD:
  ```sh
  cd F:/MyWork/my-pi/vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts
  ```
- Type/Svelte check command:
  ```sh
  cd F:/MyWork/my-pi/vendor/accordion/app && npm run check
  ```
- `my-customize-conductor` lives outside `app/src` but is imported through aliases used by app tests. Keep new helpers in `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/` or inside the conductor file.
- No new conductor registration is required; `F:/MyWork/my-pi/vendor/accordion/conductors/index.ts` already registers `my-customize-conductor`.
- Do not edit broker dashboard or normal live-client code for this feature. Both paths share store group/fold planning.

## Testing Decisions

- Test external conductor behavior through returned `Command[]`, not private helper internals.
- Tests should assert:
  - grouping appears only after fold/replace cannot reach cap;
  - group commands omit `digest` and never use `digest: null`;
  - MCP/recall/user blocks break runs and are not grouped;
  - non-MCP tool pairs can be grouped;
  - net-win uses current planned residue;
  - frozen-prefix grouping is thresholded and epoch-batched.
- Prior art:
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts` already tests My Customize ranking, MCP replacement summaries, pstack labels, Poteto beacon state, and projected token behavior.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` and `conductor.bear2-hybrid.test.ts` contain store-level group expectations if an integration-style test is needed.

## Out of Scope

- Implementing the previous rich-summary PRD itself.
- LLM-generated group summaries.
- Drop groups or irreversible deletion from My Customize.
- Engine-wide default digest changes.
- Broker dashboard UI changes.
- Rich summaries for arbitrary unknown tools.
- Changing provider cache tracking outside this conductor.
- Live manual smoke tests as a required gate.

## Unresolved Gaps

None.

## Further Notes

This PRD is a follow-up pressure-control layer. It should be implemented after rich recoverable tool summaries so grouping can use the correct planned residue and preserve the prior PRD's recall-first behavior.