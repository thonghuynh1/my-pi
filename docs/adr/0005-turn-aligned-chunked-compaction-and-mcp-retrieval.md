---
status: accepted
---

# Align chunked compaction to complete turns and index recoverable MCP results

Accordion chunked compaction uses complete user/assistant/tool turns as its normal boundary rather than raw block indices, with a safe provider-message and balanced-tool-pair split only for an oversized turn. Deterministic group digests preserve canonical wire chronology and end with an MCP Retrieval Index that maps Canonical MCP Identities to individually recallable grouped-member codes; `recall` reads the member without reopening the immutable group, and its ordinary tool result supplies the single cache-safe Protected Tail append. This supersedes ADR-0004 because block-level Pre-Group boundaries and permanent MCP/recall barriers could produce rejected groups, empty Pre-Groups, and unrecoverable named member references.

## Consequences

- Human-held blocks, existing groups, and proactively compressed blocks remain hard compaction barriers.
- MCP, recall, pstack, and user blocks may compact as part of a structurally complete unit.
- An unqualified repeated MCP identity selects its newest occurrence; older occurrences remain available through compact turn-and-code references.
- Exact identity uses server, tool, and a deterministic canonical-argument fingerprint while displaying only safe identifying arguments.
- If one provider message is itself oversized, it remains intact and the Protected Tail may exceed its token target.
