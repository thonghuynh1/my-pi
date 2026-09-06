# Candidate 1 — Cache-break grant: budget starvation is a first-class reason to rewrite the prefix

**Shape in one line:** the frozen prefix stops being a wall keyed on the *context window* and becomes a
lease keyed on a single host-computed **grant** — `denied | starved | overflow` — derived by ONE pure
function that both the host and every conductor call. No index remapping, no percentage cap, no new
conductor, no new view field.

---

## 1. Caller's view first

### 1a. The conductor author

```ts
import { availableCap, cacheBreakGrant, contextWindowCap } from "../contract";

conduct(view: ConductorView): ConductorPlan {
	const cap = availableCap(view);
	const hardCap = contextWindowCap(view);

	// ONE question, one answer, no re-derivation of host policy.
	const grant = cacheBreakGrant(view);

	if (grant !== "denied") {
		// "overflow" ⇒ we must fit the wire. "starved" ⇒ we must fit the budget.
		const target = grant === "overflow" ? hardCap : cap;
		const plan = this.planFrozenCompaction(view, target, callById);
		if (plan.length > 0) return /* … */;
	}
	// …ordinary cache-preserving planning, unchanged…
}
```

The conductor never asks "is the window overflowing?" again. It asks "am I allowed to rewrite the
prefix, and to what target?" — and the host answers with the *same function it will use to enforce*.

### 1b. The host (store)

```ts
applyCommands(cmds: Command[], by: Actor): ClampReport[] {
	const grant = this.cacheBreakGrant(); // computed ONCE per pass, O(n)
	for (const c of cmds) {
		switch (c.kind) {
			case "fold":
				for (const id of c.ids)
					this.substOne(id, c.digest, by, "fold", reports, { breakFrozen: c.breakFrozen, grant });
			// …
		}
	}
}
```

### 1c. The human

Nothing changes. Locks, holds, the protected tail, detach: untouched.

---

## 2. Data structures first

### 2.1 The one new type

```ts
// conductors/contract/conductor.ts — next to availableCap / contextWindowCap

/**
 * Whether the host will currently honour `breakFrozen`, and WHY. The single source of
 * truth for cached-prefix policy: the host enforces this value in `substOne`/`groupCmd`,
 * and a conductor reads the same value from the same function over the same view. There
 * is no second implementation to drift.
 *
 *  - "denied"   — the cached prefix is productive; keep it byte-identical. The default.
 *  - "starved"  — over BUDGET, and the unfrozen region provably cannot close the gap even
 *                 if every eligible block in it were given up. Compact to `availableCap`.
 *  - "overflow" — the REAL provider window is about to overflow. Compact to
 *                 `contextWindowCap`. Strictly more urgent than "starved".
 */
export type CacheBreakGrant = "denied" | "starved" | "overflow";
```

### 2.2 The input shape — structurally satisfied by `ConductorView`

```ts
/**
 * Everything the grant depends on. `ConductorView` already satisfies this structurally,
 * so a conductor calls `cacheBreakGrant(view)` with no adapter; the store builds the same
 * projection from its own blocks. Deliberately NOT a new field on ConductorView: the grant
 * is a pure function of data already on the view, and a stored copy is a copy that can lie.
 */
export interface CachePressureInput {
	blocks: readonly CachePressureBlock[];
	budget: number;
	contextWindow: number | null;
	liveTokens: number;
	frozenFromIndex: number;
	harnessOverhead?: number;
	outputReserve?: number;
	calibration?: number;
}

/** The subset of `ViewBlock` the grant reads. */
export interface CachePressureBlock {
	order: number;
	tokens: number;
	held: boolean;
	protected: boolean;
	grouped: boolean;
}
```

**Why no `view.cacheBreak` field.** A field must be populated by every `makeView` in every test
and every wire producer, and can be stale relative to the blocks beside it. A pure function over
fields that already exist cannot be stale and cannot be forgotten. Public surface added: **one type,
one function.** `ViewBlock` unchanged. `Command` unchanged. `ConductorView` unchanged.

---

## 3. Signatures

