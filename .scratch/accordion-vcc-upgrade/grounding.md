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

## Two-process split

- GUI process: holds `AccordionStore.blocks[]` — searchable for normal blocks only
- Extension process: holds `originals` Map — searchable for PCC blocks only
- No shared memory; only connected by WebSocket
