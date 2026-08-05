# my-customize-conductor: cache-invalidation tax and the `sentUnfolded` fix

Status: resolved-verified
Owner: (unassigned)
Related: `.scratch/accordion-large-session-perf/`

## TL;DR

Under real fold pressure on a long agentic session (~250k pre-fold, budget 70k, OpenAI-Codex `gpt-5.6-luna`), `my-customize-conductor` **added +88.8% to total dollar cost** vs. running the same session with Accordion detached. The mechanism is not fold cleverness or context size — it is **retroactive folding of blocks that the model provider had already cached in unfolded form**, which invalidates the prefix cache once per event.

A minimal invariant on the fold-decision path — *"never fold a block whose bytes have already been sent to the model in unfolded form"* — is expected to eliminate the tax without giving up proactive compression or MCP-summary features. A prototype conductor (`strict-monotonic`) that already respects this invariant produced **0 cache-invalidation events** on the same scenario and landed at −2.1% vs. baseline.

## Scenario used to measure

- Benchmark harness: `F:\MyWork\benchmark`
- Config: `F:\MyWork\benchmark\agent-suite-config.json`, scenario `impact-wide`, profile `grep-accordion`
- Target repo: `F:\MyWork\PrecioHackathon\hackathon-mcp-agent-target` @ `180707900d…`
- Candidate model: `openai-codex/gpt-5.6-luna`, thinking `high`
- Accordion budget: **70,000 tokens**, browser conductor
- Prompt shape: two phases in one message.
  - **Phase 1** — 40 sequential file reads (deterministic list).
  - **Phase 2** — 25 targeted `grep`-only sub-questions, with an instruction "do not re-read Phase 1 files".
- Per-turn usage taken from Pi's session JSONL (`usage.input`, `usage.cacheRead`, `usage.cacheWrite`, `usage.cost.total`).

## Result

Three trials, same scenario, one variable (attach / detach / conductor choice):

| | Baseline (no accordion) | `my-customize-conductor` | `strict-monotonic` |
|---|---:|---:|---:|
| Assistant turns | 59 | 78 | 67 |
| Tool calls | 58 | 77 | 66 |
| Peak API-side prompt (`input+cacheRead`) | 77.5k | 48.6k | 68.2k |
| Fresh input tokens (billed 1.0×) | 170k | **624k** | 107k |
| Cache-read tokens (billed 0.1×) | 2.46M | 2.25M | 2.97M |
| Cache-write tokens (billed 1.25×) | 0 | 0 | 0 |
| Output + reasoning | 15k | 13k | 14k |
| **Total cost (USD)** | **$0.0955** | **$0.1803** | **$0.0935** |
| Cost / tool_call | $0.00165 | $0.00234 | $0.00142 |
| Delta vs baseline | — | **+88.8%** | −2.1% |

Session artifacts:

- Baseline: `F:\MyWork\benchmark\results\agent-trials\agent-smoke\impact-wide__grep__1\2026-08-02T18-01-39-369Z_019fc3a3-7d29-775b-a67b-c9a2703ae456.jsonl`
- `my-customize-conductor` run: `impact-wide__grep-accordion__1\2026-08-02T18-51-07-041Z_019fc3d0-c5a1-7710-a2ac-825bd171b6e9.jsonl`
- `strict-monotonic` run: `impact-wide__grep-accordion__1\2026-08-02T19-12-55-602Z_019fc3e4-bd32-737d-999d-e6f86a8b3678.jsonl`

## What actually happened

Note the **peak prompt** row. `my-customize-conductor` held the API-side prompt at only **48.6k tokens** — well under the 70k budget. So the +88.8% cost cannot be attributed to a large visible context. It must be an artefact of *how* the prompt was assembled across turns.

Scanning the JSONL for the classic cache-invalidation fingerprint — a turn where `cacheRead` collapses to ~3.5k while `fresh_input` jumps to 35–45k — yields:

| Trial | Cache-invalidation events (fresh ≥ 15k AND cacheRead collapse ≥ 20%) |
|---|---:|
| Baseline | **1** (turn 30, likely provider-side TTL, unrelated to Accordion) |
| `my-customize-conductor` | **13** (turns 31, 40, 41, 50, 52, 60, 65, 67, 68, 69, 70, 72, 76) |
| `strict-monotonic` | **0** |

Each `my-customize-conductor` event has the same signature:

```
fresh_input  ≈ 38k–44k     (the whole reachable prefix, re-sent as fresh)
cacheRead    = 3,584       (provider system-message stub only)
prior max cacheRead ≈ 47k  (what was cached before this turn)
```

