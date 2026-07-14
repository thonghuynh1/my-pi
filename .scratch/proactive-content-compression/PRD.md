# PRD: Proactive Content Compression for Accordion

## Problem Statement

Accordion's cache-aware folding correctly prevents mutations inside the provider's frozen prefix. However, this creates a deadlock: by the time the budget is exceeded, most tool_result blocks are frozen and untouchable. The conductor returns empty plans and sessions never fold. Users who set a budget slider expecting context management get no folding because the frozen prefix grows faster than budget pressure accumulates.

Actors affected: developers using Accordion with any conductor (builtin or my-customize-conductor) on sessions with substantial tool output (grep, bash, file reads).

## Solution

Compress tool_result content at the transport layer (`before_provider_request`) before the provider first caches it. The provider caches already-small content. The frozen prefix contains compact blocks. Budget is rarely exceeded. When it is, the conductor handles conversation blocks (which are typically smaller). The agent retrieves full originals via the existing `recall(code)` mechanism, which appends at the tail — no cache break.

## User Stories

1. As a developer using Accordion, I want large tool results to be structurally compressed before the provider caches them, so that the frozen prefix stays small and my budget is effective.
2. As a developer, I want a recall marker in compressed tool results, so that I can retrieve the full original when I need detailed content.
3. As a developer using poteto-mode, I want MCP tool results exempt from proactive compression, so that pstack skill content remains intact for conductor identity detection and beacon injection.
4. As a conductor author, I want proactively-compressed blocks clearly marked, so that my conductor skips them and avoids double-compression.

## Required Behaviors

- `RB-001`: Proactive compression must run in `before_provider_request` BEFORE the cache tracker snapshots, so the tracker sees and caches the compressed version.
- `RB-002`: Proactive compression must not modify blocks with `order < frozenFromIndex` (already-cached content must not change).
- `RB-003`: Blocks where `toolName === "mcp"` must be exempt from compression.
- `RB-004`: The original content must be stored in the recall store keyed by the block's recall code, retrievable via the existing `recall(code)` tool.
- `RB-005`: Compressed output must include a recall marker visible to the agent (e.g. `[Full output available: recall("code")]`).
- `RB-006`: Compression must be fixed-aggressive (SmartCrusher-style): keep first/last lines + structural shape, target a hard cap (e.g. ~200 tokens output regardless of input size).
- `RB-007`: The conductor must skip proactively-compressed blocks (no double-folding).
- `RB-008`: Blocks below a minimum token threshold (e.g. 300 tokens) must pass through uncompressed.

## Accepted Decision Register

- **DEC-001** — **Transport-layer compression (A1 in `before_provider_request`)**
  - Decision: Compress at the wire payload level before provider sees content, not in the conductor or block store.
  - Rationale: Prevents the frozen-prefix deadlock entirely. Provider caches already-small content. No cache break ever needed for tool results.
  - Rejected alternatives: (1) Lower `breakFrozen` gate to soft budget — still breaks cache. (2) Double-layer A1+conductor fold — creates recall-chain problem where `recall` returns compressed version, not original. (3) Adaptive conductor-only — doesn't solve frozen blocks being untouchable.
  - Downstream impact: Hook registration order matters (A1 before cache tracker). Conductor candidate filter needs update.
  - Depends on: None
  - Decided implementation: New module `extension/proactive-compress.ts` registered on `before_provider_request` before cache-tracker. Rewrites `payload.messages[i].content` for qualifying tool_result messages.
  - Left to the implementer: Exact line-budget heuristic (how many first/last lines to keep), token estimation method for threshold check.

- **DEC-002** — **MCP tool_result exemption**
  - Decision: Never compress blocks where `toolName === "mcp"`.
  - Rationale: MCP results carry operational directives (poteto-mode pstack content). Conductor needs full content for identity detection and beacon injection. Compressing would break poteto-mode activation.
  - Rejected alternatives: Content-based detection (parse for pstack markers) — fragile, over-engineered.
  - Downstream impact: None — MCP results pass through as they do today.
  - Depends on: DEC-001
  - Decided implementation: Simple `toolName` check in the compression filter.
  - Left to the implementer: Whether to also exempt `recall` tool results (likely yes — they are already recalled content).

