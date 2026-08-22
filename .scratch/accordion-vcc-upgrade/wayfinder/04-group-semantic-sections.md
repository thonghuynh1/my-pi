# 04 — How should group digests accumulate semantic sections?

Type: grilling
Status: resolved
Blocked by: 03

## Resolution

Semantic extractors live in a shared library module (like `bm25.ts`). The conductor imports and calls them, passing the composed digest via `GroupCommand.digest`. Engine's `groupDigest()` stays as fallback.

**Sections:** `[Asks]`, `[Files]`, `[Errors]`, plus MCP Retrieval Index. Commits and Preferences excluded. Each section omitted when empty. Always extracted (no threshold).

**Caps:** Asks: 6 × 60 chars. Files: 8 full literal paths (allowlist: read/write/edit/find/grep/ls). Errors: 3 × 80 chars (isError only). MCP Index: Canonical MCP Identity → recall codes.

**No accumulation across groups** — groups are flat (hard architectural invariant, store rejects nesting). Each group extracted independently.

**Format:** Multi-line structured, optimized for agent selection (greppable paths, literal errors, recall codes).

Prototype: `.scratch/accordion-vcc-upgrade/prototype-digest-sections.html`
