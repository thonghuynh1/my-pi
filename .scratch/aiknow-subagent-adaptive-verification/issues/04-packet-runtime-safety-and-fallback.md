---
Status: ready-for-agent
status: closed
---

Status: ready-for-agent

# Enforce packet runtime ceilings, structured incompleteness, and explicit fallback

## What to build

Harden the issue 01 packet child path with separate packet timeout semantics, reserved report-only capacity, synthesized incomplete outcomes, and visible whole-packet fallback. Preserve ordinary child behavior exactly.

Covers US-003, US-004; DEC-002, DEC-007, DEC-014, DEC-016, DEC-018, DEC-019, DEC-020, DEC-021; RB-001, RB-009, RB-010, RB-011, RB-012, RB-014, RB-015, RB-019.

## Implementation map

- Edit `extensions/subagents.ts` around `normalizeTimeoutSeconds`, `runSubagent`, `createChildSession`, event subscription, abort handling, `SubagentDetails`, and `renderResult`.
- Validate packet before timeout selection. Valid packet timeout is effective `<=300`; ordinary and invalid/fallback calls retain current minimum normalization to 600.
- Count source calls and investigation turns. Operations may start only below 15 turns/29 calls. At either threshold call `setActiveToolsByName(["report_verification"])` and use one reserved follow-up turn/call; totals never exceed 16/30. Timeout aborts immediately with no grace.
- If termination occurs without a valid full report, synthesize unresolved for unreported claims and set `incomplete: true` with a specific termination reason.
- Invalid/incomplete/unsupported packets are discarded wholesale before prompt/tool/limit injection. Run ordinary prose mode and expose `mode: prose-fallback`, `packetAccepted: false`, actionable error; prose never counts as structured confirmation.
- Keep runtime lifecycle manual per DEC-018. Extract pure transition/fallback/result functions so accepted behavior is deterministically testable without mocked AgentSession.
- Issue 01 provides packet validation and completion tool. This issue wires policy state to actual `runSubagent` events and SDK tool activation.

## Acceptance criteria

- [ ] Pure ceiling state transitions reserve reporting within exact totals.
  - Run: `npx tsx extensions/__tests__/packet-runtime-policy.test.ts` (cwd `C:/my-pi`)
  - Test: planned `15/29 transition and 16/30 totals`
  - Expected: source state through 14/28; report-only at 15 turns or 29 calls; no source call starts afterward; at most one report call reaches totals 16/30.
  - Fails when: a source tool remains active, completion is uncounted, or grace exceeds totals.
- [ ] Timeout mode differs only for accepted packets.
  - Run: `npx tsx extensions/__tests__/packet-runtime-policy.test.ts` (cwd `C:/my-pi`)
  - Test: planned `packet timeout versus prose normalization`
  - Expected: valid default is 300 and lower request is honored; ordinary and rejected packet values below 600 normalize to 600; timeout transition has no report grace.
  - Fails when: legacy timeout changes or packet mode is silently raised to 600.
- [ ] Missing/partial completion synthesizes explicit unresolved outcomes.
  - Run: `npx tsx extensions/__tests__/reconciliation.test.ts` (cwd `C:/my-pi`)
  - Test: planned `incomplete termination synthesis`
  - Expected: every omitted claim is unresolved, `incomplete` is true, and turn-limit/tool-limit/timeout/cancelled/error remain distinguishable.
  - Fails when: a claim vanishes or incomplete work is shown as confirmed/completed.
- [ ] Invalid and unsupported packets use wholesale visible prose fallback.
  - Run: `npx tsx extensions/__tests__/subagents-compat.test.ts` (cwd `C:/my-pi`)
  - Test: planned `actionable prose fallback without packet leakage`
  - Expected: ordinary prompt/tools/timeout/result shape are used; details show fallback/rejection/error; no packet anchor, limit, or report tool is injected.
  - Fails when: fallback is silent, partial, fail-closed, or treated as verification.
- [ ] No-packet public boundaries remain unchanged.
  - Run: `npx tsx extensions/__tests__/subagents-compat.test.ts` (cwd `C:/my-pi`)
  - Test: planned `legacy configuration prompt tools timeout and result snapshot`
  - Expected: baseline fixtures match exactly and no `report_verification` tool appears.
  - Fails when: an ordinary user observes packet defaults or output fields.

## Blocked by

- Local: `01-walking-skeleton-evidence-packet.md`
  - Provides validator, packet prompt seam, report schema/tool, and conditional child-session creation.
  - This issue connects those outputs to real session events, active-tool transitions, timeout selection, and rendering.
