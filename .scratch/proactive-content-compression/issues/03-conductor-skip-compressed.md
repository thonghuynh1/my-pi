---
status: closed
---

# 03: Conductor skips proactively-compressed blocks

## What to build

Update `my-customize-conductor` to detect and skip proactively-compressed tool_result blocks in its candidate filter, preventing double-compression.

Covers: `DEC-004`, `US-004`, `RB-007`.

## Implementation map

### Detection strategy

Proactively-compressed blocks contain a distinctive recall marker in their `text` field (since that's what the provider cached and the block store linearized). The marker format from issue 01:

```
[{N} lines, ~{T} tokens. Full output: recall("{code}")]
```

Detection function:

```ts
const PROACTIVE_COMPRESS_MARKER = /\[\d+ lines, ~\d+ tokens\. Full output: recall\("[a-f0-9]+"\)\]$/;

function isProactivelyCompressed(b: ViewBlock): boolean {
  return b.kind === "tool_result" && PROACTIVE_COMPRESS_MARKER.test(b.text ?? "");
}
```

### Where to add the filter

`conductors/my-customize-conductor/my-customize-conductor.ts` lines ~122–135:

```ts
// Current:
const candidates = allCandidates.filter((b) => b.order >= view.frozenFromIndex);

// After:
const candidates = allCandidates.filter(
  (b) => b.order >= view.frozenFromIndex && !isProactivelyCompressed(b)
);
```

### Why content-marker detection (not a new ViewBlock field)

- No conductor contract change needed.
- No version bump required.
- The marker is deterministic and unique — false positives are negligible.
- Left to implementer: if a `ViewBlock.proactivelyCompressed` boolean is preferred later, this can be refactored without changing behavior.

### Builtin conductor

The builtin conductor already naturally handles this: proactively-compressed blocks are small (~200 tokens), so `b.foldedTokens < b.tokens` may be false (folding wouldn't save much). Even if it tries to fold one, the content is already minimal. No explicit change needed for builtin, but the marker detection can be added for correctness.

## Acceptance criteria

- [ ] **Proactively-compressed blocks are excluded from conductor candidates**
  - Run: `conductor.my-customize-conductor.test.ts` — new test case: provide a ViewBlock with `kind: "tool_result"` and text ending with the recall marker pattern
  - Expected: Block is NOT in the candidates array returned by the conductor's filtering logic

- [ ] **Non-compressed tool_result blocks are still folded normally**
  - Run: Existing conductor tests pass — tool_result blocks without the marker are still candidates
  - Expected: All existing conductor fold tests pass unchanged

- [ ] **MCP tool_result blocks remain handled by conductor (poteto-mode unaffected)**
  - Run: Existing poteto-mode conductor tests pass
  - Expected: MCP results still get beacon injection and identity detection as before

## Blocked by

- `01-proactive-compress-module.md` — depends on the marker format being defined and stable.
