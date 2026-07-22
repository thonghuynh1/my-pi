---
labels: wayfinder:research
status: done
ticket: 09-read-accordion-adrs
map: ../MAP.md
sources:
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0007-conductor-protocol.md
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0008-conductor-first-party-one-view.md
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0010-attention-conductor.md
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0016-code-skeleton-conductor.md
  - F:/MyWork/my-pi/extensions/accordion/docs/conductor-protocol.md
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0011-conductor-involvement-locks.md (skimmed)
  - F:/MyWork/my-pi/extensions/accordion/docs/adr/0013-conductor-host-capabilities.md (skimmed)
---

# ADR findings — protocol + cache rationale

## ADR 0007 — `conduct(view) → Command[]`

**Digest:**
- Single pure function contract. `Command[]` = complete desired state (host resets then applies); `[]` = clear all; `null` = **hold** (reuse last batch).
- Commands are **content-substitution only** — no structural removal, except `group(digest: null)` DROP (pair-balanced).
- Host floor = provider-validity only. Everything else is conductor strategy. Host clamps and returns `ClampReport`.
- Human GUI overrides always win. `held: true` refused. `group` over held block = wholesale refused.
- Groups are **contiguous-only**, snap outward to whole messages.

**Constraints on chunked compaction:**
- Full batch re-sent every `conduct()` call — re-emit all group summaries + all pre-group folds every time.
- Pre-group must be contiguous; if it straddles a held block, split around it.
- Async broker LLM must return `null` while in flight; only emit commands once cached.
- `tool_call` blocks never foldable (`not-foldable` clamp). Group boundaries must keep each `tool_call` with its `tool_result`.
- Handle `ClampReport` gracefully (`human-override`, `grouped`, `unknown-id`, `invalid-group`).

**Primitives to reuse:**
- `fold { ids, digest? }` — explicit digest = broker summary text as fold label.
- `group { ids, digest }` — non-null digest = summary substitution (reversible); null = DROP (irreversible).
- `replace { id, content, recoverable?: true }` — engine-owned `{#code FOLDED}` tag.
- `null` return = hold mechanism.

## ADR 0008 — first-party conductors; one public ViewBlock

**Digest:**
- Drops "untrusted 3rd party" framing. Clamps = bug/UX guardrails, not security.
- One input surface: `ConductorView` (budget, contextWindow, liveTokens, protectedFromIndex, protectTokens, blocks).
- `ViewBlock` booleans (`held`, `folded`, `protected`, `grouped`) fold host policy into flags. Precomputes `foldedTokens`. Adds `messageKey` for boundary alignment, `callId` for pair integrity.
- Built-in relocated to `conductors/builtin/`; `id === "builtin"` special-case removed.
- In-process TS class = primary path; WebSocket = explicit escape hatch.

**Constraints on chunked compaction:**
- Use `ViewBlock.tokens` + `foldedTokens` for pre-group accounting (no engine internals).
- `grouped: true` blocks refuse individual fold/replace → `grouped` clamp. Track own group set and exclude.
- `protected: true` = protected tail, never touch.
- Group commands snap to whole messages via `messageKey`; align pre-group boundaries or expect sweep-in.
- `contextWindow` may be null; fall back to `budget`.

**Primitives to reuse:**
- `ViewBlock.foldedTokens` — precomputed cost-if-folded, no `countTokens` needed for budget projection.
- `ViewBlock.messageKey` — align pre-group start/end to message transitions.
- `ViewBlock.callId` — walk tool_call + tool_result pairs together.
- `ViewBlock.turn` + `order` — chronological oldest-first.

## ADR 0010 — Attention conductor: epoch-based, cache-preserving

**Digest:**
- **Hysteresis band [70%, 90%] of contextWindow**: below 90% → hold (send nothing); at/above 90% → epoch (fold lowest-attention until ≤70%). **One deliberate cache miss per epoch.**
- Fullness computed from `blocks[].tokens/foldedTokens` against the conductor's own `appliedFoldSet` — NOT `view.liveTokens` (which is the cleared baseline due to reset-then-apply).
- **Fold set is monotonic within a session**: only grows at epochs. Blocks pruned only if they vanish or become held/grouped/protected. Maximum prefix stability.
- Background probe (Qwen2.5-0.5B) decoupled via async spawn + `scoringInFlight` guard. Graceful degradation to FOLD_RANK.
- Agent self-unfolds via `host/event "agentUnfold"` permanently exclude from candidates (`respectLive` Set).

**Constraints on chunked compaction (this ADR is the closest precedent):**
- **Cache invalidation at most once per rollover** — the rollover IS the epoch. Between rollovers return `null` or re-emit identical batch. Any change to applied set = cache miss.
- **Self-account for applied folds** — `view.liveTokens` is cleared baseline. Compute fill %/rollover trigger from per-block data against own applied GroupSummary set.
- Monotonic group summaries = no re-summarization (matches MAP.md "immutable once written").
- New blocks appending to pre-group between rollovers must update internal fill tracking without issuing new commands.
- Broker LLM latency (~seconds) analogous to probe (~8-18 s). Same decoupling: async fire, `null` while in-flight, emit after `requestRerun()`.
- After rollover, reset pre-group fill accumulation from zero.

