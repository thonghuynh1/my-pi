"""Per-task comparison: what one delivered work item costs and takes, with tstack vs without.

Answers two questions on the same population, so the comparison is like for like:
  - tokens per task
  - how fast a task goes, in calendar days from first session to last, and in agent wall-clock

Scoped to work items that actually reached a delivered state in Azure DevOps, read from
`out/ado-states.csv`. Comparing undelivered work would compare a finished task to an unfinished
one. The human-message filter matches `sql/03-automation.sql` so "human messages" means the same
thing here as in the main report.

    python -I analyse/per_task.py [--out analyse/out/per-task-<host>.md]
"""
import argparse
import csv
import datetime
import os
import socket
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merged_prs as M
from delivery import LADDER, OUT, SINCE

# No % anywhere: the Windows aiNho shim is a .CMD and cmd.exe would eat it. See merged_prs.query.
PER_SESSION_SQL = r"""
WITH f AS (SELECT session_id, arg_min(content, turn) fm FROM messages WHERE role = 'user' GROUP BY 1),
s AS (
  SELECT s.id sid, s.started_at st, s.ended_at en,
    regexp_matches(s.import_path, 'tstack-[a-z-]*sessions') via_tstack,
    coalesce(nullif(regexp_extract(s.source_path, '([67]\d{4})', 1), ''),
             nullif(regexp_extract(f.fm, '(?:^|\D)([67]\d{4})(?:\D|$)', 1), '')) ticket
  FROM sessions s LEFT JOIN f ON f.session_id = s.id
  WHERE s.source = 'pi' AND s.started_at >= '@SINCE@'
    AND regexp_matches(s.source_path, '(?i)[\\/](Tickets|Documents)([\\/]|$)'))
SELECT s.sid, s.st, s.en, s.via_tstack, coalesce(s.ticket, '') ticket,
  coalesce(sum(CAST(json_extract(m.metadata, '$.usage.input') AS BIGINT)
    + CAST(json_extract(m.metadata, '$.usage.cacheRead') AS BIGINT)
    + CAST(json_extract(m.metadata, '$.usage.cacheWrite') AS BIGINT)), 0) tokens,
  sum((m.role = 'assistant')::INT) turns,
  sum((m.role = 'user' AND NOT regexp_matches(m.content,
    '^(\[Background|===|Your tstack assignment|\[result\])'))::INT) human
FROM s LEFT JOIN messages m ON m.session_id = s.sid
GROUP BY s.sid, s.st, s.en, s.via_tstack, s.ticket;
"""


def tasks():
    """work item id -> aggregated effort across every session that touched it."""
    rows = M.query(PER_SESSION_SQL.replace('@SINCE@', str(SINCE)), 'per-session')
    acc = defaultdict(lambda: {'tokens': 0, 'turns': 0, 'human': 0, 'sessions': 0,
                               'minutes': 0.0, 'first': None, 'last': None, 'tstack': False})
    for r in rows:
        if not r['ticket']:
            continue
        t = acc[r['ticket']]
        t['tokens'] += int(float(r['tokens'] or 0))
        t['turns'] += int(float(r['turns'] or 0))
        t['human'] += int(float(r['human'] or 0))
        t['sessions'] += 1
        t['tstack'] |= r['via_tstack'].lower() == 'true'
        st = datetime.datetime.fromisoformat(r['st'][:19]) if r['st'] else None
        en = datetime.datetime.fromisoformat(r['en'][:19]) if r['en'] else None
        if st and en:
            t['minutes'] += (en - st).total_seconds() / 60
        if st:
            t['first'] = min(t['first'] or st, st)
            t['last'] = max(t['last'] or en or st, en or st)
    return acc


def delivered():
    with open(os.path.join(OUT, 'ado-states.csv'), encoding='utf-8') as fh:
        return {r['id']: r for r in csv.DictReader(fh, delimiter='|')
                if LADDER.get(r['state']) == 'delivered (Done)'}


def stat(xs, scale=1.0):
    if not xs:
        return '-', '-'
    return f'{statistics.median(xs) / scale:,.1f}', f'{sum(xs) / len(xs) / scale:,.1f}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(OUT, f'per-task-{socket.gethostname()}.md'))
    a = ap.parse_args()

    done, eff = delivered(), tasks()
    groups = defaultdict(list)
    for t, row in done.items():
        if t in eff:
            groups[('tstack' if eff[t]['tstack'] else 'without tstack', row['type'])].append(eff[t])

    L = [f'# Per delivered task, with tstack vs without ({datetime.date.today()})', '',
         'Scoped to work items that reached `Done` in Azure DevOps, so both sides are finished '
         'work. Tokens = input + cache. "Human messages" uses the same filter as '
         '`sql/03-automation.sql`.', '']
    types = sorted({k[1] for k in groups})
    for wtype in types:
        rows = [(side, groups[(side, wtype)]) for side in ('without tstack', 'tstack')
                if groups.get((side, wtype))]
        if len(rows) < 2:
            continue
        L += [f'## {wtype}, delivered', '',
              '| | Tasks | Tokens per task (median) | Tokens (mean) | Your messages per task '
              '| Agent turns per task | Calendar days first to last session | Agent wall-clock hours |',
              '|---|---|---|---|---|---|---|---|']
        for side, items in rows:
            tok_m, tok_a = stat([i['tokens'] for i in items], 1e6)
            hum_m, _ = stat([i['human'] for i in items])
            trn_m, _ = stat([i['turns'] for i in items])
            day_m, _ = stat([max((i['last'] - i['first']).total_seconds() / 86400, 0)
                             for i in items if i['first'] and i['last']])
            hrs_m, _ = stat([i['minutes'] / 60 for i in items])
            L.append(f'| **{side}** | {len(items)} | {tok_m}M | {tok_a}M | {hum_m} | {trn_m} '
                     f'| {day_m} | {hrs_m} |')
        L.append('')
    text = '\n'.join(L)
    print(text)
    with open(a.out, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    print(f'wrote {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