- **DEC-003** — **Fixed aggressive compression (SmartCrusher-style)**
  - Decision: Compress to a fixed target size regardless of context pressure. No adaptive ratio.
  - Rationale: Recall is the safety net. If the agent needs full content, it calls `recall()`. Proactive compression should be aggressive and deterministic. Adaptive complexity adds no value when recall exists.
  - Rejected alternatives: Adaptive pressure curve (Headroom-style) — unnecessary given recall mechanism. Size-proportional compression — unpredictable output size.
  - Downstream impact: Recall usage will increase. Agents see compressed tool outputs by default.
  - Depends on: DEC-001
  - Decided implementation: Structural compression: keep first N lines + last M lines + shape/stats line + recall marker. Hard cap at ~200 output tokens.
  - Left to the implementer: Exact N/M values, whether to include a line count or byte count in the stats line.

- **DEC-004** — **Conductor skips proactively-compressed blocks**
  - Decision: Clean separation — A1 owns tool_result compression, conductor owns conversation/MCP blocks. Conductor never folds a proactively-compressed block.
  - Rationale: Prevents double-compression and the recall-chain problem (recall returning compressed instead of original).
  - Rejected alternatives: Allow conductor to fold compressed blocks with chained recall — complex, still breaks cache if conductor folds frozen content.
  - Downstream impact: Conductor candidate pool shrinks. This is intentional — those blocks are already small.
  - Depends on: DEC-001
  - Decided implementation: Conductor instance state tracks compressed block IDs (received via `ViewBlock` metadata or a new field). Filter in candidate selection.
  - Left to the implementer: Whether to use a new `ViewBlock` field (requires contract change) or detect via content marker pattern.

