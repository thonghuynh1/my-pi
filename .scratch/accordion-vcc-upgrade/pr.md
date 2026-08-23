# Upgrade Accordion with VCC-inspired context summarization

## What this changes

Accordion's conductor now produces richer, more useful summaries when it folds context blocks. Instead of truncating to the first 120 characters, folded blocks get structured digests — a `📄 read` block shows which file was read and how large it was, a `💭 thinking` block gets a gist of the reasoning, an `❌ error` block preserves the error message. Groups of blocks get semantic sections listing the files touched, questions asked, and errors encountered, plus an MCP retrieval index so the agent can find folded tools by name.

The extension also gains search-within-fold: the existing `recall` tool now accepts an optional `query` parameter that runs BM25 keyword search inside a folded block and returns only the matching fragments with surrounding context, instead of expanding the entire block back into the window.

Proactive Content Compression (PCC) — the mechanism that pre-shrunk large tool results before they could freeze at full size — is removed entirely. It was structurally dead: the `mcp` tool exclusion meant it never fired on real tool results in practice, and the conductor's new richer digests plus the existing `breakFrozen` hard-cap cover the gap it was designed for. Removing it deletes ~250 lines of code and simplifies the recall path, the wire protocol, the store, the conductor contract, and the inspector UI.

## How to review

- **Start here: `extensions/accordion/app/src/lib/engine/extractors.ts`** — the shared library that powers everything else. `extractAsks()`, `extractFiles()`, `extractErrors()`, `buildMcpIndex()`, `buildSemanticDigest()`, and `blockTier()` are all pure functions with no side effects. The test file (`extractors.test.ts`, 253 lines) is the best spec for what they do.

- **Then: `extensions/accordion/app/src/lib/engine/block-digest.ts`** — six emoji-tagged templates that turn a folded block into a one-line structured summary. `richDigest()` returns `undefined` for block types it doesn't recognize, falling back to the engine's existing truncation. Tested in `block-digest.test.ts`.

- **Then: `conductors/my-customize-conductor/my-customize-conductor.ts`** — where the new modules get wired in. The conductor maintains a `digestCache` Map that pre-computes digests incrementally (50 blocks per pass) and emits `ReplaceCommand { recoverable: true }` at fold time so originals are preserved for recall/unfold. The test file grew by 205 lines to cover the new paths.

- **Then: `extensions/accordion/app/src/lib/engine/bm25.ts` + `plan.ts`** — BM25 search module (110 lines, clean-room, zero deps) and the recall integration that threads `query` through the wire protocol into `resolveRecall()`.

- **Watch for: the PCC deletion touches ~30 files** but most changes are mechanical (removing a `proactivelyCompressed` field or a `_pccCompressed` mapping). The substantive deletions are `proactive-compress.ts`, `proactive-compress.test.ts`, `store.foldgate.test.ts` (PCC-specific tests), and `Inspector.test.ts` (PCC pill tests). The recall handler in `accordion.ts` gets noticeably simpler — all codes now go straight to `requestRecall` without the PCC bypass branch.