```ts
// ── conductors/contract/conductor.ts (additions) ──────────────────────────────

export type CacheBreakGrant = "denied" | "starved" | "overflow";
export interface CachePressureBlock { /* §2.2 */ }
export interface CachePressureInput { /* §2.2 */ }

/**
 * The host's cached-prefix policy, as one pure total function. Monotone in `liveTokens`
 * and antitone in unfrozen capacity, so it cannot flap for a fixed view.
 */
export function cacheBreakGrant(input: CachePressureInput): CacheBreakGrant;

/**
 * Upper bound on the tokens the UNFROZEN region could still give up under host rules —
 * the full `tokens` of every block at `order >= frozenFromIndex` that is not held, not
 * protected and not already grouped. An UPPER bound on purpose: grouping can collapse a
 * whole run to a short digest, so counting only `tokens - foldedTokens` would understate
 * the region and grant "starved" too eagerly. Biasing this optimistic biases the grant
 * toward "denied" — cache preservation stays the default.
 */
export function unfrozenCapacity(input: CachePressureInput): number;

// ── app/src/lib/engine/store.svelte.ts (changed) ──────────────────────────────

/** REPLACES `private hasHardContextPressure(): boolean`. Same call sites, richer answer. */
private cacheBreakGrant(): CacheBreakGrant;

/** Options bag replaces the trailing positional `recoverable, breakFrozen` pair. */
interface SubstOptions {
	recoverable?: boolean;
	breakFrozen?: boolean;
	/** The pass's grant. Present so `breakFrozen` can never be read without it. */
	grant: CacheBreakGrant;
}

private substOne(
	id: string,
	content: string | undefined,
	by: Actor,
	kind: "fold" | "replace",
	reports: ClampReport[],
	opts: SubstOptions,
): void;

private groupCmd(
	ids: string[],
	by: Actor,
	digest: string | null | undefined,
	lifecycle: GroupLifecycle | undefined,
	reports: ClampReport[],
	grant: CacheBreakGrant,
): void;

// ── conductors/my-customize-conductor/my-customize-conductor.ts (changed) ─────

/** RENAMED from `planHardCapEmergency`. `hardCap` parameter becomes `target`. */
private planFrozenCompaction(
	view: ConductorView,
	target: number,
	callById: ReadonlyMap<string, ViewBlock>,
): Command[];

/** New memo key component so a grant transition always forces a re-plan. */
private lastGrant: CacheBreakGrant = "denied";
```

---

## 4. Not-implemented bodies

```ts
// conductors/contract/conductor.ts

export function unfrozenCapacity(input: CachePressureInput): number {
	// Sum `tokens` over blocks with order >= frozenFromIndex that are
	// !held && !protected && !grouped. Single pass, no allocation.
	throw new Error("not implemented");
}

export function cacheBreakGrant(input: CachePressureInput): CacheBreakGrant {
	// 1. if (liveTokens > contextWindowCap(input)) return "overflow";
	//      — unchanged from today's `hasHardContextPressure`, so every existing
	//        window-limit test keeps its exact meaning.
	// 2. if (contextWindow === null) return "denied";
	//      — with no window we have no evidence the reported boundary means anything;
	//        refuse to rewrite a cached prefix on a hunch. Keeps preview/read-only and
	//        the non-live test path byte-identical to today.
	// 3. const gap = liveTokens - availableCap(input); if (gap <= 0) return "denied";
	// 4. return unfrozenCapacity(input) < gap ? "starved" : "denied";
	//      — "even surrendering the entire unfrozen region leaves us over budget."
	//        No threshold, no percentage, no fabricated index.
	throw new Error("not implemented");
}

// app/src/lib/engine/store.svelte.ts

private cacheBreakGrant(): CacheBreakGrant {
	// Build the CachePressureBlock projection from this.blocks using the SAME
	// held/protected/grouped predicates buildView() uses (isProtected, groupWire,
	// override !== null), then delegate to the contract function. Called once per
	// applyCommands pass — never once per command.
	throw new Error("not implemented");
}

private substOne(id, content, by, kind, reports, opts: SubstOptions): void {
	// …unknown-id / human-override / pre-group / grouped / protected gates unchanged…
	//
	// FROZEN GATE — the only changed line:
	//   if (b.order < this.frozenFromIndex && !(opts.breakFrozen && opts.grant !== "denied"))
	//       return void reports.push(clamp(kind, [id], "frozen", …include opts.grant in detail…));
	//
	// …foldability gate and substitution unchanged…
	throw new Error("not implemented");
}

private groupCmd(ids, by, digest, lifecycle, reports, grant): void {
	// …unchanged…
	//   if (!canRewriteFrozen && grant === "denied")
	//       return void reports.push(clamp("group", ids, "frozen", "would rewrite the provider's cached prefix"));
	throw new Error("not implemented");
}

// conductors/my-customize-conductor/my-customize-conductor.ts

private planFrozenCompaction(view, target, callById): Command[] {
	// Body is today's planHardCapEmergency with two edits:
	//
	//  (a) every `hardCap` reference becomes `target`. The existing oldest-first
	//      early exit (`if (live <= target) break;`) now stops at the BUDGET under
	//      a "starved" grant instead of running to the 1.1M window — this is the
	//      minimal-break property: rewrite the shortest oldest prefix that closes
	//      the gap, keep the rest of the cache warm.
	//
	//  (b) the trailing group pass (for frozen blocks whose KIND cannot fold —
	//      user / tool_call) is gated on the post-fold remainder:
	//          if (live <= target) return commands;   // skip grouping entirely
	//      Today it always runs and grouped far more than the gap required.
	//
	// Everything else — MCP summary replacement with `recoverable: true,
	// breakFrozen: true`, FOLDABLE_KINDS filtering, the `disposed` set, the
	// contiguous-run flush — is untouched.
	throw new Error("not implemented");
}

