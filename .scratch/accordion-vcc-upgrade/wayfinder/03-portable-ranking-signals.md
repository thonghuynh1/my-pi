# 03 — What pi-vcc ranking signals can we port to accordion's digest layer?

Type: research
Status: resolved

## Question

pi-vcc's `selectRankedBriefBlocks()` in `src/core/rank.ts` scores blocks with:

| Signal | Score |
|---|---|
| Edit tool call | +34 |
| User turn | +18 |
| File touched | +18 |
| Test command | +26 |
| Non-zero exit bash | +24 |
| Workflow command | +14 |
| Trivial bash | −16 |
| Long tool_result | −8 |
| Recency | +0 to +12 |
| Adjacency to edits/tests | +5 to +10 |

Plus deduplication (repeated bash, repeated file reads) and adjacency boosts.

**Which of these signals are available in accordion's digest layer?** The digest function in `app/src/lib/engine/digest.ts` receives each block — what data does it have access to (kind, content, tool name, tool args)?

**Which signals translate directly?** Which need adaptation? Which are impossible given accordion's data model?

This determines the feasible scoring model for richer digests.

## Answer

All pi-vcc signals are feasible in accordion's digest/conductor layer:

| Signal | Score | How in Accordion |
|---|---|---|
| Edit tool call | +34 | `toolName` field ("edit", "write") |
| User turn | +18 | `kind === "user"` |
| File touched | +18 | Parse `tool_call.text` args JSON for `path`/`file` keys |
| Test command | +26 | Parse `tool_call.text` for test runner commands or `toolName === "run_tests"` |
| Non-zero exit | +24 | `isError: boolean` — first-class field |
| Workflow command | +14 | Parse bash args for git/gh commands |
| Trivial bash | −16 | Parse bash command text |
| Long tool_result | −8 | `tokens` field |
| Recency | +0–12 | `order` field (linear) |
| Adjacency | +5–10 | Cross-block scan using `order` |

**All signals are directly computable.** The only difference: accordion has `isError: boolean` vs pi-vcc's numeric exit code — but the scoring only uses boolean anyway (+24 for non-zero).
