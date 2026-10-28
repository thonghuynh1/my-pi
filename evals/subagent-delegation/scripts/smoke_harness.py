"""No-model smoke test of the run_eval harness pieces. Usage: smoke_harness.py <tasks.csv> <task ids>"""
import csv, sys, time
sys.stdout.reconfigure(encoding="utf-8")
TASKS, IDS = sys.argv[1], sys.argv[2].split(",")
sys.argv = ["run_eval.py", TASKS, r"C:\tmp\none"]
src_code = open("run_eval.py", encoding="utf-8").read().split("def main")[0]
exec(src_code)

for t in csv.DictReader(open(TASKS, encoding="utf-8")):
    if t["id"] not in IDS:
        continue
    header, chain, target = session_chain(t)
    src = work_dir(t, header["cwd"])
    base = PINNED[t["id"]]
    ts = target.get("timestamp") or header["timestamp"]
    t0 = time.time(); wt = make_checkout(t["id"], src, base, ts); t1 = time.time()
    fp = fingerprint(src); t2 = time.time()
    head = git("rev-parse", "HEAD", cwd=wt)
    nrefs = len(git("for-each-ref", "--format=%(refname)", cwd=wt).splitlines())
    master = git("rev-parse", "--verify", "-q", "refs/remotes/origin/master", cwd=wt)
    newest = git("for-each-ref", "--sort=-creatordate", "--count=1", "--format=%(creatordate:iso) %(refname)", cwd=wt)
    remotes = git("remote", cwd=wt) or "(none)"
    fetch = subprocess.run(["git", "fetch"], cwd=wt, capture_output=True, text=True)
    print(f"{t['id']}: wt={wt} ts={ts}\n  clone {t1-t0:.1f}s fingerprint {t2-t1:.1f}s head_ok={head.startswith(base)} refs={nrefs}"
          f" origin/master={master[:8] or '-'} newest_ref=[{newest}] remotes={remotes} fetch_rc={fetch.returncode}")
    print("  prompt:", fix_prompt(t["prompt"])[:140])
