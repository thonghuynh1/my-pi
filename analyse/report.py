"""Render analyse/out/*.csv (and work-repos-*.md) into one markdown report.

    python -I analyse/report.py [--out analyse/out/report-<host>.md]
"""
import argparse
import csv
import glob
import os
import socket
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

SECTIONS = [
    ('01-tokens-by-kind', 'Cost by session kind', 'Tokens = input + cacheRead + cacheWrite; in_M in millions.'),
    ('02-planning-cost', 'Planning cost per effort', 'A = old in-chat planning session; B = main chat plus linked side conversations and workers (millions).'),
    ('03-automation', 'Automation', 'Agent turns and tool calls per human-typed message.'),
    ('04-durations', 'Session length', 'Minutes from session start to end.'),
    ('05-friction', 'Tool errors', 'Pi tool_results.is_error.'),
    ('06-team-run-outcomes', 'Team-run outcomes', 'Last seen status per run, rolled up per feature tag.'),
    ('07-tokens-by-repo', 'Tokens by repository', 'Project name, else last path segment.'),
]


def table(path):
    with open(path, newline='', encoding='utf-8') as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return '_empty_'
    head, body = rows[0], rows[1:]
    lines = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
    lines += ['| ' + ' | '.join(r) + ' |' for r in body]
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(OUT, f'report-{socket.gethostname()}.md'))
    a = ap.parse_args()

    parts = [f'# tstack analysis report ({socket.gethostname()}, {datetime.now():%Y-%m-%d %H:%M})', '',
             'Generated from `analyse/out/`. Metric definitions and confidence: [MEASURES.md](../MEASURES.md).', '']
    for name, title, note in SECTIONS:
        path = os.path.join(OUT, f'{name}.csv')
        if os.path.exists(path):
            parts += [f'## {title}', '', f'_{note}_', '', table(path), '']
    for path in sorted(glob.glob(os.path.join(OUT, 'issues-summary-*.csv'))):
        host = os.path.basename(path)[len('issues-summary-'):-4]
        parts += [f'## Issue throughput ({host})', '', '_`.scratch` issues: opened and closed per era._', '', table(path), '']
    for path in sorted(glob.glob(os.path.join(OUT, 'work-repos-*.md'))):
        with open(path, encoding='utf-8') as fh:
            body = fh.read().split('\n', 1)[1]  # drop its own H1
        parts += [f'## Work repos ({os.path.basename(path)[11:-3]})', body.replace('\n## ', '\n### ')]

    text = '\n'.join(parts)
    with open(a.out, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    print(f'wrote {a.out}')


if __name__ == '__main__':
    main()
