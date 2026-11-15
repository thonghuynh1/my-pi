#!/bin/sh
# Pastes an issue task into the Claude the worktree dialog starts, without pressing Enter.
# Started detached by main.js: prefill.sh <task>. Gives up after 10 minutes (dialog cancelled).
task=$1
end=$(( $(date +%s) + 600 ))
since=$(( ($(date +%s) - 2) * 1000 ))
old=" "

# Claude's empty input line, past the folder-trust prompt (which also uses ❯).
ready() {
  screen=$(hc read "$1" --lines 20 2>/dev/null) || return 1
  case "$screen" in *"trust this folder"*|*"Enter to confirm"*) return 1 ;; esac
  printf '%s\n' "$screen" | grep -q '^❯'
}

target=
while [ "$(date +%s)" -lt "$end" ]; do
  sleep 1
  if [ -z "$target" ]; then
    for t in $(hc ls --json | jq -r '(.terminals // .)[].address'); do
      case "$old" in *" $t "*) continue ;; esac
      info=$(hc get "$t" --json 2>/dev/null) || continue
      # Terminals that existed before this run are checked once, then skipped.
      if [ "$(printf '%s' "$info" | jq ".created_ms < $since")" = true ]; then old="$old$t "; continue; fi
      printf '%s' "$info" | jq -e '.labels["herdr.space"] != null and .foreground.argv == ["claude"] and (.cwd // "" | contains("/.herdr/worktrees/"))' >/dev/null 2>&1 && { target=$t; break; }
    done
  elif ready "$target"; then
    old=$(pbpaste)
    printf '%s' "$task" | pbcopy
    herdr-app do pane.focus --terminal "$target" >/dev/null
    herdr-app do terminal.paste >/dev/null
    sleep 1
    [ -n "$old" ] && printf '%s' "$old" | pbcopy
    exit 0
  fi
done
