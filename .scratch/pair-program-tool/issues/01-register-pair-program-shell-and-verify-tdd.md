# Register pair_program shell and verify TDD prerequisite

Status: ready-for-agent
Type: AFK
Source PRD: `F:/MyWork/my-pi/.scratch/pair-program-tool-prd.md`

## What to build

Add the first callable `pair_program` tool shell. It should normalize MVP parameters, enforce one active pair run per Pi session, verify the Engineering Skills MCP `skill-tdd` prerequisite before starting TDD mode, and return a practical structured error/incomplete result with transcript paths. This slice does not need to run Driver/Navigator cycles yet.

Decision IDs: `MACRO-001`, `MACRO-002`, `MACRO-003`, `MESO-001`, `MESO-014`, `MESO-016`, `MESO-017`, `MICRO-001`, `MICRO-002`, `MICRO-003`.

## Implementation map

### Area: Pair Program Tool Extension

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MACRO-003`, `MESO-001`, `MESO-014`, `MESO-017`, `MICRO-001`, `MICRO-003`
- **Current code anchors**:
  - `package.json`: Pi loads `./extensions`.
  - `extensions/subagents.ts`: `buildSubagentToolDef()` registers a custom tool and renders calls/results.
  - `extensions/subagents.ts`: `SubagentParams` shows TypeBox parameter schema style.
- **Existing behavior**: The project registers extension tools from the `extensions` directory. `subagent` is a one-shot child-agent tool.
- **Required edits**:
  - Add `extensions/pair-program.ts` and register a `pair_program` tool.
  - Add `extensions/agent-session-utils.ts` only if this slice needs shared helpers; otherwise leave deeper helpers to issue 02.
  - Ensure only one active pair run per Pi session.
  - Implement parameter defaults: `mode: "tdd"`, `maxCycles: 4`, `dryRun: true`.
  - Reject non-`tdd` modes in MVP with a clear error.
  - Return runtime statuses `success | blocked | incomplete | error`; this slice will normally return `incomplete` after prerequisite verification because the full loop is not implemented yet.
- **Snippet(s)**:

```ts
// current code anchor - package extension discovery, normative
"pi": {
  "extensions": [
    "./node_modules/pi-mcp-adapter/index.ts",
    "./extensions"
  ],
  "prompts": [
    "./prompts"
  ]
}
```

```ts
// current code anchor - TypeBox tool parameter pattern, illustrative
const SubagentParams = Type.Object({
  type: StringEnum(["explore", "shell", "custom"] as const, {
    description: "Subagent type. explore=read-only investigation, shell=command-oriented investigation, custom=markdown-defined agent.",
  }),
  task: Type.String({ description: "Task to delegate to the subagent." }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent. Defaults to the current cwd." })),
  model: Type.Optional(Type.String({
    description: "Optional model override. Use provider/model or a model id in the active provider.",
  })),
});
```

```ts
// decision artifact - Pair Program Tool parameters, normative
const PairProgramParams = Type.Object({
  task: Type.String({ description: "Task for the Driver/Navigator pair." }),
  mode: Type.Optional(StringEnum(["tdd"] as const, {
    description: "Pair workflow mode. MVP supports only tdd.",
  })),
  maxCycles: Type.Optional(Type.Number({ minimum: 1 })),
  testCommand: Type.Optional(Type.String()),
  dryRun: Type.Optional(Type.Boolean()),
  driverModel: Type.Optional(Type.String()),
  navigatorModel: Type.Optional(Type.String()),
});
```

- **Tests to extend**:
  - Add pure tests for parameter normalization and runtime status mapping if the repo has a test setup.
  - If no test harness exists, keep helpers pure and verify with `npm run check`.
- **Wiring/build notes**:
  - `npm run check` runs `tsc --noEmit`.
  - New files under `extensions/` are discovered by existing package configuration.

### Area: Engineering Skills MCP and TDD Verification

- **Decision IDs**: `MESO-016`, `MICRO-002`
- **Current code anchors**:
  - `extensions/engineering-skills.ts`: finds and configures an MCP server named `engineering-skills`.
  - `package.json`: includes `pi-mcp-adapter` extension before local extensions.
  - `PrecioHackathon/hackathon-grill-me/README.md`: documents `skill-tdd`.
  - `node_modules/pi-mcp-adapter/README.md`: documents MCP direct tools and proxy behavior.
- **Existing behavior**: `engineering-skills.ts` can write MCP config and reload Pi. The adapter can expose MCP tools, but the exact public API for an extension to directly invoke `skill-tdd` without a model turn was not verified.
- **Required edits**:
  - Before any TDD pair run starts, verify `skill-tdd` availability.
  - Preferred behavior: coordinator calls `skill-tdd` once directly through the registered MCP/direct tool mechanism and fails if it cannot.
  - If direct invocation is not available through Pi extension APIs, choose one explicit fallback and document it in code comments or the issue completion notes:
    - require `skill-tdd` to be exposed as a direct MCP tool and detect it with `pi.getAllTools()`;
    - or run a cheap verification child prompt that calls `skill-tdd`;
    - or expose a small helper in the MCP adapter integration.
  - Do not hardcode `F:/MyWork/PrecioHackathon/hackathon-grill-me/skills/tdd/SKILL.md` as the contract.
- **Snippet(s)**:

```ts
// current code anchor - engineering-skills MCP config discovery, normative
function findEngineeringSkillsConfig(): { path: string; configured: boolean } {
  const candidates = [
    GLOBAL_MCP_CONFIG,
    join(homedir(), ".pi", "agent", "mcp.json"),
    resolve(process.cwd(), ".mcp.json"),
    resolve(process.cwd(), ".pi", "mcp.json"),
  ];

  for (const path of candidates) {
    const config = readJsonFile(path);
    if (config.mcpServers && Object.prototype.hasOwnProperty.call(config.mcpServers, SERVER_NAME)) {
      return { path, configured: true };
    }
  }

  return { path: GLOBAL_MCP_CONFIG, configured: false };
}
```

```ts
// current code anchor - MCP server registration shape, illustrative
mcpServers[SERVER_NAME] = {
  command: "node",
  args: [distIndex.replace(/\\/g, "/")],
  lifecycle: "lazy",
};
```

- **Tests to extend**:
  - Unit tests for MCP config discovery helper if extracted/exported.
  - Integration or manual verification for `skill-tdd` availability check once implementation chooses the exact call mechanism.
- **Wiring/build notes**:
  - The exact invocation mechanism is the main grounding task in this slice.

## Acceptance criteria

- [ ] `pair_program` is registered as a Pi extension tool with the MVP params.
- [ ] Defaults are `mode: "tdd"`, `maxCycles: 4`, `dryRun: true`.
- [ ] Unsupported modes return `error` with a clear message.
- [ ] A second concurrent `pair_program` call returns `error` / already-active feedback.
- [ ] TDD mode verifies `skill-tdd` availability before any pair run work starts.
- [ ] Verification does not hardcode a local `SKILL.md` path.
- [ ] Tool result includes status, summary, and transcript path placeholders or real initial transcript files.
- [ ] Runtime evidence captured: `npm run check`; plus a manual Pi call or documented verification path showing `pair_program` registers and the `skill-tdd` gate succeeds/fails as expected.

## Blocked by

None - can start immediately.
