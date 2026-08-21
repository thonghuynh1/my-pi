---
repo: C:\my-pi\extensions\accordion
---

## Parent

Wayfinder map: `.scratch/accordion-vcc-upgrade/map.md`, slice 1.
Resolved decision: [02 — search-within-fold architecture](../wayfinder/02-search-within-fold-architecture.md) (D1, D2).

## What to build

Add an optional `query?: string` field to `RecallRequestMessage` on the wire and to the `recall` tool's parameter schema. When `query` is absent, behavior is unchanged. This issue only threads the parameter through — the GUI-side search logic is in issue 03.

## Implementation map

### Wire protocol: `app/src/lib/live/protocol.ts`

**Current** `RecallRequestMessage` (line 214):
```ts
export interface RecallRequestMessage {
    type: "recallRequest";
    reqId: number;
    codes: string[];
}
```

**Change:** Add `query?: string` field:
```ts
export interface RecallRequestMessage {
    type: "recallRequest";
    reqId: number;
    codes: string[];
    query?: string;
}
```

No changes to `RecallContent`, `RecallResultMessage`, `ServerMessage`, or `ClientMessage` unions.

### Tool schema: `extension/accordion.ts`

**Current** recall tool parameters (line 1557–1561):
```ts
parameters: Type.Object({
    codes: Type.Array(Type.String({ ... }), { ... }),
}),
```

**Change:** Add optional `query` property:
```ts
parameters: Type.Object({
    codes: Type.Array(Type.String({ ... }), { ... }),
    query: Type.Optional(Type.String({
        description: "Search query. When provided, returns only matching fragments from the specified block(s) instead of full content."
    })),
}),
```

### Extension recall handler: `extension/accordion.ts`

**Current** `requestRecall` (line 1031) sends:
```ts
send(ws, { type: "recallRequest", reqId, codes } as RecallRequestMessage);
```

**Change:** Thread `query` through:
- Add `query?: string` parameter to `requestRecall` signature
- Include in the sent message: `{ type: "recallRequest", reqId, codes, query }`
- In the `execute` handler (~line 1568), extract `params.query` and pass to `requestRecall`

### Tool description update

Update the `recall` tool's `description` and `promptSnippet` to mention the optional `query` parameter. Add a `promptGuidelines` entry explaining when to use `query` vs plain recall.

## Acceptance criteria

- [ ] `RecallRequestMessage` accepts optional `query` field
  - Run: `npx tsc --noEmit -p app/tsconfig.json`
  - Expected: compiles — `{ type: "recallRequest", reqId: 1, codes: ["abc"], query: "test" }` satisfies `RecallRequestMessage`
  - Fails when: type error on `query` field

- [ ] `recall` tool schema includes optional `query` parameter
  - Run: `npx vitest run extension/accordion.test.ts` (or grep for `"query"` in tool registration)
  - Expected: tool parameters include `query` as optional string
  - Fails when: `query` not in schema

- [ ] `requestRecall` forwards `query` in the wire message
  - Run: verify by reading `requestRecall` signature and `send()` call
  - Expected: `query` included in `RecallRequestMessage` when present, omitted when absent
  - Fails when: `query` is dropped before sending

- [ ] Recall without `query` behaves identically to today
  - Run: `npx vitest run app/src/lib/live/plan.test.ts`
  - Expected: all existing `resolveRecall` tests pass unchanged
  - Fails when: any existing recall test regresses

## Blocked by

None - can start immediately.
