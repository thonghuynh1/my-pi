# Production-parity benchmark run

## Fixed controls

- aiKnow revision: `16becf059ed4eedc6d34a9ff6cca9f3f678bf6b1`
- aiKnow build:    `F:/MyWork/aiKnow/dist/cli.js` (rebuilt before each run via `npm run build`)
- Official adapter: `F:/MyWork/aiKnow/integrations/pi/aiknow/index.ts`
- target revision: `5e67bfcbcd16ebf9e93a32651687862b59e409b8`
- model: `openai-codex/gpt-5.6-luna`
- thinking: `medium`
- 3 scenarios × 2 methods × 3 repetitions = 18 sessions
- maximum 25 tool calls per session
- first-turn-only JSONL measurement
- aiKnow prompt uses production defaults — no fixed tier, budget, depth, or details

## Completed-run fingerprint

The runner keys reuse on a SHA-256 fingerprint covering: target revision,
aiKnow revision, adapter file path + content hash, model, thinking level,
aiKnow prompt, grep prompt, tool whitelists, and all scenario questions.
A prior session recorded under a different fingerprint is **not** reused
and will be re-executed. The fingerprint is stored in each `run-status.json`
record under `run_fingerprint`.

## Preflight

Build aiKnow and verify the adapter typecheck before running:

```powershell
cd F:\MyWork\aiKnow
npm install
npm run build
npm run check:pi
```

Expected: both exit 0, `dist/cli.js` is current, and the adapter has no unresolved imports.

## Run

```powershell
cd F:\MyWork\my-pi\.scratch\aiknow-grep-benchmark
python run_benchmark.py
```

The runner is **resumable**: completed sessions (matching the current fingerprint) are
skipped; only missing or incompatible sessions are executed. Sessions run sequentially
in the balanced paired order defined in `benchmark-config.json`.

After 18 valid sessions complete, the runner automatically writes:

| File | Contents |
|---|---|
| `retrieval-efficiency-results.json` | Per-session tool-call, timing, cost, and token metrics |
| `objective-summary.json` | All efficiency and cost gate results (independent axis evaluation) |
| `blind/blind-mapping.json` | Mapping from anonymous IDs to session names and methods |
| `blind/reviewer-packet.md` | Anonymized answers for blinded quality review (no method labels) |
| `blind/scoring-sheet.csv` | Empty template for the human reviewer (not overwritten if it exists) |

## Blinded review handoff

The reviewer receives only `blind/reviewer-packet.md` and `blind/scoring-sheet.csv`.
The reviewer fills in one integer per dimension and a total for each of the 18 answers,
then returns the completed sheet.

**Do not share `blind/blind-mapping.json` or `run-status.json` with the reviewer.**
Method labels are stored exclusively in `blind/blind-mapping.json`.

## Finalize quality results

After the reviewer returns the completed scoring sheet, validate and join it:

```powershell
cd F:\MyWork\my-pi\.scratch\aiknow-grep-benchmark
python finalize_quality.py blind/scoring-sheet.csv
```

Expected output: `blind/quality-summary.json` with per-method means, scenario
floors, and a boolean `quality_axis_pass`. This script never modifies the
reviewer's scores.

## Clean run

To force a full re-run (discarding all prior sessions):

```powershell
Remove-Item run-status.json -ErrorAction SilentlyContinue
python run_benchmark.py
```

## Objective gate reference

Gates evaluated in `objective-summary.json` (all must pass independently):

| Axis | Gate | Threshold |
|---|---|---|
| Efficiency | Mean aiKnow tool calls | ≤ 80% of grep mean |
| Efficiency | Per-trial tool calls | ≤ 25 |
| Efficiency | Mean aiKnow duration | ≤ 120% of grep mean |
| Efficiency | Per-trial duration | ≤ 360 s |
| Cost | Mean aiKnow dollar cost | ≤ 80% of grep mean |
| Cost | Per-trial dollar cost | ≤ $1.50 |
| Cost | Mean aiKnow input tokens | ≤ 120% of grep mean |
| Cost | Mean aiKnow API calls | ≤ 120% of grep mean |
| Cost | Per-trial input tokens | ≤ 3 000 000 |
| Cost | Per-trial API calls | ≤ 50 |