- **DEC-005** — **Reuse existing recall store**
  - Decision: Store originals using the same mechanism as conductor fold recall. Agent uses `recall(code)` — same UX, no new tool.
  - Rationale: No new tools to expose. Agent already knows `recall`. Appends at tail — cache-safe.
  - Rejected alternatives: Separate retrieval tool (Headroom's `headroom_retrieve` pattern) — adds tool surface area for no benefit when `recall` already exists.
  - Downstream impact: Recall store will hold more entries (every compressed tool_result, not just folded blocks).
  - Depends on: DEC-001
  - Decided implementation: A1 generates a fold code, stores `{ code, text: originalContent }` in the recall store before rewriting the payload.
  - Left to the implementer: TTL policy (if any), store cleanup strategy for long sessions.

## Implementation Plan

### Area: Proactive Compression Module

- **Coverage**: DEC-001, DEC-002, DEC-003, DEC-005, US-001, US-002, US-003, RB-001, RB-002, RB-003, RB-004, RB-005, RB-006, RB-008
- **Contract**: On each `before_provider_request`, iterate `payload.messages`. For each tool_result message: check threshold, check exemptions, compress content, store original, rewrite payload.
- **Decision constraints**: DEC-001 (transport layer), DEC-002 (MCP exempt), DEC-003 (fixed aggressive), DEC-005 (recall store reuse)
- **Code anchors**: `extension/payload-audit.ts` (hook pattern), `extension/cache-tracker.ts` (hook registration), `extension/accordion.ts` (main setup ~line 1490)
- **Existing behavior**: `payload-audit.ts` hooks `before_provider_request` for diagnostics only. Returns `undefined`.
- **Required edits**:
  - New file `extension/proactive-compress.ts` — compression logic + hook handler
  - `extension/accordion.ts` — register proactive-compress hook BEFORE cache-tracker
  - Recall store integration — store original content keyed by generated fold code
- **Normative snippet**:
  ```ts
  // proactive-compress.ts — core filter
  function shouldCompress(msg: ToolResultMessage): boolean {
    if (msg.toolName?.toLowerCase() === "mcp") return false;
    if (msg.toolName?.toLowerCase() === "recall") return false;
    if (estimateTokens(msg.content) < MIN_TOKEN_THRESHOLD) return false;
    if (msg.index < frozenFromIndex) return false;
    return true;
  }
  ```
- **Test seam**: Unit tests for compression logic (threshold, exemptions, output format). Integration test: mock `before_provider_request` event, verify payload is rewritten and original stored.
- **Wiring**: Hook registration order in `accordion.ts` — proactive-compress first, then cache-tracker, then payload-audit.
- **Grounding evidence**: GROUND-001, GROUND-006, GROUND-007, GROUND-008

### Area: Conductor Integration (my-customize-conductor)

- **Coverage**: DEC-004, US-004, RB-007
- **Contract**: Conductor must not fold blocks that were proactively compressed. Detection via content marker pattern or new ViewBlock field.
- **Decision constraints**: DEC-004 (clean separation)
- **Code anchors**: `conductors/my-customize-conductor/my-customize-conductor.ts` lines ~122–135 (candidate filter)
- **Existing behavior**: Filters by `!held && !protected && !grouped && foldedTokens < tokens && FOLDABLE_KINDS.has(kind) && order >= frozenFromIndex`
- **Required edits**:
  - Add detection of proactively-compressed blocks (marker pattern in `text` or new metadata)
  - Add to candidate filter: skip proactively-compressed blocks
- **Normative snippet**:
  ```ts
  const candidates = allCandidates.filter(
    (b) => b.order >= view.frozenFromIndex && !isProactivelyCompressed(b)
  );
  ```
- **Test seam**: Existing conductor tests in `app/src/lib/engine/conductor.my-customize-conductor.test.ts`. Add case: block with compression marker is excluded from candidates.
- **Wiring**: No DI changes. Detection function imported from shared utility.
- **Grounding evidence**: GROUND-004, GROUND-005

### Area: Recall Store Extension

- **Coverage**: DEC-005, US-002, RB-004, RB-005
- **Contract**: Proactive compression stores originals in the same store that conductor folding uses. `recall(code)` returns the full original (2000 tokens), not the compressed version.
- **Decision constraints**: DEC-005 (reuse existing store)
- **Code anchors**: `app/src/lib/engine/store.svelte.ts` (AccordionStore), `app/src/lib/live/plan.ts` (resolveRecall)
- **Existing behavior**: `block.text` is never mutated. Recall reads `store.get(b.id)?.text`. But A1 operates at the payload level, not the block store level — the block store will contain the COMPRESSED text (since that's what the provider saw and what gets linearized into blocks).
- **Required edits**:
  - A1 must register the original content in a separate recall map (keyed by fold code) BEFORE rewriting the payload
  - `resolveRecall` must check the proactive-compression recall map in addition to `block.text`
  - Or: A1 writes original into a sidecar store that `recall` checks first
- **Test seam**: Existing recall tests. Add case: recall code from proactive compression returns full original, not compressed text.
- **Wiring**: Sidecar store exposed from `proactive-compress.ts`, consumed by recall resolution in the extension's recall handler.
- **Grounding evidence**: GROUND-002

## Global Build & Wiring Notes

- Hook registration order in `accordion.ts` is critical: proactive-compress → cache-tracker → payload-audit. The cache tracker must snapshot the already-compressed payload.
- No new tools exposed to the agent — `recall(code)` already exists.
- No changes to the conductor contract (`ConductorView`, `ViewBlock`) are strictly required if detection uses content marker patterns. If a new `ViewBlock.proactivelyCompressed` boolean is preferred, that's a contract change requiring conductor contract version bump.

## Testing Decisions

| Seam | What to test | Prior art |
|---|---|---|
| Compression filter | Threshold, MCP exemption, recall exemption, frozen skip | New unit tests |
| Compression output | First/last lines preserved, recall marker present, output under token cap | New unit tests |
| Recall store | Original stored, retrievable by code, returns full content | Extend existing recall tests |
| Hook ordering | Cache tracker sees compressed content (snapshot matches next turn) | Integration test with mock hooks |
| Conductor skip | Proactively-compressed blocks excluded from candidates | Extend existing conductor tests |

## Out of Scope

- Adaptive compression ratio (decided: fixed aggressive, DEC-003)
- Compressing assistant or user messages
- Compressing MCP tool results
- Changes to the `pi` package or provider hooks API
- TTL-based eviction of the recall store (may be added later for long sessions)
- Image content in tool results (pass through unmodified)

## Unresolved Gaps

None.

## Further Notes

- Grounding evidence: `.scratch/proactive-content-compression/grounding.md`
- Related ADR: `docs/adr/0003-proactive-content-compression.md`
- Related prior work: `.scratch/cache-aware-folding/PRD.md` (the frozen-prefix system this builds on)
- Reference architecture: Headroom SmartCrusher (`headroomlabs-ai/headroom` — `crates/headroom-core/src/transforms/smart_crusher/`)
