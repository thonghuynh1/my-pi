# Implementation checkpoint

User confirmed design and explicitly requested implementation now without PRD/issues. This supersedes the planning-only session constraint for this effort. No PRD or issues will be generated.

## Todo
- [x] Read Poteto Principles in full; apply Model the Domain to normalized quota/credit snapshots and Smallest Safe Change to reuse footer, native child processes and installed CLI tools, no dependencies.
- [x] Ground. Existing usageFooter -> installUsageFooter -> render; session/subagent accounting in getTokenTotals; managed commands through createManagedExtension. Public Pi docs, tui and custom-footer example read.
- [x] Sketch. design.md defines producer readers -> monitor cache -> existing footer and details, injected process/time seams, no competing footer or token copying.
- [x] Agree. User confirmed full design including defaults, chose implementation without PRD.
- [x] Implement. Single feature owner wrote runtime + tests; parent reviewed.
- [x] Scrap. n/a; live runtime evidence confirmed accepted module shape.
- [x] Verify. bg-3 passed 48 targeted node:test cases, npm run check, all three live production readers. Isolated actual Pi TUI footer/details/close/off/on driven and captured.
- [x] Review diff. No blocking findings, no PRD/issues, commits, push or PR. One narration comment removed after tests; no behavior changed.

## Throughput checkpoint
- Blocking first steps. Design, real provider probes, lifecycle API and current footer evidence already verified before implementation.
- Independent workstreams. n/a for code writing; adapters, monitor, footer and tests share a data contract. Parent can independently prepare CLI verification.
- Shared mutable state. One implementation owner owns feature files; parent owns planning artifacts and final verification. No concurrent writes to implementation files.
- Smallest safe decomposition. One writer for this compact coupled feature, with parent integration/review. No new dependencies or generic provider plugin framework.

## Named data shape
Normalized provider records with discriminated metric kind quota vs credits. Quota groups each own windows (window label/id, finite usedPercent and optional reset); credits carry consumed credits only. Per-provider monitor status/loading + optional last successful snapshot enables stale failure without fabricated zero. Registry of exactly three readers, injected process runner/time for tests. No user credentials in state.
