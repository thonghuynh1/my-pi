"""Token cost per work item, bucketed by how far the item actually got in Azure DevOps.

Replaces "merged to master under your git email" as the shipping gate. That gate was wrong twice
over on this platform. Work lands on a pushed `feature/<id>-*` branch, which deploys to TST and
sits in states like `Ready for test` / `Test in TST` / `Test in ACC` long before it reaches
master. And the agent commits under whatever `user.email` the worktree carries, which in
`Documents` is `fixture@test.local`, so a human-email filter discards nearly all agent work.

    python -I analyse/delivery.py [--out analyse/out/delivery-<host>.md]

Reads `out/ado-states.csv`, a snapshot of `System.State` per work item taken through the Azure
DevOps MCP (`wit_work_item action=get`), because no CLI on this machine reaches ADO. Refresh it
by re-running that query for the candidate ids and rewriting the file. Token spend per work item
comes from aiNho, grouped by the ticket number on each session.
"""
import argparse
import csv
import datetime
import os
import socket
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merged_prs as M

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
SINCE = datetime.date(2026, 6, 1)
REPOS = ['C:/GitRepos/Tickets', 'C:/GitRepos/Documents']

# Where a state sits on the ladder New -> Approved -> In Progress -> Review -> Ready for test
# -> Test in TST -> Test in ACC -> Done.
LADDER = {
    'Done': 'delivered (Done)',
    'Test in ACC': 'in test (TST/ACC/review)',
    'Test in TST': 'in test (TST/ACC/review)',
    'Ready for test': 'in test (TST/ACC/review)',
    'Review': 'in test (TST/ACC/review)',
    'In Progress': 'in progress',
    'To Do': 'in progress',
    'Approved': 'not started (backlog)',
    'Refinement': 'not started (backlog)',
    'New': 'not started (backlog)',
    'Design': 'test artifact, not work',
    'Removed': 'removed',
}
ORDER = ['delivered (Done)', 'in test (TST/ACC/review)', 'in progress', 'not started (backlog)',
         'removed', 'test artifact, not work', 'not a real work item']
LANDED = ('delivered (Done)', 'in test (TST/ACC/review)')


def spend():
    """work item id -> token spend, tstack flag, first session day, repos."""
    items = {}
    for repo in REPOS:
        name = os.path.basename(repo)
        per = defaultdict(lambda: {'tokens': 0, 'tstack': False, 'first': None, 'sessions': 0})
        for r in M.sessions(name, SINCE):
            if not r['ticket']:
                continue
            p = per[r['ticket']]
            p['tokens'] += r['tokens']
            p['sessions'] += 1
            p['tstack'] |= r['via_tstack']
            p['first'] = min(p['first'] or r['day'], r['day'])
        for t, p in per.items():
            a = items.setdefault(t, {'tokens': 0, 'tstack': False, 'first': None,
                                     'repos': set(), 'sessions': 0})
            a['tokens'] += p['tokens']
            a['sessions'] += p['sessions']
            a['tstack'] |= p['tstack']
            a['repos'].add(name)
            a['first'] = min(a['first'] or p['first'], p['first'])
    return items


def untagged():
    """repo -> sessions, tokens and repo share for sessions with no ticket number.

    The share is computed here rather than quoted by hand. An earlier hand-derived 57% was wrong
    for both repos.
    """
    out = {}
    for repo in REPOS:
        name = os.path.basename(repo)
        tok = ses = total = 0
        for r in M.sessions(name, SINCE):
            total += r['tokens']
            if not r['ticket']:
                tok += r['tokens']
                ses += 1
        out[name] = (ses, tok, tok / total if total else 0)
    return out


def states():
    with open(os.path.join(OUT, 'ado-states.csv'), encoding='utf-8') as fh:
        return {r['id']: r for r in csv.DictReader(fh, delimiter='|')}


def median(xs):
    v = sorted(xs)
    return v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


