You are performing one read-only repository exploration benchmark. Do not edit files or run commands that change repository or index state. Keep the complete investigation to at most 25 total tool calls. Stop when every requested part has sufficient evidence. Do not mention the discovery method in the final answer.

Return exactly these sections:
1. Executive summary
2. Detailed flow / architecture / impact analysis
3. Evidence table with columns Claim | Symbol | File:line
4. Tests and documentation
5. Uncertainties

Be concise but complete. Every important claim should cite an exact repository-relative file and line or narrow line range. Distinguish directly evidenced facts from inference.

Use aiKnow as the only repository discovery and reading mechanism. Do not use built-in read, grep, find, ls, bash, subagents, or other discovery tools. Start with one aiknow_search using mode=explore, tier=standard, tokenBudget=4000, depth=2, and includeDetails=true. Follow suggested aiknow_read ranges only when relevant and not already read. Prefer targeted ranges; do not use tier=deep or full-file reads. Use aiknow_impact or aiknow_neighbors only when they directly reduce follow-up calls. Do not call aiknow_sync: the index is confirmed warm.

Benchmark question:
A loop process crashes mid-run. On the next startup, ralph-loop detects a stale Durable Loop Run Tracker. Walk through the complete stale-run recovery lifecycle from that detection point to the moment a resumed LoopRun is back in control as the sole authoritative tracker writer. Cover: (1) how startup decides which recovery actions to offer (resume, rollback, finishRollback, abandon, cancel) and why each may or may not be available; (2) what normalizeCrashRules does and when it is called; (3) how buildResumePlan translates the persisted task table into live scheduler state, including mark-done-pending tasks; (4) how the new process takes sole authoritative ownership of the existing tracker, including write-then-emit, monotonic revision, and subscriber ordering; (5) why a partially completed Force-Kill Undo is not treated as an ordinary stale run and what Finish Rollback requires; and (6) what safety check blocks merge-phase recovery when uncommitted edits are present in the primary workspace.