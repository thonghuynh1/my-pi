# 04 — How should group digests accumulate semantic sections?

Type: grilling
Status: open
Blocked by: 03

## Question

pi-vcc accumulates 5 semantic sections across compactions via `mergePrevious()`:
- `[Session Goal]` — first user intent + scope changes
- `[Files And Changes]` — aggregated file ops, deduped, capped at 10/category
- `[Commits]` — last 8 commits
- `[Outstanding Context]` — errors/blockers from last 20 blocks
- `[User Preferences]` — always/never/prefer patterns

Accordion's `groupDigest()` today produces: `"group · N blocks · turns X–Y · ~N tok · K replies, M results · "first ask""` — a one-liner.

**Should we adopt pi-vcc's section model for group digests?** Key questions:
- Which sections are useful for accordion's use case (agent context management vs session journaling)?
- How do sections accumulate when groups are re-grouped (group of groups)?
- Should the conductor build these sections (it sees the blocks pre-grouping) or should the digest layer?
- How to keep group digests compact enough to be useful (pi-vcc sections can grow large)?