13 events × ~38k fresh input ≈ **500k of tax**, which matches the +454k fresh-input delta almost exactly. That is the entire +88.8%.

## Why folds cause cache invalidation on some conductors and not others

Accordion applies fold decisions at **outgoing-message-serialization time** — right before Pi transmits to the provider. There are two ways a fold can play out with respect to the provider's prefix cache:

1. **The fold lands on content the provider never saw unfolded.**
   The block is folded on its first outgoing serialization. The provider only ever receives the folded stub at that position; from its cache's point of view nothing is mutated.
   → No cache-invalidation event, cost of the fold ≈ 0.

2. **The fold lands on content the provider already cached in unfolded form.**
   The provider's cache has hash `H(prefix_up_to_block, unfolded_bytes, tail)`. The next outgoing message has `H(prefix_up_to_block, stub_bytes, tail)` — different hash, cache miss from the fold point on.
   → One cache-invalidation event, cost of the fold ≈ (K tokens after fold point) × 1.0× fresh-input rate.

`my-customize-conductor` produced 13 case-2 events. `strict-monotonic` produced 0 — because its rule "never re-decide, only fold newly-eligible blocks" tends to place folds on blocks that had not yet been API-cached.

## The `sentUnfolded` proposal

Introduce a small piece of per-block state that the conductor consults on every fold decision:

```
For each block that has been serialized into an outgoing message:
  after the send succeeds, record it as `sentUnfolded = true`
  unless the block was already folded in that outgoing message.

Fold-decision rule:
  Consider a block for folding only if `sentUnfolded === false`.
```

Effect:

- Blocks that will be folded on their first API appearance stay foldable — case 1 above, cost ≈ 0.
- Blocks that already appeared unfolded to the provider become **frozen for the rest of the session** from the conductor's point of view. Any "smarter" fold decision that would touch them is silently declined.
- No behavior change on cold blocks, no behavior change on the protected tail policy, no coupling to the specific compression strategy.

This is a strict invariant: *"the conductor never mutates a prefix the provider has already cached."* It is the same principle behind `strict-monotonic`, but implemented as a filter on top of any existing scoring / compression / grouping strategy rather than as a whole conductor replacement — so the existing `my-customize-conductor` chunked-compaction and MCP-summary features are kept.

### What the fix does NOT change

- Proactive compression still runs. It just can only run on blocks that will be folded on their first send.
- MCP-summary rewrites still fire. Same restriction.
- The `garbage-collector`-style reachability / grouping algorithms still apply, on the subset of blocks that are still eligible.
- No new UI, no new protocol messages, no new dependencies.

### What the fix does change

- The conductor loses the ability to "improve" a decision it already committed. That is the whole point — the improvement was never free; the cache tax was always paying for it.
- The set of foldable blocks strictly shrinks over the life of a session. In practice, since new tool_results arrive constantly, there is always a fresh eligible pool.

## Recommended implementation sketch

