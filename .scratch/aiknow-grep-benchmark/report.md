# aiKnow vs grep benchmark

## Setup

- Repository: `F:/MyWork/PrecioHackathon/hackathon-ralph-loop`
- Task: “Explore the flow for worktree usage in hackathon-ralph-loop.”
- Model: `openai-codex/gpt-5.6-sol`, thinking `high`
- Model context window: 372K tokens
- Same read-only output rubric; only the discovery method differed.
- Metrics below are isolated to the first benchmark turn in each Pi JSONL session. Later session-inspection messages are excluded.

## Index status

- Initial `aiknow_status`: `registered`; no indexing action was requested by status.
- The first aiKnow search warned that 1,772 files were stale.
- The aiKnow worker called `aiknow_sync` at tool call 31; stale warnings reportedly continued afterward.
- Therefore this is a realistic registered-but-stale-index trial, not a guaranteed warm-index trial.

## Results

| Metric | aiKnow | grep | Better |
|---|---:|---:|---|
| Duration | 540.257 s | 319.494 s | grep |
| API calls | 81 | 44 | grep |
| Tool calls | 99 | 62 | grep |
| Tool-result payload | 497,242 chars / 11,841 lines | 327,935 chars / 6,631 lines | grep |
| Rough tool-result tokens (chars/4) | 124,310 | 81,984 | grep |
| Peak request context | 147,010 (39.5% of 372K) | 90,338 (24.3% of 372K) | grep |
| Cumulative request input | 5,650,527 | 2,396,869 | grep |
| Output tokens | 12,950 | 8,540 | grep |
| Cost | $4.119663 | $2.181281 | grep |
| Final answer size | 11,919 chars | 11,467 chars | Similar |
| Citation occurrences | 89 | 78 | aiKnow |
| Audited answer quality | 8.0/10 | 8.0/10 | Tie |

Relative to grep, aiKnow used 62.7% more peak context, 135.8% more cumulative request input, 88.9% more cost, 69.1% more time, and 59.7% more tool calls.

## Quality audit

Both answers were independently rated about 8/10 and were materially correct.

- aiKnow strengths: near-miss branch preservation/reuse, cleanup mechanics, strong architecture summary, slightly more citations.
- aiKnow gaps: missed the OpenCode `--dir` execution nuance and several important integration-test references; some citations were semantically broad or offset.
- grep strengths: explicit OpenCode `--dir` handling, same-worktree verification, richer integration/recovery test coverage, more granular flow.
- grep gaps: omitted near-miss branch preservation and whole-run review; several line ranges were inaccurate.

## Weighted score

Rubric: answer quality 50, context efficiency 20, cost efficiency 15, speed 10, tool-payload efficiency 5. For efficiency dimensions, the better run receives full points and the other receives proportional points.

| Method | Quality /50 | Context /20 | Cost /15 | Speed /10 | Payload /5 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|
| aiKnow | 40.0 | 12.3 | 7.9 | 5.9 | 3.3 | **69.4** |
| grep | 40.0 | 20.0 | 15.0 | 10.0 | 5.0 | **90.0** |

## Verdict

**grep wins this single trial, 90.0 vs 69.4.** Output quality was effectively tied, while grep consumed substantially less context, money, time, and tool payload.

The main caveat is index freshness. A fair product-level conclusion should repeat the same task at least three times against a confirmed fresh/warm aiKnow index and average the measurements.

## Why aiKnow cost more

The observed cost chain was:

> Three broad entry points → more searches → mandatory follow-up reads → duplicate/full-file reads → larger accumulated context → more expensive later model turns.

### Trace findings

