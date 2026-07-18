---
labels: wayfinder:research
status: done
ticket: 08-survey-conductor-v2-skeleton
map: ../MAP.md
---

# Findings: Survey the-conductor-v2 and code-skeleton

All refs relative to `F:/MyWork/my-pi/vendor/accordion/conductors/`.

## 1. the-conductor-v2

### 1a. Async LLM wiring
`the-conductor-v2` runs as a WebSocket server, so its equivalent of `host.complete()` is `createHostSummaryProvider()` in `the-conductor.ts` (~L178-219):
- Returns a `SummaryProvider` that wraps each call in a Promise.
- Checks `state.closed` / `ws.readyState`; rejects immediately if gone.
- Assigns `reqId = "summary-${++state.capSeq}"`.
- Sets a `setTimeout` (default 120 s, `ACCORDION_SUMMARY_TIMEOUT_MS`) that rejects and increments `state.summaryErrors`.
- Stores `{ resolve, reject, timer }` in `state.pendingCompletions: Map<reqId, ...>`.
- Sends `{ type: "cap/request", reqId, capability: "complete", completion: { system, prompt, maxOutputTokens } }`.

`handleCapResult()` (~L221-235) resolves/rejects on `cap/result`.

For in-process conductors (like `my-customize-conductor`), the equivalent semantic pattern is `host.complete(prompt)` gated by `host.can("complete")`.

Re-plan trigger:
```ts
state.deps = {
  ...,
  onSummary: () => {
    if (state.closed) return;
    recomputeAndSend(ws, state, state.lastView?.rev ?? -1);
  },
};
```
Pattern: render deterministic digest first, upgrade in-place when LLM summary lands.

### 1b. In-flight dedup
`strategy.ts:summaryFor()` (~L1620-1645):
```ts
if (!state.pendingSummaryHashes.includes(hash)) {
  state.pendingSummaryHashes.push(hash);
  void deps.summaryProvider({ block, hash, digest })
    .then(summary => { state.summaryCache[hash] = summary.trim(); deps.onSummary?.(hash, summary); })
    .catch(err  => { deps.log?.(`summary failed: ${err}`); })
    .finally(() => { state.pendingSummaryHashes = state.pendingSummaryHashes.filter(h => h !== hash); });
}
return digest;
```
`pendingSummaryHashes` is an array (O(n)). Fine for ≤20 concurrent; switch to `Set` at scale.

### 1c. Cache key
`strategy.ts:contentHash(block)` (~L1475-1483) = SHA-256 of `{kind, toolName, callId, isError, text.replace(/\s+/g," ").trim()}`. Cache: `state.summaryCache: Record<hash, string>`.

For **group summaries** the analogous key is a content hash of the **pre-group corpus** (concat block texts or their per-block hashes), so re-runs hit cache even after session resume/block-id changes.

### 1d. Error handling
- Silent skip + fallback: `.catch()` logs, returns deterministic digest. In-flight hash cleaned in `.finally()`.
- Timeout: increments `state.summaryErrors`, sets `state.lastSummaryError`.
- CAP error: same counter path.
- `state.accState.providerError` cleared on success (reset-on-success).
- No retry — passive retry happens on next `summaryFor()` call. This is intentional.

### 1e. Pluggable vs baked-in
**Pluggable via `ConductorDependencies`** (strategy.ts): `summaryProvider`, `embeddingProvider`, `onSummary`, `log`, numeric overrides (`unfoldMargin`, `hysteresisMargin`, etc.).

**Baked into `the-conductor.ts`** (server layer): WebSocket lifecycle, registry heartbeat, `createHostSummaryProvider`, `ConnState`, `maybeWarm`, `warmInFlight`, `recomputeAndSend`, `sendStatus`.

**Pure strategy core (`strategy.ts`)**: `computeFoldPlan()`, `summaryFor()`, `contentHash()`, `textHash()`, `deterministicDigest()`, provider factories (Haiku, Ollama, Gemini, OpenAI-compat).

**Output adapter (`commands.ts`)**: `buildCommands()` translates `FoldPlan` → `Command[]`.

