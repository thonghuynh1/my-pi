#!/usr/bin/env bash
# Re-run the tstack cost/value analysis into analyse/out/.
#
#   analyse/run.sh [--import]
#
# Env overrides:
#   CUTOFF       first day of the tstack era          (default 2026-09-25)
#   SINCE        start of the "before" window         (default 2026-07-01)
#   ISSUE_REPOS  repos with .scratch/*/issues/*.md     (default: aiNho tstack my-pi under F:/MyWork)
#   WORK_REPOS   repos where tasks are ticket branches (default: C:/GitRepos/Tickets C:/GitRepos/Documents)
#   WORK_CUTOFF  first tstack day in the work repos    (default 2026-08-27)
set -euo pipefail
cd "$(dirname "$0")"

CUTOFF=${CUTOFF:-2026-09-25}
SINCE=${SINCE:-2026-07-01}
ISSUE_REPOS=${ISSUE_REPOS:-"F:/MyWork/aiNho F:/MyWork/tstack F:/MyWork/my-pi"}
WORK_REPOS=${WORK_REPOS:-"C:/GitRepos/Tickets C:/GitRepos/Documents"}
WORK_CUTOFF=${WORK_CUTOFF:-2026-08-27}
HOST=$(hostname)

mkdir -p out
if [[ "${1:-}" == "--import" ]]; then aiNho import; fi

for f in sql/*.sql; do
  name=$(basename "$f" .sql)
  echo "== $name"
  q=$(sed -e "s/{{CUTOFF}}/$CUTOFF/g" -e "s/{{SINCE}}/$SINCE/g" "$f")
  aiNho sql "$q" > "out/$name.csv"
  cat "out/$name.csv"
done

existing() { for r in "$@"; do [[ -d "$r/.git" ]] && echo "$r"; done; }

mapfile -t issue_repos < <(existing $ISSUE_REPOS)
if (( ${#issue_repos[@]} )); then
  echo "== issues (${issue_repos[*]})"
  python -I issues.py --cutoff "$CUTOFF" --since "$SINCE" --csv "out/issues-$HOST.csv" "${issue_repos[@]}" \
    | tee "out/issues-summary-$HOST.csv"
fi

mapfile -t work_repos < <(existing $WORK_REPOS)
if (( ${#work_repos[@]} )); then
  echo "== merged PRs (${work_repos[*]})"
  python -I merged_prs.py --cutoff "$WORK_CUTOFF" --since 2026-06-01 --out "out/work-repos-$HOST.md" "${work_repos[@]}"
fi

python -I report.py
