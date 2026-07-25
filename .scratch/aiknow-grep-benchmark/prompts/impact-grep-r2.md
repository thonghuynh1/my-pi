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
Feature request: Add an executionCount: number field to UsageTotals so the UI can display average cost per execution alongside total cost. The field must count how many UsageLedgerEntry records contributed to each totals bucket (run total, per-issue total, and per-phase total). Streaming usage accumulations, which are ephemeral and not ledger-backed, must not inflate the count. Perform a complete impact analysis and provide concrete edit guidance: for every file that must change, name the exact symbols/functions and describe the required change. Also list tests that will break and the new test cases that should be added. Do not edit files.