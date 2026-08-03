# Grill Ledger — aiKnow × Subagents Cooperation

Consumed: `.scratch/aiknow-subagent-cooperation/PRD.md`

## D1 — Conditional cooperation contract

Status: accepted

Decision: aiKnow remains the indexed discovery mechanism. When Subagent workflow mode is enabled, the agent should delegate independent `read`/`grep`/`find`/`ls` verification work to `subagent type=explore` calls; when Subagent workflow mode is disabled, the agent should verify with the main native tools directly.

Rationale: The user wants Subagents to remain an optional user-controlled extension. The integration must respect that toggle instead of making delegation unconditional.

Evidence:
- aiKnow currently registers one `aiknow_search` tool and its prompt guidelines explicitly say to verify cited locations with native `read`, `grep`, `find`, and `ls`.
- aiKnow adapter rewrites `aiknow_read` language into native-read language; it does not emit structured tool-call objects.
- Subagents currently register one `subagent` tool with `explore`, `shell`, and `custom` modes.
- Subagents child sessions are created with `noExtensions: true` and a limited tool list, so child agents do not recursively see aiKnow unless deliberately changed.
- Pi `tool_call` events can block or mutate arguments before execution, but cannot replace one tool call with an arbitrary nested tool execution result through the documented return contract.

Decided: The observable behavior is conditional on Subagent workflow mode: on = delegate independent verification; off = main-agent verification.

Left to decide: Which module owns detecting the mode and steering/delegating the verification work.

Dependencies: none yet.

## D2 — aiKnow availability fallback

Status: accepted

Decision: If aiKnow has no usable index/results/pointers and Subagent workflow mode is enabled, delegate broad native exploration to `subagent type=explore`; if Subagent workflow mode is disabled, continue with main-agent native `read`/`grep`/`find`/`ls`.

Rationale: Subagents are optional acceleration for native investigation, not dependent on aiKnow. aiKnow seeds better verification tasks when available; when it cannot, the user's Subagent toggle still controls whether independent reading/searching work is delegated.

User constraint:
- Not every repository is indexed by aiKnow, so the design cannot assume aiKnow pointers are always available or pass aiKnow work directly into subagents.

Evidence:
- Subagents child sessions are isolated with `noExtensions: true`, so they should not be expected to call `aiknow_search` themselves.
- `subagent type=explore` can still use native `read`, `grep`, `find`, and `ls` without aiKnow.

Decided: aiKnow availability failure falls back to native exploration, routed through subagents only when Subagent workflow mode is on.

Left to implementer: exact result phrases/error-shape parsing that detects "no usable aiKnow result," as long as the fallback behavior is preserved.

Dependencies: D1 conditional cooperation contract.

## D3 — Delegation granularity when Subagent workflow mode is enabled

Status: accepted

Decision: Use smart delegation. When Subagent workflow mode is enabled, delegate broad or independent native exploration/verification work to `subagent type=explore`, but allow tiny targeted checks such as reading one known file/range to stay in the main agent.

Rationale: This preserves Subagents as the default acceleration path without making one-file verification slower or indirect.

Evidence:
- Existing Subagent workflow instructions already say to batch multiple independent questions in one assistant message.
- Existing Subagent workflow instructions already say direct main-agent reads remain appropriate for a single known file or targeted lookup.

Decided: Keep the Subagents extension generic; it does not need to know about `aiknow_search` specifically.

Rationale: The existing Subagent workflow guidance already covers the general rule: delegate broad/multi-file independent reading/searching work, but keep tiny targeted checks local. aiKnow can remain one possible producer of investigation leads without becoming part of the Subagents domain model.

Dependencies: D1 conditional cooperation contract; D2 aiKnow availability fallback.

## D4 — Cross-extension coupling direction

Status: accepted

Decision: Do not add aiKnow-specific knowledge to the Subagents extension. Preserve Subagents as a generic delegation module for broad/independent tool work.

Rationale: Subagents should not need to know which upstream source produced the files/symbols to investigate. Its interface is task delegation, not aiKnow result interpretation.

Evidence:
- Existing Subagent guidance already says broad work can be delegated and single known-file checks can stay in the main agent.
- No existing aiKnow references exist in `extensions/subagents.ts`.

Decided: Add generic delegation-aware wording to aiKnow's hybrid guidelines, without naming or depending on the Subagents extension.

Rationale: aiKnow can say that native verification may be delegated when an available workflow supports that, while Subagents remains a generic delegation module and does not learn about `aiknow_search`.

Dependencies: D1, D2, D3.

## D5 — Subagent workflow mode off semantics

Status: accepted

Decision: Keep the current soft-off behavior. When Subagent workflow mode is off, do not add workflow steering, hidden batch-coach nudges, or delegation-aware behavior; do not hide or block the bare `subagent` tool.

Rationale: The user does not want extra behavior changes right now. Existing off behavior is sufficient: no additional work needed beyond avoiding new automatic delegation when mode is off.

Evidence:
- Current implementation registers the `subagent` tool even when mode is off, but with a bare description and no prompt guidelines.
- Current `before_agent_start` Subagent system prompt and batch-coach nudge are gated by `subagentModeEnabled`.

Dependencies: D1, D2, D3, D4.
