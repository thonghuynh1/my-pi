"""Replay subagent-eval tasks: truncate each source session before the target user turn,
resume it headless in a shared clone (no remote, refs as of the turn), stop at the first subagent call /
15 actions (skill loading not counted) / 300s. Live repos are fingerprinted before and after each trial."""
import calendar, glob, csv, hashlib, json, os, re, subprocess, sys, tempfile, time, threading, shutil

TASKS, OUT_DIR = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3].split(",")) if len(sys.argv) > 3 and sys.argv[3] else None
# A batch = which repeat numbers to run for which variants, e.g. EVAL_PLAN="current:2,slim-v2:1".
PLAN = [(v, int(r)) for v, r in (x.split(":") for x in os.environ.get("EVAL_PLAN", "current:1,slim-v1:1").split(","))]
PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(TASKS)), "prompts")
MODELS = {"opus": "anthropic/claude-opus-5-5:medium", "codex": "openai-codex/gpt-6.1-sol:medium"}
# 300s: a cold-cache first request on a large resumed session can take minutes before any token.
MAX_TOOLS, MAX_SECS = 15, 300
# EVAL_REAL=1: children really run; stop AFTER_REPORT parent tool calls after the first child report instead.
REAL = os.environ.get("EVAL_REAL") == "1"
AFTER_REPORT = 10
if REAL:
    MAX_TOOLS, MAX_SECS = 30, 1200
ONLY_MODELS = os.environ.get("EVAL_MODELS", "").split(",") if os.environ.get("EVAL_MODELS") else None
# Checkout names must look like a user's own clone: the agent sees its cwd in every tool call.
WT_ROOT = r"C:\tmp\wt"
NEUTRAL = os.path.join(tempfile.gettempdir(), "pi-run")
BASES = os.path.join(os.path.dirname(os.path.abspath(TASKS)), "bases.json")
PINNED = json.load(open(BASES, encoding="utf-8")) if os.path.exists(BASES) else {}
# Git-ignored context files the original session saw in the live checkout (docs, AGENTS.md, ...);
# clean -fdx removes them, so copy them back read-only per task. Globs are relative to the source repo.
OVERLAYS_FILE = os.path.join(os.path.dirname(os.path.abspath(TASKS)), "overlays.json")
OVERLAYS = json.load(open(OVERLAYS_FILE, encoding="utf-8")) if os.path.exists(OVERLAYS_FILE) else {}
# Tools that act outside the worktree (live panes, detached jobs, external services) stay off.
# Read-only MCP servers (engineering_skills, typesafe_jev) stay on: some tasks name them.
EXCLUDE = ("herdr,bg_run,bg_input,bg_kill,tstack*,cua*,browser_*,"
           "mcp__azure_devops*,mcp__playwright*,mcp__cua*,mcp__radius*,mcp__figma*")
NETWORK_GIT = re.compile(r"git\s+(?:fetch|pull)")
# Live checkouts a run must never touch; a tool call naming one ends the run as a leak.
LIVE = re.compile(r"(?i)(?:[a-z]:|/[a-z])[\\/]+(?:hackathon[\\/]+tstack|gitrepos[\\/]+(?:tickets|documents|worktrees))(?![\w-])")
# Final answers that stop over the replayed checkout not matching the history: not a delegation decision.
MISMATCH = re.compile(r"(?i)changed (?:after|during|since)|changes I didn'?t make|checkout changed|worktree (?:doesn'?t|does not|isn'?t|was recreated)"
                      r"|recreated|doesn'?t contain the work|already (?:built|committed|implemented)|not on a feature branch|(?:deleted|removed) from the worktree|outside this session")
PI_CLI = os.path.join(os.path.dirname(shutil.which("pi")), "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")

def git(*a, cwd=None):
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True).stdout.strip()

def text(c):
    return c if isinstance(c, str) else "".join(p.get("text", "") for p in c if isinstance(p, dict))

# Sessions that worked on a feature worktree their history never names by path.
WORK_DIRS = {"T07": r"C:\GitRepos\worktrees\Tickets\feature-66552-migrationActivities-target"}

