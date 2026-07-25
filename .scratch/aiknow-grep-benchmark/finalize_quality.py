"""finalize_quality.py — Post-review quality finalization.

Validates a completed scoring sheet, joins the blind mapping to recover
method labels, and writes quality-summary.json.

Usage:
    python finalize_quality.py [scoring-sheet-path]

Default scoring sheet: blind/scoring-sheet.csv
Mapping file:          blind/blind-mapping.json (read-only; never modified)
Output:                blind/quality-summary.json
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BLIND = ROOT / "blind"

scoring_path = Path(sys.argv[1]) if len(sys.argv) > 1 else BLIND / "scoring-sheet.csv"
mapping_path = BLIND / "blind-mapping.json"
output_path = BLIND / "quality-summary.json"

# ── Load and validate inputs ──────────────────────────────────────────────────

if not scoring_path.exists():
    print(f"ERROR: scoring sheet not found: {scoring_path}", file=sys.stderr)
    sys.exit(1)
if not mapping_path.exists():
    print(f"ERROR: blind mapping not found: {mapping_path}", file=sys.stderr)
    sys.exit(1)

mapping: list[dict] = json.loads(mapping_path.read_text(encoding="utf-8"))
mapping_by_id = {e["anonymous_id"]: e for e in mapping}

scores: list[dict] = []
with open(scoring_path, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        scores.append(dict(row))

errors = []
for row in scores:
    anon_id = row.get("anonymous_id", "").strip()
    if anon_id not in mapping_by_id:
        errors.append(f"Unknown anonymous_id: {anon_id!r}")
        continue
    for col in (
        "factual_correctness_0_2",
        "scenario_completeness_0_2",
        "evidence_traceability_0_2",
        "cross_boundary_reasoning_0_2",
        "tests_safety_guidance_0_2",
        "total_0_10",
    ):
        val = row.get(col, "").strip()
        if not val:
            errors.append(f"{anon_id}: column {col!r} is empty")
        else:
            try:
                float(val)
            except ValueError:
                errors.append(f"{anon_id}: column {col!r} is not numeric: {val!r}")

if errors:
    print("Scoring sheet has validation errors:", file=sys.stderr)
    for e in errors:
        print(f"  {e}", file=sys.stderr)
    sys.exit(1)

if len(scores) != len(mapping):
    print(
        f"ERROR: scoring sheet has {len(scores)} rows but mapping has {len(mapping)} entries.",
        file=sys.stderr,
    )
    sys.exit(1)

# ── Join mapping to recover method labels ─────────────────────────────────────

joined: list[dict] = []
for row in scores:
    anon_id = row["anonymous_id"].strip()
    meta = mapping_by_id[anon_id]
    joined.append({
        "anonymous_id": anon_id,
        "session_name": meta["session_name"],
        "scenario": meta["scenario"],
        "method": meta["method"],
        "repetition": meta["repetition"],
        "factual_correctness": int(row["factual_correctness_0_2"].strip()),
        "scenario_completeness": int(row["scenario_completeness_0_2"].strip()),
        "evidence_traceability": int(row["evidence_traceability_0_2"].strip()),
        "cross_boundary_reasoning": int(row["cross_boundary_reasoning_0_2"].strip()),
        "tests_safety_guidance": int(row["tests_safety_guidance_0_2"].strip()),
        "total": float(row["total_0_10"].strip()),
        "justification": row.get("justification", "").strip(),
    })


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def method_rows(method: str) -> list[dict]:
    return [r for r in joined if r["method"] == method]


def scenario_mean(rows: list[dict], scenario: str) -> float:
    return mean([r["total"] for r in rows if r["scenario"] == scenario])


aiknow_rows = method_rows("aiknow")
grep_rows = method_rows("grep")

scenarios = sorted({r["scenario"] for r in joined})

aiknow_mean = mean([r["total"] for r in aiknow_rows])
grep_mean = mean([r["total"] for r in grep_rows])

# Quality win: aiKnow global mean ≥ grep mean + 0.5 AND no scenario mean below grep's
quality_global_win = aiknow_mean >= grep_mean + 0.5
scenario_floors: dict[str, bool] = {}
for sc in scenarios:
    ak_sc = scenario_mean(aiknow_rows, sc)
    gr_sc = scenario_mean(grep_rows, sc)
    scenario_floors[sc] = ak_sc >= gr_sc

quality_axis_pass = quality_global_win and all(scenario_floors.values())

summary = {
    "scoring_sheet": str(scoring_path),
    "records": len(joined),
    "means": {
        "aiknow": aiknow_mean,
        "grep": grep_mean,
        "delta_aiknow_minus_grep": round(aiknow_mean - grep_mean, 4),
    },
    "scenario_means": {
        sc: {
            "aiknow": scenario_mean(aiknow_rows, sc),
            "grep": scenario_mean(grep_rows, sc),
        }
        for sc in scenarios
    },
    "gates": {
        "quality_global_win_plus_0_5": quality_global_win,
        "scenario_floors": scenario_floors,
    },
    "quality_axis_pass": quality_axis_pass,
    "rows": joined,
}

# Do not modify scores — write only the summary.
output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {output_path}", flush=True)
print(f"aiKnow mean quality: {aiknow_mean:.2f}", flush=True)
print(f"grep mean quality:   {grep_mean:.2f}", flush=True)
print(f"Quality axis pass:   {quality_axis_pass}", flush=True)
