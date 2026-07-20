---
labels: wayfinder:task
status: done
ticket: 10-roadmap-hierarchical-note
map: ../MAP.md
---

# Findings: Prior design work on hierarchical / multi-level group summaries

**Verdict:** **Prior design work exists — substantial, named, partially implemented.** The concept we call "chunked compaction" maps onto accordion's already-designed **Milestone C4 "The Archivist"** (nested groups / eras) sitting on top of the flat **Milestone C2.5 "Auto-Coalesce"** layer.

## Direct references

| Source | Line(s) | Nature |
|---|---|---|
| `F:/MyWork/my-pi/vendor/accordion/VISION.md` | 100–102 | **"Folding the folds"** — north-star spec: nested groups, episode→era tree, level-by-level unfold |
| `F:/MyWork/my-pi/vendor/accordion/README.md` | 119, 128–130 | Roadmap checklist item `[ ] Hierarchical folding for million-turn sessions` |
| `F:/MyWork/my-pi/vendor/accordion/conductors/README.md` | 235–237 | Auto-coalesce (flat C1.5) prerequisite; message-boundary alignment + straggler-cost modelling required |
| `F:/MyWork/my-pi/vendor/accordion/docs/conductor-plan.md` | ~296–349 | **Milestone C2.5 Auto-Coalesce** — flat precursor; `groupSummary()` already at `app/src/lib/engine/store.svelte.ts:1546` |
| `F:/MyWork/my-pi/vendor/accordion/docs/conductor-plan.md` | ~493–600 | **Milestone C4 The Archivist** — full design: wire stays flat, engine tree, summaries-of-summaries, exit criteria (1M-token synthetic session held under 150k budget as 3-level tree, any leaf recoverable byte-identical) |
| `F:/MyWork/my-pi/vendor/accordion/docs/conductor-rework-roadmap.md` | 180–231 | C4 data model (`Group.children`, `groupEraDigest`, `findEraRuns`, `ancestorChain`), recoverable code in git branch `claude/busy-bose-bd815d:app/src/lib/engine/coalesce.ts`, **open contract question**: add `era` command vs host-automatic promotion |
| `F:/MyWork/my-pi/vendor/accordion/docs/adr/0006-multiblock-folds.md` | 205 | Explicit exclusion: "No nested groups (folders-in-folders) this cut." |
| `F:/MyWork/my-pi/vendor/accordion/docs/adr/0007-conductor-protocol.md` | 30 | "A hierarchical compactor" named among original motivations for the conductor contract |
| `F:/MyWork/my-pi/vendor/accordion/docs/adr/0009-cold-score-conductor.md` | 38, 156 | "Auto-coalesce intentionally deferred" |

## Milestone sequencing (from conductor-plan.md 86–91)

| Milestone | Name | Feature | Gates |
|---|---|---|---|
| C1 | Cold-Score | Deterministic fold policy | — |
| C2 | Summarizer | LLM summaries cached | — |
| C2.5 | Auto-Coalesce | Flat conductor-built groups | C1+C2 |
| C3 | Attentive | Between-turn relevance LLM | C1+C2 |
| **C4** | **Archivist** | **Nested groups, era hierarchy** | **C2.5 (+C3)** |
| C5 | Second Agent | Headless runtime, benchmark | C3+C4 |

## Key quotes worth citing

From `docs/conductor-plan.md` §C4:

> "The wire stays flat — that's the key simplification. ADR 0006 already collapses a contiguous range of whole messages into one synthetic summary message (`GroupOp` with leaf `memberIds`). A nested group's wire form is just a `GroupOp` whose `memberIds` are the union of its descendants' leaf block ids. Nesting is a GUI/engine concept; the extension and protocol need little or nothing new."

> "Summaries-of-summaries. A group's recap is one cheap call over its members' already-cached summaries (C2's cache makes this near-free); cached under the same content-addressed scheme (key = hash of child summary hashes), so reorganizing the tree never recomputes leaves."

From `docs/conductor-rework-roadmap.md` §C4 (**open contract question**):

> "The current `Command` union has no vocabulary for nested groups. `group` collapses a flat contiguous run; there is no `era` or `nest` command. Two options:
> - Add `era` to the `Command` union. Protocol bump to `CONDUCTOR_PROTOCOL_VERSION = 3`.
> - Make era formation host-automatic. Host promotes long-lived conductor groups to eras after a threshold. No contract change. Less flexible."

## Patterns with no hits

`pre.?group`, `chunked.*(compact|summary)`, `l2.?summary`, and `broker` (only unrelated accordion-broker multi-session dashboard).

## What this means for our map

1. **Not a clean slate** — link chunked-compaction tickets to `conductor-plan.md` C2.5+C4 and `conductor-rework-roadmap.md` C4.
2. **The open contract question is the key design gate** — the answer likely determines whether ticket 06 (group representation) needs a protocol change or can stay conductor-internal.
3. **Recoverable code exists** on `claude/busy-bose-bd815d:app/src/lib/engine/coalesce.ts` (`findCoalesceRuns`, `findEraRuns`, `ancestorChain`). Ticket 04 or an implementation ticket should port these rather than rewrite.
4. **`groupSummary()` at `store.svelte.ts:1546`** is the existing flat implementation to build atop.
5. **Vocabulary alignment**: use accordion's terms — "coalesce", "era", "episode", "Archivist" — rather than inventing "chunked" / "pre-group" / "broker" ex nihilo. Consider retitling MAP.md and tickets to align.
