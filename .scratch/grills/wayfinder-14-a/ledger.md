# Grill ledger — wayfinder ticket 14 (LLM necessity for group summaries)

Map: `.scratch/accordion-chunked-compaction/MAP.md`
Ticket: `.scratch/accordion-chunked-compaction/tickets/14-llm-necessity-for-group-summaries.md`
Type: `wayfinder:grilling` (HITL)

Blocks ticket 13. Spawned mid-grill of 13 when the human surfaced that the "does the MAP need an LLM at all?" question was prior to 13's D1/D2/D3.

## Grounding (verified before grill opens)

All file:line references are `F:/MyWork/my-pi/vendor/accordion/…` unless noted.

### G1 — The deterministic per-block path in `my-customize-conductor` is already rich

Per-block dispatch lives in `applyCandidate` at `conductors/my-customize-conductor/my-customize-conductor.ts:199-221`. Every candidate that passes the filter (`!held && !protected && !grouped`, `foldedTokens < tokens`, kind ∈ `FOLDABLE_KINDS = {"text","thinking","tool_result"}` per `score.ts:33-37`) is routed to one of four deterministic summary functions in `mcp-summary.ts`:

- **MCP results** (`toolName === "mcp"`) → `mcpSummary(result, call)` at `mcp-summary.ts:54`. Emits e.g.
  ```
  tool_result:mcp skill-pstack(name="principle-trust-the-linter")
  Label: Trust The Linter principle
  Full result preserved. Use recall({"codes":["a3f9bc"]}) , not unfold, before re-calling this exact MCP tool.
  ```
- **recall results** on pstack identity → `pstackRecallSummary(identity)` at `mcp-summary.ts:138`.
- **recall results** without identity → `genericRecallSummary(codes)` at `mcp-summary.ts:375`.
- **`read` / `grep` / `find` / `ls` / `subagent` results** → `toolResultSummary(result, call)` at `mcp-summary.ts:157`. For `read` this yields:
  ```
  tool_result:read path="~/proj/src/lib/engine/store.svelte.ts"
  Contains: export function groupDigest · export function groupDigestTokens
  Shape: 312 lines · ~4200 tok
  Full result preserved. Use recall({"codes":["a3f9bc"]}) for this prior read snapshot; re-read if the file may have changed.
  ```

Each is emitted as `{ kind: "replace", id, content: summary, recoverable: true }`. Anything else (unknown tool name, `text`, `thinking`) falls back to a plain fold with no summary text of its own.

### G2 — `host.complete()` is not currently called anywhere in `my-customize-conductor`

Grep across the conductor directory: **zero** matches for `host.complete`. The class exposes only `conduct()` — no `attach`/`detach` lifecycle, no `pendingSummaryHashes`, no `AbortController`. The conductor is fully synchronous today (`my-customize-conductor.ts:20+`). Ticket 14's claim confirmed.

### G3 — Groups today are emitted with **no digest field**; the engine supplies a structural default

Group emission at `my-customize-conductor.ts:255-261`:
```ts
groups.push({ kind: "group", ids: run.map((block) => block.id) });
```
No `digest` property. Cost estimated via `estimateDefaultGroupDigestCost(run)` at `my-customize-conductor.ts:48-65`, which reverse-engineers the char budget of the engine's default recap.

Protocol type at `conductor.ts:254-258`:
```ts
export interface GroupCommand {
    kind: "group";
    ids: string[];
    digest?: string | null;
}
```
Semantics at `conductor.ts:243-250`:
- `undefined` → engine's default recap (`groupDigest`) + `{#code FOLDED}` tag; byte-identical to today.
- `null` or `""` → DROP (no replacement in the wire).
- non-empty string → verbatim.

Engine default (`digest.ts:198`, invoked via `store.svelte.ts:745`) produces a structural recap of shape:
```
{#a3f9bc FOLDED} group · 8 blocks · turns 3–5 · ~4200 tok · 2 text, 3 tool_result, 3 tool_call · "fix the failing parser test"
```
Deterministic. Includes kind counts, turn range, token estimate, and the first user message in the run.

