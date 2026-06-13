# Pair Program Tool Issue Breakdown

Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool-prd.md`

## Proposed slices

1. **Register pair_program shell and verify TDD prerequisite**
   - Type: AFK
   - Areas cut through: Pair Program Tool Extension; Engineering Skills MCP and TDD Verification; Workspace Evidence, Final Verification, and Transcripts
   - Blocked by: None
   - User stories: 1, 4, 10, 11, 13
   - Primary anchors: `package.json`, `extensions/engineering-skills.ts`, `extensions/subagents.ts`, `node_modules/pi-mcp-adapter/README.md`

2. **Create reusable child-session runtime for Driver and Navigator roles**
   - Type: AFK
   - Areas cut through: Child Session Runtime and Role Permissions; Usage Tracking and Live Display; Pair Program Tool Extension
   - Blocked by: None
   - User stories: 2, 3, 8, 9, 12
   - Primary anchors: `extensions/subagents.ts` child session creation, model selection, event subscription, usage extraction

3. **Implement the dry-run Driver/Navigator TDD protocol loop**
   - Type: AFK
   - Areas cut through: Pair Protocol, Memory, and Prompt Contracts; Child Session Runtime and Role Permissions; Pair Program Tool Extension; Engineering Skills MCP and TDD Verification
   - Blocked by: 01, 02
   - User stories: 1, 2, 3, 5, 11, 14, 15, 16
   - Primary anchors: `extensions/subagents.ts` `session.prompt()` pattern, event subscription, final assistant text extraction

4. **Add workspace evidence, final verification, and completion status handling**
   - Type: AFK
   - Areas cut through: Workspace Evidence, Final Verification, and Transcripts; Pair Protocol, Memory, and Prompt Contracts; Pair Program Tool Extension
   - Blocked by: 03
   - User stories: 17, 18, 19, 20
   - Primary anchors: `extensions/subagents.ts` abort pattern, `package.json` scripts, git evidence commands

5. **Persist full transcripts and report role usage/live handoffs**
   - Type: AFK
   - Areas cut through: Workspace Evidence, Final Verification, and Transcripts; Usage Tracking and Live Display; Pair Program Tool Extension
   - Blocked by: 04
   - User stories: 6, 7, 8, 20
   - Primary anchors: `extensions/subagents.ts` `onUpdate`, `applyAssistantUsage`, `SubagentUsage`; `extensions/tool-panel.ts` usage display patterns

## Readiness notes

- All slices are AFK. The known `skill-tdd` invocation gap is assigned to issue 01 with a requirement to ground the Pi/MCP API and document the selected fallback if needed.
- The slices are vertical enough for incremental trial use: issue 01 creates a callable shell and prerequisite gate, issue 03 enables an observable dry-run pair loop, issue 04 makes the loop completion-aware, and issue 05 adds the audit/cost polish.
- No Ralph Loop integration is included.
