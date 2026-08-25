# Frozen-prefix stability

The conductor must never emit fold, replace, or restore commands that target
blocks inside the provider's cached prefix (`order < frozenFromIndex`). Breaking
this invariant causes a fold/unfold flip-flop cycle that destroys prompt cache
on every turn.

## What to verify

### Evidence report (deterministic proof)

The evidence test simulates a 6-turn cold-start lifecycle with advancing
`frozenFromIndex` and prints a structured report.

```bash
cd extensions/accordion/app
npx vitest run frozen-prefix-evidence.test.ts --reporter=verbose
```

Expected output: every turn shows `frozen-targeted: NONE ✅`. The report is
saved as evidence at `.verification-skills/verify-accordion/evidence/frozen-prefix-stability-report.txt`.

To regenerate evidence:
```bash
cd extensions/accordion/app
npx vitest run frozen-prefix-evidence.test.ts --reporter=verbose 2>&1 > \
  ../../.verification-skills/verify-accordion/evidence/frozen-prefix-stability-report.txt
```

### Visual demo (mock-server + Accordion app)

The mock-server replays the sample session through the real conductor. Set
`CW=70000` to create the 130k-content / 70k-budget cold-start scenario.

```bash
# Terminal 1: start the mock server (paused)
cd extensions/accordion/extension
CW=70000 node mock-server.mjs

# Terminal 2: start the Accordion dev server
cd extensions/accordion/app
npm run dev
```

Then open `http://localhost:1420`, connect to the fake session, and select
**My Customize** conductor in the conductor menu.

Open the mock-server control panel at `http://localhost:4318`, set TPS to 60,
and click Play. Watch the conductor status bar in the Accordion app header.

What to look for:
- The status should show `chunked · N% pregroup · M rollovers · Xk saved`
- Rollover count should increase steadily (not reset or oscillate)
- The tile grid should fold blocks and stay stable (no flickering)
- No `hard-cap-emergency` in the status text during normal playback

### Live demo results (captured)

A full run was captured: 982-block sample session looped with `GROW=1` from
0 to 723k tokens (4800+ blocks, 5 loops) at 70k budget.

Evidence in `.verification-skills/verify-accordion/evidence/`:

| File | Contents |
|---|---|
| `demo-conductor-plan-log.txt` | 3881 plan decisions logged by the mock server |
| `demo-capture-summary.json` | Structured milestone data |
| `frozen-prefix-stability-report.txt` | 6-turn unit test evidence report |

Key findings from the live run:

| Metric | Value | Meaning |
|---|---|---|
| Total plans emitted | 3881 | One per block sync |
| Restore commands | **0** | Frozen prefix never disturbed |
| Max groups per plan | 1 | Stable single rollover group replayed |
| Max folds per plan | 567 | Monotonically growing as context grows |
| Group count stable | Yes | Always 1 group (no flip-flop, no ungroup/regroup) |

Plan progression at token milestones:

```
~125k (loop 0): 0 folds, 1 group   — first rollover, no pressure yet
~252k (loop 1): 49 folds, 1 group   — pressure folding starts
~405k (loop 2): 191 folds, 1 group  — steady growth
~603k (loop 4): 324 folds, 1 group  — mid-session
~723k (loop 4): 514 folds, 1 group  — late session, still stable
```

The fold count grows monotonically. The group count stays at 1. Zero restores
across all 3881 plans. This is the fix working: the conductor folds blocks to
fit the budget, the frozen prefix is never disturbed, and the plan is stable
across turns.

Seven tests cover these scenarios:

| Test | What it proves |
|---|---|
| `does NOT restore folded blocks inside the frozen prefix` | Folded blocks in frozen zone stay folded. No restore commands emitted. |
| `cold-start 120k/70k: 5-turn lifecycle with advancing frozenFromIndex` | Simulates the real failure mode. 12 blocks × 10k tokens, budget 70k, frozenFromIndex advances from 0 → 4 → 8 → 11 → 12 across 5 turns. No command targets frozen blocks in any turn. |
| `plan commands shrink as frozen prefix grows` | As frozenFromIndex advances in steps of 2, the number of unfrozen targets decreases monotonically. |
| `does not replay replace commands on frozen blocks` | A `ReplaceCommand` emitted on turn 1 is NOT replayed after the block enters the frozen prefix on turn 2. |
| `hard-cap emergency still uses breakFrozen when context window overflows` | Safety valve: when `liveTokens > contextWindow`, `breakFrozen: true` commands ARE allowed (the only exception). |
| `rollover with new blocks past the frozen prefix targets only unfrozen blocks` | Two-turn test: initial blocks are grouped and frozen. Fresh blocks arrive. New groups target only fresh blocks. |

Additional coverage in `conductor.compaction-naive.test.ts`:

| Test | What it proves |
|---|---|
| `early rollover skips frozen-prefix blocks to preserve cache` | Early over-cap rollover does not group frozen blocks. |
| `does NOT restore folded blocks in the frozen prefix (cache stability)` | Folded frozen blocks are left untouched (replaced the old restore-assertion test). |

### Full conductor suite

```bash
cd extensions/accordion/app
npx vitest run conductor
```

Runs all 414 conductor tests across all conductor implementations. Confirms
the frozen-prefix changes don't break existing rollover, grouping, pressure,
or emergency behavior.

### What a failure looks like

If the invariant breaks, the flip-flop manifests as:

1. Blocks fold on turn N
2. Blocks unfold (restore) on turn N+1 when they enter the frozen prefix
3. Different blocks fold on turn N+2 to compensate
4. The cycle repeats every turn

In tests, this shows up as `restore` commands or fold/replace commands
targeting blocks with `order < frozenFromIndex` (without `breakFrozen: true`).

## Implementation details

The fix lives entirely in `conductors/my-customize-conductor/my-customize-conductor.ts`:

- Deleted the restore phase that unfolded frozen-prefix blocks
- Clamped `rolloverFromIndex` to `Math.max(rolloverFromIndex, view.frozenFromIndex)`
- Added `order >= frozenFromIndex` guard to `replayPriorCommands` (replace branch), `planNormalPressure`, and `planFoldsToCap`
- Added `lastFrozenFromIndex` tracking to all three fast-path guards and all exit points

## Related features

- [Block digests](block-digests.md) (`ReplaceCommand` mechanism)
- [Conductor control](conductor-control.md) (budget slider, conductor switching)
- [Semantic digests & recall](semantic-digests-and-recall.md) (group digests)
