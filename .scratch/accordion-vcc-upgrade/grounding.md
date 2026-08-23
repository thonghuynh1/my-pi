# Grounding — search-within-fold architecture

## Accordion tool surface

- `extension/accordion.ts:1500` — `pi.registerTool({ name: "unfold", ... })` — `codes: string[]` parameter
- `extension/accordion.ts:1548` — `pi.registerTool({ name: "recall", ... })` — `codes: string[]` parameter
- Exactly 2 tools registered total

## Recall tool execute path

- `extension/accordion.ts:1568` — `execute()` first checks `proactiveCompress.resolveOriginals(codes)` (in-process Map bypass), then calls `requestRecall(remainingCodes)` over WebSocket for the rest
- Return shape: `{ content: [{ type: "text", text: "[recalled <label> (#<code>)]\n<full original text>" }] }` — always full content, one block per code

## Block storage

- `app/src/lib/engine/types.ts:38` — `/** Full, normalized text content. Never mutated by folding. */ text: string;` on `Block`
- Folding is a view overlay (`autoFolded`, `override`, `subst`); `Block.text` always holds the original

## Wire protocol

- `app/src/lib/live/protocol.ts:214` — `RecallRequestMessage { type: "recallRequest"; reqId: number; codes: string[] }`
- `app/src/lib/live/protocol.ts:337` — `RecallResultMessage { type: "recallResult"; reqId: number; restored: RecallContent[]; missing: string[] }`
- `ServerMessage` union at line 244 — extension→GUI: `HelloMessage | SyncMessage | StreamMessage | UnfoldRequestMessage | RecallRequestMessage | CompleteResultMessage`
- `ClientMessage` union at line 344 — GUI→extension: `PlanMessage | UnfoldResultMessage | RecallResultMessage | CompleteRequestMessage`
- Adding a new message type: add interface, extend union — non-breaking, ~15 lines per side

## Proactive-compress store

- `extension/proactive-compress.ts:11` — `const originals = new Map<string, string>()` — keyed by 6-char SHA-256 hex of content
- Lives in extension process, not in GUI; populated by `before_provider_request` hook for tool results ≥300 tokens
- `resolveOriginals(codes)` returns `{ code, label, text }[]` — same shape as `RecallContent`

## Block.text availability for search

- Normal blocks: `Block.text` = full original (never mutated by folding)
- PCC blocks (`proactivelyCompressed: true`): `Block.text` = COMPRESSED snippet, NOT the original
  - True original lives ONLY in `proactive-compress.ts` originals Map (extension process, volatile)
  - GUI has NO path to the PCC original today
  - `recall` tool bypasses GUI for PCC codes via `proactiveCompress.resolveOriginals(codes)` — never sends to GUI
- Timing: `context` hook fires BEFORE `before_provider_request` — first sync has original, subsequent syncs have compressed
- PCC blocks are rejected from fold commands (`store.svelte.ts:1233` reason: "proactively-compressed")

## Group digest system

- `app/src/lib/engine/digest.ts` — `groupDigest(group, members)` — pure deterministic function, produces one-liner: `{#code FOLDED} group · N blocks · turns A–B · ~T tok · X replies, Y calls · "ask…"`
- `conductors/contract/conductor.ts:245–280` — `GroupCommand` carries a digest body plus `lifecycle?: "transient" | "rollover"`; the host owns the authoritative fold tag
- `store.svelte.ts:1878` — `createGroup()` guard: rejects if any member already in a group (flat invariant)
- `types.ts:~73` — Group type doc: "flat (members are blocks, never groups)"
- `ViewBlock` exposes: `grouped: boolean` (no groupId), `text` is always original content (not digest)
- Conductor excludes `grouped` blocks from all candidate sets — hard barrier in rollover planning

## Semantic section extractors (pi-vcc reference)

- `pi-vcc/src/extract/goals.ts` — `extractGoals(blocks)` — scans user blocks for task-intent verbs, scope-change pivots
- `pi-vcc/src/extract/files.ts` — `extractFiles(blocks, fileOps?)` — scans tool_call blocks for file-path args to known tools
- `pi-vcc/src/extract/commits.ts` — `extractCommits(blocks)` — scans bash tool calls for git commit patterns
- `pi-vcc/src/extract/preferences.ts` — `extractPreferences(blocks)` — scans user blocks for prefer/always/never patterns
- `pi-vcc/src/core/build-sections.ts` — assembles all extractors into `SectionData`

## Canonical MCP Identity / MCP Retrieval Index

- `CONTEXT.md` — MCP Retrieval Index: maps recognizable MCP identities to recall codes in group digest
- `CONTEXT.md` — Canonical MCP Identity: server + tool + deterministic arg fingerprint

## Conductor group paths (slice 2 seams)

- `my-customize-conductor.ts:193–243` — rollover groups carry semantic digests with `lifecycle: "rollover"`
- `my-customize-conductor.ts:321–328` — pressure/emergency groups carry semantic digests with `lifecycle: "transient"`
- `store.svelte.ts:1798–1805` — `groupSummary(g)` strips any supplied tag and prefixes the group ID's authoritative fold tag
- `store.svelte.ts:1197–1199` — `case "group"` passes both `digest` and `lifecycle` to `groupCmd()`
- Group lifecycle, not digest text, controls frozen-prefix rewrites, preservation, member recall, and rollover diagnostics

