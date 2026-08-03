# 03 — Benchmark verification: cache-invalidation events and cost delta

Status: ready-for-human

## Parent

`.scratch/conductor-rollover-only-strategy/PRD.md`

## What to build

Run the `impact-wide` benchmark scenario with the updated conductor and verify that the rollover-only strategy meets the cost targets: ≤ 2 cache-invalidation events per session, cost delta vs. baseline ≤ +15%.

This is HITL because it requires the benchmark infrastructure at `F:\MyWork\benchmark\`, real API calls to `openai-codex/gpt-5.6-luna`, and human judgment on model quality (judge score).

**Covers**: US-001 (benchmark criterion), US-003, RB-003 (end-to-end proof)

## Implementation map

### Benchmark setup

- **Benchmark harness**: `F:\MyWork\benchmark`
- **Config**: `F:\MyWork\benchmark\agent-suite-config.json`, scenario `impact-wide`, profile `grep-accordion`
- **Target repo**: `F:\MyWork\PrecioHackathon\hackathon-mcp-agent-target` @ `180707900d…`
- **Model**: `openai-codex/gpt-5.6-luna`, thinking `high`
- **Budget**: 70,000 tokens

### Steps

1. Build the app with the updated conductor:
   ```
   cd extensions/accordion/app && npm run build
   ```
2. Restart the broker so the built app is served.

3. Run the benchmark trial:
   ```
   cd F:\MyWork\benchmark
   python scripts/run_single_trial.py impact-wide grep-accordion openai-codex/gpt-5.6-luna
   ```

4. Score results:
   ```
   python scripts/analyze_accordion_cost.py --auto --scenario impact-wide
   ```

5. Compare against existing baselines:
   - Baseline (no accordion): `results/agent-trials/agent-smoke/impact-wide__grep__1/2026-08-02T18-01-39-369Z_019fc3a3-7d29-775b-a67b-c9a2703ae456.jsonl`
   - Old `my-customize-conductor`: `impact-wide__grep-accordion__1/2026-08-02T18-51-07-041Z_019fc3d0-c5a1-7710-a2ac-825bd171b6e9.jsonl`
   - `strict-monotonic` reference: `impact-wide__grep-accordion__1/2026-08-02T19-12-55-602Z_019fc3e4-bd32-737d-999d-e6f86a8b3678.jsonl`

### Blocking edge from #01 and #02

- **Producer**: `01-rollover-only-conduct.md` + `02-hardcap-oldest-first.md` — complete conductor rewrite
- **Consumer**: This issue runs the benchmark against the full conductor
- **Contract**: The conductor implements rollover-only behavior (DEC-001 through DEC-009). The benchmark measures end-to-end cost.

## Acceptance criteria

- [ ] **AC-03-1**: Cache-invalidation events ≤ 2
  - Run: `python scripts/analyze_accordion_cost.py --auto --scenario impact-wide`
  - Expected: Detected cache-invalidation events (fresh ≥ 15k AND cacheRead collapse ≥ 20%): ≤ 2 (vs. 13 with old conductor)
  - Fails when: more than 2 cache-invalidation events detected in the session JSONL

- [ ] **AC-03-2**: Cost delta vs. baseline ≤ +15%
  - Run: `python scripts/analyze_accordion_cost.py --auto --scenario impact-wide`
  - Expected: Total cost with rollover-only conductor is within +15% of baseline (no accordion) cost. Old conductor was +88.8%; `strict-monotonic` was −2.1%.
  - Fails when: cost delta exceeds +15%

- [ ] **AC-03-3**: Model quality no regression
  - Run: Judge score on the `impact-wide` rubric
  - Expected: Judge score ≥ old conductor's score on the same rubric
  - Fails when: judge score regresses (model produces lower-quality answers due to context changes)

- [ ] **AC-03-4**: Peak API-side prompt stays compact
  - Run: `python scripts/analyze_accordion_cost.py --auto --scenario impact-wide`
  - Expected: Peak API-side prompt (`input + cacheRead`) stays ≤ budget ceiling (~70k), comparable to old conductor's 48.6k
  - Fails when: peak prompt exceeds 80k (would indicate conductor isn't compacting effectively)

## Blocked by

- `01-rollover-only-conduct.md`
- `02-hardcap-oldest-first.md`
