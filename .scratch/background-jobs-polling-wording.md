# Investigation: agents keep polling background jobs despite completion events

## Scope

`extensions/background-jobs.ts` is the **only** place in the repo that teaches
`bg_run` / `bg_status` / `bg_list` / `notifyOnFinish` / "watch the job" behavior.
Confirmed by repo-wide grep for `bg_run|bg_status|bg_list|notifyOnFinish|watch the
job|poll.*background` — the only other hits are `pi.settings.json` (pure tool
visibility flags, no prose) and the extension's own test file. There is no
duplicate/competing guidance elsewhere (no docs, no other extension, no core
prompt) that needs to be reconciled.

Four sources of agent-facing copy live in this one file (pre-fix line numbers):

1. **Injected system prompt** — `pi.on("before_agent_start", ...)`, ~line 222.
2. **`bg_run` tool description**, ~line 281.
3. **`bg_status` tool description**, ~line 420.
4. **`bg_list` tool description**, ~line 461 — **had zero anti-polling guidance at all.**

## Why the old wording still invited polling

Old system prompt:
> "- Use `bg_run` to execute in the background so the user can continue chatting.
> - CRITICAL: NEVER call `sleep` in `bash` ... or loop polling to wait for a
>   background job. Running `sleep` freezes the terminal session and blocks you
>   from receiving reactive completion notifications.
> - When you launch a job or see via `bg_status` that it is still running,
>   simply inform the user and END YOUR TURN immediately.
> - You will be automatically woken up with a follow-up notification..."

Problems:

1. **The one `CRITICAL` marker is attached to `sleep`, not to tool polling.**
   Models pattern-match on emphasis markers; the strongest signal in the block
   says "don't sleep," so the sleep prohibition is what sticks. "Loop polling"
   is mentioned only as a trailing clause inside that sentence, not as its own
   rule with its own weight.
2. **The end-turn instruction is phrased as a conditional side-effect, not a
   standalone imperative.** "When you launch a job or see ... still running,
   simply inform ... and end your turn" reads as advice for one specific
   branch, not as a hard "never do X" rule sitting next to the sleep rule.
3. **Nothing forbids a *first* status check.** The copy never says "don't call
   `bg_status` right after `bg_run` just to see." An agent can rationalize
   "I'll check once so I can report accurately," get "running," and now is
   already mid-loop rationale — nothing told it a single check is *also*
   polling if it's about to be followed by more waiting.
4. **`bg_list`'s description had no guidance whatsoever** — "List all
   background jobs and their current statuses." An agent that internalizes
   "don't call `bg_status` in a loop" can simply switch to polling via
   `bg_list` instead, which carried no warning at all.
5. **No structural enforcement, only prose.** The `tool_call` interceptor
   (same file) hard-blocks `sleep`/`timeout`/`Start-Sleep` in `bash` while a
   job is running — but it does **not** rate-limit or block repeated
   `bg_status`/`bg_list` calls. Sleep is enforced at the code level; polling
   via the status tools is only *discouraged* in prose. That asymmetry is a
   plausible reason agents drift toward "just call `bg_status` again" instead
   of "call `sleep`" when they want to wait — the harness lets the former
   through.

## Changes made (small, copy-only — no new behavior/tools)

All four spots rewritten to make one thing explicit and un-missable: **after
`bg_run`, or the moment any status check shows "running," inform the user and
end the turn — full stop — because the harness delivers a follow-up message
automatically and there is no way to observe completion sooner.**

- System prompt is now a numbered "HARD RULES" list (not bullet prose), with a
  dedicated rule for "don't call `bg_status`/`bg_list` in a loop or just to
  check up" as its own numbered item — same visual weight as the sleep rule,
  not a subordinate clause of it. Added an explicit "checking once and then
  waiting is still polling" line so a single premature check no longer feels
  compliant.
- `bg_run` description now explicitly says "do NOT call bg_status/bg_list
  right after to check progress" in addition to "do not sleep / do not loop."
- `bg_status` description now scopes *when* it's legitimate to call it at all
  ("only when the user asks... or in response to the completion follow-up
  message — never in a loop or 'just to check up'"), not just what to do
  after the fact.
- `bg_list` description went from **no guidance** to the same "don't poll,
  end turn if running" language as `bg_status`, closing the loophole.

Files touched:
- `extensions/background-jobs.ts` (4 description/prompt strings)
- `extensions/__tests__/background-jobs.test.ts` (assertion updated to match
  new wording fragments; no behavioral test changes)

Verified with `node --test --experimental-strip-types
extensions/__tests__/background-jobs.test.ts` — 7/7 passing.

## Recommended follow-up (not done here — out of scope / "no large change")

- Consider extending the existing `tool_call` interceptor to also flag/soft-block
  a second `bg_status`/`bg_list` call for the *same* job within a single turn
  when no new tool call happened in between (mirrors the existing sleep-block
  pattern, would make the "no loop" rule structurally enforced rather than
  prose-only).
- Consider whether `bg_run`'s returned tool-result text ("Status: running...
  You will be notified when it completes.") should also state "you do not
  need to check again" directly in the tool output the model sees immediately
  after calling it, reinforcing the description before the model even has a
  chance to reach for `bg_status`.
