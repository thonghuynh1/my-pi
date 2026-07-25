Status: ready-for-agent
Type: AFK

# Complete-turn compaction with individually recallable MCP context

## Parent

`.scratch/accordion-turn-aligned-mcp-retrieval/PRD.md`

## What to build

Deliver the walking skeleton for `US-001`: one eligible completed turn containing one MCP call/result must become one real immutable chunked-compaction group whose final digest section identifies that MCP result and gives an individually working recall code. Recalling that member must return only its original content while leaving the group folded and unchanged.

Covers `US-001`, `DEC-001`, `DEC-002`, `DEC-003`, `DEC-005`, `RB-001`–`RB-003`, `RB-005`–`RB-008`, and `RB-011`–`RB-016` at walking-skeleton depth.

## Implementation map

### Complete-turn selection

- Existing owner: `extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts`.
- Add the shared pure selector `selectCompactionRange` and its canonical result type:
  ```ts
  type SafeCompactionRange = {
    fromIndex: number;
    toIndexExclusive: number;
    oversizedTurnSplit: boolean;
  };
  ```
- Normal selection must keep one **Complete Accordion Turn** together: user message, assistant parts sharing provider-message identity, and balanced call/result activity through the next user message.
- Keep the current partial turn in the Protected Tail. Do not select arbitrary block endpoints.
- Existing host facts to respect: `store.svelte.ts::buildView` exposes `turn`, `messageKey`, `callId`, and `protected`; `snappedRange` expands group endpoints to whole provider messages; `createGroup` rejects a range reaching the Protected Tail (`GROUND-001`).
- In `my-customize-conductor.ts::MyCustomizeConductor.conduct`, consume `selectCompactionRange` to form the contiguous member list.
- For chunked compaction only, user/MCP/recall/pstack blocks may belong to an eligible complete turn. Keep `held`, `grouped`, and `proactivelyCompressed` as hard barriers. Do not unintentionally alter the conductor's separate ordinary pressure-fold ordering.
- Preserve the existing context-window gate, non-empty deterministic `GroupCommand`, minimum two surviving IDs, min-saving policy, and pair-balance defense.

### Canonical MCP identity and basic index

- Existing owner: `extensions/accordion/conductors/my-customize-conductor/mcp-summary.ts`.
- Create the shared `CanonicalMcpIdentity` representation and `canonicalMcpIdentity(callText)` helper with these canonical names; issue 03 consumes them.
- Identity key consists of normalized server, normalized tool, and a deterministic fingerprint of canonical arguments. Equivalent JSON key ordering must produce the same key; different argument values must not.
- Display only safe identifying arguments. Reuse the existing sensitive-key rule `/(token|key|password|secret|auth)/i`; secret values must never appear in digest text. Fingerprint strength must be no weaker than existing six-character recovery handles.
- Pair MCP results to calls through `callId`, reusing current `callById`, `parseOuterCall`, pstack-name/label, redacted preview, and `foldCode` behavior (`GROUND-003`).
- Add the canonical shared function `chunked-compaction.ts::buildMcpRetrievalIndex`; issue 03 consumes it. For the walking skeleton, one occurrence must render as the final digest section with safe label, `<server>/<tool> · <fingerprint>`, turn, `{#memberCode}`, and exact `recall({"codes":["memberCode"]})` guidance.
- Preserve canonical wire chronology; do not add any move/reorder command. Continue emitting the existing `GroupCommand { ids, digest }`.
- Same corpus must produce byte-identical index and digest.

### Grouped-member recall

- Existing owner: `extensions/accordion/app/src/lib/live/plan.ts::resolveRecall` (`GROUND-004`).
- Today group-code recall returns the full group and the per-block branch skips members of folded groups.
- Before that generic skip, recognize a per-member code belonging to a folded chunked-compaction group and return exactly:
  ```ts
  { code, label, text: originalMemberText, ids: [memberId] }
  ```
- This path is read-only: do not call `appendToTail`, `unfold`, or `unfoldGroup`; do not set an override or alter `group.folded`.
- Keep existing group-code recall behavior and existing chunked-member `resolveUnfold` tail-append behavior unchanged.
- The registered tool in `extensions/accordion/extension/accordion.ts` already echoes `RecallContent` as one ordinary Pi tool result. Do not synthesize another append or add protocol fields.

### Required walking-skeleton test

Add a real-wiring test named exactly:

`compacts a complete MCP-bearing turn and recalls its grouped member without unfolding`

The test must construct a conductor view with one completed MCP-bearing turn and a newer protected turn, run `MyCustomizeConductor`, apply the command to an `AccordionStore`, read the named member code from the emitted index, call the real `resolveRecall`, and prove:

- one group is emitted and applied without a protected/frozen/invalid clamp;
- all parts of the completed turn are group members and no part of the protected turn is;
- the index is the final digest section and identifies the exact MCP call;
- member recall returns only the original MCP result and one ID;
- the group digest, member IDs, folded state, and block overrides are unchanged after recall.

Nearby test seams: `conductor.compaction-naive.test.ts` walking skeleton/deterministic replay/balanced pair tests; `plan.test.ts` read-only original recall tests; `plan.groups.test.ts` group recall/unfold tests.

## Acceptance criteria

- [ ] Normal chunked-compaction selection keeps completed turns whole and leaves the current partial turn protected.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts`
  - Expected: tests named `keeps complete turns together at the protected boundary` and `includes MCP recall pstack and user blocks but stops at hard barriers` pass; emitted IDs contain no split `messageKey` or `callId`.

- [ ] Canonical MCP identity is deterministic, distinguishes argument changes, and never displays sensitive values.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.my-customize-conductor.test.ts src/lib/engine/conductor.compaction-naive.test.ts ../extension/chunked-compaction-invariant.test.ts ../extension/accordion.chunkedCompactionJsonl.test.ts`
  - Expected: tests named `canonical MCP identity ignores JSON key order`, `canonical MCP identity changes with arguments`, and `MCP retrieval identity redacts sensitive display values` pass with the secret fixture absent from every digest assertion.

- [ ] The walking skeleton compacts, applies, indexes, and individually recalls one MCP-bearing complete turn through real conductor/store/plan wiring.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts`
  - Expected: `compacts a complete MCP-bearing turn and recalls its grouped member without unfolding` passes; the asserted group remains folded and byte-identical after one-member recall.

- [ ] Existing whole-group recall and chunked-member unfold semantics remain unchanged.
  - Run: `npm --prefix extensions/accordion/app test -- src/lib/engine/conductor.compaction-naive.test.ts src/lib/live/plan.test.ts src/lib/live/plan.groups.test.ts`
  - Expected: existing tests for whole-group original recall and group/member unfold pass alongside new tests named `recalls one chunked group member by its member code` and `member recall does not append or mutate fold state`.

- [ ] The shared TypeScript/Svelte contracts remain valid without protocol changes.
  - Run: `npm --prefix extensions/accordion/app run check`
  - Expected: svelte-check completes with zero errors.

## Blocked by

None - can start immediately.
