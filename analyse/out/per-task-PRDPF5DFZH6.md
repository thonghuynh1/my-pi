# Per delivered task, with tstack vs without (2026-11-09)

Scoped to work items that reached `Done` in Azure DevOps, so both sides are finished work. Tokens = input + cache. "Human messages" uses the same filter as `sql/03-automation.sql`.

## Quality issue, delivered

| | Tasks | Tokens per task (median) | Tokens (mean) | Your messages per task | Agent turns per task | Calendar days first to last session | Agent wall-clock hours |
|---|---|---|---|---|---|---|---|
| **without tstack** | 7 | 3.9M | 14.6M | 9.0 | 37.0 | 0.2 | 0.6 |
| **tstack** | 7 | 4.0M | 25.8M | 0.0 | 39.0 | 0.0 | 0.4 |

## Task, delivered

| | Tasks | Tokens per task (median) | Tokens (mean) | Your messages per task | Agent turns per task | Calendar days first to last session | Agent wall-clock hours |
|---|---|---|---|---|---|---|---|
| **without tstack** | 1 | 1.7M | 1.7M | 1.0 | 49.0 | 0.0 | 0.3 |
| **tstack** | 1 | 6.1M | 6.1M | 3.0 | 50.0 | 0.0 | 0.3 |

