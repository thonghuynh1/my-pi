# Group-First Compaction — Journal

## Slice 1 — Replace all individual folds with group-only compaction

### What was built
- [Replace planFoldsToCap with group batching](issues/01-replace-planfoldstocap-with-group-batching.md): Built — `planFoldsToCap` replaced with overflow groups via `sliceCandidateRunsIntoGroups`, called at both post-rollover sites.
- [Remove individual folds from normal pressure](issues/02-remove-individual-folds-from-normal-pressure.md): Built — `planNormalPressure` now uses `sliceCandidateRunsIntoGroups` with `lifecycle: "rollover"` instead of transient group + individual folds.
- [Remove dead fold code](issues/03-remove-dead-fold-code.md): Built — `foldOrReplace` and `planFoldsToCap` deleted from codebase.

### What surprised us
- The review phase discovered that `sliceSegmentIntoGroups` needed a rename and rewrite to `sliceCandidateRunsIntoGroups` — the original assumed contiguous candidates, but in practice candidates can have non-contiguous gaps (held boundaries). The review commit preserved group boundaries by detecting runs and trimming partial turns at boundaries.

### What we learned
- Group boundaries matter: when candidates are non-contiguous (e.g., a held boundary splits them), each contiguous run must be grouped independently to avoid spanning across unrelated regions.
- The existing test suite caught the boundary case, leading to the review fix.
- `planNormalPressure` was listed as "out of scope" in the original map but was actually in-scope per decision 03. The map's out-of-scope section was inconsistent with the resolved decisions.

### Map updates
- Closed: [Single vs chunked groups](wayfinder/01-single-vs-chunked-groups.md) — confirmed by build: chunked ~15k groups via `sliceCandidateRunsIntoGroups`
- Closed: [Overflow group lifecycle](wayfinder/02-overflow-group-lifecycle.md) — confirmed by build: `lifecycle: "rollover"` used throughout
- Closed: [planNormalPressure scope](wayfinder/03-normal-pressure-scope.md) — confirmed by build: normal pressure also uses group-only path
- Closed: [trimOpenToolPairs handling](wayfinder/04-trim-open-tool-pairs.md) — confirmed by build: inherited from `createGroup` internals
- Closed: [Fallback strategy](wayfinder/05-fallback-strategy.md) — confirmed by build: no fallback, no individual folds remain
- Out of scope entry corrected: "Rewriting `planNormalPressure` to be purely group-based" was listed as out of scope but was actually delivered (per decision 03)