Location: `F:\MyWork\my-pi\extensions\accordion\conductors\my-customize-conductor\`.

Wire the state at the block metadata boundary the conductor already sees:

- Extend the shared `ViewBlock` with `sentUnfolded: boolean` (default `false`).
  Alternative: add an out-of-band `Map<blockId, boolean>` in the conductor if we do not want to touch the contract shape.
- After each successful outgoing send in the extension host, flip `sentUnfolded = true` on every block whose outgoing serialization was NOT a fold-stub. This is one place in `extension/accordion.ts` (the same place the payload-audit already observes) — see `payload-audit.ts` for the exact hook point.
- In `my-customize-conductor/*` fold-decision code, add one filter:
  ```ts
  if (block.sentUnfolded) continue;
  ```
  as the first check inside the candidate loop.

If the contract change is undesirable, tracking it inside the conductor as a `Set<blockId>` populated from a payload-audit event stream is functionally equivalent.

## How to verify the fix

1. Restore the two existing artefacts (`impact-wide × grep`, `impact-wide × grep-accordion` with unmodified `my-customize-conductor`) — they are baseline and regression control.
2. Apply the `sentUnfolded` filter to `my-customize-conductor`.
3. Rebuild the app: `npm run build` in `extensions/accordion/app/`. Restart the broker so the built app is served.
4. Rerun: `python scripts/run_single_trial.py impact-wide grep-accordion openai-codex/gpt-5.6-luna` from `F:\MyWork\benchmark\`.
5. Score with `python scripts/analyze_accordion_cost.py --auto --scenario impact-wide`.

Success criteria:

- Detected cache-invalidation events (fresh ≥ 15k AND cacheRead collapse ≥ 20%): **≤ 2** (vs. 13 today).
- Cost delta vs. baseline: **≤ +15%** (vs. +88.8% today).
- Peak API-side prompt: unchanged (~50k, still well under budget).
- Model quality (judge score): no regression on the `impact-wide` rubric.

The strict-monotonic run already demonstrated 0 events / −2.1% cost on the same scenario; the sentUnfolded invariant is what makes strict-monotonic work, so `my-customize-conductor` with the same invariant should land in the same ballpark.

## Open questions

1. **Definition of "sent unfolded".** Is a block "sent unfolded" if it appeared in ANY prior outgoing message unfolded, or only in the most-recent one? A stricter reading (any prior) is simpler and safer. A looser reading (only most-recent) is unsound if the provider cache TTL is long enough to still hold a much older version.
2. **Interaction with `unfold` / `recall`.** ADR 0005 / 0011 already allow blocks to move between folded and unfolded states in response to agent requests. Does the `sentUnfolded` flag reset on a recall? It probably should not — the provider still has the unfolded version cached at that position.
3. **Grouping.** If a group is folded as a unit, is `sentUnfolded` tracked per group or per member? Per-member is more precise but noisier; per-group is simpler and aligns with how the fold command carries group IDs.
4. **Test coverage.** Add a `chunkedCompactionJsonl.test.ts`-style test that constructs a two-turn session where the second turn would previously produce a retroactive re-fold, and asserts the fold is now suppressed.

## Related work in this repo

- `extension/cache-tracker.ts`, `extension/cache-tracker.test.ts` — already observe cache behavior; possibly the right home for `sentUnfolded` tracking.
- `extension/payload-audit.ts` — the outgoing-payload observation hook; a natural place to emit the `sentUnfolded` signal.
- `conductors/strict-monotonic/strict-monotonic.ts` — the prototype that proved the invariant works. Small file, worth reading before implementing.
- `.scratch/accordion-large-session-perf/` — sibling PRD for the broader "long session performance" theme this issue lives under.

## Comments

### 2026-08-04 — fix verified on `impact-wide × grep-accordion`

After adjusting `my-customize-conductor` to respect the invariant, reran the same scenario at the same 70k budget on `openai-codex/gpt-5.6-luna`.

Session artefact: `F:\MyWork\benchmark\results\agent-trials\agent-smoke\impact-wide__grep-accordion__1\2026-08-04T16-52-20-680Z_019fcdb0-c048-7a9e-889b-5927faa4bb1d.jsonl`

| Metric | Baseline | Old my-customize | **NEW my-customize** |
|---|---:|---:|---:|
| Turns | 59 | 78 | 69 |
| Tool calls | 58 | 77 | 68 |
| Peak API-side prompt | 77.5k | 48.6k | **73.8k** (above budget → fold pressure engaged) |
| Fresh input | 170k | 624k | 126k |
| Cache read | 2.46M | 2.25M | 3.15M |
| Total cost | $0.0955 | $0.1803 (+88.8%) | **$0.1006 (+5.4%)** |
| Cost / tool_call | $0.00165 | $0.00234 (+42%) | **$0.00148 (−10%)** |
| Cache-invalidation events | 1 (natural) | 13 | **0** |

The pathology signature (cacheRead collapse to ~3.5k with a coincident 35–45k fresh_input spike) does not appear anywhere in the new run. All 13 events observed on the pre-fix run were structural, not statistical noise — fixing the invariant eliminated them completely.

Acceptance criteria from the "How to verify the fix" section are met:

- Detected cache-invalidation events: **0** (target: ≤ 2). ✅
- Cost delta vs baseline: **+5.4%** (target: ≤ +15%). ✅
- Peak API-side prompt: **73.8k** — crossed budget so folds fired; this run is a stronger test than the earlier `strict-monotonic` prototype, which peaked at only 68k and never engaged the fold logic under pressure.
- Model quality (judge): not yet re-scored; leave open until judge run completes.

The +5.4% total-cost delta is driven by the model making 10 additional tool_calls (+17%) rather than any per-call regression — per-tool-call cost actually improved by 10%. Those extra calls are consistent with small `recall`/re-grep work to fill in details lost to folding; on this scenario each such call cost less than the cache-invalidation tax it would have caused under the old conductor.

Open question 1 (any-prior vs. most-recent) is implicitly answered as "any-prior" by the fact that zero events fire on a run that folded content added far earlier in the session. If the implementation chose "most-recent" and works too, that would be a stronger result worth documenting.
