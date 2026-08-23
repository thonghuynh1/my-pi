# Block-Level Rich Digests

## What it does

When the conductor folds an individual block, it replaces the raw content with a structured, human-readable digest instead of the engine's default first-120-chars truncation. Each digest uses an emoji prefix and extracts semantically meaningful information from the block type.

## Templates

| Block type | Digest format | Example |
|---|---|---|
| `read` tool_result | `📄 <path> (~Nk tok)` | `📄 src/lib/engine/store.svelte.ts (~8.4k tok)` |
| `subagent` result | `🔀 <type>: "<task>" (~Nk tok)` | `🔀 explore: "find how ReplaceCommand is used" (~2.1k tok)` |
| `isError` block | `❌ <first error line>` | `❌ TypeError: Cannot read property 'x' of undefined` |
| Assistant text | `🤖 "<first sentence>" (~Nk tok)` | `🤖 "The failing test is in store.svelte.ts" (~1.5k tok)` |
| Thinking | `💭 (~Nk tok)` | `💭 (~3.2k tok)` |
| MCP tool | `🔌 <server/tool> (~Nk tok)` | `🔌 engineering-skills/skill-trek (~0.8k tok)` |
| Everything else | Engine fallback (first 120 chars) | `<toolName> → OK/ERR, ~N tok · <peek>` |

## Key implementation details

- **Module**: `app/src/lib/engine/block-digest.ts` — `richDigest(block, pairedArgs?)` returns digest string or `undefined` (engine fallback)
- **Pre-computed cache**: Conductor maintains a `digestCache` Map, populated incrementally at 50 blocks per `conduct()` pass (amortized cold-start)
- **Paired lookup**: For `read` and `subagent` blocks, the conductor scans backwards to find the paired `tool_call` block and extracts args (path, type, task)
- **Fold emission**: Blocks with a cached digest get `ReplaceCommand { recoverable: true }` instead of `FoldCommand` — original content preserved for `recall`/`unfold`
- **`foldOrReplace` helper**: Deduplicates the fold-or-replace decision across all emission paths

## How to verify

1. Load a session with diverse block types (read, subagent, errors, assistant text, thinking, MCP tools)
2. Trigger folding (conductor pressure or manual fold)
3. Folded blocks should show structured digests with emoji prefixes and token counts — NOT raw truncated content
4. `recall` on a folded block should still return the full original content (recoverable)
5. Blocks whose type is unrecognized should fall back to engine default digest

## Test commands

```bash
npx vitest run app/src/lib/engine/block-digest.test.ts
npx vitest run app/src/lib/engine/conductor.my-customize-conductor.test.ts
```
