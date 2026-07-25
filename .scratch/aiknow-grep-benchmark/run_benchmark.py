import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "benchmark-config.json").read_text(encoding="utf-8"))
TARGET = Path(CONFIG["target_repository"])
SESSIONS = ROOT / "sessions"
ANSWERS = ROOT / "answers"
LOGS = ROOT / "logs"
PROMPTS = ROOT / "prompts"
EXTENSION = ROOT / "extension" / "aiknow.ts"
PI = shutil.which("pi.cmd" if os.name == "nt" else "pi")
if not PI:
    raise RuntimeError("pi executable was not found on PATH")
for directory in (SESSIONS, ANSWERS, LOGS, PROMPTS):
    directory.mkdir(parents=True, exist_ok=True)

COMMON = """You are performing one read-only repository exploration benchmark. Do not edit files or run commands that change repository or index state. Keep the complete investigation to at most 25 total tool calls. Stop when every requested part has sufficient evidence. Do not mention the discovery method in the final answer.

Return exactly these sections:
1. Executive summary
2. Detailed flow / architecture / impact analysis
3. Evidence table with columns Claim | Symbol | File:line
4. Tests and documentation
5. Uncertainties

Be concise but complete. Every important claim should cite an exact repository-relative file and line or narrow line range. Distinguish directly evidenced facts from inference.
"""
AIKNOW = """Use aiKnow as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with one aiknow_search using mode=explore, tier=standard, tokenBudget=4000, depth=2, and includeDetails=true. Follow suggested aiknow_read ranges only when relevant and not already read. Prefer targeted ranges; do not use tier=deep or full-file reads. Use aiknow_impact or aiknow_neighbors only when they directly reduce follow-up calls. Do not call aiknow_sync: the index is confirmed warm.
"""
GREP = """Use only built-in grep, read, find, and ls for repository discovery and reading. Do not use aiKnow, bash, subagents, or other discovery tools. Prefer targeted searches and line ranges; avoid duplicate or full-file reads.
"""

scenario_by_id = {s["id"]: s for s in CONFIG["scenarios"]}
results_path = ROOT / "run-status.json"
status = []
if results_path.exists():
    status = json.loads(results_path.read_text(encoding="utf-8"))
completed = {item["name"] for item in status if item.get("exit_code") == 0 and item.get("session_file")}

def current_jsonl():
    return {p.resolve() for p in SESSIONS.glob("*.jsonl")}

for name in CONFIG["execution_order"]:
    if name in completed:
        print(f"SKIP {name}: already completed", flush=True)
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
        cmd += ["--extension", str(EXTENSION), "--tools",
                "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,aiknow_neighbors,aiknow_status,aiknow_capabilities"]
    else:
        cmd += ["--tools", "read,grep,find,ls",
                "--exclude-tools", "aiknow_search,aiknow_read,aiknow_impact,aiknow_file_map,aiknow_neighbors,aiknow_status,aiknow_capabilities,aiknow_sync"]
    prompt_path = PROMPTS / f"{name}.md"
    prompt_path.write_text(prompt, encoding="utf-8")
    cmd.append(f"@{prompt_path}")
    env = os.environ.copy()
    env["AIKNOW_CLI"] = "F:/MyWork/aiKnow/dist/cli.js"
    print(f"START {name}", flush=True)
    started = time.time()
    proc = subprocess.run(cmd, cwd=TARGET, env=env, text=True, encoding="utf-8", errors="replace", capture_output=True)
    elapsed = time.time() - started
    (ANSWERS / f"{name}.md").write_text(proc.stdout, encoding="utf-8")
    (LOGS / f"{name}.stderr.txt").write_text(proc.stderr, encoding="utf-8")
    after = current_jsonl()
    created = sorted(after - before, key=lambda p: p.stat().st_mtime)
    session_file = str(created[-1]) if created else None
    record = {
        "name": name, "scenario": scenario_id, "category": scenario["category"],
        "method": method, "repetition": int(repetition[1:]), "model": CONFIG["model"],
        "thinking": CONFIG["thinking"], "target_revision": CONFIG["target_revision"],
        "aiknow_revision": CONFIG["aiknow_revision"], "elapsed_wall_seconds": round(elapsed, 3),
        "exit_code": proc.returncode, "session_file": session_file,
        "answer_file": str((ANSWERS / f"{name}.md").resolve()),
    }
    status = [item for item in status if item["name"] != name] + [record]
    results_path.write_text(json.dumps(status, indent=2), encoding="utf-8")
    print(f"END {name}: exit={proc.returncode} elapsed={elapsed:.1f}s session={session_file}", flush=True)
    if proc.returncode != 0:
        print(f"Session failed; see {LOGS / (name + '.stderr.txt')}", file=sys.stderr, flush=True)

print("Benchmark session execution complete.", flush=True)
