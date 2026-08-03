# Research: Provider Prefix Caching Mechanics

**Sources:**
- OpenAI: https://developers.openai.com/api/docs/guides/prompt-caching.md
- Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching.md

---

## Q1: Is prefix caching strictly position-based?

**Yes — for both providers, caching is strictly prefix/position-based.**

### OpenAI
> "Cache hits are only possible for exact prefix matches within a prompt."

The cache key is a hash of the prompt prefix up to a designated breakpoint. If any token in the prefix changes, the hash changes and is a cache miss. There is no partial matching or "gap skipping" — you get either a full prefix hit or nothing.

For **GPT-5.6+**: The hash is computed at explicit breakpoints you designate. On older models, the longest matching prefix up to the latest message is automatically cached.

### Anthropic (Claude)
> "The hash is cumulative, covering everything up to and including the breakpoint, so changing any block at or before the breakpoint produces a different hash on the next request."

Same behaviour: strictly positional and cumulative prefix hash. A change at block N invalidates that block and everything after it.

---

## Q2: If you modify block C in [A][B][C][D][E], does it also invalidate D and E?

**Yes — D and E are invalidated as well (full break from C onward).**

### Both providers agree on this:

The cache is a hash of the full prefix **up to and including** the breakpoint. Since the hash is cumulative:
- Block C changes → prefix hash at C is different → cache miss at C
- Since D and E come *after* C, they cannot be loaded from cache either — the model must process C, D, and E fresh

There is **no mechanism** to "skip" C and resume cache from D onwards. The cache is a single contiguous prefix, not a per-block store.

### Anthropic's explicit documentation:
> "Because the hash is cumulative, covering everything up to and including the breakpoint, changing any block at or before the breakpoint produces a different hash on the next request."

The `What invalidates the cache` table confirms: changes to messages invalidate the **entire messages cache** for all blocks at and after the modified position.

---

## Q3: Cost with [cached_prefix 30k][modified_block 3k][unchanged_tail 20k]

**Yes — all 23k tokens (modified_block + unchanged_tail) are billed as fresh input.**

### Anthropic pricing breakdown:
For a request structured as:
```
[30k tokens — identical, cached prefix][3k modified block][20k unchanged tail]
```

If the breakpoint is placed at the end of the 30k prefix:
- **30k → cache read tokens** at 0.1× base rate ✓
- **3k + 20k = 23k → fresh input tokens** at 1.25× base rate (cache write) or 1× (no cache)

The 20k "unchanged tail" gets **no benefit** from its being "unchanged" — it sits after the modification point and is processed fresh every request.

### OpenAI (GPT-5.6+):
Same logic. On GPT-5.6+, tokens written to cache cost 1.25× uncached input rate, so you also pay for the cache write of the new prefix if you mark a new breakpoint.

### Anthropic cost fields in API response:
```
cache_read_input_tokens: 30,000     (0.1× base)
cache_creation_input_tokens: 0      (or the new write cost if you re-mark)
input_tokens: 23,000                (1× base — after last breakpoint)
```

`input_tokens` in Anthropic's API = **only tokens after the last cache breakpoint**, NOT the total.

---

## Q4: Is there any way to "skip" a modification and still cache the tail?

**No — neither provider supports this. It is always a full break from the modification point onward.**

### Both providers confirm:
- Caching works on a **single contiguous prefix**.
- There is no ability to create a "hole" in the middle and cache a suffix separately.
- The cache is fundamentally a KV-cache over a prefix; the model must attend over all prior tokens in order. You cannot skip a middle section and start the KV-cache from a later point.

### What you CAN do (workarounds):

#### 1. Place all mutable content at the END (both providers)
Structure: `[static system prompt][large static context][dynamic per-request content]`
- Put the cache breakpoint *before* the dynamic part.
- Any dynamic content (summaries, timestamps, user messages) goes after the breakpoint — no cache benefit for it, but also no cache invalidation of what came before.

#### 2. Multiple explicit breakpoints (Anthropic: up to 4; OpenAI GPT-5.6+: up to 4)
- Place breakpoints at multiple stable boundaries.
- **Constraint:** All breakpoints must be at positions that are identical across requests. You cannot cache two non-contiguous stable regions with a mutable region in between.
- **Example that DOESN'T work:** `[stable 30k ✓ breakpoint][mutable 3k][stable 20k ✓ breakpoint]` — the second breakpoint's hash includes the mutable 3k, so it changes every request.
- **Example that DOES work:** `[stable tools ✓ breakpoint][stable system prompt ✓ breakpoint][dynamic messages]` — both breakpoints are stable.

#### 3. "Compaction" / summarization before the breakpoint (design pattern)
- If the middle block is modified conversation history, consider summarizing it and prepending that summary *before* the first cache breakpoint, or replacing history with a summary that can itself be cached.
- This requires re-issuing a cache write for the new prefix, but subsequent requests can hit that new cached prefix.

#### 4. Anthropic: `mid-conversation system messages` (newer models only)
On Claude Fable 5, Mythos 5, Opus 4.8, Opus 5 — you can append a `{"role": "system"}` message to the *messages array* instead of modifying the top-level system field, which avoids invalidating the earlier cached prefix. This is a narrow escape hatch for system-prompt-like content injected mid-conversation.

---

## Summary Table

| Question | OpenAI | Anthropic |
|---|---|---|
| Strictly position-based? | ✅ Yes | ✅ Yes |
| Modify block C → invalidates D, E? | ✅ Yes | ✅ Yes |
| [30k cached][3k changed][20k tail] — 23k billed fresh? | ✅ Yes | ✅ Yes |
| Skip modification, cache tail? | ❌ No | ❌ No |
| Multiple breakpoints (max)? | 4 | 4 |
| Breakpoint must be on stable content? | ✅ Yes | ✅ Yes |

---

## Key Design Implication

If you have a pattern like:
```
[large static context] [per-turn summary/modification] [new user message]
```

The **only** way to benefit from caching the static context is to ensure the summary/modification is **appended after** a cache breakpoint that sits at the end of the static context. The summary and new message will be billed as fresh input every turn — there is no way to cache them independently or "jump over" the summary to reuse the tail.

Caching the static context still provides the major benefit (e.g., 30k at 0.1× price), even if the subsequent 3k+20k are full-price.

---

## Pricing Reference (Anthropic Claude Sonnet 5)

| Token type | Cost |
|---|---|
| Base input | $2/MTok |
| Cache write (5m) | $2.50/MTok (1.25×) |
| Cache read | $0.20/MTok (0.1×) |
| Output | $10/MTok |

## Pricing Reference (OpenAI GPT-5.6+)

- Cache writes: 1.25× uncached input rate
- Cache reads: discounted (exact rate model-dependent)
- Older models: cache writes were free; reads discounted

---

*Researched from official docs, June 2025.*
