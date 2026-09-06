# Candidate 2 — block-accounted cache tracking plus atomic budget rollover

Design only. Bodies below are signatures or pseudocode and are not implementation.

## Caller-facing shape

The extension projects the exact outbound message array together with provenance, then commits that projection on every delivered model call, including an empty-plan passthrough:

```ts
const raw = projectPlan(originalMessages, [], []);
const frozen = cacheTracker.currentFrozenBoundary();

const plan = await requestPlan(reqId, full, fresh, {
	frozenFromIndex: frozen.blockIndex,
});

const outbound = plan.ops.length || plan.groups.length
	? projectPlan(originalMessages, plan.ops, plan.groups)
	: raw;

cacheTracker.commitConversation(outbound, latestModel?.provider);
return outbound.changed
	? { messages: outbound.messages as AgentMessage[] }
	: undefined;
```

`commitConversation` is called after the final outbound choice, not only after a non-empty plan. Timeout/no-client paths remain best-effort passthrough and may use the same finalizer without waiting or doing disk I/O.

The conductor keeps its public call unchanged:

```ts
conduct(view: ConductorView): ConductorPlan
```

When over `availableCap(view)`, it first uses unfrozen material. Only when legal unfrozen savings cannot close the deficit does it schedule one turn-aligned `lifecycle: "rollover"` group that may cross the honest frozen boundary.

## Data structures

### `app/src/lib/live/mapping.ts`

```ts
export interface SourceBlockSpan {
	/** Inclusive source-message index represented by this outbound message. */
	sourceMessageFrom: number;
	sourceMessageTo: number;
	/** Exclusive Accordion block boundary represented after sourceMessageTo. */
	sourceBlockEnd: number;
}

export interface ProjectedConversation {
	messages: PiMessage[];
	spans: SourceBlockSpan[];
	changed: boolean;
}

export function projectPlan(
	messages: PiMessage[],
	ops: readonly FoldOp[],
	groups?: readonly GroupOp[],
): ProjectedConversation {
	throw new Error("design sketch");
}

export function sourceBlockEnds(messages: readonly PiMessage[]): number[] {
	throw new Error("design sketch");
}
```

Invariants encoded by `ProjectedConversation`:

- `messages.length === spans.length`.
- Every span is monotone and non-overlapping.
- An in-place fold keeps its source message span.
- A group summary maps to the entire source-message run it replaces.
- A dropped group contributes no outbound message; the next surviving span still advances over the dropped source range.
- `sourceBlockEnd` is derived through the same block-emission rules as `linearize`, never from provider-message count.

`applyPlan` remains a compatibility wrapper:

```ts
export function applyPlan(
	messages: PiMessage[],
	ops: FoldOp[],
	groups: GroupOp[] = [],
): PiMessage[] {
	return projectPlan(messages, ops, groups).messages;
}
```

### `extension/cache-tracker.ts`

Provider-envelope invalidation and conversation-prefix accounting are separate types so message units cannot be mistaken for block units:

```ts
type ProviderMessageCount = number & { readonly __brand: "ProviderMessageCount" };
type BlockBoundary = number & { readonly __brand: "BlockBoundary" };

export interface ConversationSnapshot {
	messageStrings: string[];
	spans: SourceBlockSpan[];
	provider: string;
}

export interface ProviderEnvelope {
	systemHash: string;
	toolsHash: string;
	provider: string;
}

export interface FrozenBoundary {
	blockIndex: BlockBoundary;
	matchedOutboundMessages: ProviderMessageCount;
	reason: CacheTrackerReason;
}

export function observeProviderEnvelope(
	payload: unknown,
	provider: string | undefined,
): void {
	/* update provider/system/tools invalidators only */
}

export function commitConversation(
	projected: ProjectedConversation,
	provider: string | undefined,
): FrozenBoundary {
	throw new Error("design sketch");
}

export function currentFrozenBoundary(): FrozenBoundary {
	throw new Error("design sketch");
}
```

Prefix computation:

```ts
function deriveFrozenBoundary(
	previous: ConversationSnapshot | null,
	current: ConversationSnapshot,
	envelopeStable: boolean,
): FrozenBoundary {
	/*
	1. Reset to block 0 when provider/system/tools changed.
	2. Count equal serialized outbound Pi messages.
	3. Retain the existing one-message safety margin:
	   safeMessages = max(0, matchedMessages - 1).
	4. Convert safeMessages to a block boundary through
	   current.spans[safeMessages - 1].sourceBlockEnd.
	5. Clamp only as defensive validation, never as unit conversion.
	*/
	throw new Error("design sketch");
}
```

This deliberately does not claim that provider messages and blocks are 1:1. Unchanged outbound Pi messages are a conservative cache-prefix witness because provider conversion is deterministic for a stable provider/system/tools envelope; the provenance span performs the separate conversion into block order.

### `conductors/my-customize-conductor/budget-rollover.ts` (new private helper)

This is a helper for the existing conductor, not a new conductor.

```ts
export type BudgetDeficit = {
	cap: number;
	live: number;
	requiredSaving: number;
};

export interface PlannedBudgetRollover {
	commands: Extract<Command, { kind: "group" }>[];
	consumedIds: Set<string>;
	estimatedSaving: number;
	projectedTokens: number;
}

export function budgetDeficit(view: ConductorView): BudgetDeficit | null {
	throw new Error("design sketch");
}

export function estimateLegalUnfrozenSaving(
	view: ConductorView,
	excluded: ReadonlySet<string>,
): number {
	throw new Error("design sketch");
}

export function planBudgetRollover(
	view: ConductorView,
	deficit: BudgetDeficit,
	excluded: ReadonlySet<string>,
	buildDigest: (blocks: readonly ViewBlock[]) => string,
): PlannedBudgetRollover | null {
	throw new Error("design sketch");
}
```