def work_dir(task, cwd):
    """The directory the session actually worked in: a sibling git worktree it moved into, else its cwd."""
    if task["id"] in WORK_DIRS:
        return WORK_DIRS[task["id"]]
    repo = os.path.basename(cwd.rstrip("\\/"))
    found = re.findall(r"(?i)[a-z]:[\\/]+GitRepos[\\/]+worktrees[\\/]+" + re.escape(repo) + r"[\\/]+[\w.-]+",
                       open(session_file(task), encoding="utf-8").read().replace("\\\\", "\\"))
    counts = {}
    for p in found:
        key = os.path.normcase(os.path.normpath(p))
        counts[key] = counts.get(key, 0) + 1
    best = max(counts, key=counts.get, default=None)
    if best and counts[best] >= 3 and os.path.isdir(best) and os.path.normcase(os.path.normpath(cwd)) != best:
        return os.path.normpath(best)
    return cwd

def base_commit(src, chain, ts):
    """The checkout the session saw: the newest commit its history names that is on src's line and not
    after the target turn; else the last commit on src before the turn."""
    seen = set(re.findall(r"\b[0-9a-f]{7,40}\b", json.dumps(chain)))
    found = subprocess.run(["git", "cat-file", "--batch-check"], cwd=src, capture_output=True, text=True,
                           input="".join(h + "^{commit}\n" for h in seen)).stdout.split("\n")
    shas = {l.split()[0] for l in found if l.endswith(tuple("0123456789")) and " commit " in l}
    limit = calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    best = (0, None)
    for sha in shas:
        ct = int(git("show", "-s", "--format=%ct", sha, cwd=src) or 0)
        if ct > limit or subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], cwd=src).returncode != 0:
            continue
        # Equal commit times (e.g. a merge and its parent): keep the descendant.
        if ct > best[0] or (ct == best[0] and subprocess.run(["git", "merge-base", "--is-ancestor", best[1], sha], cwd=src).returncode == 0):
            best = (ct, sha)
    return best[1] or git("rev-list", "-1", f"--before={ts}", "HEAD", cwd=src)

def repo_name(src):
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=src)
    return os.path.basename(os.path.dirname(common.rstrip("\\/")))

def refs_at(src, ts):
    """Each branch and tag as it stood at the target turn (from the reflog when it moved later);
    refs created after the turn are left out, so the answer key is out of reach."""
    limit = calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    when = time.strftime("%Y-%m-%d %H:%M:%S +0000", time.gmtime(limit))
    refs = {}
    for line in git("for-each-ref", "--format=%(refname) %(objectname) %(creatordate:unix)",
                    "refs/heads", "refs/remotes", "refs/tags", cwd=src).splitlines():
        ref, sha, ct = (line.split(" ") + ["", ""])[:3]
        if ref.endswith("/HEAD"):
            continue
        if ct and int(ct) <= limit:
            refs[ref] = sha
            continue
        r = subprocess.run(["git", "rev-parse", "--verify", "-q", f"{ref}@{{{when}}}"], cwd=src, capture_output=True, text=True)
        old = r.stdout.strip()
        if r.returncode == 0 and "only goes back" not in r.stderr and int(git("show", "-s", "--format=%ct", old, cwd=src) or 10**12) <= limit:
            refs[ref] = old
    return refs

def make_checkout(tid, src, commit, ts):
    """A shared clone of src at commit, without a remote: fetch and push reach nothing, and the live
    repo gets no worktree registration."""
    digest = hashlib.sha1(tid.encode()).hexdigest()[:4]
    wt = os.path.join(WT_ROOT, f"{repo_name(src).lower()}-{commit[:7]}-{digest}")
    if os.path.isdir(wt):
        return wt
    os.makedirs(WT_ROOT, exist_ok=True)
    subprocess.run(["git", "clone", "-q", "--shared", "--no-checkout", src, wt], capture_output=True, text=True, check=True)
    subprocess.run(["git", "update-ref", "--no-deref", "HEAD", commit], cwd=wt, check=True)
    subprocess.run(["git", "remote", "remove", "origin"], cwd=wt, capture_output=True)
    stale = git("for-each-ref", "--format=delete %(refname)", cwd=wt)
    fresh = "".join(f"create {r} {h}\n" for r, h in refs_at(src, ts).items())
    # Two transactions: one may not delete and recreate the same ref. Bytes: text-mode stdin on
    # Windows would send \r\n, which update-ref rejects.
    for script in (stale + "\n" if stale else "", fresh):
        if script:
            subprocess.run(["git", "update-ref", "--stdin"], cwd=wt, input=script.encode(), check=True)
    subprocess.run(["git", "checkout", "-q", "--detach", commit], cwd=wt, capture_output=True, text=True, check=True)
    return wt

