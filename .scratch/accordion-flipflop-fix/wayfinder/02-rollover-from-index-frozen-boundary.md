# 02 — Rollover fromIndex should respect frozen boundary

Type: grilling
Status: resolved
Blocked by: 01

## Question

The rollover start index is currently:
```ts
let rolloverFromIndex = preGroupFromIndex < view.frozenFromIndex ? preGroupFromIndex : view.frozenFromIndex;
```

This means rollover CAN start from inside the frozen prefix (when `preGroupFromIndex < frozenFromIndex`). This is why the restore phase exists — to unfold frozen-prefix blocks so rollover can group them.

**Decision:** If we decide in ticket 01 to stop restoring frozen blocks, should `rolloverFromIndex` be clamped to `Math.max(frozenFromIndex, ...)` so rollover never touches frozen blocks? This would mean:
- Frozen prefix stays untouched → cache preserved
- Rollover only operates between `frozenFromIndex` and `protectedFromIndex`
- The pre-group window effectively shrinks when `frozenFromIndex` advances past `preGroupFromIndex`

Risk: if `frozenFromIndex` advances close to `protectedFromIndex`, the rollover window becomes too small to produce meaningful groups. Need to verify the conductor still functions when the available window is narrow.

## Answer

**Decision: Yes — clamp `rolloverFromIndex` to `Math.max(frozenFromIndex, ...)`.**

The rollover start index computation changes from:
```ts
let rolloverFromIndex = preGroupFromIndex < view.frozenFromIndex ? preGroupFromIndex : view.frozenFromIndex;
```
To:
```ts
let rolloverFromIndex = Math.max(view.frozenFromIndex, preGroupFromIndex < view.frozenFromIndex ? preGroupFromIndex : view.frozenFromIndex);
```
Which simplifies to:
```ts
let rolloverFromIndex = Math.max(view.frozenFromIndex, preGroupFromIndex);
```
Wait — that's wrong. When `preGroupFromIndex >= frozenFromIndex`, the original already uses `frozenFromIndex`. The issue is when `preGroupFromIndex < frozenFromIndex`. In that case, the original uses `preGroupFromIndex` (inside frozen). The fix: always use `Math.max(frozenFromIndex, ...)` as a floor.

Actually the simplest correct fix: clamp the final value:
```ts
rolloverFromIndex = Math.max(rolloverFromIndex, view.frozenFromIndex);
```
Applied AFTER the existing computation and the barrier-skip loop.

**Narrow window risk is acceptable:** When `frozenFromIndex` is close to `protectedFromIndex`, the rollover window IS small — but that's correct behavior. The frozen prefix is cache-warm and shouldn't be touched. Normal pressure folding (which operates before `preGroupFromIndex`) handles budget pressure when rollover can't fire. The conductor already has fallback paths (normal pressure, MCP recovery) for this case.