### 1f. Cache invalidation
`the-conductor-v2` does **not** use `frozenFromIndex` or `breakFrozen`. It operates at fold level, not KV-prefix level.
- `pruneEmbeddingCache()` (~L1475) runs every pass — also prunes `summaryCache` and `pendingSummaryHashes` to live block set. **Misnamed and DANGEROUS for group summaries** (they must be immutable).
- `ws.close`: all caches zeroed, `pendingCompletions` drained/rejected.

## 2. code-skeleton

### 2a. Deterministic digest keying
- `cache: Map<block.id, Skeleton|null>` in `CodeSkeletonConductor`.
- `skeletonize(source, lang)` is pure — no Date, no random, no globals. Same input → byte-identical output.
- Cache cleared only on `attach()`/`detach()`.
- Skeleton emitted verbatim every pass → KV cache stays warm.
- No content hash needed because block ID = immutable identity by convention.

### 2b. Recovery
- `conduct()` emits `{ kind: "replace", id, content: sk.content, recoverable: true }`.
- `recoverable: true` → engine adds `{#code FOLDED}` tag → agent can `unfold`/`recall`.
- Conductor does NOT store originals; engine owns.
- Header injected: `⟨code skeleton · <path> · <N>L → <k>L · <elided> elided · call unfold for full source⟩`.

### 2c. Precision gating (5 sequential gates)
1. Kind: `tool_result && !isError`
2. Tool family: direct read tool OR single-file shell dump; hard-reject pipes/chains/redirects/globs/follow-streams/search commands.
3. Extension in `CODE_EXTS` && not in `PROSE_DATA_EXTS`.
4. Source cleaning: strip pi headers, `cat -n` prefixes (≥60% match), truncation notes.
5. Content shape: ≥2 of (keyword, punctuation density ≥1/40 & ≥6 chars, ≥2 indented lines).

Thresholds: `MIN_SKELETON_TOKENS = 1500`, `MAX_SKELETON_RATIO = 0.6`. Uses `host.can/countTokens/setStatus`. No `host.complete()`.

## Reuse list (directly adoptable)

| Pattern | Source |
|---|---|
| `contentHash(block)` as immutable summary cache key | `strategy.ts:contentHash` |
| `pendingSummaryHashes` dedup guard | `strategy.ts:summaryFor` |
| Silent-skip + digest fallback on broker error | `strategy.ts:summaryFor .catch` |
| `onSummary` → re-plan trigger | `the-conductor.ts` L357-366 |
| `warmInFlight` boolean for single-op concurrency | `the-conductor.ts:maybeWarm` |
| `recoverable: true` on `ReplaceCommand` | `code-skeleton.ts:conduct` |
| Block-ID-keyed memo cache (cleared on attach/detach) | `CodeSkeletonConductor.cache` |
| Tool-pair atomicity via `callId` | `strategy.ts:buildFoldUnits` |
| `ConductorDependencies` DI for provider swap | `strategy.ts` |

## Diverge list

| Concern | Why |
|---|---|
| Group summary cache key | Hash the pre-group **corpus** text, not per-block, so it survives session resume + block-id churn. |
| Cache pruning | `pruneEmbeddingCache` prunes `summaryCache`. Group summaries need a separate **never-pruned** `groupSummaryCache`. |
| Reconnect cold-start | v2 discards all caches. Group summaries are meant to be persistent — decide save/restore explicitly (fog on MAP.md). |
| `onSummary` re-plan granularity | v2 fires full re-plan on every summary. Debounce/batch for multiple simultaneous rollovers. |
| WebSocket vs in-process | Use `host.complete()` in-process; adapt promise/reqId pattern accordingly. |

## Gotchas

1. `pendingSummaryHashes` is O(n); use `Set` if concurrency grows.
2. `looksCallable` has a 2000-char line guard for regex backtracking; mirror in any pre-group classifier.
3. `contentHash` is SHA-256 per call, not memoized. Negligible per-block, adds up over huge groups.
4. **`pruneEmbeddingCache` is misnamed** — also prunes summaryCache + pendingSummaryHashes. Do NOT pass a `groupSummaryCache` to it.
5. `ACCORDION_SUMMARY_TIMEOUT_MS = 120 s`. Group summary broker call likely wants a separately-configurable timeout.
6. No retry logic — passive retry on next view update is by design.
7. `ws.close` guard in `onSummary` (`state.closed`) — replicate in the conductor.