def render(items, ado, blank):
    buckets = defaultdict(lambda: {'ids': [], 'tokens': 0})
    for t, info in items.items():
        row = ado.get(t)
        bucket = LADDER.get(row['state'], 'in progress') if row else 'not a real work item'
        buckets[bucket]['ids'].append(t)
        buckets[bucket]['tokens'] += info['tokens']
    total = sum(b['tokens'] for b in buckets.values())

    L = [f'Delivery gated on Azure DevOps work item state, not on merge to master. Sessions since '
         f'{SINCE}. Tokens = input + cacheRead + cacheWrite.', '',
         '### Where the ticket-tagged spend sits', '',
         '| How far the item got in ADO | Items | Tokens | Share | Per item |', '|---|---|---|---|---|']
    for name in ORDER:
        if name not in buckets:
            continue
        b, n = buckets[name], len(buckets[name]['ids'])
        L.append(f'| {name} | {n} | {b["tokens"] / 1e6:,.0f}M | {b["tokens"] / total:.0%} '
                 f'| {b["tokens"] / n / 1e6:.1f}M |')
    landed = [t for t in items if ado.get(t) and LADDER.get(ado[t]['state']) in LANDED]
    landed_tok = sum(items[t]['tokens'] for t in landed)
    ts = [t for t in landed if items[t]['tstack']]
    L += ['', f'**{landed_tok / total:.0%} of ticket-tagged spend is on work that reached test or '
          f'Done.** {len(landed)} items got that far, tstack involved in {len(ts)} of them '
          f'carrying {sum(items[t]["tokens"] for t in ts) / 1e6:,.0f}M of the '
          f'{landed_tok / 1e6:,.0f}M.', '']

    L += ['### Same type, same end state, tstack vs main chat', '',
          '| Type and state | Via | Items | Median | Mean |', '|---|---|---|---|---|']
    cells = defaultdict(list)
    for t in landed:
        a = ado[t]
        cells[(f'{a["type"]}, {LADDER[a["state"]]}', 'tstack' if items[t]['tstack'] else 'main chat')
              ].append(items[t]['tokens'])
    for key in sorted(cells):
        v = cells[key]
        L.append(f'| {key[0]} | {key[1]} | {len(v)} | {median(v) / 1e6:.1f}M '
                 f'| {sum(v) / len(v) / 1e6:.1f}M |')

    L += ['', '### Items delivered or in test', '',
          '| Work item | State | Repos | Tokens | tstack | Title |', '|---|---|---|---|---|---|']
    for t in sorted(landed, key=lambda t: -items[t]['tokens']):
        i, a = items[t], ado[t]
        L.append(f'| {t} | {a["state"]} | {", ".join(sorted(i["repos"]))} | {i["tokens"] / 1e6:.1f}M '
                 f'| {"yes" if i["tstack"] else "no"} | {a["title"][:52]} |')

    noise = buckets['not a real work item']
    L += ['', '### Caveats', '',
          f'- Sessions carrying no ticket number are excluded above and are the largest hole: '
          + '; '.join(f'{r} {t / 1e6:,.0f}M over {s} sessions ({share:.0%} of the repo)'
                      for r, (s, t, share) in blank.items())
          + '.',
          f'- {len(noise["ids"])} of {len(items)} candidate ids are not ADO work items at all '
          f'({noise["tokens"] / 1e6:,.0f}M). The `[67]\\d{{4}}` regex matches any five-digit '
          f'number, and every candidate above 71566 is nonexistent.',
          f'- {buckets["not started (backlog)"]["tokens"] / 1e6:,.0f}M sits on '
          f'{len(buckets["not started (backlog)"]["ids"])} items still in `Approved` / `New` / '
          f'`Refinement`, which may be board state lagging real work rather than unstarted work.',
          '- ADO states are a snapshot in `out/ado-states.csv`. Token numbers refresh on every '
          'run; the states do not.']
    return '\n'.join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(OUT, f'delivery-{socket.gethostname()}.md'))
    a = ap.parse_args()
    text = render(spend(), states(), untagged())
    print(text)
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
        print(f'\nwrote {a.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
