"""Merged tickets vs aiNho token cost for repos where a task is a ticket branch.

Run on the machine that has the repos (the Tickets/Documents work machine):

    python -I analyse/merged_prs.py --cutoff 2026-08-27 --since 2026-06-01 \
        --out analyse/out/work-repos.md C:/GitRepos/Tickets C:/GitRepos/Documents

A merged ticket = a first-parent commit on the main branch that landed a pull request,
authored by you (git config user.email; --all-authors to skip), whose subject carries a
5-digit ticket number. Three landing shapes count: a real merge commit, an Azure DevOps
"Merged PR NNNN:" squash, and a GitHub "... (#NNN)" squash. Tickets and Documents moved
from Azure DevOps to GitHub during 2025, so the analysis window is entirely GitHub-shaped. Tokens come from `aiNho sql` for sessions
whose source_path is the repo or one of its worktrees (any path segment equal to the repo name).
"""
import argparse
import csv
import io
import os
import re
import shutil
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime

TICKET = re.compile(r'(?<!\d)([67]\d{4})(?!\d)')
GITHUB_SQUASH = re.compile(r'\(#\d+\)\s*$')

SESSIONS_SQL = r"""
WITH f AS (SELECT session_id, arg_min(content, turn) fm FROM messages WHERE role = 'user' GROUP BY 1),
s AS (
  SELECT s.id sid, CAST(s.started_at AS DATE) AS day,
    regexp_matches(s.import_path, 'tstack-[a-z-]*sessions') via_tstack,
    coalesce(nullif(regexp_extract(s.source_path, '([67]\d{4})', 1), ''),
             nullif(regexp_extract(f.fm, '(?:^|\D)([67]\d{4})(?:\D|$)', 1), '')) ticket
  FROM sessions s LEFT JOIN f ON f.session_id = s.id
  WHERE s.source = 'pi' AND s.started_at >= '@SINCE@'
    AND regexp_matches(s.source_path, '(?i)[\\/]@NAME@([\\/]|$)'))
SELECT s.day AS day, s.via_tstack, coalesce(s.ticket, '') ticket,
  coalesce(sum(CAST(json_extract(m.metadata, '$.usage.input') AS BIGINT)
    + CAST(json_extract(m.metadata, '$.usage.cacheRead') AS BIGINT)
    + CAST(json_extract(m.metadata, '$.usage.cacheWrite') AS BIGINT)), 0) tokens
FROM s LEFT JOIN messages m ON m.session_id = s.sid AND m.role = 'assistant'
GROUP BY s.sid, s.day, s.via_tstack, s.ticket;
"""


def git(repo, *args):
    return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True,
                          encoding='utf-8', errors='replace').stdout.strip()


def main_branch(repo):
    head = git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    if head:
        return head
    for b in ('origin/develop', 'origin/main', 'origin/master', 'develop', 'main', 'master'):
        if git(repo, 'rev-parse', '--verify', '--quiet', b):
            return b
    return 'HEAD'


def merged_tickets(repo, branch, since, author):
    """ticket -> first merge date on the main branch."""
    out = git(repo, 'log', branch, '--first-parent', f'--since={since}', '--format=%P%x1f%ad%x1f%ae%x1f%s', '--date=short')
    merged = {}
    for line in out.splitlines():
        parents, day, email, subject = line.split('\x1f', 3)
        landed = (len(parents.split()) >= 2 or subject.startswith('Merged PR')
                  or GITHUB_SQUASH.search(subject))
        if not landed:
            continue
        if author and email.lower() != author:
            continue
        for t in set(TICKET.findall(subject)):
            d = date.fromisoformat(day)
            merged[t] = min(merged.get(t, d), d)
    return merged


def query(sql, label='query'):
    """Run one statement through the aiNho CLI and return CSV rows as dicts.

    The Windows aiNho shim is a .CMD file: cmd.exe expands %...% and stops at newlines, so the
    statement must be a single line and must contain no % at all. Use regexp_matches rather than
    LIKE patterns.
    """
    exe = shutil.which('aiNho') or sys.exit('aiNho CLI not found on PATH')
    res = subprocess.run([exe, 'sql', ' '.join(sql.split())], capture_output=True, text=True,
                         encoding='utf-8', errors='replace')
    if res.returncode != 0 or res.stdout.startswith('SQL error'):
        sys.exit(f'aiNho sql failed for {label}:\n{res.stdout}{res.stderr}')
    return list(csv.DictReader(io.StringIO(res.stdout)))