Selection invariants:

- Search only `[0, protectedFromIndex)`; the protected tail is never selected.
- Split at held blocks; never include or snap across a human-held block.
- Use complete turns and whole provider-message groups.
- Preserve tool-call/result balance via `trimOpenToolPairs`.
- Skip already grouped blocks and command IDs replayed by the stable plan.
- Prefer ranges at or after `frozenFromIndex`.
- Cross below `frozenFromIndex` only if all eligible unfrozen savings are insufficient.
- Select the oldest smallest safe range whose estimated group saving closes the remaining deficit.
- Emit semantic `group` commands with `lifecycle: "rollover"`; never set `breakFrozen`.
- If barriers make the budget impossible, return the maximal safe saving and report an explicit residual deficit rather than touching protected or held content.

## Conductor integration

`MyCustomizeConductor.conduct` becomes a pressure ladder:

```ts
private planBudgetPressure(
	view: ConductorView,
	prior: readonly Command[],
	callById: ReadonlyMap<string, ViewBlock>,
): ConductorPlan | null {
	/*
	1. Compute deficit against availableCap(view).
	2. Reuse normal pressure and ordinary rollover over unfrozen blocks.
	3. Project their savings.
	4. If they close the deficit, preserve current cache-first behavior.
	5. If not, invoke planBudgetRollover for only the residual.
	6. Release selected IDs from preGroup membership in the same ConductorPlan.
	7. Return prior + unfrozen commands + one atomic rollover batch.
	*/
	throw new Error("design sketch");
}
```

`planHardCapEmergency` remains a separate safety valve for actual context-window overflow. It may continue using `breakFrozen` for per-block folds/replacements. Soft-budget pressure never gains that authority.

Stable-plan guards must include whether the previous projected plan meets the current cap. A cached empty plan is not reusable while `view.liveTokens > availableCap(view)` and safe rollover capacity exists.

## Host contract and ordering

No new public command kind is required. Existing `GroupCommand.lifecycle: "rollover"` is the cache-rebase primitive.

The contract comments are tightened:

```ts
export interface FoldCommand {
	kind: "fold";
	ids: string[];
	digest?: string;
	/** Per-block cached-prefix rewrite; host permits only at real window pressure. */
	breakFrozen?: boolean;
}

export interface GroupCommand {
	kind: "group";
	ids: string[];
	digest?: string | null;
	/**
	 * "rollover" is an intentional atomic cache rebase and may cross frozenFromIndex.
	 * It still cannot cross protected, held, pre-group-owned, or invalid pair boundaries.
	 */
	lifecycle?: "transient" | "rollover";
}
```

For a `ConductorPlan`, authoritative `preGroup.memberIds` is installed before command validation, or group validation receives that desired membership. This allows a budget rollover to atomically release and consume selected pre-group IDs without a one-pass `"pre-group"` clamp.

`substOne` and `hasHardContextPressure()` do not change. `groupCmd` retains the existing explicit rollover permission, but its comment names soft-budget rollover as intended policy rather than a legacy exception.

## Module map

- `app/src/lib/live/mapping.ts`
  - Add provenance-carrying `projectPlan`.
  - Keep `linearize` and `applyPlan` public behavior.
- `extension/cache-tracker.ts`
  - Split provider-envelope invalidation from outbound-conversation prefix tracking.
  - Convert matched outbound messages to a block boundary through spans.
- `extension/accordion.ts`
  - Commit the final outbound projection on empty and non-empty plans.
  - Send only `FrozenBoundary.blockIndex` as `frozenFromIndex`.
- `conductors/my-customize-conductor/budget-rollover.ts`
  - Private safe-range and saving planner.
- `conductors/my-customize-conductor/my-customize-conductor.ts`
  - Add the budget-pressure ladder before hard-cap emergency fallback completion.
- `conductors/contract/conductor.ts`
  - Clarify existing rollover versus `breakFrozen` policy; no wider API.
- `app/src/lib/engine/store.svelte.ts`
  - Make ConductorPlan pre-group release/application atomic; retain all safety clamps.

## Test sketch

```ts
it("maps matched outbound messages to an honest block boundary", () => {
	// One assistant message emits thinking + text + tool_call blocks.
	// The result must advance by emitted block count, not provider message count.
});

it("commits empty-plan passthrough as the next prefix baseline", () => {
	// Two rapid small turns; diagnostics follow the actual outbound arrays.
});

it("prefers unfrozen pressure savings before cache rollover", () => {
	// Enough unfrozen fold/group capacity: no frozen rollover member.
});

it("atomically rolls over a fully frozen prefix at the soft budget", () => {
	// Existing 85k / 70k / 1.1M regression; projected <= 70k.
});

it("budget rollover excludes protected and held blocks", () => {
	// Held barrier splits ranges; protected tail is absent from every command.
});

it("does not grant soft-budget breakFrozen authority", () => {
	// Existing host test remains unchanged and passing.
});
```

Policy test changes:

- Keep `conductor.test.ts` — “rejects breakFrozen when only the soft budget is exceeded.”
- Replace “rewrites a frozen prefix only when the real context window overflows” with two narrower assertions:
  - per-block `breakFrozen` still requires real context-window overflow;
  - atomic rollover groups may rebase a frozen prefix to satisfy the soft budget.
- Keep the new fully-frozen regression and require projected tokens `<= availableCap(view)`.