## Two-process split

- GUI process: holds `AccordionStore.blocks[]` — searchable for normal blocks only
- Extension process: holds `originals` Map — searchable for PCC blocks only
- No shared memory; only connected by WebSocket

## Conductor fold-order logic (my-customize-conductor)

- `my-customize-conductor.ts` — NO scoring or ranking exists today
- Fold order is purely **oldest-first by `.order`** (absolute position)
- `conduct()` called on every context change (streaming token, budget change, tail resize)
- O(1) dirty guard keys on `headBlockCount`, `cap`, `viewKey` hash — essential for performance
- Fold sequence: hard-cap emergency → rollover → normal pressure → folds-to-cap → MCP recovery
- `FoldCommand` carries zero "why" metadata — just `ids[]`, optional `digest`, optional `breakFrozen`
- Guards: `held`, `protected`, `grouped`, `proactivelyCompressed` → skip; only `FOLDABLE_KINDS` (text, thinking, tool_result)

## ColdScoreConductor (separate conductor, not MyCustomize)

- `conductors/cold-score/score.ts` — full ACT-R scoring model
- Formula: `coldScore(b) = prior[kind] + activation(b) + pairWarmthBonus?`
- Kind priors: tool_result=0, thinking=8, text=16, tool_call=24, user=32 (lower = fold first)
- Decay: power-law ACT-R, per-kind exponents (tool_result=0.9, thinking=0.7, text=0.5)
- Pair warmth: +4 for blocks paired with tail callId
- Lexical pre-unfold: keep live blocks whose identifier appears in protected tail text

## pi-vcc rank.ts (reference scoring for brief selection)

- `pi-vcc/src/core/rank.ts` — additive weighted model for selecting blocks into a summary brief
- Recency: linear 0–12 (`round(index/(total-1)*12)`)
- Weights: edit=+34, test=+26, user=+18, workflow=+14, bash=+12, assistant=+10, read=+6, tool_result=+1
- Penalties: trivial bash=−16, long tool result (>1000ch)=−8
- Adjacency boost: blocks near important events (score≥34) get +10/+7/+5
- Segment-closing assistants: long assistant before user → +14
- Selection: preserve recent 16, sort rest by score desc, deduplicate repeated ops

## ViewBlock fields available for scoring

- `id`, `kind`, `turn`, `order`, `tokens`, `foldedTokens`, `toolName?`, `callId?`, `isError?`
- `text?` (optional — only with `wants:"full"`), `preview?`
- `held`, `folded`, `protected`, `grouped`, `proactivelyCompressed`

## ReplaceCommand (single-block digest substitution)

- `ReplaceCommand { kind: "replace"; id: string; content: string; recoverable?: boolean; breakFrozen?: boolean }`
- Empty content falls back to engine digest
- `recoverable: true` → host prepends `{#code FOLDED}` tag (agent can recall)
- Used today for MCP summaries in hard-cap emergency

## extractors.ts (slice 2 build)

- `extractAsks(blocks)` — user blocks, first line ≤60ch, 6 cap
- `extractFiles(blocks)` — tool_call for read/write/edit/find/grep/ls, path arg, 8 cap
- `extractErrors(blocks)` — isError===true, first line ≤80ch, 3 cap
- `buildMcpIndex(blocks)` — non-file tool_call with recallCode, 6 identities
- `buildSemanticDigest(blocks, meta)` — assembles sections, omits empties
- `blockTier(block)` — High/Medium/Low classification, NOT used by digest system
- `ExtractableBlock` interface: `id?`, `kind`, `toolName?`, `isError?`, `text?`, `recallCode?`, `retrievalIdentity?`, `tokens?` (D23 adds tokens)

## block-digest.ts (ticket 07 — to be built)

- New module in `app/src/lib/conductors/my-customize/block-digest.ts`
- Entry point: `richDigest(block: ExtractableBlock, viewBlocks: ViewBlock[]): string | undefined`
- Returns digest body (NO fold tag — engine owns tag via `substOne` recoverable path)
- Returns `undefined` for unrecognized tools → conductor skips ReplaceCommand, block goes in FoldCommand (engine fallback)
- Paired lookup: scans `viewBlocks` backwards for `read` and `subagent` to find tool_call args
- Templates: read (📄 path+tok), subagent (🔀 type+task+tok), isError (❌ first line), text (🤖 first sentence+tok), thinking (💭 tok), mcp (🔌 server/tool+tok)

## Conductor digest cache (ticket 07 — to be built)

- `Map<string, string | undefined>` in MyCustomizeConductor instance
- Populated incrementally: each conduct() pass computes digests for new blocks not yet in cache
- Consumed at fold time: lookup cached digest, emit ReplaceCommand { id, content, recoverable: true } or include in FoldCommand.ids
- No invalidation — Block.text is immutable
- Pre-compute happens for ALL blocks (including protected tail) since dirty guard fires on new block arrival
