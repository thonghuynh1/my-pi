export const DEFAULT_PRE_GROUP_TOKENS = 15_000;
export const PRE_GROUP_OVERFLOW_CAP = 1.25;
export const MIN_CONTEXT_WINDOW_FOR_CHUNKED_COMPACTION = 128_000;
export const CHUNKED_COMPACTION_PREFIX = "⟨chunked-compaction ·";

/** Format a token count as a compact human-readable string. */
export function humanTokens(n: number): string {
	const sign = n < 0 ? "-" : "";
	const value = Math.abs(n);
	if (value < 1_000) return `${n}`;

	const [unit, divisor, precision] = value >= 1_000_000_000
		? ["b", 1_000_000_000, 2]
		: value >= 1_000_000
			? ["m", 1_000_000, 2]
			: ["k", 1_000, 1];
	const formatted = (value / divisor).toFixed(precision).replace(/\.?0+$/, "");
	return `${sign}${formatted}${unit}`;
}
