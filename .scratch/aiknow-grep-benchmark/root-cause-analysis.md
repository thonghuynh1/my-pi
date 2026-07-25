# Root-cause analysis: tool calls, duration, and cost

## Executive diagnosis

aiKnow trades **smaller context payloads** for **many more retrieval round trips**. That trade reduced mean dollars by 9.9% and cumulative input tokens by 5.5%, but increased tool calls by 78.2%, assistant API calls by 129.0%, and duration by 94.5%.

The dominant problem is not `aiknow_read`; it is repeated `aiknow_search` activity followed by narrow reads.

## Quantitative decomposition

| Call category | aiKnow | grep | Excess |
|---|---:|---:|---:|
| Search/find | 246 | 97 | +149 |
| Read | 168 | 138 | +30 |
| Other navigation tools | 10 | 3 | +7 |
| Total | 424 | 238 | +186 |

Search inflation explains 149/186, or about 80%, of the excess calls.

| Payload/round metric | aiKnow mean | grep mean | Interpretation |
|---|---:|---:|---|
| Assistant API calls | 17.56 | 7.67 | aiKnow needs 2.29× as many model rounds |
| Tool calls | 47.11 | 26.44 | aiKnow needs 1.78× as many invocations |
| Tool-result characters | 89,846 | 216,375 | aiKnow returns 58.5% less material |
| Peak request context | 29,530 | 60,855 | aiKnow keeps peak context 51.5% lower |
| Cumulative input tokens | 268,645 | 284,208 | aiKnow remains 5.5% lower overall |
| Duration | 168.22 s | 86.47 s | Extra rounds nearly double latency |
| Dollars | $0.10073 | $0.11182 | Smaller contexts make aiKnow 9.9% cheaper |

Final-answer synthesis took approximately the same time for both methods (~43 s aiKnow vs ~42 s grep). The duration difference is concentrated in tool-driven exploration (~121 s vs ~39 s).

## Product-level causes

1. **Broad searches expose only three compact entry points.** In 237/246 searches, three results were shown even when the candidate pool contained hundreds or thousands of matches. Broad architectural questions therefore require many narrower searches.
2. **Search output is primarily navigational.** The compact Pi-facing result gives symbols/locations and a `next: aiknow_read`, rather than enough source to settle most claims. Useful evidence commonly costs a search plus a read.
3. **The three slots are sometimes consumed by generic symbols.** Names such as `run`, `tracker`, and `phase` repeatedly outrank more relevant lifecycle/architecture symbols.
4. **Graph tools do not provide navigable detail.** Observed `aiknow_impact`, `aiknow_neighbors`, and `aiknow_file_map` responses returned aggregate counts rather than concrete files, symbols, callers, or tests. Their calls were additive; the model returned to search afterward.
5. **Documentation and negative queries are weak.** ADR lookup and proving that a criterion event/dashboard projection does not exist required repeated searches and indirect reads.
6. **Suggested reads are too narrow.** aiKnow averaged about 87 lines per read versus grep's 146, causing repeated visits to the same files.

## Model/agent behavior causes

1. **Planning by searching:** 59 assistant turns contained searches but no reads; those turns issued 156 search calls.
2. **Parallel query decomposition:** 68% of aiKnow tool turns were batches, often 3–5 overlapping searches about one topic.
3. **Long search streaks:** sessions issued as many as 12 searches before an intervening read.
4. **Overlapping queries:** about 20 searches substantially repeated earlier keyword sets; impact-r3 was the clearest example.
5. **Repeated file visits:** files such as `loop-run.ts`, `stale-run-recovery.ts`, and `task-pipeline.ts` were read up to five times in a session because ranges were narrow.
6. **Graph-tool experimentation did not replace other calls:** impact/file-map/neighbors added ten calls without reducing later search/read work.

## Scenario effects

| Scenario | aiKnow calls | grep calls | aiKnow duration | grep duration | Quality interpretation |
|---|---:|---:|---:|---:|---|
| Lifecycle | 44.0 | 23.3 | 167.5 s | 90.3 s | Quality tied; overhead brought no quality gain |
| Architecture | 46.7 | 26.3 | 177.2 s | 73.8 s | aiKnow quality was provisionally higher; semantic exploration helped |
| Impact | 50.7 | 29.7 | 159.9 s | 95.4 s | grep quality was higher; literal occurrence enumeration fit grep better |

Impact-r3 was worst at 64 calls: 40 searches, 19 reads, and 5 auxiliary graph/file-map calls.

## Benchmark-protocol factor

The 25-call ceiling was a prompt instruction, not a programmatically enforced limit. All nine aiKnow runs and four grep runs exceeded it. Parallel invocations count individually, so one assistant turn can spend 3–5 calls. This does not explain the method difference by itself, but it explains why the intended ceiling did not control behavior.

## Prioritized remediation

### P0: increase information per aiKnow call

1. For broad exploration, return 6–8 diversified entry points grouped by layer/role instead of three individual symbols.
2. Inline a bounded complete-symbol snippet for each selected entry point, so the first search can eliminate follow-up reads.
3. Make `aiknow_impact`/`neighbors` enumerate concrete nodes, files, callers, callees, and tests—not only counts.
4. Add a multi-target read operation or let one search return complete ranges for all selected entries.
5. Penalize generic local identifiers (`run`, `tracker`, `phase`) unless the query is an exact lookup.
6. Improve ADR/docs/test indexing and provide explicit negative-search coverage metadata.

### P0: constrain agent behavior

1. Hard-enforce a call counter in the Pi extension/runner rather than relying on prompt compliance.
2. Allow at most one initial broad search, then require reading selected evidence before another search.
3. Cap searches at roughly 8–10 and reads at 10–12 per broad task.
4. Track normalized queries and previously read ranges; reject overlap/repeats.
5. Use lookup mode for known symbols and wider complete-symbol reads instead of adjacent narrow reads.
6. Disable auxiliary graph tools until their output is navigable.

### P1: optimize latency without losing the cost/context win

1. Target 8–10 assistant tool rounds instead of 17.6.
2. Preserve compact payloads, but make each payload decision-complete; do not simply increase raw output to grep scale.
3. Add a single batched exploration request that accepts several subquestions and returns diversified grouped evidence.
4. Measure server/tool execution latency directly in tool metrics; current JSONL inter-turn gaps conflate model and tool time.

## Recommended success target for the next iteration

Keep the demonstrated advantages:

- dollar cost no higher than grep;
- cumulative input tokens no higher than grep;
- equal or better blinded quality.

While reducing:

- aiKnow searches from 27.3/session to <=10;
- total calls from 47.1/session to <=25;
- assistant API calls from 17.6/session to <=10;
- duration from 168 s toward <=105 s.

The best optimization direction is therefore **richer, diversified, decision-complete retrieval per call**, not merely larger context windows.
