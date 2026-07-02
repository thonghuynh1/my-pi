/*
 * tokens.ts — content-aware token estimation.
 *
 * Still model-free (no per-model BPE tokenizer), but no longer a flat chars/4.
 * Following Headroom's EstimatingTokenCounter, the chars-per-token ratio is
 * chosen by content type, because a flat /4 badly UNDER-counts the code, JSON
 * and log output that dominate agent sessions (those tokenize denser than prose):
 *
 *   prose  ~4.0 chars/tok   ·   code  ~3.5   ·   JSON  ~3.2   ·   CJK ~1.5
 *
 * Everything downstream reads estTokens, so this single change lifts the budget
 * bar, the fold boundary, digests and liveTokens toward the real count at once.
 * A real per-model tokenizer is still deferred (see VISION roadmap); the residual
 * gap to the provider's true count is closed by live calibration in the store.
 */

/** chars/token by content type — calibrated against cl100k/o200k-class tokenizers. */
const CHARS_PER_TOKEN = 4.0; // English prose (default)
const CHARS_PER_TOKEN_CODE = 3.5; // source code (denser)
const CHARS_PER_TOKEN_JSON = 3.2; // JSON / serialized structure (densest ASCII)
const CHARS_PER_TOKEN_CJK = 1.5; // CJK / Kana / Hangul (~1 token per char)

/** Per-block structural overhead (role tags, delimiters). */
export const BLOCK_OVERHEAD = 4;

// Detection is done on a bounded PREFIX so estTokens stays cheap on huge tool
// outputs; the chosen ratio is then applied to the FULL length.
const DETECT_SAMPLE = 4000;

// JSON must both START and END with matching brackets — this deliberately EXCLUDES
// Accordion's own fold tag `{#code FOLDED} …`, which starts with `{` but ends with
// prose (mis-classifying digests inflated their token cost).
const JSON_LEAD = /^\s*[[{]/; // non-global
const JSON_TAIL = /[}\]]\s*$/; // non-global
// Global (used only with .match()): rough "codey" punctuation density signal.
const CODE_SIGNALS = /[{}();=<>]|=>|\b(function|const|let|import|export|return|class)\b/g;
// CJK ranges: main CJK ideographs + Hiragana/Katakana (inside \u3000-\u9fff) + Hangul.
const CJK_TEST = /[\u3000-\u9fff\uac00-\ud7af]/; // non-global: presence check
const CJK_ALL = /[\u3000-\u9fff\uac00-\ud7af]/g; // global: count

/**
 * Pick a chars/token ratio by sniffing a bounded prefix (+ the string's tail for
 * the JSON end-bracket check). Conservative: it only leaves the prose ratio when
 * there's a STRONG signal, so short summaries/digests keep the 4.0 ratio.
 */
function detectRatio(s: string, sample: string): number {
	// Real JSON: opens AND closes with brackets. Excludes the `{#… FOLDED}` fold tag.
	const tail = s.length > 200 ? s.slice(-200) : s;
	if (JSON_LEAD.test(sample) && JSON_TAIL.test(tail)) return CHARS_PER_TOKEN_JSON;
	const codeHits = sample.match(CODE_SIGNALS)?.length ?? 0;
	// Require both an absolute floor (≥ 6 signals — so a digest's stray braces don't
	// count) AND a density threshold (~1 signal per 120 chars) before calling it code.
	if (codeHits >= 6 && codeHits > sample.length / 120) return CHARS_PER_TOKEN_CODE;
	return CHARS_PER_TOKEN;
}

/**
 * Content-aware token estimate. CJK characters are priced separately (~1.5
 * chars/tok) from the rest, which uses the detected prose/code/JSON ratio.
 */
export function estTokens(s: string): number {
	if (!s) return 0;
	const sample = s.length > DETECT_SAMPLE ? s.slice(0, DETECT_SAMPLE) : s;
	const ratio = detectRatio(s, sample);
	let cjk = 0;
	// Only pay the full CJK scan when the sample actually shows CJK.
	if (CJK_TEST.test(sample)) cjk = s.match(CJK_ALL)?.length ?? 0;
	const other = s.length - cjk;
	return Math.ceil(other / ratio + cjk / CHARS_PER_TOKEN_CJK);
}

export function clip(s: string, n: number): string {
	const m = Math.max(1, n);
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= m ? t : t.slice(0, m - 1).trimEnd() + "…";
}

export function firstLine(s: string, n = 100): string {
	const line = (s.split("\n").find((l) => l.trim()) ?? "").trim();
	return clip(line, n);
}