def sessions(name, since):
    rows = query(SESSIONS_SQL.replace('@NAME@', re.escape(name)).replace('@SINCE@', str(since)), name)
    for r in rows:
        r['day'] = date.fromisoformat(r['day'][:10])
        r['via_tstack'] = r['via_tstack'].lower() == 'true'
        r['tokens'] = int(float(r['tokens'] or 0))
    return rows


def med(xs, scale=1e6):
    return f'{statistics.median(xs) / scale:.1f}' if xs else '-'


def report(repo, cutoff, since, author):
    name = os.path.basename(repo.rstrip('/\\'))
    branch = main_branch(repo)
    merged = merged_tickets(repo, branch, since, author)
    rows = sessions(name, since)
    era = lambda d: 'before' if d < cutoff else 'after'
    today = date.today()
    weeks = {'before': (cutoff - since).days / 7, 'after': (today - cutoff).days / 7}

    by_era = defaultdict(lambda: {'tokens': 0, 'sessions': 0, 'tstack': 0})
    by_ticket = defaultdict(lambda: {'tokens': 0, 'first': None, 'tstack': False})
    for r in rows:
        e = by_era[era(r['day'])]
        e['tokens'] += r['tokens']; e['sessions'] += 1; e['tstack'] += r['via_tstack']
        if r['ticket']:
            t = by_ticket[r['ticket']]
            t['tokens'] += r['tokens']; t['tstack'] |= r['via_tstack']
            t['first'] = min(t['first'] or r['day'], r['day'])

    lines = [f'## {name}', '', f'Main branch `{branch}`, author filter `{author or "all"}`, cutoff {cutoff}.', '',
             '| Era | Weeks | Merged tickets | Merged/week | Sessions (tstack) | Tokens (M) | Tokens per merged ticket (M) |',
             '|---|---|---|---|---|---|---|']
    for e in ('before', 'after'):
        n = sum(1 for d in merged.values() if era(d) == e)
        s = by_era[e]
        per = f'{s["tokens"] / n / 1e6:.1f}' if n else '-'
        lines.append(f'| {e} | {weeks[e]:.1f} | {n} | {n / max(weeks[e], 0.1):.1f} | {s["sessions"]} ({s["tstack"]}) '
                     f'| {s["tokens"] / 1e6:.0f} | {per} |')

    lines += ['', 'Merged tickets that have agent sessions (lead = first session to merge):', '',
              '| Group | Tickets | Median tokens (M) | Median lead (days) |', '|---|---|---|---|']
    groups = defaultdict(lambda: ([], []))
    for t, d in merged.items():
        info = by_ticket.get(t)
        if not info:
            continue
        key = f'{era(d)}, {"with tstack" if info["tstack"] else "main chat only"}'
        groups[key][0].append(info['tokens'])
        groups[key][1].append((d - info['first']).days)
    for key in sorted(groups):
        toks, leads = groups[key]
        lines.append(f'| {key} | {len(toks)} | {med(toks)} | {med(leads, 1)} |')
    touched_unmerged = sorted(t for t in by_ticket if t not in merged)
    lines += ['', f'Tickets with sessions but no merge found: {len(touched_unmerged)} '
              f'(tokens {sum(by_ticket[t]["tokens"] for t in touched_unmerged) / 1e6:.0f}M).', '']
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cutoff', default='2026-08-27')
    ap.add_argument('--since', default='2026-06-01')
    ap.add_argument('--all-authors', action='store_true')
    ap.add_argument('--author', help='Email to attribute merges to. Defaults to each repo\'s '
                                     'git config user.email, which a repo may have overridden '
                                     'to something unrelated.')
    ap.add_argument('--out')
    ap.add_argument('repos', nargs='+')
    a = ap.parse_args()
    cutoff, since = date.fromisoformat(a.cutoff), date.fromisoformat(a.since)
    parts = [f'# Work repos: merged tickets vs token cost ({datetime.now():%Y-%m-%d %H:%M})', '']
    for repo in a.repos:
        author = None if a.all_authors else (a.author or git(repo, 'config', 'user.email')).lower() or None
        parts.append(report(repo, cutoff, since, author))
    text = '\n'.join(parts)
    print(text)
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')


if __name__ == '__main__':
    main()
