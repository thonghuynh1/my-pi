# Independent-axis benchmark run

## Fixed controls

- aiKnow revision: `5e899c741e7aeceab02d75d00e4b276b216ed8b0`
- target revision: `5e67bfcbcd16ebf9e93a32651687862b59e409b8`
- model: `openai-codex/gpt-5.6-luna`
- thinking: `medium`
- 3 scenarios × 2 methods × 3 repetitions = 18 sessions
- maximum 25 tool calls per session
- first-turn-only JSONL measurement

## Preflight evidence

- `npm test -- --run retrieval-golden`: 11 passed
- cold rebuild: `+195 ~0 -0 (unchanged: 0)`
- confirmed-warm sync: `+0 ~0 -0 (unchanged: 195)`
- warm probe: `staleExcluded=0`, `warnings=[]`

## Run

```powershell
cd F:\MyWork\my-pi\.scratch\aiknow-grep-benchmark
python run_benchmark.py
```

The runner is resumable and executes sessions sequentially in a balanced method order.

## Analyze

After all sessions succeed:

```powershell
python analyze.py <all session JSONL paths> > retrieval-efficiency-results.json
```

Then anonymize answers and score them using `quality-rubric.md` before joining scores to method labels or objective metrics.
