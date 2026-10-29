"""Summarise judge_onepass output, in the eval checklist's report shape.
Usage: report_onepass.py <judged-onepass.jsonl> [old judged.jsonl for agreement] [out.md]"""
import collections, json, os, re, statistics, sys

rows = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8")]
old = {}
if len(sys.argv) > 2 and sys.argv[2] != "-":
    old = {json.loads(l)["tag"]: json.loads(l) for l in open(sys.argv[2], encoding="utf-8")}
out = []
num = lambda v: v if isinstance(v, int) else None
avg = lambda xs: f"{sum(xs) / len(xs):.2f} (n={len(xs)})" if xs else "-"

refs = [r for r in rows if r["variant"] == "reference"]
bad = [r for r in refs if any(num(r.get(k)) not in (2, None) for k in ("decision", "timing", "split", "brief", "self_work"))
       or "_error" in r]
out.append(f"Reference check, hidden among trials: {len(refs) - len(bad)}/{len(refs)} references at full marks"
           + (": failing " + ", ".join(f"{r['task']} {({k: r.get(k) for k in ('decision', 'timing', 'split', 'brief', 'self_work')})}" for r in bad) if bad else ""))
errs = [r for r in rows if "_error" in r]
out.append(f"Judge errors: {len(errs)}")
trials = [r for r in rows if r["variant"] != "reference"]

out.append("\n| model / variant | trials | MUST-NOT delegated (pass^k) | MUST delegated | EITHER decision | timing | split | brief | self_work |")
out.append("|---|---|---|---|---|---|---|---|---|")
by = collections.defaultdict(list)
for r in trials:
    by[(r["model"], r["variant"])].append(r)
for (m, v), rs in sorted(by.items()):
    g = lambda f, rr=rs: [num(r.get(f)) for r in rr if num(r.get(f)) is not None]
    mn = [r for r in rs if r["label"] == "MUST-NOT"]
    mu = [r for r in rs if r["label"] == "MUST"]
    ei = [r for r in rs if r["label"] == "EITHER"]
    bad_mn = ", ".join(sorted({r["task"] for r in mn if r["delegated"]}))
    out.append(f"| {m} / {v} | {len(rs)} | {sum(r['delegated'] for r in mn)}/{len(mn)}{' (' + bad_mn + ')' if bad_mn else ''} | "
               f"{sum(r['delegated'] for r in mu)}/{len(mu)} | {avg(g('decision', ei))} | {avg(g('timing'))} | {avg(g('split'))} | "
               f"{avg(g('brief'))} | {avg(g('self_work'))} |")

out.append("\n## Per task: trials passing / trials (MUST, MUST-NOT by code; EITHER = judge decision 2)\n")
variants = sorted({r["variant"] for r in trials})
out.append("| task | label | model | " + " | ".join(variants) + " |")
out.append("|---|---|---|" + "---|" * len(variants))
for task, model in sorted({(r["task"], r["model"]) for r in trials}):
    label = next(r["label"] for r in trials if r["task"] == task)
    cells = []
    for v in variants:
        rs = [r for r in trials if r["task"] == task and r["model"] == model and r["variant"] == v]
        cells.append(f"{sum(num(r.get('decision')) == 2 for r in rs)}/{len(rs)}" if rs else "·")
    out.append(f"| {task} | {label} | {model} | " + " | ".join(cells) + " |")

# The article: don't just read the final score, look at which tasks flipped between variants.
if len(variants) >= 2:
    base_v = "current" if "current" in variants else variants[0]
    out.append(f"\n## Flips against {base_v} (pass rate differs)\n")
    flips = []
    for task, model in sorted({(r["task"], r["model"]) for r in trials}):
        rate = {}
        for v in variants:
            rs = [r for r in trials if r["task"] == task and r["model"] == model and r["variant"] == v]
            if rs:
                rate[v] = (sum(num(r.get("decision")) == 2 for r in rs), len(rs))
        for v, (p, n) in rate.items():
            if v != base_v and base_v in rate and p / n != rate[base_v][0] / rate[base_v][1]:
                bp, bn = rate[base_v]
                flips.append(f"- {task} {model}: {base_v} {bp}/{bn} -> {v} {p}/{n} ({'better' if p / n > bp / bn else 'WORSE'})")
    out.extend(flips or ["- none"])

# Cost and latency up to the decision. Dry runs stop at the first subagent call, so these are
# decision-point numbers, not whole-task numbers.
# run_dir is stored as the run folder's name; runs sit next to each other (default: beside the judged file's run).
RUNS_ROOT = os.environ.get("RUNS_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(sys.argv[1])))
def done(r):
    p = os.path.join(RUNS_ROOT, r.get("run_dir") or "", "logs", r["tag"] + ".jsonl.done")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
for r in trials:
    r["_done"] = done(r)
out.append("\n## Cost and time to the decision (median per trial)\n")
out.append("| model / variant | trials | cost | secs | delegated trials: secs to first subagent call |")
out.append("|---|---|---|---|---|")
med = lambda xs: f"{statistics.median(xs):.2f}" if xs else "-"
for (m, v), rs in sorted(by.items()):
    d = [r["_done"] for r in rs if r["_done"]]
    out.append(f"| {m} / {v} | {len(d)} | ${med([x['cost'] for x in d])} | {med([x['secs'] for x in d if 'secs' in x])} | "
               f"{med([x['decision_secs'] for x in d if x.get('decision_secs')])} |")

# Rule checks code can grade: explore children cannot run commands.
CMD = re.compile(r"(?i)\b(run|execute)\b[^.\n]{0,40}\b(git|dotnet|npm|pnpm|npx|vitest|jest|tests?|build|script)\b|\bgit (diff|log|show|status|blame)\b")
wrong = [(r["tag"], b["task"][:120]) for r in trials for b in r["_done"].get("briefs", [])
         if b.get("type") == "explore" and CMD.search(b.get("task", ""))]
with_briefs = sum(1 for r in trials if r["_done"].get("briefs"))
out.append(f"\n## Rule check: explore child asked to run commands ({len(wrong)} of {with_briefs} delegating trials with recorded briefs)\n")
out.extend(f"- {t}: {b!r}" for t, b in wrong)

if old:
    pairs = [(r, old[r["tag"]]) for r in trials if r["tag"] in old]
    out.append("\n## Agreement with the earlier per-run judge\n")
    for k in ("decision", "timing", "split", "brief", "self_work"):
        ps = [(num(a.get(k)), num(b.get(k))) for a, b in pairs if num(a.get(k)) is not None and num(b.get(k)) is not None]
        out.append(f"- {k}: {sum(x == y for x, y in ps)}/{len(ps)} equal, within 1: {sum(abs(x - y) <= 1 for x, y in ps)}/{len(ps)}")

out.append("\n## Below full marks\n")
for r in sorted(trials, key=lambda r: r["tag"]):
    low = {k: r.get(k) for k in ("decision", "timing", "split", "brief", "self_work") if r.get(k) not in (2, None)}
    if low:
        out.append(f"- **{r['tag']}** ({r['label']}, delegated={r['delegated']}) {low}: {r.get('why', '')}")

text = "\n".join(out)
if len(sys.argv) > 3:
    open(sys.argv[3], "w", encoding="utf-8").write(text)
sys.stdout.buffer.write(text.encode("utf-8"))
