---
repo: F:/MyWork/my-pi/extensions/accordion
status: closed
---

## Parent

[Wayfinder map](../map.md) — Slice 5. Covers ticket [08 — Remove PCC](../wayfinder/08-remove-pcc.md), decisions D31 (remove PCC), D32 (no migration).

## What to build

Delete the Proactive Content Compression module and unwire it from the extension entry point. PCC is structurally dead — `shouldCompress()` excludes `mcp` toolName, which blocks virtually all tool results in practice. No PCC blocks have ever been observed.

After this issue, the `proactive-compress.ts` module no longer exists and the recall tool handler sends all codes directly to the GUI via `requestRecall()`.

## Implementation map

### Delete the PCC module

- **Delete** `extension/proactive-compress.ts` — the entire module (~90 lines): `originals` Map, `shouldCompress()`, `compress()`, `resolveOriginals()`, `install()`, `getOriginal()`, `MIN_TOKEN_THRESHOLD`
- **Delete** `extension/proactive-compress.test.ts` — all PCC unit tests

### Unwire from accordion.ts

**File:** `extension/accordion.ts`

1. **Remove import** — find `import * as proactiveCompress from "./proactive-compress"` (or similar) near the top and delete it.

2. **Remove `install()` call** — at ~line 1479:
   ```ts
   proactiveCompress.install(pi);  // ← delete this line
   ```
   Leave `cacheTracker.install(pi, ...)` and `payloadAudit.install(pi)` untouched.

3. **Simplify recall handler** — at ~line 1568–1580, the recall tool's `execute()` currently does:
   ```ts
   const proactive = proactiveCompress.resolveOriginals(codes, params.query);
   const proactiveCodes = new Set(proactive.map(({ code }) => code));
   const remainingCodes = codes.filter((code) => !proactiveCodes.has(code));
   // → requestRecall(remainingCodes, params.query)
   ```
   Replace with: pass all `codes` directly to `requestRecall(codes, params.query)`. Remove the `proactive` / `proactiveCodes` / `remainingCodes` variables. Remove any merging of proactive results back into the response — the GUI handles all recall now.

### What NOT to change in this issue

- `Block`, `WireBlock`, `ViewBlock` types — cleaned in issue 12
- `substOne` guard — cleaned in issue 12
- `ClampReason` type — cleaned in issue 12
- `mapping.ts` wire flag — cleaned in issue 12
- `Inspector.svelte` PCC UI — cleaned in issue 12

## Acceptance criteria

- [ ] `proactive-compress.ts` and `proactive-compress.test.ts` are deleted
  - Run: `ls extension/extension/proactive-compress*`
  - Expected: no files found
  - Fails when: either file still exists

- [ ] No remaining imports of `proactive-compress` in `accordion.ts`
  - Run: `grep -n "proactive-compress\|proactiveCompress" extension/extension/accordion.ts`
  - Expected: no matches
  - Fails when: any reference to PCC remains

- [ ] Recall handler sends all codes to GUI
  - Run: `grep -A5 "requestRecall" extension/extension/accordion.ts`
  - Expected: `requestRecall(codes, ...)` with no PCC filtering step
  - Fails when: `resolveOriginals` or `proactiveCodes` or `remainingCodes` still present

- [ ] TypeScript compiles
  - Run: `npx tsc --noEmit` (from extension root)
  - Expected: no errors (type fields still exist, just unused — cleaned in issue 12)
  - Fails when: compilation errors from missing PCC module

- [ ] Existing tests pass (excluding deleted PCC tests)
  - Run: `npm test`
  - Expected: all tests pass
  - Fails when: any test depends on PCC module being present

## Blocked by

None - can start immediately.
