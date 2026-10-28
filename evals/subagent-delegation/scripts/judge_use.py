"""Grade how the parent used real child reports (EVAL_REAL runs) with a bare Opus judge.
Usage: judge_use.py <tasks.csv> <run_dir>"""
import csv, json, os, shutil, subprocess, sys

PI_CLI = os.path.join(os.path.dirname(shutil.which("pi")), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")
JUDGE_MODEL = "anthropic/claude-opus-5-5:medium"

def text(c):
    return c if isinstance(c, str) else "".join(p.get("text", "") for p in c or [] if isinstance(p, dict))

TASKS, RUN_DIR = sys.argv[1:3]

SYSTEM = """You grade how a coding agent USED the reports of its subagents on one turn, following Anthropic's guidance
('When to fold subagents into your main agent loop'): a child hands back a lossy summary, so the main agent keeps
design calls and edits, and verifies child conclusions against real data before acting on them. Explore/shell
children are read-only. The transcript shows the parent's own calls and the full child reports; it was cut after
10 parent tool calls following the first report, 30 tool calls in total, or 20 minutes. Long child reports are
truncated for you; the parent saw them in full. Grade the parent on what it did after the reports arrived.

Return ONLY a JSON object:
{"verify": 0|1|2,     // 2 = checked the claims it relied on against the code/output before acting or answering;
                      // 1 = spot-checked some; 0 = acted on or repeated the report unchecked
 "integrate": 0|1|2,  // 2 = combined reports with its own context into its own conclusion or plan; 0 = pasted/parroted
 "ownership": 0|1|2,  // 2 = parent kept design calls and edits; 0 = handed them to children or re-delegated the same work
 "efficiency": 0|1|2, // 2 = no redundant re-reading of what the report already settled; 0 = redid the child's work
 "report_quality": 0|1|2, // the children's reports: 2 = compact, evidence with paths/lines, answers the brief
 "issues": "<child claims that were wrong/unsupported and whether the parent caught them, or 'none seen'>",
 "why": "<one or two sentences>"}"""

def transcript(log):
    out = []
    for line in open(log, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "message_end" and (e.get("message") or {}).get("role") == "assistant":
            for c in e["message"].get("content") or []:
                if c.get("type") == "text" and c.get("text", "").strip():
                    out.append("ASSISTANT: " + c["text"].strip()[:3000])
                elif c.get("type") == "toolCall":
                    child = c.get("name", "").startswith("subagent")
                    out.append(f"TOOL CALL {c.get('name')}: {json.dumps(c.get('arguments'), ensure_ascii=False)[:4000 if child else 500]}")
        elif e.get("type") == "tool_execution_end":
            body = text((e.get("result") or {}).get("content"))
            if (e.get("toolName") or "").startswith("subagent"):
                out.append(f"CHILD REPORT ({e.get('toolName')}, {len(body)} chars; judge sees the first 7000):\n{body[:7000]}")
            else:
                out.append(f"TOOL RESULT {e.get('toolName')}: {len(body)} chars, starts: {body[:300]!r}")
    return "\n".join(out)

def main():
    tasks = {t["id"]: t for t in csv.DictReader(open(TASKS, encoding="utf-8"))}
    out_path = os.path.join(RUN_DIR, "judged-use.jsonl")
    done = {json.loads(l)["tag"] for l in open(out_path, encoding="utf-8")} if os.path.exists(out_path) else set()
    logs = os.path.join(RUN_DIR, "logs")
    for name in sorted(os.listdir(logs)):
        if not name.endswith(".jsonl.done"):
            continue
        res = json.load(open(os.path.join(logs, name), encoding="utf-8"))
        if res["tag"] in done or not res.get("reports") or res["stop"] in (("harness_error",) if os.environ.get("JUDGE_INCLUDE_LEAK") else ("leak", "harness_error")):
            print(f"{res['tag']:28} skipped (reports={res.get('reports')} stop={res['stop']})", flush=True)
            continue
        prompt = (f"USER TURN:\n{tasks[res['task']]['prompt'][:2000]}\n\nRUN: stop={res['stop']} reports={res['reports']} "
                  f"tools_after_report={res['tools_after_report']}\n\nTRANSCRIPT:\n{transcript(os.path.join(logs, name[:-5]))[:60000]}")
        cmd = ["node", PI_CLI, "-p", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--no-skills",
               "--no-context-files", "--model", JUDGE_MODEL, "--system-prompt", SYSTEM, "Grade the run above."]
        # Full child reports exceed the Windows command-line limit; pi prepends piped stdin to the prompt.
        out = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        try:
            g = json.loads(out[out.find("{"): out.rfind("}") + 1])
        except ValueError:
            g = {"error": out[-500:]}
        row = {"tag": res["tag"], "task": res["task"], "model": res["model"], "stop": res["stop"], "cost": res["cost"], **g}
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(json.dumps(row, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