### G4 — MCP-result and recall-result blocks are **group boundaries** — they never land inside a group

`my-customize-conductor.ts:68-71` treats MCP results, recall results, and pstack-tagged blocks as boundaries; runs are broken there. Groups only form over runs of `text`, `thinking`, and non-MCP/non-recall `tool_result` blocks.

Concretely, what a group's members look like in a realistic session:
- assistant `text` and `thinking` blocks (which had **no** per-block deterministic replace — they plain-folded);
- `read` / `grep` / `find` / `ls` / `subagent` tool_results, each **already replaced** in the wire with a structured `toolResultSummary` snippet before the group forms;
- possibly some `tool_call` blocks (kind not in `FOLDABLE_KINDS` so no candidate treatment, but includable in a `group` `ids[]`).

The high-signal, "expensive to lose" blocks — MCP skill loads and prior recall snapshots — are architecturally excluded from group runs.

### G5 — MAP-side commitments that assume LLM broker (would need to move under α)

- **Destination bullet 2** (`MAP.md`): "When it exceeds threshold, a **broker LLM** summarizes it once into a new immutable group summary."
- **Ticket 06** (closed): "reuse `GroupCommand` with a **broker-produced digest string** + deterministic recovery-codes footer."
- **Ticket 04** (closed): D2 (`host.complete()` per-session in conductor), D3 (`broker latency` in `conductor/status`), D5 (per-session JSON write-through persistence explicitly because LLM calls are expensive enough to survive reconnect).
- **Ticket 13** (paused): D1/D2/D3 all presuppose the LLM.

## Decisions

### D1 — Do we need an LLM at all for group summaries?

status: **accepted — α (no LLM)**

Human picked α. Rationale (per grounding G1, G3, G4 above): the deterministic per-block path is already rich; MCP/recall boundaries exclude high-signal blocks from group runs by construction; the engine's default group digest is already structural; immutability is trivially honored when the digest is a pure function of the corpus. Adding an opportunistic LLM later remains a strict addition, not blocked by this decision.

**Applied to the map + tickets in the same turn:**

1. MAP Destination bullet 2 rewritten (drops "broker LLM"; states deterministic digest).
2. MAP standing preferences pruned: broker latency out of telemetry; per-session JSON write-through persistence replaced with "determinism (not persistence) provides byte-identical restore"; "cache the summary by content-hash" bullet dropped.
3. MAP Not yet specified: broker prompt-template details and D5 JSON persistence details removed; "exact composition rule for the deterministic digest body under α" added.
4. Ticket 03 amended with §α amendment: sync/async shape replaced with synchronous single-pass emission; `pendingRolloverHash` and failure/unavailability table dropped; trigger predicate, escape valve, min-savings gate stand.
5. Ticket 04 amended with §α amendment: D2 narrowed to deterministic, D3 narrowed (no broker latency, no failure surface), D5 dropped in full. D1/D4/D6 stand.
6. Ticket 06 amended with §α amendment: §1 narrowed to deterministic digest, §3 Layer 1 broker cache dropped; §2 (tail-append recall) and §4 (no protocol change) stand.
7. Ticket 13 closed as `wontfix` (superseded). Grill ledger wayfinder-13-a marked archived as historical.
8. Ticket 11 blocklist reduced (13, 14 removed).
9. Ticket 14 closed (this ticket). Frontier collapses from {03, 07, 14} to {05, 07} (03 was independently closed by another worker during this grill; 05 was unblocked when 03 closed).

### Downstream fallout per outcome (reference, kept for provenance)

