# 07 — How should richer individual fold digests work?

Type: grilling
Status: open
Blocked by: 06

## Question

Currently when a block is folded, its digest is the first ~120 characters of `block.text` — a dumb truncation. The destination calls for **semantically-aware summaries** that tell the agent what the block contained without expanding it.

Decision 01 says the conductor pushes richer digests via `ReplaceCommand`. But **what does a rich digest look like per block type**, and how does the ranking score (ticket 06) gate digest quality?

### Sub-questions

1. **What digest format per block type?**

   | Block type | Current digest | Proposed rich digest |
   |-----------|---------------|---------------------|
   | `read` tool result | first 120 chars of file content | `📄 path/to/file.ts (245 lines, 3.2k tok)` |
   | `bash` tool result | first 120 chars of stdout | `$ npm test → exit 0 (14 lines)` or `$ npm test → FAIL: 3 failures (stderr: ...)` |
   | `edit` tool call | first 120 chars of JSON args | `✏️ path/to/file.ts lines 42–58 (+12/−4)` |
   | `write` tool call | first 120 chars of JSON args | `📝 path/to/new-file.ts (new, 89 lines)` |
   | `grep`/`find` result | first 120 chars | `🔍 grep "pattern" → 7 matches in 3 files` |
   | Error block | first 120 chars | `❌ TypeError: Cannot read property 'x' of undefined (line 42)` |
   | Assistant (with tools) | first 120 chars | `🤖 Called edit(file.ts), bash(npm test) — "fixing the import"` |
   | Assistant (prose only) | first 120 chars | First sentence or decision statement |
   | User message | first 120 chars | First line (already decent — maybe keep as-is) |
   | Subagent result | first 120 chars | `🔀 explore: "found 3 definitions in src/lib/"` |

2. **Should digest quality tier based on ranking score?**
   - High-rank blocks (score > threshold from ticket 06): full structured digest
   - Mid-rank blocks: condensed one-liner
   - Low-rank blocks: just truncated (current behavior, cheapest)
   
   This avoids spending CPU on rich digests for blocks no agent will ever recall.

3. **How to extract structured info from block text?**
   - `read` results: parse the path from the tool_call's arguments (available via `callId` link or embedded in text)
   - `bash` results: first line often has the command; exit code from `isError`
   - `edit`/`write`: tool arguments are JSON — parse `path`, `oldText`/`newText` lengths
   - Errors: first non-empty line of stderr/error text
   
   Are these parsers similar enough to the group extractors (ticket 04) to share code, or do they need a separate module?

4. **When does the conductor emit ReplaceCommand for a folded block?**
   - At fold time (when the FoldCommand is first issued)?
   - Lazily (when the block is first displayed in folded state)?
   - Always recompute on every conduct cycle (expensive)?

5. **Recoverable flag** — `ReplaceCommand` has `recoverable: true` which preserves the original for unfold. Rich digests MUST be recoverable. But does the digest string itself need to encode the unfold handle (like `{#code FOLDED}`), or does the engine add that separately?

## Constraints

- Zero-LLM — all extraction is regex/parsing, no summarization model
- Must not break existing `recall` (which needs original text, not the digest)
- Digests should be greppable by agents (literal paths, literal error messages)
- `ReplaceCommand.content` is the digest string; `recoverable: true` preserves original
- The engine already handles `{#code FOLDED}` tag injection — conductor supplies only the digest body
