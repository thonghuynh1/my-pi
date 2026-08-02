/*
 * strict-monotonic.ts — a cache-preservation-first conductor.
 *
 * Motivation: prompt caching (all major providers) is prefix-hash-based. ANY change
 * to a block invalidates every cache hit downstream of that block. A conductor that
 * re-evaluates fold decisions across turns therefore silently trades cheap cache-read
 * tokens (~0.1×) for expensive fresh-input tokens (1.0×) every time it changes its
 * mind. That trade is usually invisible in the visible-context view but shows up as
 * a large per-turn dollar delta.
 *
 * This conductor eliminates that class of churn by adopting one rule:
 *
 *   ONCE FOLDED, STAYS FOLDED — in the same order, with no re-decisions.
 *
 * Concrete strategy:
 *   1. Only fold when the live context exceeds `availableCap(view)`.
 *   2. Only consider candidates in strictly-ascending block order (oldest first).
 *   3. Do NOT rank by kind. Rank-first (as in `BuiltinConductor`) causes new
 *      tool_results to leap-frog older text blocks between turns, mutating the
 *      already-cached prefix.
 *   4. Never touch protected, held, grouped, or already-folded blocks.
 *   5. Fold the minimum number of blocks needed to fit under the cap.
 *
 * By construction: two successive conducts on a monotonically-growing session pick
 * a SUPERSET of the previous fold decision — no unfolds, no re-orderings, no
 * relocations. The cached prefix upstream of the newest fold is stable across turns.
 *
 * This conductor makes no relevance judgement. Its whole value proposition is
 * predictability: fold decisions that happen once and never change, so the provider's
 * prefix cache keeps working.
 */
import type { Conductor, ConductorView, Command } from "../contract";
import { availableCap } from "../contract";

export class StrictMonotonicConductor implements Conductor {
	readonly id = "strict-monotonic";
	readonly label = "Strict monotonic";

	conduct(view: ConductorView): Command[] {
		let live = view.liveTokens;
		const cap = availableCap(view);
		if (live <= cap) return [];

		// Pure age-order candidates. No kind rank on purpose (see file header).
		const candidates = view.blocks
			.filter((b) => !b.held && !b.protected && !b.grouped && b.foldedTokens < b.tokens)
			.sort((a, b) => a.order - b.order);

		const ids: string[] = [];
		for (const b of candidates) {
			if (live <= cap) break;
			ids.push(b.id);
			live += b.foldedTokens - b.tokens;
		}

		return ids.length ? [{ kind: "fold", ids }] : [];
	}
}
