# 03 — replayPriorCommands skips frozenFromIndex check for replace commands

Type: grilling
Status: resolved

## Question

In `replayPriorCommands()`, group commands check `canRewriteFrozen` before replaying in the frozen prefix:
```ts
if (command.kind === "group") {
    const canRewriteFrozen = command.lifecycle === "rollover" || (...);
    const valid = command.ids.every((id) => {
        // ...
        (block.order >= view.frozenFromIndex || canRewriteFrozen);
    });
}
```

But replace commands have NO frozen check:
```ts
} else if (command.kind === "replace") {
    const block = blockById.get(command.id);
    if (block && !block.held && !block.protected && !block.grouped) {
        replayable.push(command);
    }
}
```

**Decision:** Should replace commands also check `block.order >= view.frozenFromIndex` before being replayed? Replaying a replace on a frozen block would change the cached content. The host may clamp it, but relying on host clamping is fragile — the conductor should not emit commands it knows will break cache.

This is a secondary contributor to instability: a replace command from a prior plan keeps being replayed on a now-frozen block, potentially with a different digest than what was cached.

Note: the host may already clamp these via `ClampReport`, but the conductor should be self-consistent — don't emit what you know will be clamped.

## Answer

**Decision: Yes — add `block.order >= view.frozenFromIndex` check for replace commands in `replayPriorCommands()`.**

The fix is a one-line addition to the replace branch:
```ts
} else if (command.kind === "replace") {
    if (excluded.has(command.id)) continue;
    const block = blockById.get(command.id);
    if (block && !block.held && !block.protected && !block.grouped && block.order >= view.frozenFromIndex) {
        replayable.push(command);
    }
}
```

This prevents replaying a replace on a block that's now in the cached prefix. The cached version (whatever it was — original or a prior replace) should be preserved. A stale replace replayed on a frozen block changes the prefix content → cache break.

**Exception consideration:** Group commands have `canRewriteFrozen` for rollover lifecycle. Replace commands don't need this exception because:
- Replace is for individual blocks (rich digests, MCP summaries)
- These are already applied and cached — re-applying with potentially different content is harmful
- If the conductor needs to change a frozen replace, it should wait for the next rollover (which explicitly breaks cache via group commands)
