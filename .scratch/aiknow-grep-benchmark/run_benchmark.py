"""Production-parity benchmark runner (multi-method, impact-scope aware).

Executes retrieval-benchmark sessions across four discovery methods
(aiKnow, grep, tokensave, graphify), then writes
retrieval-efficiency-results.json, objective-summary.json, and the blinded
reviewer packet.

Methods:
  aiknow     Official aiKnow Pi adapter (F:/MyWork/aiKnow/integrations/pi/aiknow)
  grep       Built-in read/grep/find/ls only
  tokensave  Local Pi adapter that wraps `tokensave tool <name> --json`
  graphify   Local Pi adapter that wraps graphify's BFS/explain/affected CLI

Scope:
  Set BENCHMARK_SCOPE=impact_only (env) to run only the 12 impact-scenario
  sessions (3 reps x 4 methods). Otherwise the full execution_order runs
  (18 sessions -- lifecycle + architecture + impact for aiknow + grep only;
  new methods currently only participate in impact_only).

Reuse:
  Session records are keyed by a per-method fingerprint covering the method's
  own inputs (prompt, tool allowlist, extension path + content hash, model,
  thinking, target revision, all scenario questions). Changing one method's
  prompt does NOT invalidate other methods' recorded sessions.
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

AIKNOW_ADAPTER_DIR = Path("F:/MyWork/aiKnow/integrations/pi/aiknow")
AIKNOW_EXTENSION = AIKNOW_ADAPTER_DIR / "index.ts"
TOKENSAVE_ADAPTER_DIR = ROOT / "extensions" / "tokensave"
TOKENSAVE_EXTENSION = TOKENSAVE_ADAPTER_DIR / "index.ts"
GRAPHIFY_ADAPTER_DIR = ROOT / "extensions" / "graphify"
GRAPHIFY_EXTENSION = GRAPHIFY_ADAPTER_DIR / "index.ts"

# Tokensave binary lives under ~/tools/tokensave for this benchmark host.
TOKENSAVE_BIN_DIR = Path(os.environ.get("TOKENSAVE_BIN_DIR", str(Path.home() / "tools" / "tokensave")))

PI = shutil.which("pi.cmd" if os.name == "nt" else "pi")
if not PI:
    raise RuntimeError("pi executable was not found on PATH")

for directory in (SESSIONS, ANSWERS, LOGS, PROMPTS, BLIND, BLIND_ANSWERS):
    directory.mkdir(parents=True, exist_ok=True)

# ── Scope selection ──────────────────────────────────────────────────────────

SCOPE = os.environ.get("BENCHMARK_SCOPE", "impact_only").strip()
if SCOPE == "impact_only":
    EXECUTION_ORDER = CONFIG["impact_only_execution_order"]
    EXPECTED_COUNT = len(EXECUTION_ORDER)
elif SCOPE == "full":
    EXECUTION_ORDER = CONFIG["execution_order"]
    EXPECTED_COUNT = len(EXECUTION_ORDER)
else:
    raise SystemExit(f"Unknown BENCHMARK_SCOPE={SCOPE!r} (expected 'impact_only' or 'full')")
print(f"Scope: {SCOPE} ({EXPECTED_COUNT} sessions)", flush=True)

# ── Prompt text ──────────────────────────────────────────────────────────────

COMMON = """You are performing one read-only repository exploration benchmark. Do not edit files or run commands that change repository or index state. Keep the complete investigation to at most 25 total tool calls. Stop when every requested part has sufficient evidence. Do not mention the discovery method in the final answer.

Return exactly these sections:
1. Executive summary
2. Detailed flow / architecture / impact analysis
3. Evidence table with columns Claim | Symbol | File:line
4. Tests and documentation
5. Uncertainties

Be concise but complete. Every important claim should cite an exact repository-relative file and line or narrow line range. Distinguish directly evidenced facts from inference.
"""

AIKNOW = """Use aiKnow as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with one aiknow_search to orient; follow targeted aiknow_read calls on relevant ranges only. Do not call aiknow_sync: the index is confirmed warm.
"""

GREP = """Use only built-in grep, read, find, and ls for repository discovery and reading. Do not use aiKnow, bash, subagents, or other discovery tools. Prefer targeted searches and line ranges; avoid duplicate or full-file reads.
"""

TOKENSAVE = """Use tokensave as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with tokensave_context (broad task) or tokensave_search (specific symbol) to orient; follow with tokensave_body / tokensave_read for source detail. The tokensave index is warm.
"""

GRAPHIFY = """Use graphify as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with graphify_query for a symbol or concept; use graphify_explain to zoom in on a node's neighbors; use graphify_affected for impact analysis; use graphify_read to inspect source once the graph points at a file. The graph is up to date.
"""

HYBRID = """Use aiknow_search for discovery and built-in read/grep/find/ls for verification. Recommended pattern:

