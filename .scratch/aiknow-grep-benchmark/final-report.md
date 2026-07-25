# Retrieval-efficiency independent-axis benchmark

## Revisions and controls

- aiKnow revision: `5e899c741e7aeceab02d75d00e4b276b216ed8b0`
- target repository: `F:/MyWork/PrecioHackathon/hackathon-ralph-loop`
- target revision: `5e67bfcbcd16ebf9e93a32651687862b59e409b8`
- model: `openai-codex/gpt-5.6-luna`
- thinking: `medium`
- matrix: 3 scenarios × 2 methods × 3 repetitions = 18 valid sessions
- tool isolation: PASS
- warm preparation: 11 golden tests passed; warm sync `+0 ~0 -0 (unchanged: 195)`; probe `staleExcluded=0`, `warnings=[]`

## Objective means

| Metric | aiKnow | grep | aiKnow / grep | Gate |
|---|---:|---:|---:|---|
| Tool calls | 47.111 | 26.444 | 178.2% | ≤80% |
| Duration | 168.217 s | 86.472 s | 194.5% | ≤120% |
| Cost | $0.100727 | $0.111818 | 90.1% | ≤80% |
| Cumulative input tokens | 268,645 | 284,208 | 94.5% | ≤120% |
| Assistant API calls | 17.556 | 7.667 | 229.0% | ≤120% |

## Independent axes

| Axis | Result | Reason |
|---|---|---|
| Quality | **PROVISIONAL FAIL** | AI-assisted blinded scores tie overall at 9.444/10; aiKnow does not achieve +0.5 and loses the impact scenario floor. Human approval is still required. |
| Efficiency | **FAIL** | Tool-call and duration means fail; all nine aiKnow runs exceeded the 25-call ceiling. |
| Cost | **FAIL** | Mean dollar cost is 90.1% of grep rather than ≤80%; API calls are 229.0% rather than ≤120%. Per-run dollar/token/API ceilings passed. |
| Overall | **FAIL regardless of pending quality** | Independent-axis rule forbids compensation for a failed axis. |

## aiKnow per-run ceilings

| Run | Calls | Duration | Cost | Input tokens | API calls | Result |
|---|---:|---:|---:|---:|---:|---|
| lifecycle-aiknow-r1 | 53 | 191.801 s | $0.105500 | 238,429 | 15 | FAIL: calls |
| lifecycle-aiknow-r2 | 40 | 152.201 s | $0.082440 | 163,394 | 13 | FAIL: calls |
| lifecycle-aiknow-r3 | 39 | 158.573 s | $0.073694 | 143,934 | 11 | FAIL: calls |
| architecture-aiknow-r1 | 48 | 182.031 s | $0.114608 | 361,216 | 16 | FAIL: calls |
| architecture-aiknow-r2 | 42 | 169.784 s | $0.086709 | 183,089 | 13 | FAIL: calls |
| architecture-aiknow-r3 | 50 | 179.929 s | $0.104016 | 312,852 | 18 | FAIL: calls |
| impact-aiknow-r1 | 37 | 127.287 s | $0.100829 | 338,406 | 28 | FAIL: calls |
| impact-aiknow-r2 | 51 | 183.521 s | $0.103370 | 248,061 | 20 | FAIL: calls |
| impact-aiknow-r3 | 64 | 168.823 s | $0.135378 | 428,426 | 24 | FAIL: calls |

Every aiKnow run remained below 360 seconds, $1.50, 3.0M input tokens, and 50 API calls.

## Blinded review

- Rubric: `quality-rubric.md`
- Anonymous answers: `blind/answers/A01.md` through `A18.md`
- Reviewer sheet: `blind/scoring-sheet.csv`
- Hidden join: `blind/blind-mapping.json` (do not expose before scoring)

Provisional AI-assisted blinded review files are `blind/provisional-ai-scores.csv` and `blind/provisional-quality-summary.json`. A human must approve or revise them before they count as HITL evidence.

## Provisional quality results

| Scope | aiKnow | grep | Result |
|---|---:|---:|---|
| Overall | 9.444 | 9.444 | Tie; strict +0.5 gate FAIL |
| Lifecycle | 9.667 | 9.667 | Scenario floor PASS |
| Architecture | 10.000 | 8.667 | Scenario floor PASS |
| Impact/edit guidance | 8.667 | 10.000 | Scenario floor FAIL |

## Alternative pragmatic interpretation

If success is redefined prospectively as **equal high answer quality, lower dollar cost, and no increase in cumulative input context**, aiKnow is favorable:

- answer quality: tied at 9.444/10;
- mean dollar cost: 9.9% lower;
- mean cumulative input tokens: 5.5% lower.

Under that relaxed product criterion, the result can reasonably be called **good/promising**. It should not be called a pass of the already accepted independent-axis benchmark because aiKnow used 78.2% more tool calls, took 94.5% longer, made 129.0% more API calls, and missed the accepted quality-win threshold.