**Primitives to reuse:**
- Send-nothing = hold mechanism (free inter-rollover cache stability).
- `renderedTokens()` pattern — compute from per-block data against own applied fold set.
- `foldCandidates()` filter (`held`, `protected`, `grouped`, `foldedTokens >= tokens`).
- `host/event "agentUnfold"` tracking → exclude from sweeps.
- Monotonic `appliedFoldSet: Set<string>` as core data structure.
- Graceful degradation: broker unavailable → fall back to kind-rank + age (FOLD_RANK).
- `policy.mjs` separation — pure logic (decideFolds, renderedTokens, foldCandidates), no I/O, unit-testable.

## ADR 0016 — Code-skeleton: deterministic, precision-gated, cache-warm

**Digest:**
- New `ReplaceCommand.recoverable?: boolean` — when true, engine bakes `{#code FOLDED}` tag. **Engine is sole author** — conductors must NOT re-implement.
- Precision-first, reject-biased classification. False positives are destructive; false negatives merely missed opportunities.
- Skeletonizer is byte-identical for same input → substituted prefix stable across passes → KV cache never invalidated by content variation. **The direct cache-warmth mechanism.**
- Three-pass budget discipline: (1) preferred/structural pass, (2) generic fallback, (3) downgrade oldest skeletons to plain digests.
- Only `tool_result` eligible; `tool_call` never foldable (orphan risk). Memo skeletons per block-id.

**Constraints on chunked compaction:**
- **Determinism = cache stability prerequisite.** Broker LLM output is non-deterministic → MUST cache broker summaries by content-hash of the pre-group token sequence so same input → same summary → same frozen prefix bytes → no additional cache misses on re-passes.
- Use `replace + recoverable: true` OR `group(digest: <text>)` for reversibility (MAP.md standing preference).
- **Never use `group(digest: null)` DROP** for group summaries — irreversible.
- `host.countTokens(text)` is synchronous, `conduct()`-safe — use for summary sizing.
- `host.digestOf(id)` returns engine's per-kind digest — fallback when broker unavailable.
- Precision-first: only genuine compaction candidates in pre-group (not too small, not already thin, not tool_call).
- `tool_call` writes have no conductor-accessible fold path — account for them as non-foldable floor cost.

**Primitives to reuse:**
- `ReplaceCommand.recoverable: true`.
- `host.countTokens(text)`, `host.digestOf(id)`, `host.setStatus(text, metrics, details)`.
- `host.can("complete")` gate + `host.complete(req)` + `requestRerun()` + `null`-hold = in-process async broker LLM pattern.
- Three-pass budget discipline adapted: (1) rollover eligible via broker, (2) fold remaining via engine digest, (3) downgrade oldest group summaries if still over.
- Content-hash memo (not block-id — blocks can grow before rollover).

## `conductor-protocol.md` additions

- `CONDUCTOR_PROTOCOL_VERSION = 3` (bumped by ADR 0011).
- `group(digest: null | "")` = DROP: irreversible, pair-balanced. **Do not use for recoverable summaries.**
- `host/event` carries block ids (correlate against `ViewBlock.id`).
- `cap/request` capabilities: `summarize`, `countTokens`, `getContent`, `getDigest`, `complete`. `complete` requires `"complete"` in `HostCapabilityId` and gated by `host.can("complete")`.
- `wants.content: "onDemand"` + `getContent` — fetch per-block, avoid sending all text over wire.
- `conductor/status` — display-only telemetry. Emit pre-group fill %, rollover state, broker latency here.
- Involvement locks (ADR 0011): `human-steering`, `agent-unfold`, `tail-size`. For v1 stay collaborative (no locks).
- `AbortSignal` on `host.complete()` — pass a controller, abort from `detach()` to prevent stale summaries.

## Combined: Hard Constraints

1. Full-state batch on every `conduct()` call — no diffing.
2. Content substitution only; DROP is irreversible — use `group(digest: <text>)` with non-null string for recoverable summaries.
3. Contiguous groups only, message-boundary aligned via `messageKey`.
4. Never fold `tool_call`; keep each with its `tool_result`.
5. Human-held blocks off-limits.
6. Between rollovers, send nothing or identical batch — every change = KV miss.
7. Self-account for applied fold state — `view.liveTokens` is the cleared baseline.
8. Broker LLM must be async; `conduct()` synchronous; `null` while in flight.
9. Cache broker summaries by content-hash of pre-group.
10. `host.can("complete")` gate before broker; graceful fallback to engine `digestOf()`.
11. Protected tail off-limits (`protected: true`).
12. Recoverable summaries required by MAP.md standing pref.

## Combined: Free Levers

1. Rollover threshold (absolute tokens, %, or knob).
2. Broker prompt template + system message.
3. Which blocks enter the pre-group (conductor concept).
4. Summary text format (markdown, structured, whatever).
5. Fallback fold order.
6. `conductor/status` telemetry content.
7. In-process vs out-of-process architecture.
8. Involvement locks (opt-in).
9. `wants.content` mode.
10. Level-2 rollover (summary-of-summaries) — MAP defers to follow-up.
11. Session persistence of group summaries — MAP marks as fog.
12. Pre-group minimum block count.