1. First call: aiknow_search with intent='impact' and query=<the key type, class, or function name from the question> -- this returns a Definition -> Callers -> Tests -> Callees tree naming exact file:line locations to investigate. If the seed looks wrong (points at a test constant instead of the real declaration), retry with a more specific query.
2. Then use read/grep/find/ls to open those file:line ranges, verify claims (especially assertion style: exact-equality vs partial-match), and cover anything the tree missed.
3. Do NOT use aiknow_read, bash, subagents, or other retrieval tools.

Stop calling aiknow_search after 1-2 calls total. Everything else is read/grep. The aiKnow index is warm.
"""

# Production-active tool surfaces (must match each extension's registered names).
AIKNOW_TOOLS = "aiknow_search,aiknow_read,aiknow_impact,aiknow_status,aiknow_capabilities,aiknow_sync"
GREP_TOOLS = "read,grep,find,ls"
TOKENSAVE_TOOLS = "tokensave_search,tokensave_context,tokensave_body,tokensave_read"
GRAPHIFY_TOOLS = "graphify_query,graphify_explain,graphify_affected,graphify_read"
HYBRID_TOOLS = "aiknow_search,read,grep,find,ls"

# Exclusions keep each method truly isolated when pi ships new default tools.
GREP_EXCLUDE_TOOLS = (
    "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,"
    "aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync,"
    "tokensave_search,tokensave_context,tokensave_body,tokensave_read,"
    "graphify_query,graphify_explain,graphify_affected,graphify_read"
)
NON_BUILTIN_EXCLUDE = "read,grep,find,ls,bash,subagent"


def adapter_content_hash(adapter_dir: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(adapter_dir.glob("*.ts")):
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


# ── Method registry ──────────────────────────────────────────────────────────

METHODS = {
    "aiknow": {
        "prompt": AIKNOW,
        "tools": AIKNOW_TOOLS,
        "extension": AIKNOW_EXTENSION,
        "adapter_dir": AIKNOW_ADAPTER_DIR,
        "extra_exclude": (
            "tokensave_search,tokensave_context,tokensave_body,tokensave_read,"
            "graphify_query,graphify_explain,graphify_affected,graphify_read"
        ),
    },
    "grep": {
        "prompt": GREP,
        "tools": GREP_TOOLS,
        "extension": None,
        "adapter_dir": None,
        "extra_exclude": GREP_EXCLUDE_TOOLS,
    },
    "tokensave": {
        "prompt": TOKENSAVE,
        "tools": TOKENSAVE_TOOLS,
        "extension": TOKENSAVE_EXTENSION,
        "adapter_dir": TOKENSAVE_ADAPTER_DIR,
        "extra_exclude": (
            "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,"
            "aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync,"
            "graphify_query,graphify_explain,graphify_affected,graphify_read"
        ),
    },
    "graphify": {
        "prompt": GRAPHIFY,
        "tools": GRAPHIFY_TOOLS,
        "extension": GRAPHIFY_EXTENSION,
        "adapter_dir": GRAPHIFY_ADAPTER_DIR,
        "extra_exclude": (
            "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,"
            "aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync,"
            "tokensave_search,tokensave_context,tokensave_body,tokensave_read"
        ),
    },
    "hybrid": {
        "prompt": HYBRID,
        "tools": HYBRID_TOOLS,
        # Load the aiKnow extension so aiknow_search is available, but keep
        # built-in read/grep/find/ls enabled and block every other retrieval
        # tool (including aiknow_read) so this method is aiknow_search + grep.
        "extension": AIKNOW_EXTENSION,
        "adapter_dir": AIKNOW_ADAPTER_DIR,
        "extra_exclude": (
            "aiknow_read,aiknow_impact,aiknow_file_map,"
            "aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync,"
            "tokensave_search,tokensave_context,tokensave_body,tokensave_read,"
            "graphify_query,graphify_explain,graphify_affected,graphify_read"
        ),
    },
}

ALLOWED_TOOL_NAMES = {
    method: set(METHODS[method]["tools"].split(","))
    for method in METHODS
}

# The hybrid method may legally call any tool in its allowlist (aiknow_search
# plus the built-ins). Isolation still catches misuse of aiknow_read etc.

# ── Fingerprint (per method) ─────────────────────────────────────────────────

def method_fingerprint(method: str) -> str:
    """Hash only the inputs that affect this method's session outputs.

    Changing one method's prompt/tools/extension does NOT invalidate any
    other method's recorded sessions.
    """
    m = METHODS[method]
    h = hashlib.sha256()
    h.update(method.encode())
    h.update(CONFIG["target_revision"].encode())
    h.update(CONFIG["model"].encode())
    h.update(CONFIG["thinking"].encode())
    h.update(m["prompt"].encode())
    h.update(m["tools"].encode())
    if m.get("extension"):
        h.update(str(m["extension"]).encode())
        h.update(adapter_content_hash(m["adapter_dir"]).encode())
    if method in ("aiknow", "hybrid"):
        h.update(CONFIG["aiknow_revision"].encode())
    for s in CONFIG["scenarios"]:
        h.update(s["question"].encode())
    return h.hexdigest()[:16]


METHOD_FINGERPRINTS = {m: method_fingerprint(m) for m in METHODS}
for m, fp in METHOD_FINGERPRINTS.items():
    print(f"  fingerprint[{m}] = {fp}", flush=True)

# ── Session execution ────────────────────────────────────────────────────────

scenario_by_id = {s["id"]: s for s in CONFIG["scenarios"]}
results_path = ROOT / "run-status.json"
status: list[dict] = []
if results_path.exists():
    status = json.loads(results_path.read_text(encoding="utf-8"))

# Only reuse sessions that match the current per-method fingerprint.
completed = {
    item["name"]
    for item in status
    if item.get("exit_code") == 0
    and item.get("session_file")
    and item.get("method") in METHOD_FINGERPRINTS
    and item.get("method_fingerprint") == METHOD_FINGERPRINTS[item["method"]]
}
incompatible = {
    item["name"] for item in status
    if item.get("method") in METHOD_FINGERPRINTS
    and item.get("method_fingerprint") != METHOD_FINGERPRINTS[item["method"]]
}
if incompatible:
    print(
        f"NOTE: {len(incompatible)} prior record(s) have a different fingerprint "
        "and will be re-run.",
        flush=True,
    )


def current_jsonl() -> set[Path]:
    return {p.resolve() for p in SESSIONS.glob("*.jsonl")}


def parse_session_name(name: str) -> tuple[str, str, int]:
    """<scenario>-<method>-r<n> -> (scenario, method, n)."""
    scenario_id, method, repetition = name.rsplit("-", 2)
    return scenario_id, method, int(repetition[1:])


for name in EXECUTION_ORDER:
    if name in completed:
        print(f"SKIP {name}: already completed (fingerprint match)", flush=True)
        continue
    scenario_id, method, repetition = parse_session_name(name)
    if method not in METHODS:
        print(f"SKIP {name}: unknown method {method!r}", flush=True)
        continue
    scenario = scenario_by_id[scenario_id]
    m = METHODS[method]
    prompt = COMMON + "\n" + m["prompt"] + "\nBenchmark question:\n" + scenario["question"]
    before = current_jsonl()
    cmd = [
        PI, "--model", CONFIG["model"], "--thinking", CONFIG["thinking"],
        "--mode", "text", "--print", "--session-dir", str(SESSIONS), "--name", name,
    ]
    cmd += ["--tools", m["tools"]]
    if method == "grep" or method == "hybrid":
        cmd += ["--exclude-tools", m["extra_exclude"]]
    else:
        # Non-grep/hybrid methods disable all built-in read/grep/find/ls/bash/subagent
        # AND every other method's tools to keep isolation strict.
        exclude = NON_BUILTIN_EXCLUDE
        if m["extra_exclude"]:
            exclude = exclude + "," + m["extra_exclude"]
        cmd += ["--exclude-tools", exclude]
    if m.get("extension"):
        cmd += ["--extension", str(m["extension"])]
    prompt_path = PROMPTS / f"{name}.md"
    prompt_path.write_text(prompt, encoding="utf-8")
    cmd.append(f"@{prompt_path}")
    env = os.environ.copy()
    env["AIKNOW_CLI"] = "F:/MyWork/aiKnow/dist/cli.js"
    # Put tokensave binary on PATH for tokensave sessions and their extension.
    if method == "tokensave":
        env["PATH"] = str(TOKENSAVE_BIN_DIR) + os.pathsep + env.get("PATH", "")
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
        "repetition": repetition,
        "model": CONFIG["model"],
        "thinking": CONFIG["thinking"],
        "target_revision": CONFIG["target_revision"],
        "aiknow_revision": CONFIG["aiknow_revision"],
        "adapter_path": str(m["extension"]) if m.get("extension") else None,
        "adapter_content_hash": (
            adapter_content_hash(m["adapter_dir"]) if m.get("adapter_dir") else None
        ),
        "method_fingerprint": METHOD_FINGERPRINTS[method],
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

# ── Post-session analysis ────────────────────────────────────────────────────

status = json.loads(results_path.read_text(encoding="utf-8"))
valid = [
    item for item in status
    if item.get("exit_code") == 0
    and item.get("session_file")
    and item["name"] in EXECUTION_ORDER
    and item.get("method") in METHOD_FINGERPRINTS
    and item.get("method_fingerprint") == METHOD_FINGERPRINTS[item["method"]]
]
if len(valid) < EXPECTED_COUNT:
    print(
        f"Only {len(valid)}/{EXPECTED_COUNT} valid sessions -- "
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

eff_path = ROOT / "retrieval-efficiency-results.json"
eff_path.write_text(json.dumps(session_reports, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {eff_path}", flush=True)

# ── Tool isolation ───────────────────────────────────────────────────────────

def check_tool_isolation(reports: list[dict]) -> list[str]:
    failures = []
    for r in reports:
        by_name = r.get("tool_calls_by_name", {})
        allowed = ALLOWED_TOOL_NAMES.get(r["method"], set())
        bad = [k for k in by_name if k not in allowed]
        if bad:
            failures.append(f"{r['name']} ({r['method']}): unexpected tools {bad}")
    return failures


isolation_failures = check_tool_isolation(session_reports)

# ── Per-method metric summaries ──────────────────────────────────────────────

def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


methods_present = sorted({r["method"] for r in session_reports})

def method_stats(method: str) -> dict:
    rs = [r for r in session_reports if r["method"] == method]
    return {
        "count": len(rs),
        "tool_calls": mean([r.get("tool_calls", 0) for r in rs]),
        "duration_seconds": mean([r.get("duration_seconds", 0.0) for r in rs]),
        "total_cost_usd": mean([r.get("total_cost_usd", 0.0) for r in rs]),
        "sum_request_input_tokens": mean([r.get("sum_request_input_tokens", 0) for r in rs]),
        "assistant_api_calls": mean([r.get("assistant_api_calls", 0) for r in rs]),
        "output_tokens": mean([r.get("output_tokens", 0) for r in rs]),
    }


means = {m: method_stats(m) for m in methods_present}

# Grep is the baseline for efficiency / cost gates.
grep_stats = means.get("grep")

# ── Objective gates (per non-grep method vs grep baseline) ────────────────────

def gate_axis(method: str) -> dict:
    rs = [r for r in session_reports if r["method"] == method]
    if not rs or method == "grep" or not grep_stats:
        return {}
    tool_calls = [r.get("tool_calls", 0) for r in rs]
    durations = [r.get("duration_seconds", 0.0) for r in rs]
    costs = [r.get("total_cost_usd", 0.0) for r in rs]
    tokens = [r.get("sum_request_input_tokens", 0) for r in rs]
    api = [r.get("assistant_api_calls", 0) for r in rs]
    mstats = means[method]
    g = grep_stats
    gates = {
        "eff_mean_calls_le_80pct_grep": mstats["tool_calls"] <= 0.80 * g["tool_calls"],
        "eff_no_trial_gt_25_calls": all(c <= 25 for c in tool_calls),
        "eff_mean_duration_le_120pct_grep": mstats["duration_seconds"] <= 1.20 * g["duration_seconds"],
        "eff_no_trial_gt_360s": all(d <= 360 for d in durations),
        "cost_mean_le_80pct_grep": mstats["total_cost_usd"] <= 0.80 * g["total_cost_usd"],
        "cost_no_trial_gt_1_50_usd": all(c <= 1.50 for c in costs),
        "cost_tokens_le_120pct_grep": mstats["sum_request_input_tokens"] <= 1.20 * g["sum_request_input_tokens"],
        "cost_api_calls_le_120pct_grep": mstats["assistant_api_calls"] <= 1.20 * g["assistant_api_calls"],
        "cost_no_trial_gt_3M_tokens": all(t <= 3_000_000 for t in tokens),
        "cost_no_trial_gt_50_api_calls": all(a <= 50 for a in api),
    }
    eff_pass = all([gates["eff_mean_calls_le_80pct_grep"], gates["eff_no_trial_gt_25_calls"],
                    gates["eff_mean_duration_le_120pct_grep"], gates["eff_no_trial_gt_360s"]])
    cost_pass = all([gates["cost_mean_le_80pct_grep"], gates["cost_no_trial_gt_1_50_usd"],
                     gates["cost_tokens_le_120pct_grep"], gates["cost_api_calls_le_120pct_grep"],
                     gates["cost_no_trial_gt_3M_tokens"], gates["cost_no_trial_gt_50_api_calls"]])
    ceilings = []
    for r in rs:
        tc = r.get("tool_calls", 0)
        dur = r.get("duration_seconds", 0.0)
        cost = r.get("total_cost_usd", 0.0)
        toks = r.get("sum_request_input_tokens", 0)
        a = r.get("assistant_api_calls", 0)
        ceilings.append({
            "name": r["name"], "tool_calls": tc, "duration_seconds": dur,
            "total_cost_usd": cost, "sum_request_input_tokens": toks,
            "assistant_api_calls": a,
            "pass": tc <= 25 and dur <= 360 and cost <= 1.50 and toks <= 3_000_000 and a <= 50,
        })
    ratios = {
        "tool_calls": (mstats["tool_calls"] / g["tool_calls"]) if g["tool_calls"] else None,
        "duration_seconds": (mstats["duration_seconds"] / g["duration_seconds"]) if g["duration_seconds"] else None,
        "total_cost_usd": (mstats["total_cost_usd"] / g["total_cost_usd"]) if g["total_cost_usd"] else None,
        "sum_request_input_tokens": (mstats["sum_request_input_tokens"] / g["sum_request_input_tokens"]) if g["sum_request_input_tokens"] else None,
        "assistant_api_calls": (mstats["assistant_api_calls"] / g["assistant_api_calls"]) if g["assistant_api_calls"] else None,
    }
    return {
        "gates": gates,
        "ceilings": ceilings,
        "over_grep_ratios": ratios,
        "efficiency_axis_pass": eff_pass,
        "cost_axis_pass": cost_pass,
    }


method_axes = {m: gate_axis(m) for m in methods_present if m != "grep"}

obj = {
    "scope": SCOPE,
    "method_fingerprints": METHOD_FINGERPRINTS,
    "records": len(valid),
    "methods": methods_present,
    "tool_isolation_pass": len(isolation_failures) == 0,
    "tool_isolation_failures": isolation_failures,
    "means": means,
    "per_method": method_axes,
    "quality_axis": "PENDING_BLINDED_HUMAN_SCORING",
}
obj_path = ROOT / "objective-summary.json"
obj_path.write_text(json.dumps(obj, indent=2), encoding="utf-8")
print(f"Wrote {obj_path}", flush=True)

# ── Blinded review packet ────────────────────────────────────────────────────

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

# Shuffle the valid sessions into a per-scope stable order (seed varies with
# scope so switching SCOPE re-shuffles cleanly).
seed = 42 if SCOPE == "full" else 4212
random.seed(seed)
shuffled = list(valid)
random.shuffle(shuffled)
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

# Reset blind/ so the packet always matches the current scope + shuffle.
for old in BLIND_ANSWERS.glob("*.md"):
    old.unlink()

(BLIND / "blind-mapping.json").write_text(
    json.dumps(mapping, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(f"Wrote {BLIND / 'blind-mapping.json'}", flush=True)

for entry in mapping:
    anon_id = entry["anonymous_id"]
    session_name = entry["session_name"]
    answer_path = ANSWERS / f"{session_name}.md"
    text = answer_path.read_text(encoding="utf-8") if answer_path.exists() else ""
    (BLIND_ANSWERS / f"{anon_id}.md").write_text(text, encoding="utf-8")

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

# Empty scoring sheet; deleted+rewritten because IDs change per scope.
scoring_path = BLIND / "scoring-sheet.csv"
header = "anonymous_id,factual_correctness_0_2,scenario_completeness_0_2,evidence_traceability_0_2,cross_boundary_reasoning_0_2,tests_safety_guidance_0_2,total_0_10,justification"
rows = [header] + [f"{e['anonymous_id']},,,,,,," for e in mapping]
scoring_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
print(f"Wrote {scoring_path}", flush=True)

print("\nAll output files written. Benchmark run complete.", flush=True)
print(f"  retrieval-efficiency-results.json: {eff_path}", flush=True)
print(f"  objective-summary.json:            {obj_path}", flush=True)
print(f"  blind/blind-mapping.json:          {BLIND / 'blind-mapping.json'}", flush=True)
print(f"  blind/reviewer-packet.md:          {BLIND / 'reviewer-packet.md'}", flush=True)
for m, axes in method_axes.items():
    print(f"\n[{m}] efficiency_axis_pass={axes.get('efficiency_axis_pass')} cost_axis_pass={axes.get('cost_axis_pass')}", flush=True)
