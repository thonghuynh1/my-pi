---
status: ready-for-agent
map: .scratch/accordion-chunked-compaction/MAP.md
adr: docs/adr/0004-accordion-chunked-compaction.md
---

# PRD — Accordion chunked compaction (four-zone context layout)

## Problem Statement

Long-running Pi sessions using `MyCustomizeConductor` accumulate conversational turns (assistant messages, MCP tool_results, pstack recalls) in the frozen prefix as they age. Once the frozen prefix has grown to cover the bulk of the context window, ADR-0003 ([Proactive Content Compression](../../docs/adr/0003-proactive-content-compression.md)) has already collapsed the compressible tool_results (its A1 exemption list — MCP and recall results — being deliberately preserved), and the [Frozen-Prefix Deadlock](../../CONTEXT.md#frozen-prefix-deadlock) reasserts itself for the remaining conversational bulk on models with 128 k–200 k context windows.

Two failure modes must be avoided by any fix:

1. **KV-cache thrash.** Providers cache on prefix identity; any change to an already-sent block forces re-tokenisation of everything after it. A naive summariser that overwrites the prefix on every turn is worse than doing nothing.
2. **Non-determinism on reconnect.** If the summary text differs across reconnect (LLM sampling, model version drift, cache miss), the frozen prefix diverges byte-for-byte and every downstream cache lookup misses.

Affected actors:

- **Developers running long Pi sessions** on models with `contextWindow ≥ 128 000` — the direct beneficiaries of freeing the aged conversational bulk.
- **Dashboard viewers** watching a session — must see chunked-compaction groups render alongside existing groups without a protocol bump.
- **Downstream implementers** consuming this PRD — must be able to verify every claim (especially the "≤ 1 KV-cache-prefix break per rollover" invariant) with a test, without any code shipped from the parent map.

## Solution

`MyCustomizeConductor` will render every `ConductorView` as four ordered zones — **System + tool defs | Immutable Group Summaries | Pre-Group (raw) | Protected Tail (raw)** — and periodically roll the oldest slice of the Pre-Group into a single new immutable **group summary**. The group summary is a **deterministic pure function of the pre-group corpus**, computed synchronously in the same `conduct()` pass that fires the trigger. Reload re-emits byte-identical `GroupCommand`s without any cache or persistence file. KV-cache prefix invalidation happens **at most once per rollover**, never per message; the Protected Tail is never rewritten; older group summaries are never regenerated. The wire form is unchanged: `GroupCommand`, `ConductorView`, `ContextUpdateMessage`, and `CONDUCTOR_PROTOCOL_VERSION` are all untouched. One additive engine change (a `substOne` frozen-region clamp bypass for `group` with non-null digest) is the sole load-bearing engine tweak; a second additive engine change (fold-code resolver policy branch for group-member codes → tail-append) preserves per-member `recall` reversibility without invalidating the frozen prefix.

## User Stories

1. As a developer running a long Pi session on a model with `contextWindow ≥ 128 000`, I want aged pre-group messages to be rolled into an immutable group summary when the pre-group crosses ~15 000 tokens on a safe boundary, so that my session does not hit the context ceiling and the KV cache stays warm across turns.
2. As a dashboard viewer, I want chunked-compaction groups to render as normal group tiles carrying a recognisable `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩` header, so that I can identify what happened without any protocol change on the wire.
3. As a developer inspecting a historical detail, I want to `recall(<code>)` a specific group-member block into the Protected Tail without invalidating the frozen prefix, so that I can inspect original content without paying a KV-cache-break cost.
4. As an operator or downstream implementer inspecting session diagnostics, I want the extension to emit rollover events and metrics (both `conductor/status` live telemetry and per-turn JSONL records), so that I can verify the "≤ 1 KV-cache-prefix break per rollover" invariant with a static one-line grep on the JSONL log.
5. As a developer running a session on a model with `contextWindow < 128 000` or `null`, I want chunked compaction to be inert, so that the small-context fallback behaves exactly as it does today.

## Walking Skeleton

**`US-001`** — end-to-end rollover on a 200 k session.

Acceptance criterion: a real `MyCustomizeConductor` instance, driven by a synthesised `ConductorView` whose `blocks` accumulate past `preGroupTokens = 15 000` on a turn boundary with no open tool-call/tool-result pair straddling the pre-group / tail edge, emits **exactly one** `GroupCommand` whose `ids` are the pre-group's `ViewBlock.id`s and whose `digest` is a non-empty string beginning with the `⟨chunked-compaction ·` header prefix and ending with a `Members: {#code} …` footer. The engine's `substOne` accepts the group substitution across the frozen boundary (per `RB-003`), the immediate next `conduct()` pass emits **no** further `GroupCommand`, and re-running the same pass against the same corpus (deterministic replay) emits a `GroupCommand` with a **byte-identical** `digest` string. The full user-visible flow runs via real wiring: extension observes the group via its existing `applyPlan(originalMessages, plan.ops, plan.groups)` call site in `accordion.ts`, and the per-turn JSONL gains one `chunkedCompaction` block per `RB-006`.

## Required Behaviors

- **`RB-001`**: No changes to `ConductorView`, `ContextUpdateMessage`, `docs/conductor-protocol.md`, the `Command` union, `GroupCommand`'s field set, or `CONDUCTOR_PROTOCOL_VERSION` (currently `= 3` per `F:/MyWork/my-pi/vendor/accordion/conductors/contract/protocol.ts:32`). Any diff touching these files is a defect.
- **`RB-002`**: For every `GroupCommand` emitted by `MyCustomizeConductor` under chunked compaction, every `callId` referenced by any block in `group.ids` has both halves of its pair present in `group.ids` (or neither). Enforced by the pre-emit trim in `DEC-011`; verified by the property test in `## Testing Decisions`.
- **`RB-003`**: The engine's frozen-region clamp for `group` substitutions (currently at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1174–1176`, inside `groupCmd`) is bypassed **when and only when** the substitution's `kind === "group" && digest !== null && digest !== ""`. `FoldCommand`, `ReplaceCommand` (both routed through `substOne`), and `group` commands with `digest: null` or `digest: ""` (DROP) remain clamped exactly as today. No `breakFrozen` flag is added.
- **`RB-004`**: Emitted group summaries are immutable — no re-summarising a prior group; no re-computing an existing digest under a new corpus. `GroupCommand` with `digest: null` (DROP) is never emitted by chunked compaction under any code path.
- **`RB-005`**: On reconnect / reload, `MyCustomizeConductor` re-reads raw blocks, re-derives the pre-group corpus, and re-emits `GroupCommand`s with **byte-identical** `digest` text on identical input. No cache file, no persistence, no per-session JSON write-through. The content-hash embedded in the digest header IS the group's stable identity.
- **`RB-006`**: On rollover turns only, `accordion.ts` appends one `chunkedCompaction` block to the per-turn JSONL (existing writer: `writeContextDiagnostic()` at `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts` ~line 368) using the shape in `DEC-016`. On non-rollover turns the field is absent.
- **`RB-007`**: On every `conduct()` pass, `MyCustomizeConductor` emits one `conductor/status` frame with the payload shape in `DEC-016`. Requires a new `attach(host)` implementation on the conductor (currently absent — verified NOT IMPLEMENTED).
- **`RB-008`**: Chunked compaction is **inert** when `view.contextWindow < 128 000` or `null` — `effectivePreGroupTokens(view)` returns `0`, the walk-back returns an empty range, the trigger never fires, no `chunkedCompaction` JSONL block is written, and `conductor/status.metrics.rolloverCount` stays at `0` for the life of the session.
- **`RB-009`**: Unfolding a group-member fold code (either agent `recall` or human GUI unfold) appends the original member content into the Protected Tail as a synthesised `recall(<code>)` `tool_call` / `tool_result` pair. The group summary block and the frozen prefix are **not** mutated. Repeated recalls of the same code produce repeated tail entries (no deduplication).
- **`RB-010`** (verification invariant, normative): in a stable-provider scripted session where chunked compaction is the only operation that rewrites provider-visible messages, let `prefixRewrite = cacheTracker.previousMessageCount > 0 && cacheTracker.matchedPrefix < cacheTracker.previousMessageCount` and `cacheBreak = cacheTracker.reason == "cold-start" || prefixRewrite`. Then `count(chunkedCompaction.event == "rollover") == count(cacheBreak) − coldStartCount`, with `coldStartCount ≤ 1`. Older chunked groups repeated in later full plans must not author another rollover record.

## Accepted Decision Register

### `DEC-001` — Four-zone layout is a rendering of existing wire state

- **Decision**: Every `ConductorView` decomposes into four ordered zones — System + tool defs (`view.harnessOverhead`), Immutable Group Summaries (contiguous prefix of `view.blocks` with `grouped: true` after `frozenFromIndex`), Pre-Group (raw; conductor-internal derived index `[preGroupFromIndex .. protectedFromIndex − 1]`), Protected Tail (raw; `view.blocks[protectedFromIndex ..]`).
- **Rationale**: The wire fields the protocol already exposes (`ViewBlock.grouped`, `view.protectedFromIndex`, `view.frozenFromIndex`, `view.harnessOverhead`) are sufficient to describe every zone; the pre-group is a pure derivation from `protectedFromIndex` and the groupability predicate.
- **Rejected alternatives**: Adding a `preGroupFromIndex` field to `ConductorView` (forces a protocol bump for no wire-state gain); a new `pregroup` block flag (same rejection).
- **Downstream impact**: No changes to `docs/conductor-protocol.md`, `ConductorView`, `ContextUpdateMessage`, or `CONDUCTOR_PROTOCOL_VERSION`. Implementers must not add wire fields for pre-group state.
- **Depends on**: None.
- **Decided implementation**: `MyCustomizeConductor` computes `preGroupFromIndex` internally per pass; no state is stored on the wire.
- **Left to the implementer**: Whether the derivation caches within a single `conduct()` pass or recomputes for each downstream consumer (both correct).

### `DEC-002` — Pre-group sizing and walk-back algorithm

- **Decision**: `preGroupTokens` default = `15 000`; `PRE_GROUP_OVERFLOW_CAP` = `1.25` (hard ceiling = `18 750` tokens). Walk-back mirrors the protected-tail algorithm at `F:/MyWork/my-pi/vendor/accordion/extension/store.svelte.ts:824–847`: start at `view.blocks[protectedFromIndex − 1]`, always include that block, walk backwards summing `ViewBlock.tokens`, stop when `sum >= target` or the next block would push `sum > target × 1.25` or the next block fails the groupability predicate (`DEC-003`). `preGroupTokens = 0` disables chunked compaction (same convention as `protectTokens = 0`).
- **Rationale**: Symmetric with the existing protected-tail sizing (3:4 ratio between pre-group and tail). Reusing the vendor's walk-back shape means no new algorithm to test; the 1.25 overflow cap mirrors an already-proven guard against one huge boundary block inflating a zone.
- **Rejected alternatives**: Bisection walk-back (no test coverage in the vendor's protected-tail code path); block-count-based sizing (pre-group tokens is the dimension we're bounded by, not blocks).
- **Downstream impact**: `preGroupTokens` becomes a `MyCustomizeConductor` constructor option; the walk-back function must be a pure derivation.
- **Depends on**: `DEC-003`.
- **Decided implementation**: `effectivePreGroupTokens(view, opts)` returns `0` when `view.contextWindow < 128_000` or `null` (per `DEC-004`) and the constructor option otherwise; a `computePreGroupFromIndex(view, target)` pure function performs the walk-back.
- **Left to the implementer**: Function names and file placement of the walk-back helper.

### `DEC-003` — Groupability predicate

- **Decision**: A block is groupable iff `!grouped && !held && !proactivelyCompressed`. Walk-back terminates at any block failing any of these three checks.
- **Rationale**: `grouped` blocks are already inside a prior immutable group; `held` blocks (involvement locks per vendor ADR-0011) must not be swept; `proactivelyCompressed` blocks are protected by ADR-0003 and the A1 exemption list (MCP + recall results whose full content carries operational meaning). This predicate makes MCP results and recall results **architectural group boundaries** — the blocks that would most benefit from LLM prose synthesis are structurally excluded from the pre-group by construction, not by policy. This is the load-bearing structural fact underlying `DEC-019` (no LLM).
- **Rejected alternatives**: A more permissive predicate that permits `proactivelyCompressed` blocks in the pre-group (violates ADR-0003's contract and produces meaningless double-compression); a per-block override list (`!grouped && !held && !proactivelyCompressed` already exhausts the axes that matter).
- **Downstream impact**: The predicate is consulted twice — inside the walk-back (`DEC-002`) and inside `noOpenToolPairAcrossPreGroupTail` (`DEC-005`). It also affects the `unfold` policy branch in `DEC-009`: whether tail-appended `recall` results carry a `proactivelyCompressed` marker to prevent re-grouping is a reversible local choice for the implementer (see `## Unresolved Gaps`).
- **Depends on**: None.
- **Decided implementation**: Single boolean predicate on `ViewBlock`; consumed by walk-back and predicate helpers.
- **Left to the implementer**: The exact spelling of the field references — implementer must verify the current source of truth against `F:/MyWork/my-pi/vendor/accordion/extension/proactive-compress.ts`.

### `DEC-004` — Small-context-window gate

- **Decision**: Chunked compaction is inert when `view.contextWindow < 128 000` or `null`. `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000` is a constants-file export, not a user setting; there is no UI control.
- **Rationale**: On sub-128 k models, the pre-group budget (`15 000`) plus the protected-tail budget (`20 000`) plus system/tools overhead consumes most or all of the window before any grouping benefit accrues; the pre-existing frozen-grouping pressure valve at `live > hardCap` already handles those sessions.
- **Rejected alternatives**: A soft warning without inert behaviour (user-experience regression on small-context sessions); a `128k` threshold tuned per-provider (the value dominates on every provider by construction).
- **Downstream impact**: Test seam requires three cases (`RB-008`): `contextWindow = 200 000` fires; `contextWindow = 32 000` inert; `contextWindow = null` inert.
- **Depends on**: `DEC-002`.
- **Decided implementation**: `effectivePreGroupTokens(view, opts)` returns `0` when the gate fails; the whole path short-circuits.
- **Left to the implementer**: Whether the gate lives inside `effectivePreGroupTokens` or one level up in the trigger predicate (both preserve `RB-008`).

### `DEC-005` — Two-tier hybrid rollover trigger; synchronous single-pass emission

- **Decision**: Fast path fires when `preGroupTokens ≥ 15 000 && preGroupEndsOnTurnBoundary && noOpenToolPairAcrossPreGroupTail && estimatedGroupSaving ≥ max(2 000, 0.05 × cap)`. Escape valve fires when `preGroupTokens > 18 750` and force-aligns backwards to the nearest safe boundary. In both paths, emission is **synchronous** in the same `conduct()` pass — one `GroupCommand` is added to the return value; there is no `host.complete()`, no `host.requestRerun()`, no `pendingRolloverHash`, no async broker, no cache lookup.
- **Rationale**: Turn-boundary alignment and tool-pair integrity are folded **into** the predicate (no separate hold mechanism), so the "≤ 1 KV-cache-prefix break per rollover" invariant (`RB-003` × `RB-010`) is preserved trivially by single-emission. The synchronous shape drops the `pendingSummaryHashes` map, the `SummaryProvider` async re-plan flow, the AbortController plumbing, and every failure branch — because there is no async operation to fail.
- **Rejected alternatives**: The γ shape (async LLM broker with `host.complete()` and `onSummary` re-plan) — rejected on ticket 14 (`DEC-019`); the β shape (deterministic-first + opportunistic LLM upgrade) — rejected on ticket 14: opportunism requires overwriting an already-emitted digest, which either invalidates the frozen prefix or produces text the frozen prefix does not contain.
- **Downstream impact**: `MyCustomizeConductor.conduct()` gains one predicate check and one `GroupCommand` emission path per pass. `availableCap(view)` is the function that supplies `cap`. Force-alignment shares the same tool-pair invariant as the fast path (`DEC-011`).
- **Depends on**: `DEC-011`, `DEC-006`, `DEC-019`.
- **Decided implementation**: One synchronous branch inside `conduct()`; no state machine.
- **Left to the implementer**: The exact walk-back-vs-bisection algorithm for the escape-valve force-alignment (both correct as long as they consume the same `noOpenToolPairAcrossPreGroupTail` invariant).

### `DEC-006` — Min-savings gate inherits `max(2 000, 0.05 × cap)`; no new formula

- **Decision**: The min-savings gate `estimatedGroupSaving ≥ max(2 000, 0.05 × cap)` is inherited unchanged from `MyCustomizeConductor`'s pre-existing frozen-grouping gate (verified at `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:233` — currently inline literal `Math.max(2_000, 0.05 * cap)`). No new tunable, no new formula, no per-provider tuning.
- **Rationale**: The one-time KV-cache-prefix break at rollover time costs ≤ ~2 000 tokens against the ~10× cache-miss premium the vendor's ADR-0010 attention-conductor analysis established on the tail. The 2 000-token floor dominates the penalty on any conversation with ≥ 1 subsequent turn; the 5 % of cap upper bound scales gracefully to larger windows.
- **Rejected alternatives**: The "expected_future_requests × tokens_saved > digest_cost + kv_break_penalty" formula from ticket 05 (`expected_future_requests` is not observable at trigger time); plumbing observed hit-rate into the trigger (runtime tuning based on hit rate cannot cross the break-even line without violating the invariant it protects).
- **Downstream impact**: The gate is a single inline expression in `conduct()`; the constant `2_000` may stay inline or move into the constants file (cosmetic).
- **Depends on**: `DEC-005`, `DEC-017`.
- **Decided implementation**: `Math.max(2_000, 0.05 * cap)`; same expression as the pre-existing frozen-grouping path (`my-customize-conductor.ts:233`).
- **Left to the implementer**: Whether to extract the `2_000` and `0.05` into named constants (cosmetic).

### `DEC-007` — No failure path

- **Decision**: There is no `host.complete()` call, no `host.can("complete")` check, no `AbortController`, no timeout accounting, and no `conductor/status.lastSummaryError` / `summaryErrors` metrics. Chunked compaction has no failure mode of its own; the pre-existing frozen-grouping pressure valve at `live > hardCap` (`my-customize-conductor.ts:217–237`) remains as the unshared hard-pressure fallback.
- **Rationale**: A synchronous, deterministic, pure-function digest has no external dependencies to fail. The `pendingSummaryHashes`, `groupSummaryCache`, `onSummary` re-plan, and `host.complete()` failure branches from the-conductor-v2 all become moot under `DEC-019`.
- **Rejected alternatives**: A silent-skip fallback when a broker call fails (no broker exists); an emit-then-upgrade shape (rejected under `DEC-005`).
- **Downstream impact**: Zero. The absence is the contract.
- **Depends on**: `DEC-005`, `DEC-019`.
- **Decided implementation**: No new code; the failure branches simply do not exist in the chunked-compaction path.
- **Left to the implementer**: None.

### `DEC-008` — Group representation reuses `GroupCommand` with deterministic digest string

- **Decision**: The wire form of a rollover is a single `GroupCommand { kind: "group", ids, digest }` (per `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts:254–259`). `digest` is always a non-empty string of the shape:

  ```text
  ⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩

  <deterministic body>

  Members: {#code1} {#code2} …
  ```

  The header/body/footer are separated by blank lines (`\n\n`). `GroupCommand.recoverable: true` is **not** introduced (this diverges from `ReplaceCommand.recoverable`; per-member recoverability is handled by `DEC-009`).
- **Rationale**: Reusing `GroupCommand` avoids a protocol bump; the header is a `MyCustomizeConductor`-private convention (`DEC-013`) that dashboards can pattern-match against without any wire-level cooperation. The engine's default group recap at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/digest.ts:198` (routed via `store.svelte.ts:745`) emits a single `{#code FOLDED}` tag for the group as a whole — the conductor must always supply an explicit `digest` string (never pass `undefined`) to retain per-member recall reversibility.
- **Rejected alternatives**: A new `era` or `nest` command variant for hierarchical grouping (deferred to a future map — see `## Out of Scope`); adding a `chunkedCompaction: true` flag on `GroupCommand` (forces a protocol bump for no wire-observable-behavior gain).
- **Downstream impact**: Supersedes the v0 test at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts:336–338` (which asserts `expect(g.digest).not.toMatch(/\{#\w+\s+FOLDED\}/)`); chunked compaction's digest **does** carry `{#code}` tags in the Members footer. The new expectation is that the digest **starts with** `⟨chunked-compaction ·` and **ends with** `Members: {#code} …`.
- **Depends on**: `DEC-009`, `DEC-010`, `DEC-011`.
- **Decided implementation**: `GroupCommand` emission is a single object literal at the emission site; the digest string is composed by three helper functions (`digestHeader(corpusHash, N, [X,Y])`, `digestBody(blocks)`, `digestMembersFooter(ids)`).
- **Left to the implementer**: The exact composition rule for `<deterministic body>` — structural aggregation, concatenated per-block `replace` outputs via `host.digestOf(id)`, or both. The load-bearing property is byte-identical output on identical input; any composition satisfying that is acceptable.

### `DEC-009` — Recall via tail-append; group summary and frozen prefix never rewritten

- **Decision**: The conductor derives one fold code per member `ViewBlock.id` (deterministic function of the id — not random, not turn-scoped) and lists them in the digest's `Members: {#code} …` footer. On unfold of a group-member code (agent `recall` or human GUI), the **engine's fold-code resolver** takes a policy branch: normal fold code → restore in place (existing behaviour); group-member fold code → append the original member text into the Protected Tail as a synthesised `recall(<code>)` `tool_call` / `tool_result` pair. The group summary block and every downstream block are left untouched; the KV-cache prefix is preserved.
- **Rationale**: In-place restore into the frozen prefix would defeat the whole point of the group substitution (one KV-cache-prefix break followed by another every time a user recalls). Tail-append shifts the recall's cost onto `liveTokens` and the tail budget where it is subject to the tail's own governance (protected-tail semantics per ADR-0002).
- **Rejected alternatives**: Refusing to unfold group members (violates the standing preference "Preserve `recall` / unfold reversibility on every folded block"); rewriting the group summary to include the recalled content (violates immutability, `RB-004`).
- **Downstream impact**: An **engine-side** change is required at the resolver. Verified anchor: `resolveUnfold(store, codes)` at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts:105`; the per-block match loop is at `plan.ts:127–155`. A new branch conditional on "block is a member of an emitted `GroupCommand`" appends a synthetic tail entry rather than calling `store.unfold(b.id, "agent")`. Tail-appended blocks count against `liveTokens` normally; repeated recalls produce repeated tail entries (no dedup).
- **Depends on**: `DEC-008`.
- **Decided implementation**: The resolver branch is authored by the extension/engine, not the conductor. A new `store.appendToTail(id)` (or equivalent) method is added to `store.svelte.ts`; `plan.ts` routes group-member codes to it.
- **Left to the implementer**: The exact policy for detecting "block is a member of an emitted `GroupCommand`" — a lookup against the store's group registry vs. a marker on the block vs. a parse of the digest string. Any deterministic, cheap approach is acceptable.

### `DEC-010` — Stable identity via determinism, not persistence

- **Decision**: On reconnect, `MyCustomizeConductor` re-reads raw blocks, re-computes the pre-group corpus, and re-emits the same `GroupCommand` with the same `digest` text. The content-hash embedded in the header IS the group's stable identity. There is no persistence file, no `groupSummaryCache: Map<contentHash, string>`, no `~/.accordion/sessions/<session-id>/group-summaries.json` (that was the γ-shape persistence path; explicitly not created).
- **Rationale**: With a deterministic digest, persistence has zero information content. Persistence would add a file to GC, a version to migrate, and a corruption failure mode, for no gain over recomputation.
- **Rejected alternatives**: JSON write-through per-session cache (rejected on ticket 04 D5 α-amendment); shared cross-session cache (rejected on ticket 04 D4 — cross-session isolation is a design principle, `DEC-014`).
- **Downstream impact**: Implementation must not add any file I/O for group summary state. Reload correctness is verified by the deterministic-replay half of the walking skeleton acceptance criterion.
- **Depends on**: `DEC-005`, `DEC-008`, `DEC-019`.
- **Decided implementation**: The digest composition is a pure function of `view.blocks` and the pre-group index range; no external state, no clock, no PRNG.
- **Left to the implementer**: The specific hash function for the content-hash embedded in the header (SHA-256 is the conventional choice from the-conductor-v2's `contentHash()` helper at `strategy.ts:~L1475–1483`; any collision-resistant hash is acceptable as long as it is deterministic and stable across releases).

### `DEC-011` — Pre-emit tool-pair trim on `group.ids`

- **Decision**: Before the digest is computed and before `estimateDefaultGroupDigestCost(run)` is evaluated, a single trim pass runs over the tentative `ids`:

  ```text
  collect callId → { inside, outsideLeft, outsideRight } for every block in ids
  for each callId with any outside partner: remove the inside half(s) from ids
  if |ids| < 2: skip emission this cycle (same fallthrough as saving <= 0 guard)
  ```

  Trimmed blocks stay live between the group and the tail and enter the next rollover cycle.
- **Rationale**: The engine's `applyPlan` Phase A tool-pair balance fixpoint (verified at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/mapping.ts:~345–372`) is the engine-level pre-image of this invariant; the conductor-level pre-emit trim ensures the conductor never emits `ids` that Phase A would then have to demote. Ordering matters: trim must run before cost estimation, otherwise cost is quoted against a set that includes blocks that will be removed.
- **Rejected alternatives**: Rejecting the emission whenever a tool pair straddles the boundary (force-alignment produces higher throughput than skip-and-retry); building the invariant into the walk-back predicate directly (walk-back is size-oriented, not pair-oriented; keeping them separate simplifies both).
- **Downstream impact**: The invariant is consumed twice by `DEC-005` — as the boolean `noOpenToolPairAcrossPreGroupTail` predicate for the fast-path trigger, and as the trim rule for the escape-valve force-alignment. The already-existing `isGroupBoundary()` helper in `my-customize-conductor.ts` is a reuse candidate for both.
- **Depends on**: None.
- **Decided implementation**: One pure function `trimOpenToolPairs(ids: string[], allBlocks: ViewBlock[]): string[]`; called once from the emission site.
- **Left to the implementer**: Whether the pair map is built once per pass and shared with the walk-back or rebuilt per call (cosmetic).

### `DEC-012` — Engine tweak: frozen-region clamp bypass for `group` commands with non-null digest

- **Decision**: The engine's frozen-region clamp on `group` commands (verified at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1174–1176`, inside `groupCmd`) is bypassed when `digest !== null && digest !== ""`. `FoldCommand`, `ReplaceCommand` (both routed through `substOne`), and `group` commands with `digest: null` or `digest: ""` (DROP) remain clamped as today. No `breakFrozen` flag is introduced; the bypass rule **is** the flag.
- **Rationale**: For chunked compaction to work, exactly one KV-cache-prefix break per rollover must be permitted — the rollover's whole purpose is to substitute a large frozen slice with a small one. This is the single load-bearing engine change ADR-0002's "cache-aware folding" contract needs; the DROP path stays fully clamped because DROP is irreversible and still requires the pre-existing `hasHardContextPressure()` gate.
- **Rejected alternatives**: A `breakFrozen: true` boolean flag on `GroupCommand` (`ConductorView` / `Command` protocol change; `RB-001` violation); a per-conductor allow-list keyed on conductor identity (conductors are collaborative and unnamed at the engine layer).
- **Downstream impact**: One engine change, authored by the extension. The `groupCmd` frozen clamp gains one additional disjunct. Existing tests that rely on `substOne`'s clamp for `fold` / `replace` (at `store.svelte.ts:1113–1116`) continue to pass unchanged; new tests for the group-bypass path must cover `digest !== null` accepts and `digest === null | ""` rejects.
- **Depends on**: None.
- **Decided implementation**: Modify the `frozen && !this.hasHardContextPressure()` check inside `groupCmd(ids, by, reports, digest)` at `store.svelte.ts:1174–1176` to add the `digest !== null && digest !== ""` disjunct on the accept side. **Anchor correction (from to-issues grounding)**: an earlier draft pointed this decision at `substOne` at `store.svelte.ts:1113–1116`, but `substOne`'s `kind` parameter is typed `"fold" | "replace"` only — `group` commands are dispatched via `case "group"` at `store.svelte.ts:1077–1079` to the separate `groupCmd` method. The contract (frozen clamp bypass for `group` with non-null digest) is preserved; the current anchor is `groupCmd`. `substOne`'s own frozen clamp is unchanged.
- **Left to the implementer**: The exact JS/TS expression (equivalent forms are acceptable); whether to extract a named helper `isChunkedCompactionSubst(digest)` (cosmetic).

### `DEC-013` — Both direct and broker modes; conductor is mode-oblivious

- **Decision**: `MyCustomizeConductor` emits chunked-compaction commands unconditionally on every session where `contextWindow ≥ 128 000`. No mode-detection channel is added; no ambient signal; no branch in the conductor code based on broker-mode. The dashboard's `GET /__accordion/broker-meta` endpoint (broker detection seam) is not consulted by the conductor.
- **Rationale**: One conductor code path in both modes means no divergence risk. Dashboards recognise a chunked-compaction group by pattern-matching the `⟨chunked-compaction · …⟩` header on `GroupCommand.digest`; the header is a `MyCustomizeConductor`-private convention (no protocol field).
- **Rejected alternatives**: A separate `MyCustomizeBrokerConductor` (doubles maintenance burden); passing broker-mode as a constructor option (mode detection leaks into the conductor abstraction).
- **Downstream impact**: Dashboards must be validated to render `⟨chunked-compaction · …⟩` groups exactly as they render other groups — reuses existing `group` rendering in `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/display.ts:43` (`buildDisplay`), `tileDraw.ts:432–479` (`drawTile`), and `ContextMap.svelte:~113,~1000`. `lastBrokerLatencyMs` telemetry was considered and explicitly dropped under α (`DEC-019`); implementers must not add it.
- **Depends on**: `DEC-008`, `DEC-019`.
- **Decided implementation**: No mode-detection code in the conductor; dashboard rendering unchanged; header pattern-match is a dashboard-side convention.
- **Left to the implementer**: None.

### `DEC-014` — Strict per-session isolation

- **Decision**: Chunked compaction is strictly per-session. Digest computation happens per-session in the conductor. There is no cross-session summary sharing, no cross-session cache, no cross-session dedup, ever — this is a design principle, not a v1-only deferral.
- **Rationale**: Cross-session sharing introduces synchronisation problems, cache-consistency problems, and privacy-boundary problems for zero cache-hit gain on the KV-cache axis (which is the only cache that matters for cost).
- **Rejected alternatives**: A shared per-corpus-content-hash cache across sessions (rejected on ticket 04 D4 — perpetual out-of-scope).
- **Downstream impact**: No cross-session state exists.
- **Depends on**: `DEC-010`.
- **Decided implementation**: State is scoped to a `MyCustomizeConductor` instance.
- **Left to the implementer**: None.

### `DEC-015` — No persistence

- **Decision**: No persistence file for chunked-compaction state exists. Reload correctness is provided by determinism (`DEC-010`).
- **Rationale**: See `DEC-010`.
- **Rejected alternatives**: See `DEC-010`.
- **Downstream impact**: Implementation must not create any file under `~/.accordion/sessions/` or elsewhere for group-summary state.
- **Depends on**: `DEC-010`.
- **Decided implementation**: No file I/O.
- **Left to the implementer**: None.

### `DEC-016` — Diagnostic surface: two sites

- **Decision**: Two diagnostic surfaces, both required.

  **Site 1 — `conductor/status` frame** emitted by `MyCustomizeConductor` (which gains an `attach(host)` implementation — currently absent, verified at `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts`) on every `conduct()` pass:

  ```ts
  {
    type: "conductor/status",
    text: `chunked · ${preGroupFillPct}% pregroup · ${rolloverCount} rollovers · ${humanTokens(tokensSavedByRollover)} saved`,
    metrics: {
      preGroupTokens,             // current, integer
      preGroupFillPct,            // 0–100+, integer (overflow visible)
      rolloverCount,              // cumulative since session start, integer
      tokensSavedByRollover,      // cumulative sum of estimatedGroupSaving, integer
      lastEstimatedGroupSaving,   // integer
      breakFrozenCount            // cumulative count of emitted group commands with digest !== null, integer
    }
  }
  ```

  On the pass that emits a rollover, `text` transitions to `"chunked · rollover · ${rolloverCount} rollover(s) · ${humanTokens(tokensSavedByRollover)} saved · pregroup ${before} → ${after}"`.

  **Site 2 — `chunkedCompaction` JSONL block** appended by `accordion.ts`'s `writeContextDiagnostic()` (verified at `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~433` — anchor updated from PRD-drafting-time line 368 per to-issues grounding; contract intact) on rollover turns only:

  ```jsonc
  {
    "turn": <n>,
    "context": { /* existing fields */ },
    "chunkedCompaction": {
      "event": "rollover",
      "preGroupTokensBefore": 15850,
      "preGroupBlockCount": 47,
      "preGroupTurnRange": [17, 31],
      "digestTokens": 512,
      "estimatedGroupSaving": 15338,
      "frozenFromIndexBefore": 22,
      "frozenFromIndexAfter": 68,
      "cacheTrackerReasonBefore": "prefix-match",
      "cacheTrackerReasonAfter": "prefix-match",
      "digestContentHash": "sha256:..."
    }
  }
  ```

- **Rationale**: Site 1 gives the live badge (matches the standing preference "Conductor emits `conductor/status` telemetry"); Site 2 gives the static replay surface for postmortem + verification (`RB-010`) via a one-line `jq` grep. Extension owns Site 2 because it already observes `GroupCommand`s (via `applyPlan(originalMessages, plan.ops, plan.groups)` — verified in `accordion.ts:~1227` — anchor updated from PRD-drafting-time line 1215 per to-issues grounding; contract intact; note that a parallel passthrough branch at ~1207–1225 also calls `writeContextDiagnostic` but fires only when `plan.groups.length === 0`, so no rollover can occur there and no JSONL block is required on that branch) and already holds `cacheTracker.getDiagnostics()` in scope. The conductor stays JSONL-oblivious; no new upward channel is added.
- **Rejected alternatives**: `conductor/status` only (Option A on ticket 05 mock — no static replay surface); JSONL only (Option B — live badge regresses); a `lastBrokerLatencyMs` metric (rejected under α); a `lastSummaryError` metric (rejected under `DEC-007`).
- **Downstream impact**: `MyCustomizeConductor` gains `attach(host)`; `accordion.ts`'s existing `writeContextDiagnostic()` payload gains one optional field. Field types: all integers except `event` (string), `preGroupTurnRange` (`[number, number]`), `cacheTrackerReasonBefore/After` (strings drawn from `CacheTrackerReason` union at `F:/MyWork/my-pi/vendor/accordion/extension/cache-tracker.ts:17–23`), `digestContentHash` (string with `sha256:` prefix or equivalent).
- **Depends on**: `DEC-005`, `DEC-008`.
- **Decided implementation**: `attach(host)` stores the host reference; on every `conduct()` pass, after computing the plan, the conductor calls `host.setStatus(text, metrics, null)` per the `ConductorHost` interface at `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts` — verified signature: `setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void`; on rollover turns, the extension's plan-applied hook composes the JSONL block and appends it to the existing payload.
- **Left to the implementer**: The `humanTokens()` formatter (a small helper that renders `15338 → "15.3k"`); whether to pass a non-null `details` argument (v1 passes `null`). **Anchor correction (from to-issues grounding)**: an earlier draft referred to `host.emit(…)` — the actual API is `setStatus`, not `emit`.

### `DEC-017` — Provider-agnostic v1

- **Decision**: One policy for all providers. All cache-cost math is delegated to the Pi SDK (specifically the `usage.cost.cacheRead` / `usage.cost.cacheWrite` fields). Per-provider tuning is out of scope for this map.
- **Rationale**: The min-savings gate (`DEC-006`) dominates the KV-break penalty on every provider by construction; a per-provider `preGroupTokens_soft` is not warranted for v1. The one provider-specific branch (OpenAI system-message layout) at `F:/MyWork/my-pi/vendor/accordion/extension/cache-tracker.ts:89` is orthogonal to chunked compaction.
- **Rejected alternatives**: Per-provider `preGroupTokens_soft` (unwarranted complexity for v1; noted as a future-map trigger for "OpenAI's larger auto-cache or Gemini's explicit context caching").
- **Downstream impact**: No provider-specific code in the chunked-compaction path.
- **Depends on**: `DEC-006`.
- **Decided implementation**: Single unconditional path.
- **Left to the implementer**: None.

### `DEC-018` — Verification invariant with cold-start exclusion

- **Decision**: In a stable-provider scripted session where chunked compaction is the only operation that rewrites provider-visible messages:

  ```text
  prefixRewrite(record)
    = record.cacheTracker.previousMessageCount > 0
      && record.cacheTracker.matchedPrefix < record.cacheTracker.previousMessageCount

  cacheBreak(record)
    = record.cacheTracker.reason == "cold-start" || prefixRewrite(record)

  count(chunkedCompaction.event == "rollover")
    == count(cacheBreak(record)) − coldStartCount
  ```

  `coldStartCount` is the count of records whose reason is `cold-start` and is at most one in the scripted session. An older group repeated in a later full plan is not another rollover.
- **Rationale**: `CacheTrackerReason` values are disjoint. A cold start reports `cold-start`, not `prefix-mismatch`. The tracker reports `prefix-mismatch` only when `matchedPrefix == 0`; a later rollover after an immutable summary can report `prefix-match` while `matchedPrefix < previousMessageCount` proves that the cached suffix was rewritten. Numeric prefix accounting therefore matches the cache event being verified.
- **Rejected alternatives**: Counting `reason == "prefix-mismatch"` misses partial-prefix rewrites and subtracts cold starts that were never included. Applying the equality to arbitrary sessions also misattributes provider, system, tools, and unrelated folding changes to chunked compaction.
- **Downstream impact**: The invariant is an extension integration-test seam. The test drives zero, one, and two rollovers through the real conductor, store, plan mapping, and tracker. It also removes one real rollover block to prove that the count is discriminating.
- **Depends on**: `DEC-016`.
- **Decided implementation**: `vendor/accordion/extension/chunked-compaction-invariant.test.ts` owns the scripted session and in-memory JSONL sink.
- **Left to the implementer**: None.

### `DEC-019` — No LLM broker; digest is a deterministic pure function of the corpus

- **Decision**: The group-summary digest is a deterministic pure function of the pre-group corpus. No LLM call at rollover; no `SummaryProvider`; no `host.complete()`; no async broker; no cache.
- **Rationale**: Three compounding grounds (ticket 14 §1–§4):
  1. The deterministic per-block path in `MyCustomizeConductor` — `mcpSummary`, `pstackRecallSummary`, `genericRecallSummary`, `toolResultSummary` in `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/mcp-summary.ts` — is already unusually rich; the load-bearing blocks are already prose-preserved as `replace` commands upstream.
  2. MCP results and recall results are architectural group boundaries by the walk-back predicate (`DEC-003`), so the blocks worth prose-synthesising are excluded from group runs **by construction, not by policy**.
  3. A non-deterministic digest would require a persistent cache to survive reconnect byte-identical; determinism removes the cache, the persistence file, the GC, the corruption handling, `pendingSummaryHashes`, `host.can("complete")` gating, `AbortController`, timeout accounting, and every failure branch.
  The cost is a less "human-readable" summary; the win is a much simpler contract and no reconnect cliff.
- **Rejected alternatives**: The γ shape (async LLM broker); the β shape (deterministic-first + opportunistic LLM upgrade). Both preserved for the record in `## Further Notes`.
- **Downstream impact**: `DEC-007`, `DEC-010`, `DEC-015` all become straightforward. The `contentHash(block)` helper from the-conductor-v2's `strategy.ts:~L1475–1483` (SHA-256 of a normalised block payload) is the reuse candidate for the corpus-content-hash; note that for group summaries the hash is over the **entire corpus**, not per-block.
- **Depends on**: `DEC-003`.
- **Decided implementation**: The digest composition is three pure helpers (`digestHeader`, `digestBody`, `digestMembersFooter`); the corpus content-hash is computed over the concatenation of member block payloads.
- **Left to the implementer**: The exact normalisation applied before hashing (whitespace collapse, field-order canonicalisation, etc.); the exact composition of `<deterministic body>` — see `DEC-008`.

### `DEC-020` — Immutability and DROP exclusion

- **Decision**: Group summaries emitted by chunked compaction are immutable once written — no re-summarising a prior group, no re-computing an existing digest under a new corpus. `GroupCommand` with `digest: null` (irreversible DROP) is not used by chunked compaction under any code path; the frozen-region clamp bypass (`DEC-012`) applies only to `digest !== null`.
- **Rationale**: Immutability is required by `RB-005` (byte-identical replay) and by the vendor's ADR-0011 "appliedFoldSet monotonic within session" pattern. DROP remains available to the pre-existing hard-pressure fallback in `MyCustomizeConductor`, gated on `hasHardContextPressure()` — unchanged by this map.
- **Rejected alternatives**: Re-summarising when a level-2 rollover is needed (level-2 rollover is a follow-up map — see `## Out of Scope`).
- **Downstream impact**: Any implementer temptation to "improve" an existing digest is a defect; the digest string is fixed for the life of the group.
- **Depends on**: `DEC-010`, `DEC-012`.
- **Decided implementation**: The conductor emits each digest once. `AccordionStore.clearConductorState()` preserves groups whose digest starts with `⟨chunked-compaction ·`, even when their first member sits exactly at `frozenFromIndex`, so a later pass cannot expand an immutable summary back into raw messages.
- **Left to the implementer**: None.

## Implementation Plan

### Area: Conductor — pre-group derivation and rollover trigger

- **Coverage**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-005`, `DEC-006`, `DEC-007`, `DEC-011`, `DEC-013`, `DEC-014`, `DEC-017`, `US-001`, `US-005`, `RB-001`, `RB-002`, `RB-008`.
- **Contract**: A pure function `effectivePreGroupTokens(view, opts): number` returning `0` when `view.contextWindow < 128 000 || null`, else the constructor option (default `15 000`). A pure function `computePreGroupFromIndex(view, target): number` performing the walk-back. A predicate `noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex): boolean`. A trigger check inside `conduct()` that fires the fast-path or the escape-valve, computes `estimatedGroupSaving`, and emits exactly one `GroupCommand` when both `preGroupTokens ≥ 15 000 && preGroupEndsOnTurnBoundary && noOpenToolPairAcrossPreGroupTail && estimatedGroupSaving ≥ max(2 000, 0.05 × cap)` hold, or when the escape-valve condition `preGroupTokens > 18 750` holds.
- **Decision constraints**: `DEC-001` — no wire fields; `DEC-002` — 15 000 / 18 750 constants, mirror `PROTECT_OVERFLOW_CAP` walk-back shape; `DEC-003` — `!grouped && !held && !proactivelyCompressed`; `DEC-004` — inert below 128 k; `DEC-005` — synchronous single emission; `DEC-006` — inherit `max(2 000, 0.05 × cap)`; `DEC-007` — no failure path; `DEC-011` — trim before cost estimation.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:71` → `class MyCustomizeConductor`.
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:82` → `conduct(view: ConductorView): Command[]`.
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:217–237` → existing frozen-grouping pressure valve (unchanged; remains as hard-pressure fallback).
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:233` → the inline `Math.max(2_000, 0.05 * cap)` expression to reuse.
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `isGroupBoundary()` helper (existing; reuse candidate for `DEC-011` and `DEC-002` walk-back stopping).
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:49` → `estimateDefaultGroupDigestCost` (existing; call after trim per `DEC-011`).
  - `F:/MyWork/my-pi/vendor/accordion/extension/store.svelte.ts:824–847` → `protectedFromIndex` walk-back reference algorithm (mirror shape).
- **Existing behavior**: `MyCustomizeConductor` today groups the non-frozen suffix on `block.order >= view.frozenFromIndex`, breaks at `user`/`held`/`protected`/`grouped`/MCP/recall boundaries, and gates emission on `estimatedGroupSaving ≥ max(2 000, 0.05 × cap)` inline. The frozen-grouping pressure valve at lines 217–237 fires only when `view.liveTokens > hardCap`.
- **Required edits**:
  - Add `effectivePreGroupTokens(view, opts)`, `computePreGroupFromIndex(view, target)`, `noOpenToolPairAcrossPreGroupTail(view, preGroupFromIndex)`, `trimOpenToolPairs(ids, allBlocks)` (see next Area).
  - Add the trigger branch to `conduct()`: compute `preGroupFromIndex`, evaluate trigger, compute `estimatedGroupSaving` (using `estimateDefaultGroupDigestCost` after trim), emit one `GroupCommand` or fall through.
  - Add a constructor option `preGroupTokens: number` defaulting to the constants file (see Global Build & Wiring Notes).
- **Normative snippet**: See `DEC-005` for the exact trigger predicate.
- **Test seam**: `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` (existing vitest suite; test infrastructure and view builders already in place). Run with `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run conductor.compaction-naive` (see `## Global Build & Wiring Notes` for the corrected test command); success is a green suite. Add new test cases per `## Testing Decisions`.
- **Wiring**: The conductor is registered in `F:/MyWork/my-pi/vendor/accordion/conductors/` — no new registration; the constructor option flows through the existing conductor construction path in the extension.
- **Grounding evidence**: The subagent grounding-verification pass confirmed no `constants.ts` exists yet; `attach(host)` is not implemented on the conductor; `preGroupTokens` does not exist as a symbol anywhere in the vendor codebase (fresh identifier). The `HOLD_BAND = 0.9` epoch gate at lines 89–91 is orthogonal and unchanged.

### Area: Conductor — group digest emission and tool-pair trim

- **Coverage**: `DEC-008`, `DEC-009`, `DEC-010`, `DEC-011`, `DEC-013`, `DEC-015`, `DEC-019`, `DEC-020`, `US-002`, `RB-004`, `RB-005`.
- **Contract**: Three pure helpers — `digestHeader(corpusHash, N, [X, Y]): string` producing exactly `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩`; `digestBody(blocks: ViewBlock[]): string` producing a deterministic body; `digestMembersFooter(ids: string[]): string` producing exactly `Members: {#code1} {#code2} …` with fold codes derived from block ids via a deterministic function. `composeDigest(...)` concatenates the three with `\n\n` separators. `trimOpenToolPairs(ids, allBlocks): string[]` per `DEC-011`.
- **Decision constraints**: `DEC-008` — the three-section shape; `DEC-009` — fold codes derived from ids, not random; `DEC-010` — byte-identical output on identical input; `DEC-011` — trim before cost + digest; `DEC-019` — no LLM; `DEC-020` — never DROP.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts:254–259` → `type GroupCommand = { kind: "group"; ids: string[]; digest?: string | null }` — the wire type to fill.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/digest.ts:198` → `groupDigest(group, members)` — engine's default recap (superseded when digest string is supplied).
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:745` → the call site routing through `digest.ts:198`.
  - The-conductor-v2 `contentHash(block)` at `~L1475–1483` in `strategy.ts` → reference implementation for the SHA-256-of-normalised-payload approach; adapt for a corpus-level hash.
- **Existing behavior**: `GroupCommand.digest` is optional (`digest?: string | null`); when `undefined`, the engine emits its default recap at `digest.ts:198` (a single `{#code FOLDED}` tag for the whole group). Test `conductor.compaction-naive.test.ts:336–338` asserts that a model-supplied digest is not overwritten by the default recap; that test is v0 behavioural and is superseded by this PRD (see `DEC-008`).
- **Required edits**:
  - Add `digestHeader`, `digestBody`, `digestMembersFooter`, `composeDigest`, `trimOpenToolPairs` as pure helpers (module placement: alongside `my-customize-conductor.ts`).
  - Wire them into `conduct()` at the emission site.
- **Normative snippet**:

  ```text
  ⟨chunked-compaction · <N> blocks · turns <X>–<Y> · content-hash <hash>⟩

  <deterministic body>

  Members: {#<code1>} {#<code2>} …
  ```

- **Test seam**: `conductor.compaction-naive.test.ts` — add cases for header format, byte-identical replay, and superseded-v0-test replacement. Deterministic replay is the walking-skeleton acceptance criterion.
- **Wiring**: Emission is a single `Command` object pushed into the return value of `conduct()`.
- **Grounding evidence**: Verified `GroupCommand.recoverable` does not exist as a field on `GroupCommand` (unlike `ReplaceCommand`); per-member recoverability is handled by `DEC-009`'s engine branch.

### Area: Conductor — `attach(host)` and `conductor/status` telemetry

- **Coverage**: `DEC-016`, `US-004`, `RB-007`.
- **Contract**: `MyCustomizeConductor.attach(host: ConductorHost): void` stores the host reference. On every `conduct()` pass, before returning, emit one `conductor/status` frame per the shape in `DEC-016`. On rollover passes, use the alternative `text` template.
- **Decision constraints**: `DEC-016` — payload shape verbatim; `DEC-007` — no `lastSummaryError` field.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts` → `ConductorHost` interface. The status-emission method is `setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void` (three arguments; PRD-drafting-time reference to `host.emit(…)` is corrected — the actual API is `setStatus`).
  - `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:71` → class body; `attach` is currently absent.
- **Existing behavior**: `MyCustomizeConductor` currently has no `attach(host)` and no `ConductorHost` reference. The class is stateful for epoch gating (`lastPlan`, `lastFrozenGroupEpochKey`) but does not emit any host events.
- **Required edits**:
  - Add `attach(host: ConductorHost): void` and a private field `#host: ConductorHost | null`.
  - Add cumulative counters (`rolloverCount`, `tokensSavedByRollover`, `breakFrozenCount`) as instance fields.
  - Add a helper `humanTokens(n: number): string` (`15338 → "15.3k"`).
  - Emit at the end of `conduct()`.
- **Normative snippet**: See `DEC-016` for the payload.
- **Test seam**: New test cases in `conductor.compaction-naive.test.ts` (or a sibling file) that spy on the mock host's `emit` calls and assert payload shape + counter increments.
- **Wiring**: `attach(host)` is called by the extension during conductor construction (existing hook in the extension's conductor wiring; verify at `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts`).
- **Grounding evidence**: Subagent verification confirmed `attach(host)` is not currently implemented; the field must be added fresh.

### Area: Engine — group frozen-region clamp bypass

- **Coverage**: `DEC-012`, `RB-003`.
- **Contract**: The frozen clamp inside `groupCmd` at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1174–1176` is extended to accept substitutions when `digest !== null && digest !== ""`. All other clamps for `group` (`invalid-group`, `human-override`) are unchanged. `substOne`'s own frozen clamp for `fold` / `replace` at `store.svelte.ts:1113–1116` is unchanged; the pre-existing `breakFrozen && hasHardContextPressure()` gate for DROP is untouched.
- **Decision constraints**: `DEC-012` — group with non-null digest is the accept condition; DROP path unchanged.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1077–1079` → `case "group":` dispatch to `groupCmd`.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1166–1179` → `groupCmd(ids, by, reports, digest)` — method containing the frozen clamp to modify.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1174–1176` → the specific `frozen && !this.hasHardContextPressure()` check to extend.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1103–1116` → `substOne(id, content, by, kind, reports, recoverable, breakFrozen)` — unchanged reference (its `kind` is `"fold" | "replace"` only; `group` commands do not reach it).
- **Existing behavior**: The current clamp in `groupCmd` (lines 1174–1176) refuses any group whose `range` includes a block with `order < frozenFromIndex` unless `hasHardContextPressure()` returns `true`. `substOne`'s clamp for `fold`/`replace` (line 1113) refuses any substitution whose block has `order < frozenFromIndex` unless `breakFrozen === true && hasHardContextPressure()` — unchanged by this map.
- **Required edits**: Modify the frozen clamp condition inside `groupCmd` to add the `digest !== null && digest !== ""` disjunct on the accept side.
- **Normative snippet**:

  ```ts
  // Inside groupCmd, replacing store.svelte.ts:1174–1176:
  const frozen = range.some((id) => (this.get(id)?.order ?? this.frozenFromIndex) < this.frozenFromIndex);
  if (frozen) {
      const isChunkedCompactionSubst = digest !== null && digest !== undefined && digest !== "";
      if (!isChunkedCompactionSubst && !this.hasHardContextPressure())
          return void reports.push(clamp("group", ids, "frozen", "would rewrite the provider's cached prefix"));
  }
  ```

- **Test seam**: Add engine unit tests to `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/` covering: (a) `group` with `digest: "..."` on a frozen block → accepted; (b) `group` with `digest: null` on a frozen block → still requires hard-pressure gate (unchanged); (c) `fold` on a frozen block → still clamped; (d) `replace` on a frozen block → still clamped.
- **Wiring**: No wiring — single-file engine change.
- **Grounding evidence**: Verified the clamp location and the surrounding guards.

### Area: Engine — fold-code resolver policy branch (group-member → tail-append)

- **Coverage**: `DEC-009`, `US-003`, `RB-009`.
- **Contract**: `resolveUnfold(store, codes)` at `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts:105` gains a policy branch: when a matched code corresponds to a `ViewBlock` that is a member of an emitted `GroupCommand`, the resolver appends the block's original content into the Protected Tail as a synthesised `recall(<code>)` `tool_call` / `tool_result` pair. When the code corresponds to a normal fold, the resolver falls through to the existing `store.unfold(b.id, "agent")` path (`store.svelte.ts:1439–1456`). Repeated recalls produce repeated tail entries.
- **Decision constraints**: `DEC-009` — group summary and frozen prefix are not mutated; tail-appended blocks count against `liveTokens` normally.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts:105` → `resolveUnfold(store, codes)`.
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts:127–155` → per-block match loop (insertion point for the new branch).
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/live/plan.ts:111–125` → group code path (existing whole-group unfold; unchanged for chunked compaction — chunked-compaction groups do not use it).
  - `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/store.svelte.ts:1439–1456` → `unfold(id, by)` — existing in-place restore path.
- **Existing behavior**: `resolveUnfold` today restores blocks in place via `store.unfold(b.id, "agent")` (sticky override on `b.override = "unfolded"`).
- **Required edits**:
  - Add a `store.appendToTail(id: string): void` method (or equivalent — implementer chooses the exact API name) to `store.svelte.ts` that materialises a synthetic `recall(<code>)` `tool_call` / `tool_result` pair and appends it to the tail without mutating the group summary.
  - Add the policy branch to `resolveUnfold` (`plan.ts:~135`, inside the per-block match loop, before the existing `store.unfold` call).
  - Provide a way for the resolver to detect "block is a member of an emitted chunked-compaction `GroupCommand`" — implementer's choice (a group registry lookup, a `groupMemberOf` field on `ViewBlock`, or a parse of the digest string).
- **Normative snippet**: The branch:

  ```ts
  // in resolveUnfold, inside the per-block match loop
  if (isChunkedCompactionGroupMember(store, b)) {
    store.appendToTail(b.id);
    continue;
  }
  store.unfold(b.id, "agent"); // existing path
  ```

- **Test seam**: Add engine unit tests to cover: (a) unfolding a group-member code → tail gains a new `tool_call` / `tool_result` pair, group summary unchanged, `frozenFromIndex` unchanged; (b) unfolding a normal fold code → existing in-place restore behaviour; (c) repeated unfold of the same group-member code → two tail entries; (d) human GUI unfold of a group-member code → same tail-append shape as agent recall.
- **Wiring**: The resolver is invoked from the existing agent-recall and human-GUI-unfold paths; no new callers.
- **Grounding evidence**: Verified `resolveUnfold` location, existing group-code path, and per-block match loop; verified `store.unfold(id, by)` shape.

### Area: Extension — `chunkedCompaction` JSONL block

- **Coverage**: `DEC-015`, `DEC-016`, `DEC-018`, `US-004`, `RB-006`, `RB-010`.
- **Contract**: `writeContextDiagnostic()` at `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~433` composes an additional `chunkedCompaction` field when the applied plan contains a previously unreported `GroupCommand` whose digest begins with `⟨chunked-compaction ·`. The extension tracks reported group ids per session because full plans repeat older folded groups. The field is absent on non-rollover turns.
- **Decision constraints**: `DEC-016` — payload shape verbatim; extension owns the JSONL record; conductor is JSONL-oblivious.
- **Code anchors**:
  - `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~433` → `writeContextDiagnostic()` writer (private nested function; anchor updated from PRD-drafting-time ~368).
  - `F:/MyWork/my-pi/vendor/accordion/extension/accordion.ts:~1156, ~1183, ~1207, ~1215` → the four call sites that pass `cacheTracker.getDiagnostics()` into the payload; the rollover-detection site is `~1215` (`applyPlan(originalMessages, plan.ops, plan.groups)` — has both the plan and the cache-tracker diagnostics in scope).
  - `F:/MyWork/my-pi/vendor/accordion/extension/cache-tracker.ts:17–23` → `CacheTrackerDiagnostics` interface (`matchedPrefix`, `reason`, `frozenFromIndex`, `messageCount`, `previousMessageCount`).
  - `F:/MyWork/my-pi/vendor/accordion/extension/cache-tracker.ts:67` → `getDiagnostics()` accessor.
- **Existing behavior**: `writeContextDiagnostic()` writes per-turn JSONL records with existing fields; it already has `cacheTracker.getDiagnostics()` in scope at every call site.
- **Required edits**:
  - At `accordion.ts:~1227` (anchor updated from PRD-drafting-time ~1215), select the first chunked-compaction group whose id is not in the session's reported-group set.
  - Compose the `chunkedCompaction` block from: the plan (block count, turn range, member ids), the cache-tracker diagnostics (`frozenFromIndex` before / after via a snapshot pair, `reason` before / after), and the digest string (content-hash extraction).
  - Add the group id to the reported set only when its diagnostic is authored. Clear the set on session start and shutdown.
  - Append to the existing payload; keep the existing best-effort write semantics.
- **Normative snippet**: See `DEC-016`.
- **Test seam**: `vendor/accordion/extension/chunked-compaction-invariant.test.ts` drives real conductor, store, plan mapping, and cache tracking through zero, one, and two rollovers. The only mock is an in-memory append sink. It verifies numeric prefix rewrites, suppresses repeated old-group diagnostics, and removes one rollover block as a discriminating check.
- **Wiring**: No new module registration; the block is one additional key on the existing payload.
- **Grounding evidence**: Subagent verification confirmed the four `writeContextDiagnostic()` call sites, the `applyPlan` call at `~1215`, and the `CacheTrackerDiagnostics` field set.

## Global Build & Wiring Notes

- **Constants file**: `constants.ts` does not currently exist under `F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/` (verified). The implementer creates a new file (e.g. `conductors/my-customize-conductor/constants.ts`) exporting `DEFAULT_PRE_GROUP_TOKENS = 15_000`, `PRE_GROUP_OVERFLOW_CAP = 1.25`, `MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000`, and the shared `CHUNKED_COMPACTION_PREFIX` marker used by the conductor, engine, plan resolver, and extension diagnostics. The existing inline `HOLD_BAND = 0.9` and the inline `Math.max(2_000, 0.05 * cap)` gate at line 279 (anchor updated from PRD-drafting-time line 233 per to-issues grounding) may stay inline (cosmetic per `DEC-006`) or move into the same constants file (implementer's choice).
- **Constructor option**: `MyCustomizeConductor` accepts a new constructor option `preGroupTokens?: number` (default = `DEFAULT_PRE_GROUP_TOKENS`). No user-facing UI setting.
- **`ConductorHost` API**: The method for the `DEC-016` `conductor/status` frame is **`host.setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void`** at `F:/MyWork/my-pi/vendor/accordion/conductors/contract/conductor.ts` (three arguments). **Anchor correction (from to-issues grounding)**: an earlier draft referred to `host.emit(…)` — the actual API is `setStatus`, not `emit`.
- **Test command**: The vendor repo at `F:/MyWork/my-pi/vendor/accordion/` has **no root `package.json`** and no `pnpm-workspace.yaml`; the app package name is **`accordion-app`** (not `accordion`). The correct test invocation is `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run <filename-fragment>` (or `pnpm test` for the full suite). The PRD-drafting-time command `pnpm --filter accordion test conductor.compaction-naive` is incorrect; use the vitest form above. The vitest config at `app/vitest.config.ts` picks up `src/lib/**/*.test.ts` automatically.
- **No new file I/O**: Implementers must not create files under `~/.accordion/sessions/` or elsewhere for chunked-compaction state (`DEC-015`).
- **No protocol bump**: `CONDUCTOR_PROTOCOL_VERSION` at `F:/MyWork/my-pi/vendor/accordion/conductors/contract/protocol.ts:32` stays at `3`.
- **Repo boundary**: All implementation lands in the vendor'd accordion repo at `F:/MyWork/my-pi/vendor/accordion/`. The parent `madtom` repo hosts the PRD, MAP, ADR, and tickets only; it ships no code from this map (`## Out of Scope`).

## Testing Decisions

Chunked compaction is tested at five seams. Each seam runs against real wiring (no mocks of the substances under test).

- **Seam 1 — Conductor emission (unit).** File: `F:/MyWork/my-pi/vendor/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` (existing). Command: `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run conductor.compaction-naive` (**anchor correction**: PRD-drafting-time `pnpm --filter accordion test conductor.compaction-naive` is incorrect — no root package.json; app package is `accordion-app`; see `## Global Build & Wiring Notes`). Add cases:
  1. **Walking skeleton** (`US-001`): synthesise a `ConductorView` with `contextWindow = 200_000`, pre-group summing to ~15 850 tokens on a turn boundary with no open tool pair. Expect exactly one `GroupCommand` in the return; expect `digest.startsWith("⟨chunked-compaction ·")` and `digest.includes("Members: {#")`. Immediately re-run the same pass; expect **byte-identical** digest string.
  2. **Small-context inert** (`US-005`, `RB-008`): same view but `contextWindow = 32 000`; expect **zero** chunked-compaction `GroupCommand`s. Repeat with `contextWindow = null`.
  3. **Superseded v0 test** (per `DEC-008`): the assertion `expect(g.digest).not.toMatch(/\{#\w+\s+FOLDED\}/)` at lines 336–338 is v0 behavioural; replace with `expect(g.digest).toMatch(/^⟨chunked-compaction ·/)` and `expect(g.digest).toMatch(/Members: \{#\w+\}/)` for the chunked-compaction case.
- **Seam 2 — Tool-pair invariant (property + regression).** File: same suite or a sibling file. Add:
  1. **Property test** (`RB-002`): randomised views (block-kinds × `frozenFromIndex` × `protectedFromIndex`); property — for every emitted `GroupCommand`, `group.ids` contains both halves of every referenced `callId` or neither.
  2. **Regression test**: build a view where `protectedFromIndex − 1` is a `tool_call` and `protectedFromIndex` is its `tool_result`; assert emitted `ids` **excludes** the trailing `tool_call`; the `tool_call` block stays live between the group and the tail (i.e., is a `ViewBlock` after the group and before the tail on the next `conduct()` pass).
  3. **Cost-honesty test**: assert `estimateDefaultGroupDigestCost` is called with `|ids|` **after** trim, not before.
- **Seam 3 — Verification invariant (integration).** `vendor/accordion/extension/chunked-compaction-invariant.test.ts` drives a stable-provider multi-turn session through real `MyCustomizeConductor`, `AccordionStore`, `computeGroupOps`, `applyPlan`, and `cacheTracker`. The test computes:

  ```text
  prefixRewrite = previousMessageCount > 0 && matchedPrefix < previousMessageCount
  cacheBreaks = count(reason == "cold-start") + count(prefixRewrite)
  pass = count(chunkedCompaction.event == "rollover") == cacheBreaks - coldStartCount
  ```

  The zero, one, and two rollover cases expect cache-break counts `1`, `2`, and `3`. An intervening build turn after the first rollover must not re-author the older group's diagnostic. A corrupted copy with one rollover block removed must fail the equality. The only mock is the in-memory append sink.

- **Seam 4 — Engine group frozen-clamp bypass (unit).** Add tests to the engine's existing store test suite covering the four cases in the "Engine — group frozen-region clamp bypass" area above.
- **Seam 5 — Fold-code resolver tail-append (unit).** Add tests to the engine's existing `plan.ts` test suite covering the four cases in the "Engine — fold-code resolver policy branch" area above.

No new test framework is introduced; every seam uses the vendor's existing vitest binding. No mocks are introduced for `MyCustomizeConductor`, `substOne`, or `resolveUnfold`; each is exercised in-situ.

## Out of Scope

- **Level-2 rollover** (summary-of-summaries) when group summaries themselves accumulate. Likely a follow-up map keyed on accordion's C4 Archivist (see [ticket 10 findings](./tickets/10-findings.md) — `conductor-plan.md:~493–600`, `VISION.md:100–102`, `conductor-rework-roadmap.md:180–231`). Scope of that map includes the open `era` / nest command contract question (add to `Command` union with a `CONDUCTOR_PROTOCOL_VERSION` bump vs. host-automatic promotion).
- **Interaction with other collaborative conductors** (`code-skeleton`, attention) when blocks that already went through skeletonisation later fall into the pre-group. v1 walks around them via the groupability predicate (`DEC-003`).
- **Behaviour under Pi's native `/compact`** (`session_before_compact` hook) when the four-zone layout is active.
- **Exact composition rule for the deterministic digest body** (`DEC-008` — structural aggregation vs. concatenated per-block `replace` outputs vs. both). Left to the implementer; the load-bearing property is byte-identical output on identical input.
- **GUI treatment** of chunked-compaction groups beyond reuse of existing `group` rendering. If dashboards want a distinct visual, they pattern-match the `⟨chunked-compaction · …⟩` header — no protocol cooperation required.
- **Modifying `extension/store.svelte.ts` protected-tail semantics or `protectTokens` defaults** — this effort adapts to the tail, does not redesign it.
- **Non-additive changes to the conductor contract** — only additive changes allowed (and none proposed).
- **Shipping chunked compaction as the default for conductors other than `MyCustomizeConductor`** — v1 lives in `MyCustomizeConductor` only. A future map may promote it (moves the constants file to a shared location).
- **Cross-session summary dedup or shared caches** — group summaries are strictly per-session (`DEC-014`), ruled out as a design principle.
- **Idle / human-invoked rollover** — the trigger is `conduct()`-driven only; no idle timer, no `/rollover` command.
- **Per-provider tuning of `preGroupTokens_soft`** (e.g. for OpenAI's larger auto-cache or Gemini's explicit context caching) — a future map trigger, out of scope for v1.
- **Any code merged into `conductors/my-customize-conductor/` from the parent map** — implementation ships on the downstream map keyed on this PRD; the parent `madtom` map ends at ADR-0004 accepted + this PRD `ready-for-agent`.
- **Adding `lastBrokerLatencyMs`, `lastSummaryError`, `summaryErrors`, `pendingSummaryHashes`, or `groupSummaryCache`** — all considered and explicitly dropped under α (`DEC-005`, `DEC-007`, `DEC-019`). Implementers must not re-introduce them.
- **Removing / weakening the `hasHardContextPressure()` DROP gate** — DROP remains fully clamped; only `group` with non-null digest bypasses (`DEC-012`, `DEC-020`).

## Unresolved Gaps

None.

*(Two implementation-local mechanisms are called out inside `DEC-003` / `DEC-009` and the "Engine — fold-code resolver policy branch" area: whether tail-appended `recall` results carry a `proactivelyCompressed` marker to prevent immediate re-grouping in the next cycle, and how the resolver detects "block is a member of an emitted chunked-compaction `GroupCommand`". These are reversible local choices per the `Left to the implementer` clauses on those DECs — not material decisions gated on human confirmation, and not returned as `RETURN-###` contradictions.)*

## Further Notes

- **Anchor drifts caught during to-issues grounding** (all corrected in the individual issue files under `.scratch/accordion-chunked-compaction/issues/` and re-applied inline in this PRD; contracts intact — anchor updates only):
  - `MyCustomizeConductor` `Math.max(2_000, 0.05 * cap)` gate: PRD-drafting-time line 233 → **actual line 279**.
  - `DEC-012` engine bypass target: `substOne` at `store.svelte.ts:1113–1116` → **actual clamp is in `groupCmd` at `store.svelte.ts:1166–1179`, specifically lines 1174–1176**. `substOne`'s `kind` is `"fold" | "replace"` only; `group` commands are dispatched via `case "group"` at `store.svelte.ts:1077–1079` to the separate `groupCmd(ids, by, reports, digest)` method. `substOne`'s own frozen clamp at 1113–1116 is unchanged by this PRD.
  - Extension `applyPlan` call site: PRD-drafting-time ~1215 → **actual ~1227**. A parallel passthrough branch exists at ~1207–1225 but is correctly excluded from the JSONL block author path (empty-plan turn — no `GroupCommand` can occur there).
  - Extension `writeContextDiagnostic`: PRD-drafting-time ~368 → **actual ~433** (private nested function inside the extension's outer scope; writes to `${DIAGNOSTICS_DIR}/${sessionId}.context.jsonl`).
  - Conductor host status API: PRD-drafting-time `host.emit(…)` → **actual `host.setStatus(text: string | null, metrics?: Record<string, number | string | boolean>, details?: JSONValue): void`** (three arguments; `details` may be `null` in v1).
  - Test command: PRD-drafting-time `pnpm --filter accordion test conductor.compaction-naive` → **actual `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run conductor.compaction-naive`** (no root `package.json` in the vendor repo; the app package name is `accordion-app`, not `accordion`).
  - `MyCustomizeConductor` today has **no explicit constructor** (field initialisers only) — the `preGroupTokens?: number` constructor option is a fresh addition, not an amendment to an existing signature.

- **Parent map**: [`.scratch/accordion-chunked-compaction/MAP.md`](./MAP.md).
- **Accepted ADR**: [`docs/adr/0004-accordion-chunked-compaction.md`](../../docs/adr/0004-accordion-chunked-compaction.md) — the durable architectural record; this PRD is a strict subordinate.
- **Ticket grounding** (all closed under the parent map; consulted in composition, referenced from DECs above):
  - [T02 four-zone layout](./tickets/02-four-zone-layout.md), [T03 rollover trigger](./tickets/03-rollover-trigger-policy.md), [T04 broker integration](./tickets/04-broker-model-integration.md), [T05 cache-invalidation accounting](./tickets/05-cache-invalidation-accounting.md), [T06 group representation](./tickets/06-group-representation.md), [T07 tool-pair integrity](./tickets/07-tool-call-pair-integrity.md), [T11 ADR draft/accept](./tickets/11-draft-adr-0004.md), [T14 LLM necessity (α)](./tickets/14-llm-necessity-for-group-summaries.md).
- **Research findings** (closed AFK tickets): [T08 the-conductor-v2 + code-skeleton survey](./tickets/08-findings.md), [T09 vendor ADRs 0007/0008/0010/0016](./tickets/09-findings.md), [T10 hierarchical-grouping prior art](./tickets/10-findings.md).
- **Prototype**: [`.scratch/accordion-chunked-compaction/prototypes/d3-metric-surface-mock.md`](./prototypes/d3-metric-surface-mock.md) — the three-option D3 metric-surface mock; Option C ("both") was selected and is codified in `DEC-016`.
- **Context glossary** ([`CONTEXT.md`](../../CONTEXT.md)): existing entries for [Proactive Content Compression](../../CONTEXT.md#proactive-content-compression), [A1 Exemption List](../../CONTEXT.md#a1-exemption-list), [Frozen-Prefix Deadlock](../../CONTEXT.md#frozen-prefix-deadlock), and [Authoritative Accordion Folding Runtime](../../CONTEXT.md#authoritative-accordion-folding-runtime) are the load-bearing definitions. No new glossary entry is required by this PRD ("chunked compaction" is fully specified by ADR-0004 and needs no cross-repo glossary shorthand).
- **Related ADRs**: [`docs/adr/0002-authoritative-accordion-folding-runtime.md`](../../docs/adr/0002-authoritative-accordion-folding-runtime.md) (cache-aware folding contract this PRD's engine tweak extends); [`docs/adr/0003-proactive-content-compression.md`](../../docs/adr/0003-proactive-content-compression.md) (the transport-layer precedent whose A1 exemption list makes chunked compaction structurally necessary).
- **Vendor-repo grounding**: The subagent grounding pass verified: `MyCustomizeConductor` class at `my-customize-conductor.ts:71` (also verified at line 74 during to-issues grounding — anchor may vary by a few lines); `conduct()` signature at line 82; no `attach(host)` currently; no `constants.ts` currently; no `preGroupTokens` symbol anywhere in the vendor codebase; the frozen-grouping pressure valve at lines 217–237 (unchanged); `estimateDefaultGroupDigestCost` at line 49; `Math.max(2_000, 0.05 * cap)` at line **279** (anchor updated from PRD-drafting-time line 233); `CacheTrackerDiagnostics` shape at `cache-tracker.ts:17–23`; `getDiagnostics()` at `cache-tracker.ts:67`; `writeContextDiagnostic()` and its two-branch structure in `accordion.ts` (writer at ~L**433**, apply-plan branch with `cacheTracker.getDiagnostics()` in scope at ~L**1227**, passthrough branch at ~L1207–1225 — anchors updated from PRD-drafting-time ~L368 / ~L1156/1183/1207/1215); `applyPlan` Phase A fixpoint at `mapping.ts:~L345–372`; `substOne` at `store.svelte.ts:1103` with clamp at `1113–1116` (unchanged — handles `"fold" | "replace"` only); **`groupCmd` at `store.svelte.ts:1166–1179` with frozen clamp at `1174–1176` (the actual target of `DEC-012`, dispatched via `case "group"` at `store.svelte.ts:1077–1079`)**; `groupDigest()` engine default at `digest.ts:198` routed via `store.svelte.ts:745`; `resolveUnfold` at `plan.ts:100` with per-block match loop at `~120–135` (anchors updated from PRD-drafting-time 105 / 127–155); `store.unfold(id, by)` at `store.svelte.ts:1439–1456`; `GroupCommand` type at `conductors/contract/conductor.ts:254–259`; **`ConductorHost.setStatus(text, metrics?, details?)` at `conductors/contract/conductor.ts`** (three arguments — not `host.emit(…)`); `CONDUCTOR_PROTOCOL_VERSION = 3` at `protocol.ts:32`; `protectedFromIndex` walk-back at `store.svelte.ts:824–847`; group rendering call sites `display.ts:43`, `tileDraw.ts:432–479`, `ContextMap.svelte:~113/~1000`; the v0 test at `conductor.compaction-naive.test.ts:336–338`. **Test command corrected**: no root `package.json` in the vendor repo; app package is `accordion-app`; correct invocation is `cd F:/MyWork/my-pi/vendor/accordion/app && pnpm vitest run <filename-fragment>`.
- **Considered options preserved for the record**: γ async LLM broker; β deterministic-first + opportunistic LLM upgrade; JSON write-through persistence per session; shared cross-session cache; new `era` command variant; observed cache-hit-rate plumbing into the trigger. All rejected — rationale is captured on the individual DECs and in ADR-0004's Considered Options section.
- **The-conductor-v2 reuse note**: several helpers named in the grounding evidence (`contentHash(block)` at `strategy.ts:~L1475–1483`; the `SummaryProvider` pattern at `the-conductor.ts:~L178–219`) were originally the reuse candidates under the γ shape; only `contentHash(block)` (adapted for a corpus-level hash) survives under α. The `pruneEmbeddingCache()` misnamed function at `strategy.ts:~L1475` — which also prunes `summaryCache` and `pendingSummaryHashes` — is a **DANGER symbol** that implementers must not invoke; no analogous cache exists here to be pruned.

