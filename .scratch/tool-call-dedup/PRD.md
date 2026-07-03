# PRD: Prevent Redundant Tool Calls Against Already-Folded Results

## Problem Statement

Folding replaces a tool result's content with a `{#code FOLDED}` digest at its original position. The full content is never lost, `recall`/`unfold` can always bring it back. But nothing makes the model prefer retrieval over recomputation. If the model needs data that a folded block already holds, it can just call the same tool again instead of noticing the digest and calling `recall`. For a cheap, idempotent tool (a file read) that only wastes a turn. For an MCP tool with cost, side effects, or a rate limit, it is a real problem, not just an inefficiency.

Investigated and confirmed this session: the model reads its own history every turn, so the folded marker is visible, but nothing routes the model through "check for an existing folded answer" before it decides to call a tool. `skills/accordion-context-folding/SKILL.md` only says "if you need the exact content, unfold it", it says nothing about checking before re-calling a tool.

## Solution

Two independent layers, cheapest first.

1. **Skill instruction nudge** (shipped this session). Tell the model directly, in the skill it already reads, to check folded digests before repeating a tool call. Costs nothing, closes part of the gap, still depends on the model noticing the connection.
2. **`tool_call` hook enforcement** (this PRD's remaining scope). pi's `ExtensionAPI` exposes a `tool_call` hook that fires before a tool executes and can block it (confirmed against `dist/core/extensions/types.d.ts` this session, see Further Notes). Accordion can track which tool calls currently have a folded result and block a duplicate call outright, pointing the model at the existing block's code instead of letting it re-run.

This turns "the model should notice and prefer recall" into "the extension refuses the redundant call and tells the model what to do instead." The skill text is the soft version. The hook is the hard guarantee.

## User Stories

1. As a user paying for or rate-limited by an MCP tool, I want Accordion to block a redundant call when the answer is already sitting in a folded block, so that I do not pay for or wait on work that was already done this session.
2. As the model mid-task, I want a blocked redundant call to tell me exactly which block holds the answer, so that I can `recall` it in the same turn instead of hitting a dead end.
3. As a user watching the GUI, I want this check to never interfere with fold policy (what gets folded and when), so that it stays a tool-execution safety concern, not a second fold-decision authority competing with the conductor.

## Accepted Decision Register

- **DEC-001** — **Own this in the pi extension (`accordion.ts` / a new sibling module), not the app/GUI conductor.**
  - Lens: `scope`
  - Rationale: `tool_call` is a pi `ExtensionAPI` hook. It fires in the extension process, before the tool executes, with access to the real message history (`lastMessages`), not the GUI's abstracted `ViewBlock` digests. The GUI has no visibility into tool-call arguments at all, only the extension does.
  - Rejected alternatives: route the check through the GUI (adds a WebSocket round trip to every tool call, defeats the point of a hook that must decide before execution; also conflates "what to fold" policy, which the GUI owns, with "is this call redundant", which it has no data to answer).
  - Downstream impact: new module lives in `vendor/accordion/extension/`, follows the `payload-audit.ts`/`cache-tracker.ts` pattern (`install(pi)`, module-level state, exported getters).

- **DEC-002** — **Identity key: tool name plus a stable (sorted-key) JSON serialization of arguments.**
  - Lens: `runtime`
  - Rationale: Cheapest thing that distinguishes "same call" from "different call" without a per-tool schema. No dependency, no async work on the hot path.
  - Rejected alternatives: deep-equal without normalization (misses semantically-identical calls with different key order); per-tool custom identity functions (real improvement, but scope creep for a first version, revisit if false negatives show up in practice).
  - Downstream impact: two calls that differ only in key order or whitespace correctly collide. Two calls with a meaningfully different argument value never collide. Known accepted gap: textually different but semantically identical arguments (path casing, trailing slash) will not be detected as duplicates in v1.

- **DEC-003** — **Block outright with a reason, do not substitute the result.**
  - Lens: `runtime`
  - Rationale: `tool_call`'s return type only supports `{ block, reason }`, it cannot replace the tool's result (that is `tool_result`'s job, a different hook, firing after execution). Blocking and telling the model to `recall` the existing block keeps `recall`'s own audit trail intact, the model explicitly asks for the content, rather than the extension silently injecting it and making the tool call look like it ran.
  - Rejected alternatives: combine `tool_call` (block) with `tool_result` (inject content) to make the block transparent to the model. More moving parts, and it hides the redundant-call detection from the model instead of teaching it to route through `recall`, which is the behavior the skill instruction (layer 1) is already trying to build.
  - Downstream impact: `reason` string must name the fold code directly, e.g. `"Already have this in block 3f9a2c, folded. Call recall({codes:[\"3f9a2c\"]}) instead of re-running it."` so the model can act on it in the same turn without a second lookup.

- **DEC-004** — **Track currently-folded identity keys by scanning messages on the `context` hook, not by intercepting fold plans.**
  - Lens: `runtime`
  - Rationale: The extension already owns the `context` hook and already sees the post-`applyPlan` message array before it goes out. Scanning that array for `{#<code> FOLDED}` markers on `tool_result` messages, and correlating each one back to the identity key recorded when that tool call was originally made, needs no new wire message and no new dependency on the GUI's internal fold-plan format.
  - Rejected alternatives: have the GUI report which blocks are folded and their original tool identity (the GUI does not have tool arguments at all, per DEC-001, this is not available to it).
  - Downstream impact: new module needs its own small map, `toolCallId -> identityKey`, populated on `tool_call` (before blocking check, so a call gets recorded even if not blocked), and a second map, `identityKey -> foldCode`, rebuilt from the current message scan on every `context` hook. An unfolded block's identity key drops out of the second map automatically because the marker is gone from its content.

## Implementation Plan

### Area: new module, `vendor/accordion/extension/tool-dedup.ts`

- **Decision IDs**: DEC-001, DEC-002, DEC-003, DEC-004
- **Current code anchors**:
  - `vendor/accordion/extension/payload-audit.ts` and `vendor/accordion/extension/cache-tracker.ts` for the module shape to follow (`install(pi)`, module-level state, exported getters, `reset()`).
  - `vendor/accordion/extension/accordion.ts` for where hooks are registered today (the `session_start`/`context`/`before_provider_request` registrations, and `lastMessages`, the extension's own copy of the current message array).
- **Existing behavior**: no tool-call interception exists. The extension only reacts to messages after the model has already decided to call a tool.
- **Required edits**:
  1. `identityKey(toolName: string, input: Record<string, unknown>): string`, pure function, `toolName + ":" + stableStringify(input)` where `stableStringify` sorts object keys recursively. (DEC-002)
  2. `install(pi)` registers two handlers:
     - `pi.on("tool_call", handler)`: compute the identity key for the incoming call, record `toolCallId -> identityKey` in a module-level map, then check the second map (`identityKey -> foldCode`) for a hit. On a hit, return `{ block: true, reason: "Already have this in block <code>, folded. Call recall({codes:[\"<code>\"]}) instead of re-running it." }`. On a miss, return nothing (let the call proceed). (DEC-001, DEC-002, DEC-003)
     - `pi.on("context", handler)`: after the existing `context` logic builds the outgoing message array, scan it for `tool_result` messages whose content starts with `{#<code> FOLDED}`, look up their `toolCallId` in the first map to get the identity key, and rebuild the `identityKey -> foldCode` map from that scan (full rebuild each pass, not incremental, mirrors the reset-and-recompute pattern already used by the app-side conductor, keeps the module stateless-feeling and easy to reason about). (DEC-004)
  3. `reset()` clears both maps. Call it from `session_shutdown` alongside the other module resets already in `accordion.ts`.
  4. No export needed beyond `install` and `reset`, this module has no diagnostic surface the way `payload-audit.ts` does.
- **Snippet(s)**:
  - `decision artifact` (normative).
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
  - `decision artifact` (normative), the fold-marker scan:
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
- **Tests to extend**: create `vendor/accordion/extension/tool-dedup.test.ts`, following the shape of `cache-tracker.test.ts`.
- **Wiring/build notes**: install alongside the other modules in `accordion.ts`, likely near `payloadAudit.install(pi)` and `cacheTracker.install(...)`.

### Area: `accordion.ts` — wiring

- **Decision IDs**: DEC-001
- **Current code anchors**: the existing `install(pi)` calls for `payloadAudit` and `cacheTracker`, and the `session_shutdown` handler that resets other modules.
- **Required edits**:
  1. Import `tool-dedup` and call `toolDedup.install(pi)` alongside the other installs.
  2. Call `toolDedup.reset()` in `session_shutdown`.
- **Tests to extend**: extend `smoke.mjs` with a case: call a tool, let its result fold (simulate a GUI fold plan the way existing smoke cases do), attempt the same call again, assert the `tool_call` handler returns `block: true` with the folded code in `reason`.

## Global Build & Wiring Notes

- Everything in this PRD is scoped to `vendor/accordion/extension/`. No changes to `vendor/accordion/app/` (the GUI/conductor engine) are needed, per DEC-001.
- No `pi` package changes are needed. `tool_call` and `context` are both hooks pi already exposes (confirmed against `dist/core/extensions/types.d.ts` this session).
- Follow the existing module pattern (`payload-audit.ts`, `cache-tracker.ts`): `install(pi)`, module-level state, `reset()`, no class, no singleton export beyond the functions.

## Testing Decisions

- Test `identityKey`/`stableStringify` as pure functions in isolation, key order and nested object cases matter most.
- Test the `tool_call` handler's block/pass-through decision against a pre-populated `identityKey -> foldCode` map, not through a live fold round trip, that keeps the unit tests independent of the GUI.
- End-to-end proof belongs in `smoke.mjs`, which already drives `accordion.ts` through a mock `pi` object and asserts on hook outcomes.

## Out of Scope

- Per-tool custom identity functions (normalizing path casing, ignoring irrelevant argument fields). Revisit if v1's plain stable-stringify produces real false negatives.
- Any change to what gets folded or when (conductor/GUI fold policy is untouched).
- Injecting the folded content automatically via `tool_result` instead of blocking (see DEC-003).
- Deduplicating calls across sessions (this is in-memory, per-session state, same lifetime as the other extension modules).

## Unresolved Gaps

- Whether `AgentMessage`'s `tool_result` shape actually exposes `toolCallId` and plain-string `content` the way the snippet above assumes needs a direct read of pi's message types before implementation starts (not yet done this session, `types.d.ts` was read for `ExtensionAPI` hooks, not for the `AgentMessage` shape itself).
- Whether sibling tool calls in the same assistant message (pi preflights `tool_call` sequentially per the confirmed lifecycle) could race against the `context`-hook rebuild in a way that misses a same-turn duplicate. Worth a smoke test case specifically for two identical calls in one assistant turn.

## Further Notes

- `tool_call` hook confirmed this session against `…/pi-coding-agent/dist/core/extensions/types.d.ts` and `docs/extensions.md`. Signature: `on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void`, returns `{ block?: boolean; reason?: string }`, fires after `tool_execution_start` and before the tool runs, `event.input` is mutable in place (not used by this feature, only the block path is).
- Working reference for the block pattern: `examples/extensions/permission-gate.ts` in the pi package, blocks bash commands pending user confirmation with the same `{ block: true, reason }` shape this PRD reuses for a different purpose.
- Layer 1 (skill instruction) shipped in `vendor/accordion/extension/skills/accordion-context-folding/SKILL.md`, new "Before repeating a tool call" section, no code change, no test to run.
