# Group-First Compaction — Grounding

## Key symbols

| Symbol | File | Behavior |
|--------|------|----------|
| `planNormalPressure` | `my-customize-conductor.ts:332` | Collects foldable candidates, slices into ~15k groups via `sliceCandidateRunsIntoGroups`. No individual folds. |
| `sliceCandidateRunsIntoGroups` | `my-customize-conductor.ts:368` | Detects non-contiguous gaps in candidate list, trims partial-turn blocks at run boundaries, flushes each run as a rollover-lifecycle group. Universal path (not legacy). |
| `replayPriorCommands` | `my-customize-conductor.ts:126` | Replays prior `group` and `replace` commands. Does NOT replay `fold`. Group-only compaction makes replay stable across replanning cycles. |
| `createGroup` | `my-customize-conductor.ts:230` | Creates a group command; applies `trimOpenToolPairs`; guards on `minimumSaving` |
| `DEFAULT_PRE_GROUP_TOKENS` | `constants.ts` | ~15k token target for pre-group window |
| `minimumSaving` | computed | `max(2000, 0.05 * cap)` |

### Removed symbols

| Symbol | Status |
|--------|--------|
| `planFoldsToCap` | **Deleted** — replaced by `sliceCandidateRunsIntoGroups` overflow groups |
| `foldOrReplace` | **Deleted** — individual fold helper no longer needed |

## Test seams

| Seam | Location | Notes |
|------|----------|-------|
| Mock server demo | `extension/mock-server.mjs` | `CW=70000 CONTEXT_WINDOW=272000 GROW=1 TPS=5000` reproduces rollover pressure |
| Conductor tests | `conductor.my-customize-conductor.test.ts` | 306 lines of group-batching coverage including boundary preservation |
| Frozen prefix evidence | `frozen-prefix-evidence.test.ts` | Validates no commands target frozen blocks |
| Naive compaction tests | `conductor.compaction-naive.test.ts` | Compaction baseline |

## Constraints

- `trimOpenToolPairs` must be applied to any group to avoid straddling incomplete tool pairs
- Groups must pass `minimumSaving = max(2000, 0.05 * cap)` threshold
- `replayPriorCommands` handles `group` commands (they persist) but not `fold` (no longer emitted)
- Rollover groups use `lifecycle: "rollover"` to cross frozen boundary
- `sliceCandidateRunsIntoGroups` preserves group boundaries by detecting non-contiguous candidate runs
