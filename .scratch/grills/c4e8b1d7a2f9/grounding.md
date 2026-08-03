# Grounding — aiKnow × Subagents Efficiency Improvement

## GROUND-001 — Current aiKnow cooperation is prompt metadata only

- Source: `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/index.ts`
- Symbols: `HYBRID_GUIDELINES`, `aiknow_search` registration
- Fact: aiKnow advises that broad independent verification may use an enabled delegation workflow, but exposes no structured handoff to that workflow.

## GROUND-002 — Child sessions are isolated native-tool workers

- Source: `C:/my-pi/extensions/subagents.ts`
- Symbol: `runSubagent`
- Fact: child services use `resourceLoaderOptions.noExtensions: true`; explore children receive only `read`, `grep`, `find`, and `ls`.

## GROUND-003 — The generic Subagent interface carries only prose work

- Source: `C:/my-pi/extensions/subagents.ts`
- Symbols: `SubagentParams`, `resolveRunConfig`
- Fact: the tool accepts `type`, `task`, optional custom agent/cwd/model/timeout. It has no anchors, known facts, verification claims, file budget, turn budget, or coverage contract.

## GROUND-004 — Benchmark outcome

- Sessions: `benchmark-aiknow` and `benchmark-grep`, run concurrently in `C:/GitRepos/Tickets`
- Same parent model: `openai-codex/gpt-5.5`, thinking `high`; Subagents used the same configured `github-copilot/claude-sonnet-4.6` model.
- aiKnow + Subagents: 353.276 seconds, 2.648M total tokens including cache, $2.023, 3 children, 136 child tool calls.
- Grep + Subagents: 238.02 seconds, 2.372M total tokens including cache, $2.033, 4 children, 159 child tool calls.
- Fact: aiKnow was 48% slower and used about 11.7% more tokens while producing only a slightly better answer and nearly identical cost.

## GROUND-005 — Discovery did not bound delegated work

- Source: `benchmark-aiknow` session
- Fact: after one 3,525-character aiKnow result, the parent launched three broad prose tasks. The read/unread child ran 34 turns, made 54 tool calls, and consumed 1.255M tokens. aiKnow pointers were not passed as a structured constraint.

## GROUND-006 — Parent repeated substantial verification

- Source: `benchmark-aiknow` session
- Fact: after aiKnow and child reports, the parent made a second aiKnow search and 18 native file reads. Parent cost was $0.428 versus $0.292 in the grep baseline.

## GROUND-007 — aiKnow already extracts compact structured pointers

- Source: `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/response-compressor.ts`
- Symbols: `FilePointer`, `extractPointers`, `compressToPointers`
- Fact: aiKnow can represent file, line, symbol, kind, summary, and optional signature. Pointer mode exposes these through tool-result details and compact model-visible content, so producing a bounded Evidence Packet candidate does not require inventing a new search result parser.

## GROUND-008 — The Pi adapter does not sync or attest index freshness

- Source: `C:/Hackathon/aiKnow/aiKnow/integrations/pi/aiknow/http.ts`
- Symbols: `ensureServer`, `checkHealth`, `callTool`
- Fact: the adapter selects the current Git branch and ensures that a local aiKnow server is healthy, but it does not run sync, compare the index to `HEAD` or the working tree, or attach a freshness attestation to search results. A user may have synced earlier, but the adapter cannot currently prove that the indexed content matches current source or uncommitted changes.

## GROUND-009 — Adaptive routing prototype validated the decision shape

- Historical source: `C:/my-pi/extensions/prototypes/aiknow-subagent-routing/` (removed after validation under DEC-022).
- Fact: The throwaway interactive logic prototype covered local/direct, cohesive single-child, independent parallel-child, already-covered, and material/non-material follow-up scenarios. It validated that exact local evidence routes directly and Subagent counts are not quotas. The production implementation must not depend on the removed prototype.

## GROUND-010 — Existing Subagent timeout normalization conflicts with 300 seconds

- Source: `C:/my-pi/extensions/subagents.ts`
- Symbols: `normalizeTimeoutSeconds`, `runSubagent`
- Fact: ordinary `timeoutSeconds` values below 600 are raised to 600 before execution, and the runtime timer uses the normalized value. The accepted packet-mode 300-second safety ceiling therefore needs an explicit packet-only path or must be revised to 600 seconds.

## GROUND-011 — Pi SDK supports packet-only custom tools and report-only transitions

- Source: Pi SDK documentation and `dist/core/agent-session.d.ts`.
- APIs: `defineTool`, `createAgentSession(... customTools)`, `AgentSession.setActiveToolsByName`, `AgentSession.getActiveToolNames`.
- Fact: a child session can receive an SDK custom `report_verification` tool alongside selected built-ins. The session can later switch active tools by name, rebuild the system prompt, and apply the restricted set on the next turn. This supports a report-only final turn without loading extensions into the isolated child.

## GROUND-012 — aiKnow broad-search details can supply graph grouping inputs with enrichment

- Source: `C:/Hackathon/aiKnow/aiKnow/src/interfaces/http/http-tools.ts` → search handler around `isBroad`, `details.matches`, and `details.context.relationships`.
- Existing behavior: Broad/hybrid intent is available through `result.interpretation.queryBreadth`. Matches expose path, span, symbol, kind, reason, and confidence. Relationships are emitted only when `includeDetails` is true, are capped to six edges per candidate, and expose edge node IDs without candidate node IDs.
- Required implication: automatic broad packet production must internally request details and enrich endpoint identity sufficiently for deterministic graph-first grouping; path-family fallback remains required for incomplete edges.
- Test prior art: `C:/Hackathon/aiKnow/aiKnow/src/test/retrieval-query-breadth.test.ts`, `retrieval-golden.test.ts`, and `mcp-search-through-http.test.ts`.

## GROUND-013 — Subagent runtime already tracks the counters needed for ceilings

- Source: `C:/my-pi/extensions/subagents.ts` → `SubagentParams`, `normalizeTimeoutSeconds`, `runSubagent`, its session subscription, and `SubagentDetails`.
- Existing behavior: the schema carries prose task/configuration only; the 600-second timeout floor is applied in `prepareArguments`; child sessions use `noExtensions: true`; `runSubagent` tracks turns, tool execution, usage, and abort signals but does not enforce turn/tool ceilings or pass SDK custom tools.
- Required implication: packet validation must occur at runtime before choosing packet or prose-fallback mode; the packet-only timeout path must bypass legacy normalization; valid packet children must receive `report_verification` through `customTools`.
- Test prior art: `C:/my-pi/extensions/__tests__/subagents-defaults.test.ts` using `node:test` via `npx tsx`.

## GROUND-014 — Deterministic build and test commands

- `C:/my-pi`: `npm run check`; pure extension tests use `npx tsx extensions/__tests__/<file>.test.ts`.
- `C:/Hackathon/aiKnow/aiKnow`: `npm run check:pi`; focused tests use `npx vitest run <test files>`.
- Recognizable success: TypeScript exits with code 0 and focused test runners report all tests passing.

## Existing proof seams

- `C:/my-pi/extensions/__tests__/subagents-defaults.test.ts` and related extension tests.
- `C:/Hackathon/aiKnow/aiKnow/src/test/pi-aiknow-hybrid-guidelines.test.ts` if created by the prior issue.
- Session JSONL plus `usage-footer.ts` provide runtime token/cost evidence for repeated A/B benchmarks.
