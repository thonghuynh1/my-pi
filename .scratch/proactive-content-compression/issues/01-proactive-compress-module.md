---
status: closed
---

# 01: Proactive compression module — compress tool_result payloads before provider

## What to build

A new extension module (`extension/proactive-compress.ts`) that hooks `before_provider_request`, identifies qualifying `tool_result` messages, structurally compresses them to a fixed ~200-token output, and stores the original in a sidecar recall map. The compressed payload is what the provider sees and caches.

Covers: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-005`, `US-001`, `US-002`, `US-003`, `RB-001`, `RB-002`, `RB-003`, `RB-004`, `RB-005`, `RB-006`, `RB-008`.

## Implementation map

### Hook registration

- Pattern: follow `extension/payload-audit.ts` and `extension/cache-tracker.ts` — both use `(pi as unknown as { on }).on("before_provider_request", handler)`.
- Register in `extension/accordion.ts` (~line 1490) **BEFORE** `cacheTracker.install(pi)` so the cache tracker snapshots the already-compressed payload (`RB-001`).
- Handler signature: `(event: { payload?: unknown }) => unknown`. Return the modified payload object (not `undefined`) to replace it.

### Compression filter (`shouldCompress`)

```ts
const MIN_TOKEN_THRESHOLD = 300; // RB-008

function shouldCompress(msg: { role: string; toolName?: string; content: string }, index: number, frozenFromIndex: number): boolean {
  if (msg.role !== "tool") return false; // only tool_result
  const name = (msg.toolName ?? "").trim().toLowerCase();
  if (name === "mcp") return false;       // RB-003, DEC-002
  if (name === "recall") return false;    // exempt recalled content
  if (estimateTokens(msg.content) < MIN_TOKEN_THRESHOLD) return false; // RB-008
  if (index < frozenFromIndex) return false; // RB-002
  return true;
}
```

### Structural compression (`compress`)

- DEC-003: fixed aggressive, SmartCrusher-style.
- Keep first N lines (e.g. 8) + last M lines (e.g. 4) + a stats/shape line + recall marker.
- Target hard cap: ~200 output tokens regardless of input size.
- Generate a 6-char hex recall code (e.g. SHA-256 of original content, first 6 chars).
- Output format:

```
<first 8 lines of original>
...
<last 4 lines of original>
[{totalLines} lines, ~{tokenCount} tokens. Full output: recall("{code}")]
```

- Left to implementer: exact N/M, whether stats includes byte count.

### Recall sidecar store

- DEC-005: reuse recall mechanism. Store `{ code → originalText }` in a module-level `Map<string, string>`.
- Expose via `getOriginal(code: string): string | undefined`.
- The extension's recall handler (in `accordion.ts`) must check this sidecar store BEFORE falling back to `block.text`. If the code matches a proactive-compression entry, return the full original.
- No TTL in this issue (out of scope per PRD).

### Frozen index access

- `frozenFromIndex` is available from `cacheTracker.getFrozenFromIndex()` (already exported).
- On the first turn (cold start), `frozenFromIndex = 0` → all messages are compressible. This is correct — the provider hasn't cached anything yet.

### Payload iteration

- Anthropic: `payload.messages` array, tool results have `role: "tool"` with `.tool_use_id` and `.content`.
- OpenAI Chat: `payload.messages` array, tool results have `role: "tool"` with `.tool_call_id` and `.content`.
- OpenAI Responses: `payload.input` array (different shape — left to implementer whether to support initially or skip).
- Identify `toolName` from the paired `tool_use` / `tool_call` message (previous message in array) or from the message itself if the provider format includes it.

## Acceptance criteria

- [ ] **Tool results above threshold are compressed in the outgoing payload**
  - Run: Unit test — provide a mock payload with a 2000-token tool_result, call the handler
  - Expected: Returned payload's tool_result content is ≤200 tokens, contains first/last lines and recall marker

- [ ] **MCP tool results are exempt**
  - Run: Unit test — provide a mock payload with `toolName: "mcp"` and 2000-token content
  - Expected: Content is unchanged in returned payload

- [ ] **Recall tool results are exempt**
  - Run: Unit test — provide a mock payload with `toolName: "recall"` and 2000-token content
  - Expected: Content is unchanged in returned payload

- [ ] **Blocks below threshold pass through**
  - Run: Unit test — provide a mock payload with a 200-token tool_result
  - Expected: Content is unchanged in returned payload

- [ ] **Frozen messages are not modified**
  - Run: Unit test — set frozenFromIndex=5, provide a tool_result at index 3
  - Expected: Content is unchanged in returned payload

- [ ] **Original is stored and retrievable via sidecar store**
  - Run: Unit test — compress a message, then call `getOriginal(code)`
  - Expected: Returns the full original 2000-token content

- [ ] **Hook is registered before cache-tracker**
  - Run: Integration test — verify registration order in accordion.ts setup
  - Expected: proactive-compress hook fires before cache-tracker hook in the event listener chain

## Blocked by

None - can start immediately.