def fingerprint(src):
    """HEAD, refs, tracked-file status and last fetch of the live checkout and its main repo: equal
    before and after a trial, or something touched the live repo while it ran."""
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=src)
    parts = []
    for d in sorted({os.path.normcase(src), os.path.normcase(os.path.dirname(common))}):
        parts += [d, git("rev-parse", "HEAD", cwd=d), git("status", "--porcelain", "--untracked-files=no", cwd=d)]
    parts.append(git("for-each-ref", "--format=%(refname) %(objectname)", cwd=src))
    for fh in glob.glob(os.path.join(common, "**", "FETCH_HEAD"), recursive=True):
        parts.append(f"{fh} {os.path.getmtime(fh)}")
    return hashlib.sha1("\n".join(parts).encode("utf-8", "replace")).hexdigest()

def reset_worktree(wt, commit):
    """Every run starts from the same checkout: earlier runs' edits must not leak into later ones."""
    for a in (["reset", "-q", "--hard", commit], ["clean", "-q", "-fdx"]):
        subprocess.run(["git", *a], cwd=wt, capture_output=True, text=True, check=True)

def overlay(tid, src, wt):
    for pattern in OVERLAYS.get(tid, []):
        for path in glob.glob(os.path.join(src, pattern), recursive=True):
            dest = os.path.join(wt, os.path.relpath(path, src))
            if os.path.isdir(path) and "*" not in pattern:
                shutil.copytree(path, dest, dirs_exist_ok=True)
            elif os.path.isfile(path):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(path, dest)

def cwd_rewriter(orig, wt):
    """Point every spelling of the original cwd (C:\\x, C:/x, /c/x, any case) at the worktree,
    so the replayed history never steers tools into the live repository."""
    parts = re.split(r"[\\/]+", orig.rstrip("\\/"))
    drive = re.escape(parts[0][0])
    pattern = re.compile(r"(?i)(?:" + drive + r":|/" + drive + r")" + "".join(r"[\\/]+" + re.escape(p) for p in parts[1:]) + r"(?![\w.-])")
    swap = lambda m: wt.replace("\\", "/") if "/" in m.group(0) else wt
    def walk(o):
        if isinstance(o, str):
            return pattern.sub(swap, o)
        if isinstance(o, list):
            return [walk(v) for v in o]
        if isinstance(o, dict):
            return {k: walk(v) for k, v in o.items()}
        return o
    return walk

def session_file(task):
    """The raw session: the recorded path, else the same session id under this machine's ~/.pi sessions."""
    if os.path.exists(task["import_path"]):
        return task["import_path"]
    found = glob.glob(os.path.join(os.path.expanduser("~"), ".pi", "agent", "sessions", "*", f"*_{task['sid']}*.jsonl"))
    if not found:
        raise FileNotFoundError(f"session {task['sid']} ({task['id']}) is not on this machine; sync the aiNho Pi sessions first")
    return found[0]

def session_chain(task):
    """Session header, the ancestor chain of the target user message, and that message."""
    lines = [json.loads(l) for l in open(session_file(task), encoding="utf-8") if l.strip()]
    header, entries = lines[0], lines[1:]
    by_id = {e.get("id"): e for e in entries}
    target = next(e for e in entries if e.get("type") == "message" and e["message"].get("role") == "user"
                  and text(e["message"].get("content"))[:60].replace("\n", " ").strip() == task["prompt"][:60].strip())
    chain, pid = [], target.get("parentId")
    while pid:
        chain.append(by_id[pid]); pid = by_id[pid].get("parentId")
    chain.reverse()
    return header, chain, target

# The original prompts name engineering_skills tools by spellings that match no declared tool
# (engineering_skills_skill-pstack, engineering_skills_catalog-search), so Opus searched the disk for
# SKILL.md files instead. Point them at the real tools.
SKILL_TOOLS = {"catalog_search", "catalog_read", "skill_pstack", "skill_reference"}

def fix_prompt(prompt):
    def real(m):
        name = m.group(1).replace("-", "_")
        if name not in SKILL_TOOLS:
            return m.group(0)
        return f"mcp__engineering_skills__{name} (codemode: tools.mcp__engineering_skills__{name})"
    return re.sub(r"\bengineering_skills_([a-z][\w-]*)", real, prompt)

