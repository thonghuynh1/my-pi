#!/usr/bin/env bash
# Fill the work-repo section of the tstack analysis on the work machine.
#
#   analyse/run-work-repos.sh
#
# The Memory Store is a single-writer DuckDB file, so a running `aiNho sync` or `aiNho import`
# blocks every read. This waits for the lock, imports this machine's sessions, refreshes the
# store-wide queries, then runs the work-repo report and renders everything.
#
# Env overrides:
#   AUTHOR       email merges are attributed to (repos may carry a stale git user.email)
#   WORK_CUTOFF  first tstack day in the work repos
#   WAIT_MINS    how long to wait for the Memory Store lock
set -euo pipefail
cd "$(dirname "$0")"

AUTHOR=${AUTHOR:-thong.huynh.minh@aspia.se}
WORK_CUTOFF=${WORK_CUTOFF:-2026-08-27}
SINCE=${SINCE:-2026-07-01}
CUTOFF=${CUTOFF:-2026-09-25}
WAIT_MINS=${WAIT_MINS:-180}
WORK_REPOS=${WORK_REPOS:-"C:/GitRepos/Tickets C:/GitRepos/Documents"}
HOST=$(hostname)
mkdir -p out

until aiNho sql "SELECT 1" >/dev/null 2>&1; do
  (( WAIT_MINS-- )) || { echo "Memory Store still locked after the wait budget"; exit 1; }
  echo "store locked, waiting ($WAIT_MINS min left)"
  sleep 60
done
echo "store readable"

aiNho import

for f in sql/*.sql; do
  name=$(basename "$f" .sql)
  echo "== $name"
  q=$(sed -e "s/{{CUTOFF}}/$CUTOFF/g" -e "s/{{SINCE}}/$SINCE/g" "$f")
  aiNho sql "$q" > "out/$name.csv"
done

echo "== merged PRs"
python -I merged_prs.py --cutoff "$WORK_CUTOFF" --since 2026-06-01 --author "$AUTHOR" \
  --out "out/work-repos-$HOST.md" $WORK_REPOS

echo "== merged PRs, all authors (team context, confounded)"
python -I merged_prs.py --cutoff "$WORK_CUTOFF" --since 2026-06-01 --all-authors \
  --out "out/work-repos-all-authors-$HOST.md" $WORK_REPOS

# The one to trust. Needs out/ado-states.csv, which only the Azure DevOps MCP can refresh.
echo "== delivery by ADO state"
python -I delivery.py --out "out/delivery-$HOST.md" > /dev/null

python -I report.py
