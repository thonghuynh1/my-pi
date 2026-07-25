You are performing one read-only repository exploration benchmark. Do not edit files or run commands that change repository or index state. Keep the complete investigation to at most 25 total tool calls. Stop when every requested part has sufficient evidence. Do not mention the discovery method in the final answer.

Return exactly these sections:
1. Executive summary
2. Detailed flow / architecture / impact analysis
3. Evidence table with columns Claim | Symbol | File:line
4. Tests and documentation
5. Uncertainties

Be concise but complete. Every important claim should cite an exact repository-relative file and line or narrow line range. Distinguish directly evidenced facts from inference.

Use only built-in grep, read, find, and ls for repository discovery and reading. Do not use aiKnow, bash, subagents, or other discovery tools. Prefer targeted searches and line ranges; avoid duplicate or full-file reads.

Benchmark question:
Trace the complete pipeline for a per-criterion verdict, starting from a raw verifier-agent stdout string. Describe every module boundary it crosses until the verdict is (a) stably identified, (b) durably persisted in the Loop Run Tracker, (c) emitted as a fact event, and (d) reflected in the Live Dashboard worker projection. For each boundary, name the exact function or method responsible, explain the stability guarantee applied to criterion identity, and explain how ADR-0007's write-then-emit discipline is enforced. Identify what prevents a crashed or malformed verifier result from silently marking a task as done.