def is_action(name, args):
    """Tool calls that count toward the budget: not skill loading, not the codemode wrapper itself
    (its inner calls arrive as their own events)."""
    if name == "codemode" or (name or "").removeprefix("mcp__engineering_skills__") in SKILL_TOOLS:
        return False
    return not (name == "read" and re.search(r"(?i)SKILL\.md|[\\/]skills[\\/]", json.dumps(args or {})))

def truncated_session(task, wt, dest, extra_dir=None):
    """Keep the session header plus the ancestor chain of the target user message; retarget cwd paths."""
    header, chain, target = session_chain(task)
    if not any(e.get("type") == "message" and e["message"].get("role") in ("user", "assistant") for e in chain):
        # First-turn task (only model/thinking/system-prompt entries before it): resuming collides
        # in pi; start fresh.
        return fix_prompt(text(target["message"]["content"])), False
    rewriters = [cwd_rewriter(d, wt) for d in {header["cwd"], extra_dir or header["cwd"]}]
    retarget = lambda e: [e := r(e) for r in rewriters][-1]
    header["cwd"] = wt
    with open(dest, "w", encoding="utf-8") as f:
        for e in [header, *chain]:
            f.write(json.dumps(retarget(e), ensure_ascii=False) + "\n")
    return fix_prompt(text(target["message"]["content"])), True

def run_one(task, model_key, variant, rep, wt, extra_dir, base):
    tag = f"{task['id']}_{model_key}_{variant}_r{rep}"
    log = os.path.join(OUT_DIR, "logs", tag + ".jsonl")
    if os.path.exists(log + ".done"):
        return json.load(open(log + ".done", encoding="utf-8"))
    # Neutral paths: the session and guideline files must not name the experiment.
    os.makedirs(NEUTRAL, exist_ok=True)
    sess = os.path.join(NEUTRAL, hashlib.sha1(tag.encode()).hexdigest()[:12] + ".jsonl")
    prompt, resumed = truncated_session(task, wt, sess, extra_dir)
    reset_worktree(wt, base)
    overlay(task["id"], extra_dir, wt)
    env = dict(os.environ, PI_SUBAGENT_EVAL_DRYRUN="0" if REAL else "1",
               # Never push from an eval run: rewrite every push URL to an unreachable scheme.
               GIT_CONFIG_COUNT="2",
               GIT_CONFIG_KEY_0="url.eval-no-push://blocked/.pushInsteadOf", GIT_CONFIG_VALUE_0="https://",
               GIT_CONFIG_KEY_1="url.eval-no-push://blocked/.pushInsteadOf", GIT_CONFIG_VALUE_1="git@",
               GIT_TERMINAL_PROMPT="0")
    env.pop("PI_SUBAGENT_PROMPT_FILE", None)
    if variant != "current":
        body = open(os.path.join(PROMPTS_DIR, variant + ".txt"), encoding="utf-8").read()
        guide = os.path.join(NEUTRAL, hashlib.sha1(body.encode()).hexdigest()[:10] + ".txt")
        open(guide, "w", encoding="utf-8").write(body)
        env["PI_SUBAGENT_PROMPT_FILE"] = guide
    cmd = ["node", PI_CLI, *(["--session", sess] if resumed else ["--no-session"]), "-p", "--mode", "json",
           "--exclude-tools", EXCLUDE, "--model", MODELS[model_key], prompt]
    before = fingerprint(extra_dir)
    start = time.time()
    # pi -p reads piped stdin as extra prompt input; a held-open pipe would block it forever.
    p = subprocess.Popen(cmd, cwd=wt, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace")
    timer = threading.Timer(MAX_SECS, lambda: kill(p))
    timer.start()
    res = {"tag": tag, "task": task["id"], "model": model_key, "variant": variant, "rep": rep,
           "delegated": False, "sub_type": None, "tools_before": 0, "tools": [], "cost": 0.0, "stop": "ended", "final": "",
           "reports": 0, "tools_after_report": 0, "actions": 0}
    own_jobs = set()
    with open(log, "w", encoding="utf-8") as lf:
        for line in p.stdout:
            lf.write(line)
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t = e.get("type")
            if t == "tool_execution_start":
                name = e.get("toolName") or (e.get("toolCall") or {}).get("name")
                res["tools"].append(name)
                res["actions"] += is_action(name, e.get("args"))
                if res["reports"]:
                    res["tools_after_report"] += 1
                if name in ("subagent", "subagent_followup"):
                    res["delegated"] = True
                    res["sub_type"] = res["sub_type"] or (e.get("args") or {}).get("type")
                    if not REAL:
                        res["stop"] = "subagent"
                # Fetch/pull from a worktree touches the shared object store and remote refs of the live repo.
                if LIVE.search(json.dumps(e.get("args"))) or NETWORK_GIT.search(json.dumps(e.get("args"))):
                    res["stop"] = "leak"
                    kill(p); break
                # Children from the replayed history were saved with the live repo as cwd; reopening one leaks.
                if REAL and name == "subagent_followup" and (e.get("args") or {}).get("jobId") not in own_jobs:
                    res["stop"] = "stale_followup"
                    kill(p); break
            if REAL and t == "tool_execution_end" and e.get("toolName") in ("subagent", "subagent_followup", "subagent_wait"):
                res["reports"] += 1
                own_jobs.update(re.findall(r"\bsa-\d+\b", json.dumps(e.get("result"))))
            if "[subagent-eval] call recorded" in line and not res["delegated"]:
                res.update(delegated=True, stop="subagent")
            if t == "message_end" and (e.get("message") or {}).get("role") == "assistant":
                res["cost"] += ((e["message"].get("usage") or {}).get("cost") or {}).get("total", 0) or 0
                said = text([c for c in e["message"].get("content") or [] if c.get("type") == "text"]).strip()
                res["final"] = said[:600] or res["final"]
            if REAL and res["tools_after_report"] >= AFTER_REPORT:
                res["stop"] = "after_report_budget"
                kill(p); break
            if (res["delegated"] and not REAL) or res["actions"] >= MAX_TOOLS:
                if not res["delegated"] or REAL:
                    res["stop"] = "tool_budget"
                kill(p); break
    timer.cancel()
    p.wait()
    res["live_changed"] = fingerprint(extra_dir) != before
    if resumed and os.path.exists(sess):
        shutil.copy2(sess, os.path.join(OUT_DIR, "sessions", tag + ".jsonl"))
    if time.time() - start >= MAX_SECS and res["stop"] == "ended":
        res["stop"] = "timeout"
    if res["stop"] == "ended" and MISMATCH.search(res["final"]):
        res["stop"] = "state_mismatch"
    if not res["tools"] and res["cost"] == 0:
        # No model activity at all: a harness failure, not a decision. Leave it rerunnable.
        res["stop"] = "harness_error"
        print(f"{tag}: harness error, see {log}", flush=True)
        return res
    res["tools_before"] = len([n for n in res["tools"] if n not in ("subagent", "subagent_followup")])
    res["secs"] = round(time.time() - start, 1)
    json.dump(res, open(log + ".done", "w", encoding="utf-8"))
    return res

def kill(p):
    if p.poll() is None:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)

