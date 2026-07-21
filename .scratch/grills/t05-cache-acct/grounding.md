> Historical path note: Accordion was later relocated to `extensions/accordion/` and `extensions/accordion/broker/` by `.scratch/accordion-first-party-extension/issues/01-adopt-accordion-as-first-party-extension.md`.

# Grounding — Ticket 05 (Cache-invalidation accounting)

## Inherited from closed tickets

- **T02 (four-zone):** `preGroupTokens = 15_000` soft cap; overflow 1.25 → 18_750; inert when `contextWindow < 128_000`.
- **T03 α-amended:** fast-path gate `preGroupTokens ≥ 15_000 && preGroupEndsOnTurnBoundary && noOpenToolPairAcrossPreGroupTail && estimatedGroupSaving ≥ max(2_000, 0.05 * cap)`; escape valve at `> 18_750`; **synchronous single-pass emission**; no `pendingRolloverHash`, no `host.complete()`, no failure path. Frozen-grouping pressure valve at `live > hardCap` is the sole unshared fallback.
- **T03 inheritance line for T05:** "exactly one KV-cache-prefix break per successful rollover; zero interstitial breaks while pending (there is no pending state under α). Ticket 05's spec need not carry the pending-state case at all."
- **T14 α:** no LLM broker for group summaries; digest is deterministic pure function of pre-group corpus. Reload re-emits byte-identical `GroupCommand`.
- **T04:** dashboard read-only; reuses existing `group` rendering + `conductor/status` telemetry + textual header. **No new Broker API surface.**
- **T06:** digest carries `⟨chunked-compaction · N blocks · turns X–Y · content-hash <hash>⟩` header. `recall` of a group-member code = tail-append synthesised `recall()` tool_call/tool_result.

## Repo evidence (verified this session)

### `extension/cache-tracker.ts` — F:/MyWork/my-pi/vendor/accordion/
- Fields on `CacheTrackerDiagnostics`: `frozenFromIndex`, `reason` ∈ `cold-start | provider-changed | system-changed | tools-changed | prefix-mismatch | prefix-match | error`, `messageCount`, `previousMessageCount`, `matchedPrefix`.
- **Module-level singleton** state — no per-session isolation, no history/accumulator; every `before_provider_request` overwrites.
- Emits: `getFrozenFromIndex()`, `getDiagnostics()`, `reset()`. No public "break count" or "hit rate".
- Consumed by:
  - `accordion.ts:638` — `harnessFrame()` puts `frozenFromIndex` in every `sync` frame (GUI sees it).
  - `accordion.ts:1159/1198/1219/1250` — `getDiagnostics()` written to JSONL context log per turn.
  - `proactive-compress.ts:64` — skips compression of already-frozen messages.
- **Reason** is NOT on `ConductorView` — conductor sees only the index.

### `ConductorView.frozenFromIndex` — `conductors/contract/conductor.ts:102-109`
> "Index of the first block the conductor may fold. Blocks before this index are in the provider's prompt cache prefix. 0 = no frozen prefix (cold start, unknown provider, or cache expired). Host-enforced: fold/replace commands targeting blocks below this index are clamped with reason 'frozen'."

### `my-customize-conductor` — F:/MyWork/my-pi/vendor/accordion/conductors/my-customize-conductor/
- **Emits ZERO `conductor/status`** today. Has no `attach(host)`. Pure synchronous `conduct(view) → Command[]`.
- Existing frozen-grouping gate: `frozenEpochKey !== lastFrozenGroupEpochKey && totalFrozenSaving >= max(2_000, 0.05 * cap)`; fires only when `liveTokens > hardCap`.
- `estimateDefaultGroupDigestCost(run)` ≈ 24-30 tokens for a run header — well below any block-savings amount.
- Private state: `lastFrozenGroupEpochKey`, `lastSavings`, `lastSemanticKey`, `lastViewKey`, `lastPlan`.
- **No tracking** of rollover count / tokens saved / KV-break count anywhere in this conductor.

### `conductor/status` contract — `conductors/contract/protocol.ts` + `vendor/accordion/docs/conductor-protocol.md`
```ts
{ type: "conductor/status", text?: string, metrics?: Record<string, number|string|boolean>, details?: JSONValue }
```
> "Purely informational. The host renders `text` (and may use the optional structured `metrics`/JSON-shaped `details`) and does **nothing else** — it never folds, alters commands, or triggers a model call on this."
- Existing rich emitters: `the-conductor-v2`, `attention-folder`, `thermocline`, `tiered-relevance`. Template metrics: `fullness`, `folded`, `groups`, `pressure`, `foldTarget`.

### Provider prompt-cache economics
- **Anthropic:** SDK-computed `usage.cost.cacheRead` / `usage.cost.cacheWrite` — the *only* per-provider cost math visible. No `cache_control` breakpoints in this repo; delegated to Pi SDK.
- **OpenAI:** auto-cache (≥1024 tokens, exact prefix); `cache-tracker.ts:89` has one branch (`if provider === "openai"` skip embedded system) — that is the entire OpenAI-specific code path.
- **Gemini:** zero handling. `conductor-rework-roadmap.md:163` names "Gemini cost, cache hit/miss rate" as future work.
- Session cost report uses provider-agnostic `cache_miss` heuristic: `cost.total > $0.05 AND tokens.cacheRead < 10_000`.

### Break-even wording in prior art
- **ADR-0010 (attention conductor):** "~10x cost increase" for cache-miss on a 100k window. "Fold periodically, not continuously — change the fold set only at deliberate 'epochs'."
- **Thermocline:** "Tiny units (saving < `minFoldTokens`) are skipped."
- **PCC DEC-004:** "A stub is ~50 tokens. Folding it saves ~20-30 tokens — negligible in a hard overflow." — the closest algebraic break-even in prose.
- **No canonical formula** exists across ADRs.

### Constraints on upward surface (from PRD DEC-006 + ADR-0002)
- Dashboard/broker is read-only; **no new Broker API for accounting**. `conductor/status` is the only sanctioned channel. JSONL context log already exists as postmortem seam.