conduct(view: ConductorView): ConductorPlan {
	// const grant = cacheBreakGrant(view);
	//
	// Memo guards (3 sites) — replace `view.liveTokens <= hardCap` with
	// `grant === "denied"` and add `grant === this.lastGrant` to the key, so a
	// denied→starved transition can never be served from cache. Record
	// this.lastGrant alongside lastCap / lastFrozenFromIndex at every exit.
	//
	// Emergency gate:
	//   if (grant !== "denied") {
	//       const target = grant === "overflow" ? hardCap : cap;
	//       const emergency = this.planFrozenCompaction(view, target, callById);
	//       …existing replay + finishConduct wiring, rolloverBlockedReason becomes
	//         "hard-cap-emergency" | "budget-starved"…
	//   }
	//
	// Everything below the gate — pre-group, rollover, normal pressure — unchanged.
	throw new Error("not implemented");
}
```

---

## 5. Module map

| file | change | size |
|------|--------|------|
| `conductors/contract/conductor.ts` | **+** `CacheBreakGrant`, `CachePressureBlock`, `CachePressureInput`, `cacheBreakGrant()`, `unfrozenCapacity()`. Doc-only edits on `FoldCommand.breakFrozen`, `ReplaceCommand.breakFrozen` ("only at the real context-window limit" → "only when the host grants a cache break") and on `ConductorView.frozenFromIndex` (state plainly that the value is a host estimate and that starvation overrides it). | ~55 lines added, 3 comments edited |
| `app/src/lib/engine/store.svelte.ts` | `hasHardContextPressure()` → `cacheBreakGrant()`; `applyCommands` computes the grant once and threads it; `substOne` takes `SubstOptions`; `groupCmd` takes `grant`. Two enforcement predicates change. | ~30 lines |
| `conductors/my-customize-conductor/my-customize-conductor.ts` | rename + `target` parameter + group-pass gate + grant-aware memo key. | ~20 lines |
| `conductors/contract/conductor.cache-break.test.ts` | **new** — the grant's truth table (denied / starved / overflow, `contextWindow: null`, held & protected exclusions, gap boundary). | ~90 lines |
| `app/src/lib/engine/conductor.test.ts` | 2 policy tests rewritten (§6). | ~30 lines |
| `app/src/lib/engine/conductor.my-customize-conductor.test.ts` | 1 rename, the failing test goes green. | ~5 lines |

**Untouched:** `extension/cache-tracker.ts`, `extension/accordion.ts`, `mapping.ts`, `protocol.ts`,
the Rust layer, every other conductor, the builtin golden test, the UI.

---

## 6. Test deltas — the product rule that changes, named explicitly

> **RULE CHANGE.** Today: *a cached prefix may be rewritten only when the real context window
> overflows.* After this change: *a cached prefix may be rewritten when the real context window
> overflows, OR when the session is over budget and the unfrozen region provably cannot close the
> gap.* The soft budget alone is still NOT a licence to break cache — that part of the old rule
> survives intact, and the rewritten tests assert it.

| test | today | after |
|------|-------|-------|
| `conductor.test.ts` → "rejects breakFrozen when only the soft budget is exceeded" | rejects | **rewritten** as "rejects breakFrozen when the soft budget is exceeded but unfrozen material can still close the gap" — same setup, unfrozen block sized above the gap. Still rejects. Plus a new sibling, "permits breakFrozen when the soft budget is exceeded and no unfrozen material remains", which passes. |
| `conductor.test.ts` → "rejects a frozen group when only the soft budget is exceeded" | rejects | same treatment: renamed with "…but unfrozen material can still close the gap", block sized accordingly. |
| `conductor.test.ts` → "permits a frozen rewrite at the real context-window limit" | passes | unchanged, unchanged meaning (`"overflow"`). |
| `my-customize-conductor.test.ts` → "rewrites a frozen prefix only when the real context window overflows" | passes | **renamed** to "…only when the host grants a cache break"; body unchanged (window 2 000 ⇒ `"overflow"`). |
| `my-customize-conductor.test.ts` → "does not rewrite a frozen prefix when the context window is unknown" | passes | **unchanged and green** — step 2 of the grant returns `"denied"` when `contextWindow === null`. |
| `my-customize-conductor.test.ts` → the three `hardCap …` tests | pass | unchanged. `"overflow"` targets `contextWindowCap`, identical to today. The new group-pass gate only ever emits *fewer* group commands; every assertion is on folds and on `projected(...) <= window`. |
| `my-customize-conductor.test.ts` → **"compacts a fully frozen prefix when over budget even if the context window still has room"** | `commands.length === 0` | **green** — traced in §7. |

---

## 7. Trace of the failing test

Input: 16 content blocks (`user`/`text` alternating, 5 000 tokens each; `text.foldedTokens = 100`)
plus a protected `user` tail. `liveTokens = 85 000`, `budget = 70 000`, `contextWindow = 1 100 000`,
`frozenFromIndex = 17 = blocks.length`.

1. `contextWindowCap` = 1 100 000. `85 000 > 1 100 000` is false ⇒ not `"overflow"`. *(This is exactly
   why today's code emits nothing.)*
2. `contextWindow !== null` ⇒ continue.
3. `availableCap` = `min(70 000, 1 100 000)` = 70 000. `gap = 85 000 − 70 000 = 15 000 > 0`.
4. `unfrozenCapacity`: no block has `order >= 17`; the tail is `protected` anyway ⇒ **0**.
   `0 < 15 000` ⇒ **`"starved"`**.
5. `target = availableCap = 70 000`. `planFrozenCompaction` walks frozen candidates oldest-first;
   the 8 `text` blocks are foldable (`foldedTokens 100 < 5 000`), the `user` blocks are not.
   Four folds (`t:1, t:3, t:5, t:7`) save `4 × 4 900 = 19 600`; `live` reaches `65 400 <= 70 000`
   and the loop exits. The group pass is skipped by the new gate.
6. `commands.length === 4 > 0` ✅ · every command carries `breakFrozen: true` ✅ ·
   `projected = 65 400 <= 70 000` ✅.
7. The store applies them: its own `cacheBreakGrant()` sees the same numbers, returns `"starved"`,
   and the frozen gate passes. Twelve of seventeen blocks keep their cached bytes.

**Self-limiting.** The rewrite changes the wire, so the next turn's prefix match collapses,
`frozenFromIndex` drops, and ordinary cache-preserving folding resumes. If it does not — if the
session is still over budget next turn — breaking again is the correct answer, and each break
strictly reduces tokens, so the 840 k monotone climb becomes a sawtooth under the budget instead.
