---
id: "002"
title: "tool_call Hook — Block Redundant Tool Calls Against Folded Results"
labels: [ready-for-agent]
depends_on: ["001"]
status: ready-for-agent
---

## What to build

Create `vendor/accordion/extension/tool-dedup.ts`, a new extension module that tracks which currently-folded blocks correspond to which tool calls, and blocks a repeated call against the same tool and arguments via pi's `tool_call` hook, pointing the model at the existing block's fold code instead of letting the call re-run.

**PRD decisions implemented**: DEC-001, DEC-002, DEC-003, DEC-004

**User stories covered**: 1, 2, 3

## Implementation map

### Area: `tool-dedup.ts` — new extension module

- **Decision IDs**: DEC-001, DEC-002, DEC-003, DEC-004
- **Current code anchors**: `vendor/accordion/extension/cache-tracker.ts` and `vendor/accordion/extension/payload-audit.ts` for module shape (`install(pi)`, module-level state, `reset()`, no class).
- **Existing behavior**: no tool-call interception exists anywhere in the extension.
- **Required edits**:

  1. `stableStringify(value: unknown): string` and `identityKey(toolName: string, input: Record<string, unknown>): string` (decision artifact, normative):
     ```ts
     function stableStringify(value: unknown): string {
       if (value === null || typeof value !== "object") return JSON.stringify(value);
       if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
       const keys = Object.keys(value as Record<string, unknown>).sort();
       return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
     }

     export function identityKey(toolName: string, input: Record<string, unknown>): string {
       return `${toolName}:${stableStringify(input)}`;
     }
     ```

  2. Fold-marker scan to rebuild the currently-folded identity index (decision artifact, normative):
     ```ts
     const FOLD_MARKER = /^\{#([0-9a-f]+) FOLDED\}/;

     function rebuildFoldedIndex(messages: AgentMessage[], callIdToKey: Map<string, string>): Map<string, string> {
       const index = new Map<string, string>();
       for (const m of messages) {
         if (m.type !== "tool_result" || typeof m.content !== "string") continue;
         const match = FOLD_MARKER.exec(m.content);
         if (!match) continue;
         const key = callIdToKey.get(m.toolCallId);
         if (key) index.set(key, match[1]);
       }
       return index;
     }
     ```
     Confirm `AgentMessage`'s `tool_result` shape actually has `toolCallId` and string `content` before wiring this in, see Blocked by.

  3. Module state: `callIdToKey: Map<string, string>` (populated on every `tool_call`, never cleared except by `reset()`) and `foldedIndex: Map<string, string>` (fully rebuilt on every `context` pass via `rebuildFoldedIndex`).

  4. `install(pi: ExtensionAPI): void`:
     - `pi.on("tool_call", (event) => { ... })`: guard on `isToolCallEventType` the way `permission-gate.ts` does, compute `identityKey(event.toolName, event.input)`, store it in `callIdToKey` keyed by `event.toolCallId`, look it up in `foldedIndex`. On a hit, return `{ block: true, reason: `Already have this in block ${code}, folded. Call recall({codes:["${code}"]}) instead of re-running it.` }`. On a miss, return nothing.
     - `pi.on("context", (event) => { ... })`: after existing `context` logic computes the outgoing message array, call `rebuildFoldedIndex(messages, callIdToKey)` and store the result as `foldedIndex`. Must not interfere with the existing fold-apply return value, this handler only reads the array, it does not participate in `applyPlan`.

  5. `reset(): void` clears both maps.

- **Tests to extend**: create `vendor/accordion/extension/tool-dedup.test.ts`.

## Acceptance criteria

- [ ] `identityKey("read_file", { path: "a.ts" })` equals `identityKey("read_file", { path: "a.ts" })` regardless of key insertion order in the input object.
  Run: `npx vitest run vendor/accordion/extension/tool-dedup.test.ts --reporter=verbose`. Expected: test `identityKey — key order independence` passes.

- [ ] `identityKey("read_file", { path: "a.ts" })` differs from `identityKey("read_file", { path: "b.ts" })`.
  Run: same file. Expected: test `identityKey — distinguishes different arguments` passes.

- [ ] `identityKey` differs across tool names for identical arguments.
  Run: same file. Expected: test `identityKey — distinguishes tool name` passes.

- [ ] `rebuildFoldedIndex` extracts the fold code from a `{#<code> FOLDED}` marker at the start of a `tool_result` message's content and maps it to the identity key recorded for that `toolCallId`.
  Run: same file. Expected: test `rebuildFoldedIndex — basic extraction` passes.

- [ ] `rebuildFoldedIndex` ignores a `tool_result` message with no fold marker.
  Run: same file. Expected: test `rebuildFoldedIndex — unfolded message ignored` passes.

- [ ] `rebuildFoldedIndex` ignores a `tool_result` whose `toolCallId` was never recorded in `callIdToKey` (defensive, should not throw).
  Run: same file. Expected: test `rebuildFoldedIndex — unknown toolCallId ignored` passes.

- [ ] The `tool_call` handler returns `{ block: true, reason }` naming the fold code when the identity key is present in `foldedIndex`, and the `reason` string contains the code.
  Run: same file (mock `pi.on` capture pattern, same as `cache-tracker.test.ts`). Expected: test `tool_call handler — blocks duplicate` passes.

- [ ] The `tool_call` handler returns `undefined` (lets the call proceed) when the identity key is absent from `foldedIndex`.
  Run: same file. Expected: test `tool_call handler — allows new call` passes.

- [ ] `reset()` clears both `callIdToKey` and `foldedIndex`, a call that was previously blocked is allowed again after reset (simulating a new session).
  Run: same file. Expected: test `reset — clears state` passes.

- [ ] End-to-end: `smoke.mjs` gains a case that calls a tool, simulates the GUI folding its result, attempts the identical call again, and asserts the second call is blocked with the correct code in the reason.
  Run: `node vendor/accordion/extension/smoke.mjs`. Expected: new assertion passes alongside the existing ~40.

## Blocked by

- Needs a direct read of pi's `AgentMessage` / `tool_result` message type (not yet done this session, only `ExtensionAPI` hook types were read) to confirm `toolCallId` and `content` field names and shapes match what `rebuildFoldedIndex` assumes. Do this before writing the implementation, not after.
