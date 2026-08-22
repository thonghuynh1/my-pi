---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 2 (group semantic sections)
Covers decisions: D10 (MCP Retrieval Index)

## What to build

Add an MCP Retrieval Index builder to the extractor module that maps Canonical MCP Identities to recall codes for non-file tool_call blocks in a group.

### Resolved decisions

- **D10**: Non-file tool activity uses MCP Retrieval Index format. Each Canonical MCP Identity (server/tool) maps to recall codes. File tools feed `[Files]`, not the index. Present only when non-empty.

### Implementation map

**File**: `app/src/lib/engine/extractors.ts` (extend from issue 04)

**Existing concept**: `CONTEXT.md` defines Canonical MCP Identity as "server + tool + deterministic fingerprint of canonical arguments, with safe identifying arguments displayed." For this extractor, parse from tool_call text.

**New export:**

```typescript
interface McpIndexEntry {
  identity: string;   // e.g. "engineering-skills/skill-trek" or "subagent/check pi-vcc extractors"
  codes: string[];    // recall codes for the blocks
}

function buildMcpIndex(blocks: ExtractableBlock[]): McpIndexEntry[]
```

**Logic:**
1. Filter `kind === "tool_call"` where `toolName` is NOT in `FILE_TOOLS` set
2. For `toolName === "mcp"`: parse `tool` and optional `server` from text → identity = `server/tool` or just `tool`
3. For `toolName === "subagent"`: parse `task` from text → identity = `subagent/<first 40 chars of task>`
4. For other tools (e.g. `run_tests`, `bash`): identity = `toolName`
5. Group by identity, collect block ids/codes per identity
6. Cap at 6 distinct identities

**Block ID for recall**: The extractor needs a block identifier to serve as the recall code. `ExtractableBlock` must be extended with an optional `id?: string` field. The conductor has `ViewBlock.id`; the engine has `Block.id`.

**Test file**: `app/src/lib/engine/extractors.test.ts` (extend)

## Acceptance criteria

- [ ] `buildMcpIndex` returns MCP identities with recall codes for mcp tool_calls
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: Test passes with: mcp tool_call with server+tool → `"server/tool"` identity; mcp without server → `"tool"` identity; recall codes collected per identity
  - Fails when: mcp tool_calls not recognized or identity format wrong

- [ ] `buildMcpIndex` handles subagent tool_calls
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: subagent tool_call → `"subagent/<task first 40 chars>"` identity with recall code
  - Fails when: subagent blocks not recognized

- [ ] `buildMcpIndex` excludes file-tool tool_calls (read/write/edit/find/grep/ls)
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: file-tool tool_calls do NOT appear in the MCP index (they belong in [Files])
  - Fails when: file-tool identities leak into the index

- [ ] `buildMcpIndex` returns empty array when no non-file tool_calls exist
  - Run: `npx vitest run app/src/lib/engine/extractors.test.ts`
  - Expected: [] returned
  - Fails when: non-empty result from file-only group

## Blocked by

- `04-extractor-module.md`
