"""Issue throughput and lead time from .scratch/<feature>/issues/*.md git history.

Created = first commit touching the file; closed = first commit whose content has
`Status: closed|resolved|done`. Prints a per repo/era summary CSV to stdout.

    python -I analyse/issues.py --cutoff 2026-09-25 --since 2026-07-01 --csv out/issues.csv REPO...
"""
import argparse
import csv
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timezone

DONE = re.compile(r'^\W*status\W*:\W*(closed|resolved|done)', re.I | re.M)
ISSUE = re.compile(r'\.scratch/.+/issues/[^/]+\.md$')


def git(root, *args):
    return subprocess.run(['git', '-C', root, *args], capture_output=True, text=True,
                          encoding='utf-8', errors='replace').stdout


def mine(root):
    names = {f for f in git(root, 'log', '--all', '--name-only', '--format=', '--', '.scratch').splitlines() if ISSUE.search(f)}
    for f in sorted(names):
        log = [line.split(' ', 1) for line in git(root, 'log', '--all', '--reverse', '--format=%H %aI', '--', f).splitlines() if line]
        if not log:
            continue
        closed = next((d for h, d in log if DONE.search(git(root, 'show', f'{h}:{f}'))), '')
        yield f, log[0][1], closed


def utc(s):
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cutoff', required=True)
    ap.add_argument('--since', required=True)
    ap.add_argument('--csv', help='write per-issue rows here')
    ap.add_argument('repos', nargs='+')
    a = ap.parse_args()
    cutoff = datetime.fromisoformat(a.cutoff).replace(tzinfo=timezone.utc)
    since = datetime.fromisoformat(a.since).replace(tzinfo=timezone.utc)
    era = lambda d: 'before' if d < cutoff else 'after'

    rows = [(os.path.basename(r.rstrip('/\\')), *row) for r in a.repos for row in mine(r)]
    if a.csv:
        with open(a.csv, 'w', newline='') as fh:
            w = csv.writer(fh)
            w.writerow(['repo', 'path', 'created', 'closed'])
            w.writerows(rows)

    agg = {}
    new = lambda: {'opened': 0, 'closed_of_opened': 0, 'lead_h': [], 'closed_in_era': 0}
    for repo, _, created, closed in rows:
        c = utc(created)
        if c >= since:
            s = agg.setdefault((repo, era(c)), new())
            s['opened'] += 1
            if closed:
                s['closed_of_opened'] += 1
                s['lead_h'].append((utc(closed) - c).total_seconds() / 3600)
        if closed and utc(closed) >= since:
            agg.setdefault((repo, era(utc(closed))), new())['closed_in_era'] += 1

    w = csv.writer(sys.stdout)
    w.writerow(['repo', 'era', 'opened', 'closed_of_opened', 'close_rate_pct', 'closed_in_era', 'median_lead_h'])
    for (repo, e), s in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1] != 'before')):
        lead = round(statistics.median(s['lead_h']), 1) if s['lead_h'] else ''
        w.writerow([repo, e, s['opened'], s['closed_of_opened'],
                    round(100 * s['closed_of_opened'] / max(s['opened'], 1)), s['closed_in_era'], lead])


if __name__ == '__main__':
    main()
