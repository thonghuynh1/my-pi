---
id: "001"
title: "Add non-frozen My Customize group fallback with residue accounting"
labels: [ready-for-agent]
depends_on: []
status: closed
---
Status: ready-for-agent

# Add non-frozen My Customize group fallback with residue accounting

## What to build

Add the first complete, non-frozen group-fallback path to `MyCustomizeConductor`. Existing rich recoverable replacements and ordinary folds must be planned first. If their projected residue still exceeds the available cap, the conductor may emit deterministic default-digest group commands for eligible non-frozen runs, but only when grouping is a positive net token win against the current planned residue.

This slice implements `DEC-001`, `DEC-002`, `DEC-003`, `DEC-007`, `DEC-008`, and `DEC-010`.

User stories covered:

- Old folded tool-heavy regions collapse under pressure.
- Rich `read`/`grep`/`find`/`ls`/`subagent` summaries happen before grouping.
- Grouping is deterministic, synchronous, recoverable, and isolated to My Customize.
- Group commands use the host default digest and never drop content.

## Implementation map

### MyCustomizeConductor planning pipeline

**Decision IDs:** `DEC-001`, `DEC-002`, `DEC-003`, `DEC-007`, `DEC-008`, `DEC-010`

**Current code anchors:**

- `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`
  - `MyCustomizeConductor.conduct()`
  - local candidate application logic (`applyCandidate()` or its current equivalent)
  - `lastPlan`, `lastSavings`, `lastSemanticKey`
  - `isMcpResult()` and `isRecallResult()` handling
- `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts`
  - `Command`, `GroupCommand`, `ViewBlock`, `ConductorView`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`

**Existing behavior:** The conductor ranks and applies rich replacements/folds until the projected live token count fits the available cap. It currently emits only `replace` and `fold` commands. The host already accepts `{ kind: "group", ids: [...] }` and supplies a recoverable default digest when `digest` is omitted.

**Required edits:**

1. Preserve the existing candidate ranking and special MCP/recall/pstack replacement behavior.
2. Plan replacements/folds first. Do not group while the planned projected count is already at or below `availableCap(view)`.
3. When still over cap, build non-frozen group candidates and emit deterministic `{ kind: "group", ids: [...] }` commands without a `digest` field.
4. Track the planned residue for every member: replacement summary cost, folded cost, or original cost when untouched.
5. Update projected tokens by the conservative estimated group saving.
6. Ensure the conductor remains synchronous and does not call `host.complete()`.

Normative pipeline:

```ts
// 1. Plan rich replace/fold candidates using existing ranking.
// 2. If projected <= cap, emit replaces + folds.
// 3. Else build safe group runs.
// 4. Emit only net-win groups using default digest.
// 5. Remove grouped ids from per-block fold commands.
```

Normative command shape:

```ts
export interface GroupCommand {
  kind: "group";
  ids: string[];
  digest?: string | null;
}
```

My Customize must emit the command without `digest`; it must never emit `digest: null` or `digest: ""`.

### Keel-style residue accounting

**Current code anchor:** `F:/MyWork/my-pi/vendor/accordion/conductors/keel/budget.ts`, especially `groupHeadCost()` and the `saving = runLive - headCost` gate.

Use the same conservative approach without coupling the conductor to the store. The planned contribution is:

```ts
plannedContribution(block) =
  planned replace summary token cost, if replaced
  otherwise block.foldedTokens, if folded
  otherwise block.tokens
```

Estimate the default group digest cost with a named local constant/helper. Emit a group only when:

```ts
saving = sum(plannedContribution(member)) - estimatedGroupDigestCost(run)
saving > 0
```

The estimate is for planning only; the host remains authoritative for the actual digest.

### Host compatibility

No changes are expected in:

- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts`
- `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/mapping.ts`

Those paths already create default recoverable group summaries for omitted `digest` values. Do not add drop-group behavior.

## Acceptance criteria

- [ ] Running `cd F:/MyWork/my-pi/vendor/accordion/app && npx vitest run src/lib/engine/conductor.my-customize-conductor.test.ts` exits with code 0 and the test file reports zero failed tests.
- [ ] A test with fold/replace planning already at or below the cap asserts that the returned command list contains no `kind: "group"` command.
- [ ] A test with fold/replace planning still above the cap asserts that the returned command list contains at least one `kind: "group"` command.
- [ ] A test asserts every group emitted by My Customize has an omitted/`undefined` `digest`, never `null` or an empty string.
- [ ] A test asserts a run whose planned residue is no greater than the estimated default digest cost produces no group command.
- [ ] A test asserts a run whose planned residue is greater than the estimated default digest cost produces a group command and reduces the projected token count by the estimated saving.
- [ ] A test with a rich replacement asserts the net-win calculation uses the replacement summary cost rather than the original block token count.
- [ ] The implementation contains no asynchronous completion call, timer, network request, or new host attachment state for grouping.
- [ ] The existing `conductor.my-customize-conductor.test.ts` helper that calculates projected tokens accounts for group commands, so the new pressure assertions measure the returned plan rather than ignoring groups.

## Blocked by

None - the prerequisite rich-summary PRD is already implemented and its issues are closed.
