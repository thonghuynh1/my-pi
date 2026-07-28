"""finalize_quality.py — Post-review quality finalization (multi-method).

Validates a completed scoring sheet, joins the blind mapping to recover
method labels, and writes quality-summary.json with per-method means and
per-scenario means for every method present in the mapping.

Usage:
    python finalize_quality.py [scoring-sheet-path]

Default scoring sheet: blind/scoring-sheet.csv
Mapping file:          blind/blind-mapping.json (read-only)
Output:                blind/quality-summary.json

Gate semantics (unchanged for aiKnow vs grep so results are comparable to
prior runs; the same gates are computed independently for every non-grep
method that has recorded sessions):
  * quality_global_win_plus_0_5 : method mean >= grep mean + 0.5
  * scenario_floors[scenario]   : method mean on that scenario >= grep mean
  * quality_axis_pass           : both of the above pass
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


methods_present = sorted({r["method"] for r in joined})
scenarios = sorted({r["scenario"] for r in joined})


def scenario_mean(rows: list[dict], scenario: str) -> float:
    return mean([r["total"] for r in rows if r["scenario"] == scenario])


means_by_method = {m: mean([r["total"] for r in method_rows(m)]) for m in methods_present}
scenario_means_by_method = {
    m: {sc: scenario_mean(method_rows(m), sc) for sc in scenarios}
    for m in methods_present
}

# Grep is the shared baseline.
grep_mean = means_by_method.get("grep", 0.0)

per_method: dict[str, dict] = {}
for m in methods_present:
    if m == "grep":
        continue
    m_mean = means_by_method[m]
    quality_global_win = m_mean >= grep_mean + 0.5
    scenario_floors: dict[str, bool] = {}
    for sc in scenarios:
        m_sc = scenario_means_by_method[m][sc]
        g_sc = scenario_means_by_method.get("grep", {}).get(sc, 0.0)
        scenario_floors[sc] = m_sc >= g_sc
    per_method[m] = {
        "mean": m_mean,
        "delta_over_grep": round(m_mean - grep_mean, 4),
        "gates": {
            "quality_global_win_plus_0_5": quality_global_win,
            "scenario_floors": scenario_floors,
        },
        "quality_axis_pass": quality_global_win and all(scenario_floors.values()),
    }

summary = {
    "scoring_sheet": str(scoring_path),
    "records": len(joined),
    "methods": methods_present,
    "means_by_method": means_by_method,
    "scenario_means_by_method": scenario_means_by_method,
    "per_method": per_method,
    "rows": joined,
}

# Back-compat: expose the legacy top-level fields when only aiknow+grep are
# present, so existing consumers keep working.
if set(methods_present) == {"aiknow", "grep"}:
    aiknow_mean = means_by_method["aiknow"]
    summary["means"] = {
        "aiknow": aiknow_mean,
        "grep": grep_mean,
        "delta_aiknow_minus_grep": round(aiknow_mean - grep_mean, 4),
    }
    summary["scenario_means"] = {
        sc: {
            "aiknow": scenario_means_by_method["aiknow"][sc],
            "grep": scenario_means_by_method["grep"][sc],
        }
        for sc in scenarios
    }
    summary["gates"] = per_method["aiknow"]["gates"]
    summary["quality_axis_pass"] = per_method["aiknow"]["quality_axis_pass"]

output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {output_path}", flush=True)
print(f"grep mean quality: {grep_mean:.2f} (baseline)", flush=True)
for m in methods_present:
    if m == "grep":
        continue
    m_mean = means_by_method[m]
    pm = per_method[m]
    print(
        f"[{m:10s}] mean={m_mean:.2f}  delta_vs_grep={pm['delta_over_grep']:+.2f}  "
        f"quality_axis_pass={pm['quality_axis_pass']}",
        flush=True,
    )
