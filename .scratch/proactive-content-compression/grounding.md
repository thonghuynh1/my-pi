### GROUND-001 — before_provider_request hook
- Source: `extension/payload-audit.ts` → `api.on?.("before_provider_request", ...)`
- Existing behavior: Records payload sizes for diagnostics. Returns `undefined` (pass-through).
- Current excerpt: `(event: { payload?: unknown }) => unknown` — returning undefined is pass-through; returning a value replaces the payload (undocumented but structurally supported).
- Payload shape: `payload.messages` (Anthropic/OpenAI Chat), `payload.input` (OpenAI Responses), `payload.system`, `payload.tools`
- Test prior art: No existing tests for payload mutation; `payload-audit.ts` is diagnostic-only.

### GROUND-002 — Recall store (block.text preservation)
- Source: `app/src/lib/engine/store.svelte.ts` → `AccordionStore`
- Existing behavior: `block.text` is NEVER mutated by folding. Folding writes to `block.autoFolded` and `block.subst`. Recall reads `store.get(b.id)?.text`.
- Current excerpt: `restored.push({ code, label: blockLabel(b), text: store.get(b.id)?.text ?? b.text, ids: [b.id] })` (plan.ts line 177–211)
- Test prior art: `app/src/lib/engine/store.svelte.ts` tests in the app test suite.

### GROUND-003 — Block type definition
- Source: `app/src/lib/engine/types.ts` lines ~37–88
- Existing behavior: No custom flags/tags field. Conductor-writable field is `subst` only. Conductor instance state (Set<string>) is the existing pattern for tracking block categories.
- Key fields for tool_result: `id`, `kind: "tool_result"`, `text`, `tokens`, `toolName`, `callId`, `isError`

### GROUND-004 — Conductor candidate filtering (my-customize-conductor)
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts` lines ~122–135
- Existing behavior: `allCandidates = view.blocks.filter(b => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens && FOLDABLE_KINDS.has(b.kind))` then `candidates = allCandidates.filter(b => b.order >= view.frozenFromIndex)`
- Where skip check would go: Additional filter `&& !proactivelyCompressed.has(b.id)` on the candidates filter.

### GROUND-005 — MCP result detection (poteto-mode)
- Source: `conductors/my-customize-conductor/my-customize-conductor.ts`
- Existing behavior: `isMcpResult(b)` checks `(b.toolName ?? "").trim().toLowerCase() === "mcp"`. Poteto-mode activates when the MCP result contains a pstack identity for "poteto-mode". Beacon injection into newest eligible copy.
- Implication: MCP results must not be compressed by A1 — conductor needs full content for identity parsing and beacon generation.

### GROUND-006 — tool_result block linearization
- Source: `extension/mapping.ts` → `linearize` function, lines ~175–190
- Existing behavior: `push(blockId(m, i), "tool_result", flattenContent(m.content).text, { toolName, callId, isError }, imageTokens)`
- Implication: A1 intercepts at payload level (messages array), not at block level. Compression rewrites `message.content` in the wire payload before sending to provider.

### GROUND-007 — Cache tracker frozen prefix
- Source: `extension/cache-tracker.ts`
- Existing behavior: Fires on `before_provider_request`, compares message strings to previous snapshot, sets `frozenFromIndex = Math.max(0, matchedPrefix - 1)`.
- Ordering: Cache tracker runs on same hook. A1 must run BEFORE cache tracker snapshots, or the snapshot will capture pre-compression content and never match post-compression content on next turn.
- Implication: Hook registration order matters. A1 must register first so the cache tracker sees the compressed payload.

### GROUND-008 — Headroom SmartCrusher reference architecture
- Source: `headroomlabs-ai/headroom` → `crates/headroom-core/src/transforms/smart_crusher/config.rs`
- Behavior: Fixed aggressive compression. `max_items_after_crush = 15`, `min_items_to_analyze = 5`, `min_tokens_to_crush = 200`. Always keeps first 30% + last 15% of selected items. Errors/anomalies always pinned.
- Recall: `<<ccr:HASH rows_offloaded>>` marker + `headroom_retrieve(hash)` tool. TTL 30 min.
