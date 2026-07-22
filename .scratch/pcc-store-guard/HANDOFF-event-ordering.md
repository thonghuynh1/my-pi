# Handoff — PCC flag pipeline is inert due to event ordering

Status: needs investigation. The PRD's code is fully implemented, but the pieces never connect at runtime.

## What was found

The PCC store guard PRD (`.scratch/pcc-store-guard/PRD.md`) added a flag pipeline:

```
proactive-compress.ts sets _pccCompressed: true
  → linearize() reads it → Block.proactivelyCompressed
    → buildView() → ViewBlock.proactivelyCompressed
      → substOne() guard clamps fold/replace
      → Inspector renders "PCC" badge
```

Every piece is implemented and individually tested. But in a live session, there are **zero PCC-flagged blocks** despite 148 tool results (largest at 5600 tokens, well above the 300-token threshold). The pipeline never fires end-to-end.

## The event ordering problem

Pi's extension hooks fire in this order:

```
1. "context" hook fires (before model call)
   └─ accordion reads pi's stored messages (original full content)
   └─ linearize(messages) → blocks sent to dashboard
   └─ messages have NO _pccCompressed flag
   └─ all blocks have proactivelyCompressed: false

2. "before_provider_request" hook fires (after context, before provider call)
   └─ PCC compresses eligible tool results
   └─ returns { ...message, content: stub, _pccCompressed: true }
   └─ provider receives compressed payload
   └─ _pccCompressed exists ONLY on this transient payload object

3. next turn → back to step 1
   └─ pi's stored messages still have full content, no _pccCompressed
   └─ linearizer never sees the flag
```

The `_pccCompressed` flag is born at step 2 and dies at step 2. It never reaches step 1 where the linearizer, store, and dashboard live.

## What this means

| Component | Code present? | Exercised at runtime? |
|---|---|---|
| `_pccCompressed` set on message | Yes | Only in transient provider payload |
| Linearizer propagation | Yes | Never (input messages lack the flag) |
| `substOne()` guard | Yes | Never fires |
| Dashboard "PCC" badge | Yes | Never renders |
| Conductor cleanup (removed regex) | Yes | Conductor now uses `b.proactivelyCompressed` which is always `false` |
| PCC compression itself | Yes | Works (provider receives stubs) but invisible to everything else |

The store guard was designed to prevent double-folding of PCC stubs. But since `proactivelyCompressed` is always `false`, any conductor can freely fold these stubs. The guard protects nothing.

## The design fix (user's intuition)

PCC should compress the message and set the flag BEFORE linearization, so the stub enters the entire pipeline from the start:

1. Tool result created → PCC compresses it → `_pccCompressed: true` on pi's stored message
2. `context` hook → linearizer reads `_pccCompressed` → `proactivelyCompressed: true` on block
3. Store guard protects the stub from conductor folding
4. Dashboard shows PCC badge
5. Provider receives the stub (already compressed, cache-stable)
6. On next call, the stub is already small in the frozen prefix

This means PCC should fire at message creation time or during the `context` hook (before linearization), not during `before_provider_request` (after linearization). The compressed stub becomes the canonical message content from the start. The recall tool's `originals` map still holds the full content for agent recovery.

## Key question to grill

If PCC compresses during `context` instead of `before_provider_request`, the compressed stub becomes pi's stored message. On subsequent model calls, the stub content is what enters the provider's cache prefix. This is good (small, stable prefix). But verify:

- Does `recallCode()` produce deterministic codes for the same content? (If not, re-compression on retry would change the stub and invalidate the cache.)
- What happens if the model call fails and pi retries with the same messages? The stubs are already in place, so the retry sends identical content. This is correct.
- What happens with accordion's fold plan? If the conductor tries to fold a PCC stub, the store guard now actually fires and clamps it. This is the intended behavior.

## Evidence

- Live session query: 428 blocks, 148 tool results, 0 with `proactivelyCompressed: true`.
- Largest tool result: 5605 tokens (`read`), well above `MIN_TOKEN_THRESHOLD = 300`.
- `frozenFromIndex: 237` (cache tracker working correctly, not blocking PCC).
- Hook registration order confirmed: PCC registers before cache-tracker on `before_provider_request`, both fire AFTER `context`.

## Files involved

- `extensions/accordion/extension/proactive-compress.ts` — PCC logic, `handleBeforeProviderRequest`, `shouldCompress`
- `extensions/accordion/extension/accordion.ts` — event hook registration, `context` hook at line 1124, PCC install at line 1462
- `extensions/accordion/extension/cache-tracker.ts` — `getFrozenFromIndex()`, prefix-match heuristic
- `extensions/accordion/app/src/lib/live/mapping.ts` — `linearize()`, reads `_pccCompressed`
- `extensions/accordion/app/src/lib/engine/store.svelte.ts` — `substOne()` guard, `buildView()` propagation

## Suggested skills for next session

- `skill-pstack name=poteto-mode` — load before working
- `skill-pstack name=interrogate` — stress-test the proposed fix (compress-at-context vs compress-at-provider-request)
- `skill-pstack name=principle-redesign-from-first-principles` — PCC's hook point should be redesigned as if the flag pipeline had been part of the original design
- `skill-pstack name=blast-radius` — verify that moving PCC earlier doesn't break the cache tracker's prefix-match logic (it compares stringified messages; changing content changes the comparison)

## Also fixed this session

Two unrelated bugs in `extensions/frontend-coach/picker.js` were fixed:

1. `whenBodyReady` deferral: `addInitScript` runs before `<body>` exists, crashing `appendChild`. Fixed with a `MutationObserver` fallback.
2. Custom input overlay: replaced `window.prompt()` (auto-dismissed by Playwright CDP) with an in-page HTML overlay. Named event handlers with `__piCoachCleanup` for safe re-injection.

The accordion dashboard build was also stale (protocol version 6 vs extension's version 5). Rebuilt via `npm run build` in `extensions/accordion/app/`.