- aiKnow made 30 searches and 66 reads; grep made 20 searches and 37 reads.
- aiKnow required 81 model/API turns versus 44 for grep.
- The first broad aiKnow query found 6,114 candidates but exposed only three entry points. The first broad grep returned 200 matches and immediately identified most relevant implementation, test, and documentation files.
- The benchmark prompt required following suggested `aiknow_read` calls. This added reads even when the top result was irrelevant, too narrow, or already covered.
- `aiknow_sync` did not run until tool call 31, after repeated warnings about 1,772 stale files.
- aiKnow repeated several ranges: portions of `workspace.ts` and `ralph-loop.ts` were read three times, while other ranges were read twice. The grep run had effectively no duplicate reads.
- The aiKnow worker escalated tiers, depth, limits, and token budgets, but the public result still exposed only three entry points.
- Large full-file reads and repeated ranges grew peak context to 147K tokens. Every subsequent model turn then processed this larger conversation, producing 5.65M cumulative request-input tokens.
- The extra investigation did not improve audited answer quality: both answers scored approximately 8/10.

### Relevant aiKnow implementation constraints

- Public discovery entry points are hard-capped at three, independently of the larger ranked candidate pool.
- Compact graph expansion is small, which is poorly matched to broad multi-module architecture questions.
- The rendered `next:` suggestion uses the top result and a fixed narrow line window rather than the complete containing symbol.
- Stale records remain searchable with only a small ranking penalty; synchronization may therefore leave stale warnings and ranking noise.
- Broad results are ranked individually rather than diversified across architectural layers or modules.

## Improvement backlog for later investigation

### Benchmark protocol

- [ ] Synchronize aiKnow before the timed run.
- [ ] Run a probe search and record the stale-file warning count; do not treat `registered` alone as proof of freshness.
- [ ] If stale records persist after synchronization, investigate index rebuild/pruning or exclude stale records from the trial.
- [ ] Use the same model, thinking level, output rubric, and maximum tool-call budget for both methods.
- [ ] Remove mandatory compliance with every `next: aiknow_read` suggestion.
- [ ] Run at least three warm trials per method and report average, median, and range.
- [ ] Separate index preparation time from exploration time, while reporting both.
- [ ] Score answer quality blindly before examining cost metrics.

### aiKnow worker behavior

- [ ] Cap the investigation at 25 total tool calls.
- [ ] Track previously read `path:start-end` ranges and skip duplicates.
- [ ] Prefer targeted line reads; prohibit full-file reads unless justified.
- [ ] Do not use `tier=deep` or `tokenBudget > 4000` for this task.
- [ ] Use anchors/keywords for known concepts such as `ralphLoop`, `TaskPipeline`, `WorkspaceManager`, and `cleanupWorktree`.
- [ ] After finding an entry symbol, prefer graph/impact traversal over repeated broad searches.
- [ ] Stop once every requested phase has at least one implementation citation and one test/doc citation.

### Potential aiKnow product changes

- [ ] Make the three-entry-point cap configurable.
- [ ] Diversify broad explore results across files, modules, and architectural roles.
- [ ] Exclude stale files from retrieval, prune deleted records, or apply a much stronger stale penalty.
- [ ] Make `next:` return the containing symbol range and avoid repeatedly recommending the same range.
- [ ] Return richer graph relationships by default for `mode=explore`.
- [ ] Add an architecture-oriented retrieval mode that groups entry points by layer rather than line-level lexical score.

## Proposed aiKnow rerun method

```text
METHOD: Use aiKnow as the primary discovery mechanism.

Start with one aiknow_search using mode=explore, tier=standard,
tokenBudget=4000, depth=2, and includeDetails=true.

Follow a suggested aiknow_read only when it is clearly relevant and its
path/range has not already been read. Prefer targeted line ranges. Do not
use tier=deep or full-file reads unless necessary.

Limit the investigation to 25 total tool calls. After two unhelpful searches
for the same sub-question, stop refining that question. Stop when entry,
creation, execution, status, integration, cleanup, and recovery each have
sufficient cited evidence.
```

For a strict tool-vs-tool benchmark, keep aiKnow-only and grep-only access but apply the same 25-call ceiling. For a real-world productivity benchmark, allow the aiKnow worker to fall back to grep after two unhelpful searches and measure the hybrid workflow separately.
