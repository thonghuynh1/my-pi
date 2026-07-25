"""Production-parity benchmark runner.

Executes nine aiKnow + nine grep sessions using the official adapter,
then writes retrieval-efficiency-results.json, objective-summary.json,
and the blinded reviewer packet.

Completed-run reuse is keyed by a fingerprint covering: target revision,
aiKnow revision, official adapter path+content hash, model, thinking level,
aiKnow prompt text, tool whitelists, and all scenario questions.
A prior run recorded under a different fingerprint is not reused.
"""

import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "benchmark-config.json").read_text(encoding="utf-8"))
TARGET = Path(CONFIG["target_repository"])
SESSIONS = ROOT / "sessions"
ANSWERS = ROOT / "answers"
LOGS = ROOT / "logs"
PROMPTS = ROOT / "prompts"
BLIND = ROOT / "blind"
BLIND_ANSWERS = BLIND / "answers"

ADAPTER_DIR = Path("F:/MyWork/aiKnow/integrations/pi/aiknow")
EXTENSION = ADAPTER_DIR / "index.ts"

PI = shutil.which("pi.cmd" if os.name == "nt" else "pi")
if not PI:
    raise RuntimeError("pi executable was not found on PATH")

for directory in (SESSIONS, ANSWERS, LOGS, PROMPTS, BLIND, BLIND_ANSWERS):
    directory.mkdir(parents=True, exist_ok=True)

# ── Prompt text ───────────────────────────────────────────────────────────────

COMMON = """You are performing one read-only repository exploration benchmark. Do not edit files or run commands that change repository or index state. Keep the complete investigation to at most 25 total tool calls. Stop when every requested part has sufficient evidence. Do not mention the discovery method in the final answer.

Return exactly these sections:
1. Executive summary
2. Detailed flow / architecture / impact analysis
3. Evidence table with columns Claim | Symbol | File:line
4. Tests and documentation
5. Uncertainties

Be concise but complete. Every important claim should cite an exact repository-relative file and line or narrow line range. Distinguish directly evidenced facts from inference.
"""

# Production: no fixed tier/budget/depth/details — let the adapter choose defaults.
AIKNOW = """Use aiKnow as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with one aiknow_search to orient; follow targeted aiknow_read calls on relevant ranges only. Do not call aiknow_sync: the index is confirmed warm.
"""

GREP = """Use only built-in grep, read, find, and ls for repository discovery and reading. Do not use aiKnow, bash, subagents, or other discovery tools. Prefer targeted searches and line ranges; avoid duplicate or full-file reads.
"""

# Production-active tools (matches what the official adapter registers).
AIKNOW_TOOLS = "aiknow_search,aiknow_read,aiknow_status,aiknow_capabilities,aiknow_sync"
GREP_TOOLS = "read,grep,find,ls"
GREP_EXCLUDE_TOOLS = (
    "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,"
    "aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync"
)

# ── Fingerprint ───────────────────────────────────────────────────────────────

def adapter_content_hash() -> str:
    h = hashlib.sha256()
    for f in sorted(ADAPTER_DIR.glob("*.ts")):
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def compute_run_fingerprint() -> str:
    h = hashlib.sha256()
    h.update(CONFIG["target_revision"].encode())
    h.update(CONFIG["aiknow_revision"].encode())
    h.update(str(EXTENSION).encode())
    h.update(adapter_content_hash().encode())
    h.update(CONFIG["model"].encode())
    h.update(CONFIG["thinking"].encode())
    h.update(AIKNOW.encode())
    h.update(AIKNOW_TOOLS.encode())
    h.update(GREP.encode())
    h.update(GREP_TOOLS.encode())
    for s in CONFIG["scenarios"]:
        h.update(s["question"].encode())
    return h.hexdigest()[:16]


RUN_FINGERPRINT = compute_run_fingerprint()
print(f"Run fingerprint: {RUN_FINGERPRINT}", flush=True)

# ── Session execution ─────────────────────────────────────────────────────────