| | α wins | β wins | γ wins |
|---|---|---|---|
| MAP Destination bullet 2 | rewrite (drop "broker LLM") | narrow ("optionally augmented by broker LLM") | unchanged |
| Ticket 04 (closed) | **re-open** — D2/D3/D5 all assume broker | scope narrows — LLM is opportunistic add-on | unchanged |
| Ticket 06 (closed) | **re-open** — "broker-produced digest" replaced with deterministic digest | scope narrows — companion-artifact contract added | unchanged |
| Ticket 13 (paused) | **close as superseded** — D1/D2/D3 evaporate | re-scope to "when opportunistic LLM runs, what shape / what fallback"; D1 recommendation (visible-wait) likely still holds; D2/D3 largely intact | resume as originally scoped |
| MAP standing prefs | prune broker-latency telemetry, prune per-session JSON write-through persistence, prune "cache the summary by content-hash of the pre-group so re-runs hit" | narrow (companion cache still deserves persistence) | unchanged |
| Ticket 11 (draft ADR-0004) | reflects α | reflects β | reflects γ |
| Ticket 12 (compile PRD) | reflects α | reflects β | reflects γ |

### What grounding shifts

G1 + G4 together are the load-bearing evidence: **the highest-signal pre-group content (MCP loads, recall snapshots, structured tool-churn) is already deterministically summarized before groups form.** The only content that lands inside a group with no per-block deterministic summary is assistant `text` and `thinking` — the "conversational reasoning" case that the ticket's framing itself names as the one where γ is warranted.

So the question collapses to: **in a realistic `my-customize-conductor` session, how much load-bearing information lives in assistant `text` / `thinking` runs between MCP/recall boundaries, such that the engine's structural default digest (G3: kind counts + turn range + first user message) is not enough post-rollover?**

- If the answer is "not much — the tool-churn `replace`s + recall reversibility carry the session": **α**.
- If the answer is "a lot — long design/debugging reasoning that the agent later needs to consult, and structural counts won't rescue it": **γ**.
- If the answer is "we don't know yet, and don't want to bet on it before we've watched the conductor run": **β**.

### Recommendation

**α**, tentatively. Reasons grounded above:

1. **G4** removes the strongest argument for LLM prose synthesis: the blocks worth synthesizing (MCP skill loads, prior recall snapshots) are already architectural group boundaries and stay in the wire uncompressed until aged out individually. The LLM would be summarizing the *leftover* — mostly runs of `text`/`thinking` interleaved with already-summarized tool-churn `replace`s.
2. **G1 + G3** show the deterministic path is already unusually rich for a conductor — every foldable tool_result gets identity-preserving structured summary, and the engine's default group digest carries kind counts + turn range + first user message. Concatenating the per-block `replace`s that already live in the run (or listing their ids/turns) as a "recovery-codes footer" gives an enriched deterministic group digest with zero new async machinery.
3. Standing preference "group summaries are **immutable** once written" is much easier to honor when the digest is a deterministic function of the corpus — the immutability wrinkle in ticket 13 D1 (a committed low-fidelity fallback would freeze forever) simply doesn't arise under α.
4. Reversibility is already covered by the standing preference "Preserve `recall` / unfold reversibility on every folded block" — assistant `text`/`thinking` inside a group is retrievable by id/turn without prose synthesis.
5. The cost of being wrong about α is **cheap to recover from later**: the group digest is deterministic today (ticket 06 D-recovery-codes-footer already contemplates a deterministic footer). Adding an opportunistic LLM later is a strict addition, not a retraction. β can graduate out of α on evidence.

**β** is the honest hedge if the human wants to preserve optionality without committing to the machinery immediately. It costs a "companion artifact" store surface that lives outside the immutable group — non-trivial but bounded.

**γ** is only warranted if the human has a specific belief that assistant reasoning content in the pre-group is load-bearing in a way structural digest + `recall` reversibility cannot rescue, AND that belief is worth the machinery cost (async `host.complete`, `pendingSummaryHashes` dedup, `groupSummaryCache`, per-session JSON persistence, D1-style failure surface).

## Session status

**Closed** — D1 accepted α, all fallout applied in the same turn. See ticket 14 resolution section for the consequences summary.

## Open sub-questions to raise after ticket-close

Under α, the enriched-deterministic-digest shape (concatenation vs recovery-codes footer vs both) is a downstream implementation detail for ticket 11 (ADR-0004 draft) and lives in the PRD, not this map.
