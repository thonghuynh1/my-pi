"""One blinded judge pass per task over every trial of both variants and both models, plus a hidden
reference trial, on one scale (pstack eval playbook). Code decides MUST / MUST-NOT; the judge scores
the rest.

Usage: judge_onepass.py <tasks.csv> <labels.json> <references.json> <out.jsonl> <run_dir> [<run_dir> ...]
  --refs-only   judge each reference alone (reference check)
Env: VARIANTS (default current,slim-v3,slim-v4), TASKS_ONLY (comma list)."""
import csv, hashlib, json, os, random, shutil, subprocess, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
REFS_ONLY = "--refs-only" in sys.argv
TASKS, LABELS, REFS, OUT, RUN_DIRS = args[0], args[1], args[2], args[3], args[4:]
VARIANTS = os.environ.get("VARIANTS", "current,slim-v3,slim-v4").split(",")
ONLY = set(os.environ["TASKS_ONLY"].split(",")) if os.environ.get("TASKS_ONLY") else None
PI_CLI = os.path.join(os.path.dirname(shutil.which("pi")), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")
JUDGE_MODEL = "anthropic/claude-opus-5-5:medium"
SKIP = {"leak", "harness_error", "state_mismatch", "stale_followup"}
PER_RUN = 9000

SYSTEM = """You grade how coding agents used subagents on one user turn, following Anthropic's guidance
('When to fold subagents into your main agent loop'). The default is one agent loop: an agent that has
seen the result of each earlier step can connect them, while children hand back lossy summaries. A
subagent is right only when (1) the work would flood the main context with material it won't reuse,
(2) independent tasks can run in parallel in fresh contexts, or (3) for black-box verification of a
change. Divide by context: each child gets work that needs little from the rest and hands back a
compact result in a clear report shape. The main agent keeps design calls, coupled edits and anything
built on the conversation. Explore children cannot run commands; shell children can.

You will see several runs of the same turn, under neutral labels, in random order. Score every run on
the same scale. Each transcript was cut at the first subagent call (with all subagent calls in that
message shown), after 15 actions, or when the agent ended its turn. Skill loading (catalog/pstack
tool calls, reading SKILL.md) is expected setup and is not broad reading.

Per run, score each criterion 0, 1 or 2, "unclear" if the transcript cannot show it, or null where it
does not apply:
- decision: ONLY when the task label is EITHER, otherwise null. 2 = matches the ideal, 1 = defensible
  but not ideal, 0 = wrong call.
- timing: delegated runs only. 2 = delegated before reading the material itself (orientation such as
  a file listing or git status is fine); 0 = after doing the delegated work itself.
- split: delegated runs only. 2 = split by context, parallel where independent, no causal chain cut
  across children; 0 = split by topic with coupled work divided, or one child given everything.
- brief: delegated runs only. 2 = self-contained goal, scope, constraints and report shape, and a child
  type that can do the work; 0 = missing most of these.
- self_work: 2 = focused work, 0 = flooding its context with broad reading a child should own (for
  delegated runs, rate the work before delegating).

Return ONLY JSON: {"<label>": {"decision": ..., "timing": ..., "split": ..., "brief": ..., "self_work": ...,
"why": "<one sentence>"}, ...} with every label."""

def text(c):
    return c if isinstance(c, str) else "".join(p.get("text", "") for p in c or [] if isinstance(p, dict))

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
                    out.append("ASSISTANT: " + c["text"].strip()[:1500])
                elif c.get("type") == "toolCall":
                    limit = 3000 if c.get("name") in ("subagent", "subagent_followup") else 400
                    out.append(f"TOOL CALL {c.get('name')}: {json.dumps(c.get('arguments'), ensure_ascii=False)[:limit]}")
        elif e.get("type") == "tool_execution_start" and e.get("parentToolCallId") and e.get("toolName") in ("subagent", "subagent_followup"):
            # Subagent calls made from a codemode script: the script itself is cut at 400 chars above.
            out.append(f"TOOL CALL {e['toolName']} (from codemode): {json.dumps(e.get('args'), ensure_ascii=False)[:3000]}")
        elif e.get("type") == "tool_execution_end" and not e.get("parentToolCallId"):
            body = text((e.get("result") or {}).get("content"))
            out.append(f"TOOL RESULT {e.get('toolName')}: {len(body)} chars, starts: {body[:160]!r}")
    return "\n".join(out)

def call_judge(prompt):
    cmd = ["node", PI_CLI, "-p", "--mode", "json", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
           "--no-skills", "--no-context-files", "--model", JUDGE_MODEL, "--system-prompt", SYSTEM, "Grade every run above."]
    # The runs exceed the Windows command-line limit; pi prepends piped stdin to the prompt.
    p = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace")
    reply, cost = "", 0.0
    for line in p.stdout.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "message_end" and (e.get("message") or {}).get("role") == "assistant":
            cost += ((e["message"].get("usage") or {}).get("cost") or {}).get("total", 0) or 0
            reply = text([c for c in e["message"].get("content") or [] if c.get("type") == "text"]) or reply
    try:
        return json.loads(reply[reply.find("{"): reply.rfind("}") + 1]), cost
    except ValueError:
        return {"_error": (reply or p.stdout)[-400:]}, cost

def trials(task_id):
    found = []
    for d in RUN_DIRS:
        logs = os.path.join(d, "logs")
        for name in sorted(os.listdir(logs)):
            if not name.endswith(".jsonl.done"):
                continue
            r = json.load(open(os.path.join(logs, name), encoding="utf-8"))
            if r["task"] != task_id or r["variant"] not in VARIANTS or r["stop"] in SKIP or r.get("live_changed"):
                continue
            found.append({**r, "run_dir": os.path.basename(d), "log": os.path.join(logs, name[:-5])})
    return found

def main():
    tasks = {t["id"]: t for t in csv.DictReader(open(TASKS, encoding="utf-8"))}
    labels = json.load(open(LABELS, encoding="utf-8"))
    refs = json.load(open(REFS, encoding="utf-8"))
    rows, judge_cost = [], 0.0
    for tid, task in tasks.items():
        lab = labels.get(tid)
        if not lab or lab["label"] == "UNCLEAR" or tid not in refs or (ONLY and tid not in ONLY):
            continue
        items = [{"tag": f"REF_{tid}", "model": "ref", "variant": "reference", "delegated": refs[tid]["delegated"],
                  # A normal stop value: "reference" would tell the judge which run it is.
                  "stop": "subagent" if refs[tid]["delegated"] else "ended", "body": refs[tid]["transcript"]}]
        if not REFS_ONLY:
            items += [{**r, "body": transcript(r["log"])[:PER_RUN]} for r in trials(tid)]
        random.Random(int(hashlib.sha1(tid.encode()).hexdigest(), 16)).shuffle(items)
        names = {f"run-{chr(65 + i // 26) if i >= 26 else ''}{chr(65 + i % 26)}": it for i, it in enumerate(items)}
        prompt = (f"USER TURN:\n{task['prompt'][:2000]}\n\nTASK LABEL: {lab['label']}\nIDEAL: {lab['ideal']}\n\n" +
                  "\n\n".join(f"===== {n} (delegated={it['delegated']}, stop={it['stop']})\n{it['body']}" for n, it in names.items()))
        scores, cost = call_judge(prompt)
        judge_cost += cost
        for n, it in names.items():
            g = scores.get(n) if isinstance(scores.get(n), dict) else {"_error": scores.get("_error", "missing label")}
            if lab["label"] in ("MUST", "MUST-NOT"):
                want = lab["label"] == "MUST"
                g = {**g, "decision": 2 if it["delegated"] == want else 0, "decision_by": "code"}
            else:
                g = {**g, "decision_by": "judge"}
            rows.append({"tag": it["tag"], "task": tid, "label": lab["label"], "model": it["model"], "variant": it["variant"],
                         "delegated": it["delegated"], "stop": it["stop"], "run_dir": it.get("run_dir"), "blind": n, **g})
        print(f"{tid}: {len(items)} runs judged, ${cost:.3f}", flush=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"judge usage: ${judge_cost:.2f} over {len(rows)} scored runs -> {OUT}")

if __name__ == "__main__":
    main()