scenario_by_id = {s["id"]: s for s in CONFIG["scenarios"]}
results_path = ROOT / "run-status.json"
status: list[dict] = []
if results_path.exists():
    status = json.loads(results_path.read_text(encoding="utf-8"))

# Only reuse sessions that match the current fingerprint.
completed = {
    item["name"]
    for item in status
    if item.get("exit_code") == 0
    and item.get("session_file")
    and item.get("run_fingerprint") == RUN_FINGERPRINT
}
incompatible = {item["name"] for item in status} - completed
if incompatible:
    print(
        f"NOTE: {len(incompatible)} prior record(s) have a different fingerprint "
        "and will be re-run.",
        flush=True,
    )


def current_jsonl() -> set[Path]:
    return {p.resolve() for p in SESSIONS.glob("*.jsonl")}


for name in CONFIG["execution_order"]:
    if name in completed:
        print(f"SKIP {name}: already completed (fingerprint match)", flush=True)
        continue
    scenario_id, method, repetition = name.rsplit("-", 2)
    scenario = scenario_by_id[scenario_id]
    method_text = AIKNOW if method == "aiknow" else GREP
    prompt = COMMON + "\n" + method_text + "\nBenchmark question:\n" + scenario["question"]
    before = current_jsonl()
    cmd = [
        PI, "--model", CONFIG["model"], "--thinking", CONFIG["thinking"],
        "--mode", "text", "--print", "--session-dir", str(SESSIONS), "--name", name,
    ]
    if method == "aiknow":
        cmd += ["--extension", str(EXTENSION), "--tools", AIKNOW_TOOLS]
    else:
        cmd += ["--tools", GREP_TOOLS, "--exclude-tools", GREP_EXCLUDE_TOOLS]
    prompt_path = PROMPTS / f"{name}.md"
    prompt_path.write_text(prompt, encoding="utf-8")
    cmd.append(f"@{prompt_path}")
    env = os.environ.copy()
    env["AIKNOW_CLI"] = "F:/MyWork/aiKnow/dist/cli.js"
    print(f"START {name}", flush=True)
    started = time.time()
    proc = subprocess.run(
        cmd, cwd=TARGET, env=env, text=True, encoding="utf-8",
        errors="replace", capture_output=True,
    )
    elapsed = time.time() - started
    (ANSWERS / f"{name}.md").write_text(proc.stdout, encoding="utf-8")
    (LOGS / f"{name}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
    after = current_jsonl()
    created = sorted(after - before, key=lambda p: p.stat().st_mtime)
    session_file = str(created[-1]) if created else None
    record: dict = {
        "name": name,
        "scenario": scenario_id,
        "category": scenario["category"],
        "method": method,
        "repetition": int(repetition[1:]),
        "model": CONFIG["model"],
        "thinking": CONFIG["thinking"],
        "target_revision": CONFIG["target_revision"],
        "aiknow_revision": CONFIG["aiknow_revision"],
        "adapter_path": str(EXTENSION),
        "adapter_content_hash": adapter_content_hash(),
        "run_fingerprint": RUN_FINGERPRINT,
        "elapsed_wall_seconds": round(elapsed, 3),
        "exit_code": proc.returncode,
        "session_file": session_file,
        "answer_file": str((ANSWERS / f"{name}.md").resolve()),
    }
    status = [item for item in status if item["name"] != name] + [record]
    results_path.write_text(json.dumps(status, indent=2), encoding="utf-8")
    print(
        f"END {name}: exit={proc.returncode} elapsed={elapsed:.1f}s session={session_file}",
        flush=True,
    )
    if proc.returncode != 0:
        print(
            f"Session failed; see {LOGS / (name + '.stderr.txt')}",
            file=sys.stderr, flush=True,
        )

print("Benchmark session execution complete.", flush=True)

# ── Post-session analysis ─────────────────────────────────────────────────────

# Reload status after execution.
status = json.loads(results_path.read_text(encoding="utf-8"))
valid = [
    item for item in status
    if item.get("exit_code") == 0
    and item.get("session_file")
    and item.get("run_fingerprint") == RUN_FINGERPRINT
]
if len(valid) < 18:
    print(
        f"Only {len(valid)}/18 valid sessions for this fingerprint — "
        "skipping output generation.",
        flush=True,
    )
    sys.exit(1)

print("Generating output files…", flush=True)


def text_content(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def analyze_session(path: str) -> dict:
    entries = [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    user_indexes = [
        i
        for i, entry in enumerate(entries)
        if entry.get("type") == "message"
        and entry.get("message", {}).get("role") == "user"
    ]
    start = user_indexes[0]
    end = user_indexes[1] if len(user_indexes) > 1 else len(entries)
    turn = entries[start:end]

    assistant = [
        e for e in turn
        if e.get("type") == "message" and e.get("message", {}).get("role") == "assistant"
    ]
    tool_results = [
        e for e in turn
        if e.get("type") == "message" and e.get("message", {}).get("role") == "toolResult"
    ]
    usages = [
        e["message"]["usage"] for e in assistant if e.get("message", {}).get("usage")
    ]
    tool_calls = []
    for e in assistant:
        for part in e.get("message", {}).get("content", []):
            if isinstance(part, dict) and part.get("type") == "toolCall":
                tool_calls.append(part)

    final_candidates = [
        e for e in assistant if e.get("message", {}).get("stopReason") == "stop"
    ]
    final = (
        text_content(final_candidates[-1]["message"].get("content", []))
        if final_candidates else ""
    )

    tool_names: dict[str, int] = {}
    for call in tool_calls:
        n = call.get("name", "unknown")
        tool_names[n] = tool_names.get(n, 0) + 1

    prompt_contexts = [
        usage.get("input", 0) + usage.get("cacheRead", 0) + usage.get("cacheWrite", 0)
        for usage in usages
    ]
    costs = [usage.get("cost", {}).get("total", 0) for usage in usages]
    first_ts = turn[0].get("timestamp", "") if turn else ""
    final_ts = (
        final_candidates[-1].get("timestamp", "") if final_candidates
        else (turn[-1].get("timestamp", "") if turn else "")
    )
    duration = 0.0
    try:
        duration = (
            datetime.fromisoformat(final_ts.replace("Z", "+00:00"))
            - datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
        ).total_seconds()
    except Exception:
        pass

    citations = re.findall(
        r"(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+:\d+(?:[-–]\d+)?", final
    )
    result_texts = [
        text_content(e["message"].get("content", [])) for e in tool_results
    ]
    model_change = next((e for e in entries if e.get("type") == "model_change"), {})
    thinking_change = next(
        (e for e in entries if e.get("type") == "thinking_level_change"), {}
    )

    return {
        "session_file": str(path),
        "model": f"{model_change.get('provider')}/{model_change.get('modelId')}",
        "thinking_level": thinking_change.get("thinkingLevel"),
        "duration_seconds": round(duration, 3),
        "assistant_api_calls": len(usages),
        "tool_calls": len(tool_calls),
        "tool_calls_by_name": tool_names,
        "tool_result_chars": sum(len(t) for t in result_texts),
        "sum_request_input_tokens": sum(prompt_contexts),
        "output_tokens": sum(usage.get("output", 0) for usage in usages),
        "total_cost_usd": round(sum(costs), 6),
        "final_answer_chars": len(final),
        "citation_occurrences": len(citations),
        "unique_citations": len(set(citations)),
        "final_answer": final,
    }


# Merge session analysis with run-status metadata.
session_reports: list[dict] = []
for item in valid:
    sf = item["session_file"]
    try:
        report = analyze_session(sf)
    except Exception as e:
        print(f"WARNING: could not analyze {sf}: {e}", flush=True)
        report = {"session_file": sf}
    report.update({
        "name": item["name"],
        "scenario": item["scenario"],
        "category": item["category"],
        "method": item["method"],
        "repetition": item["repetition"],
        "elapsed_wall_seconds": item["elapsed_wall_seconds"],
    })
    session_reports.append(report)

# Write retrieval-efficiency-results.json.
eff_path = ROOT / "retrieval-efficiency-results.json"
eff_path.write_text(json.dumps(session_reports, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {eff_path}", flush=True)

# ── Objective gates ───────────────────────────────────────────────────────────

aiknow_sessions = [r for r in session_reports if r["method"] == "aiknow"]
grep_sessions = [r for r in session_reports if r["method"] == "grep"]


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def check_tool_isolation(reports: list[dict]) -> list[str]:
    failures = []
    for r in reports:
        by_name = r.get("tool_calls_by_name", {})
        if r["method"] == "aiknow":
            bad = [k for k in by_name if k in ("read", "grep", "find", "ls", "bash")]
            if bad:
                failures.append(f"{r['name']}: aiknow session used {bad}")
        else:
            bad = [k for k in by_name if k.startswith("aiknow_")]
            if bad:
                failures.append(f"{r['name']}: grep session used {bad}")
    return failures


isolation_failures = check_tool_isolation(session_reports)

aiknow_tool_calls = [r.get("tool_calls", 0) for r in aiknow_sessions]
grep_tool_calls = [r.get("tool_calls", 0) for r in grep_sessions]
aiknow_durations = [r.get("duration_seconds", 0.0) for r in aiknow_sessions]
grep_durations = [r.get("duration_seconds", 0.0) for r in grep_sessions]
aiknow_costs = [r.get("total_cost_usd", 0.0) for r in aiknow_sessions]
grep_costs = [r.get("total_cost_usd", 0.0) for r in grep_sessions]
aiknow_tokens = [r.get("sum_request_input_tokens", 0) for r in aiknow_sessions]
grep_tokens = [r.get("sum_request_input_tokens", 0) for r in grep_sessions]
aiknow_api = [r.get("assistant_api_calls", 0) for r in aiknow_sessions]
grep_api = [r.get("assistant_api_calls", 0) for r in grep_sessions]

grep_mean_calls = mean(grep_tool_calls)
grep_mean_dur = mean(grep_durations)
grep_mean_cost = mean(grep_costs)
grep_mean_tokens = mean(grep_tokens)
grep_mean_api = mean(grep_api)

aiknow_mean_calls = mean(aiknow_tool_calls)
aiknow_mean_dur = mean(aiknow_durations)
aiknow_mean_cost = mean(aiknow_costs)
aiknow_mean_tokens = mean(aiknow_tokens)
aiknow_mean_api = mean(aiknow_api)

# Gate definitions (all must pass independently).
#   efficiency: mean aiKnow calls ≤ 80% grep; no trial > 25; mean duration ≤ 120% grep; no trial > 360s
#   cost:       mean aiKnow cost ≤ 80% grep; no trial > $1.50; tokens/API ≤ 120% grep; no trial > 3M tokens or 50 calls
gate_eff_mean_calls = aiknow_mean_calls <= 0.80 * grep_mean_calls
gate_eff_no_trial_calls = all(c <= 25 for c in aiknow_tool_calls)
gate_eff_mean_dur = aiknow_mean_dur <= 1.20 * grep_mean_dur
gate_eff_no_trial_dur = all(d <= 360 for d in aiknow_durations)
gate_cost_mean = aiknow_mean_cost <= 0.80 * grep_mean_cost
gate_cost_no_trial = all(c <= 1.50 for c in aiknow_costs)
gate_cost_tokens = aiknow_mean_tokens <= 1.20 * grep_mean_tokens
gate_cost_api = aiknow_mean_api <= 1.20 * grep_mean_api
gate_cost_no_trial_tokens = all(t <= 3_000_000 for t in aiknow_tokens)
gate_cost_no_trial_api = all(a <= 50 for a in aiknow_api)

efficiency_axis_pass = all([
    gate_eff_mean_calls, gate_eff_no_trial_calls,
    gate_eff_mean_dur, gate_eff_no_trial_dur,
])
cost_axis_pass = all([
    gate_cost_mean, gate_cost_no_trial,
    gate_cost_tokens, gate_cost_api,
    gate_cost_no_trial_tokens, gate_cost_no_trial_api,
])

aiknow_ceilings = []
for r in aiknow_sessions:
    tc = r.get("tool_calls", 0)
    dur = r.get("duration_seconds", 0.0)
    cost = r.get("total_cost_usd", 0.0)
    tokens = r.get("sum_request_input_tokens", 0)
    api = r.get("assistant_api_calls", 0)
    trial_pass = tc <= 25 and dur <= 360 and cost <= 1.50 and tokens <= 3_000_000 and api <= 50
    aiknow_ceilings.append({
        "name": r["name"],
        "tool_calls": tc,
        "duration_seconds": dur,
        "total_cost_usd": cost,
        "sum_request_input_tokens": tokens,
        "assistant_api_calls": api,
        "pass": trial_pass,
    })

obj = {
    "run_fingerprint": RUN_FINGERPRINT,
    "records": len(valid),
    "tool_isolation_pass": len(isolation_failures) == 0,
    "tool_isolation_failures": isolation_failures,
    "means": {
        "aiknow": {
            "tool_calls": aiknow_mean_calls,
            "duration_seconds": aiknow_mean_dur,
            "total_cost_usd": aiknow_mean_cost,
            "sum_request_input_tokens": aiknow_mean_tokens,
            "assistant_api_calls": aiknow_mean_api,
        },
        "grep": {
            "tool_calls": grep_mean_calls,
            "duration_seconds": grep_mean_dur,
            "total_cost_usd": grep_mean_cost,
            "sum_request_input_tokens": grep_mean_tokens,
            "assistant_api_calls": grep_mean_api,
        },
    },
    "aiknow_over_grep_ratios": {
        "tool_calls": aiknow_mean_calls / grep_mean_calls if grep_mean_calls else None,
        "duration_seconds": aiknow_mean_dur / grep_mean_dur if grep_mean_dur else None,
        "total_cost_usd": aiknow_mean_cost / grep_mean_cost if grep_mean_cost else None,
        "sum_request_input_tokens": aiknow_mean_tokens / grep_mean_tokens if grep_mean_tokens else None,
        "assistant_api_calls": aiknow_mean_api / grep_mean_api if grep_mean_api else None,
    },
    "gates": {
        "eff_mean_calls_le_80pct_grep": gate_eff_mean_calls,
        "eff_no_trial_gt_25_calls": gate_eff_no_trial_calls,
        "eff_mean_duration_le_120pct_grep": gate_eff_mean_dur,
        "eff_no_trial_gt_360s": gate_eff_no_trial_dur,
        "cost_mean_le_80pct_grep": gate_cost_mean,
        "cost_no_trial_gt_1_50_usd": gate_cost_no_trial,
        "cost_tokens_le_120pct_grep": gate_cost_tokens,
        "cost_api_calls_le_120pct_grep": gate_cost_api,
        "cost_no_trial_gt_3M_tokens": gate_cost_no_trial_tokens,
        "cost_no_trial_gt_50_api_calls": gate_cost_no_trial_api,
    },
    "aiknow_ceilings": aiknow_ceilings,
    "efficiency_axis_pass": efficiency_axis_pass,
    "cost_axis_pass": cost_axis_pass,
    "quality_axis": "PENDING_BLINDED_HUMAN_SCORING",
}
obj_path = ROOT / "objective-summary.json"
obj_path.write_text(json.dumps(obj, indent=2), encoding="utf-8")
print(f"Wrote {obj_path}", flush=True)

# ── Blinded review packet ─────────────────────────────────────────────────────

RUBRIC = """# Blinded answer-quality rubric (10 points)

Score each anonymized final answer before seeing method labels or usage/cost data. Use five dimensions worth 0–2 points each.

1. **Factual correctness (0–2)**
   - 0: materially wrong or unsafe.
   - 1: mostly correct with one meaningful error or unsupported claim.
   - 2: correct, precise, and no material contradictions.
2. **Scenario completeness (0–2)**
   - 0: misses most requested parts.
   - 1: covers the main path but misses at least one important requested branch/invariant.
   - 2: covers every explicit part of the question at useful depth.
3. **Evidence and traceability (0–2)**
   - 0: little/no verifiable repository evidence.
   - 1: useful symbols/files but some broad, inaccurate, or missing locations.
   - 2: claims consistently tied to accurate symbols and file:line evidence.
4. **Cross-boundary reasoning (0–2)**
   - 0: isolated file summary with no coherent relationships.
   - 1: generally coherent flow/impact with some weak transitions.
   - 2: accurately explains ordering, ownership, data flow, invariants, and conditional branches.
5. **Tests, safety, and actionable guidance (0–2)**
   - 0: omits relevant tests/safety consequences or gives unusable guidance.
   - 1: identifies major tests/risks but misses meaningful coverage.
   - 2: identifies relevant existing/new tests, failure/safety behavior, and concrete guidance appropriate to the scenario.

Record one integer per dimension and a total out of 10. Add a short justification. Do not infer or guess the discovery method.
"""

# Shuffle sessions by scenario group (interleave aiknow/grep within each group)
# so anonymous IDs are unpredictable.
random.seed(42)
shuffled = list(valid)
random.shuffle(shuffled)
# Stable anonymous IDs A01..A18 assigned to shuffled order.
mapping = []
for idx, item in enumerate(shuffled):
    anon_id = f"A{idx + 1:02d}"
    mapping.append({
        "anonymous_id": anon_id,
        "session_name": item["name"],
        "scenario": item["scenario"],
        "method": item["method"],
        "repetition": item["repetition"],
    })

# Write blind-mapping.json (separate from packet — method not exposed in packet).
(BLIND / "blind-mapping.json").write_text(
    json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(f"Wrote {BLIND / 'blind-mapping.json'}", flush=True)

# Write per-answer files under blind/answers/.
for entry in mapping:
    anon_id = entry["anonymous_id"]
    session_name = entry["session_name"]
    answer_path = ANSWERS / f"{session_name}.md"
    text = answer_path.read_text(encoding="utf-8") if answer_path.exists() else ""
    (BLIND_ANSWERS / f"{anon_id}.md").write_text(text, encoding="utf-8")

# Assemble reviewer-packet.md: rubric + each answer, no method labels.
lines = ["# Blinded reviewer packet\n", RUBRIC]
for entry in mapping:
    anon_id = entry["anonymous_id"]
    scenario = entry["scenario"]
    anon_file = BLIND_ANSWERS / f"{anon_id}.md"
    answer_text = anon_file.read_text(encoding="utf-8") if anon_file.exists() else ""
    lines.append(f"\n---\n\n# Answer {anon_id}\n")
    lines.append(f"**Scenario:** {scenario}\n\n")
    lines.append(answer_text.strip())
    lines.append("\n")

(BLIND / "reviewer-packet.md").write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {BLIND / 'reviewer-packet.md'}", flush=True)

# Write empty scoring sheet (do not overwrite if already filled in).
scoring_path = BLIND / "scoring-sheet.csv"
header = "anonymous_id,factual_correctness_0_2,scenario_completeness_0_2,evidence_traceability_0_2,cross_boundary_reasoning_0_2,tests_safety_guidance_0_2,total_0_10,justification"
if not scoring_path.exists():
    rows = [header] + [f"{e['anonymous_id']},,,,,,," for e in mapping]
    scoring_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"Wrote {scoring_path}", flush=True)
else:
    print(f"Preserved existing {scoring_path}", flush=True)

print("\nAll output files written. Benchmark run complete.", flush=True)
print(f"  retrieval-efficiency-results.json: {eff_path}", flush=True)
print(f"  objective-summary.json:            {obj_path}", flush=True)
print(f"  blind/blind-mapping.json:          {BLIND / 'blind-mapping.json'}", flush=True)
print(f"  blind/reviewer-packet.md:          {BLIND / 'reviewer-packet.md'}", flush=True)
print(f"\nEfficiency axis pass: {efficiency_axis_pass}", flush=True)
print(f"Cost axis pass:       {cost_axis_pass}", flush=True)