def main():
    for d in ("logs", "sessions"):
        os.makedirs(os.path.join(OUT_DIR, d), exist_ok=True)
    tasks = [t for t in csv.DictReader(open(TASKS, encoding="utf-8")) if not ONLY or t["id"] in ONLY]
    results = os.path.join(OUT_DIR, "results.jsonl")
    total = 0.0
    for task in tasks:
        header, chain, target = session_chain(task)
        src = work_dir(task, header["cwd"])
        # Pinned bases keep every batch on the same checkout even as the live repos move on.
        base = PINNED.get(task["id"]) or base_commit(src, chain, target.get("timestamp") or header["timestamp"])
        print(f"{task['id']}: base {base[:10]} from {src}", flush=True)
        wt = make_checkout(task["id"], src, base, target.get("timestamp") or header["timestamp"])
        for model_key in [m for m in MODELS if not ONLY_MODELS or m in ONLY_MODELS]:
            for variant, rep in PLAN:
                    r = run_one(task, model_key, variant, rep, wt, src, base)
                    total += r["cost"]
                    with open(results, "a", encoding="utf-8") as f:
                        f.write(json.dumps(r) + "\n")
                    print(f"{r['tag']:28} delegated={r['delegated']!s:5} stop={r['stop']:11} tools={r['tools_before']:2} "
                          f"{'LIVE-CHANGED ' if r.get('live_changed') else ''}"
                          f"${r['cost']:.3f} total=${total:.2f}", flush=True)

if __name__ == "__main__":
    main()
