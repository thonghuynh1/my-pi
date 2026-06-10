# Add project custom subagents

Status: ready-for-agent

## What to build

Add four project-level custom subagent markdown files so `/subagent on` exposes specialized agents for common workflows: fast repo exploration, fresh-context diff review, caller discovery, and focused test running.

Decision IDs: `MACRO-001`, `MACRO-002`, `MACRO-003`

## Implementation map

### Area: Project custom subagent markdowns

- **Decision IDs**: `MACRO-003`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — `discoverCustomAgents`, `loadCustomAgentsFromDir`, `CustomAgent` shape.
  - `C:/my-pi/README.md` — subagent custom-agent usage docs.
- **Existing behavior**: Agents are discovered from user `~/.pi/agent/agents` and nearest project `.pi/agents`; project agents override user agents by name.
- **Required edits**:
  - Create `C:/my-pi/.pi/agents/explore-fast.md`.
  - Create `C:/my-pi/.pi/agents/review-diff.md`.
  - Create `C:/my-pi/.pi/agents/find-callers.md`.
  - Create `C:/my-pi/.pi/agents/test-runner.md`.
  - Use supported comma-separated `tools` frontmatter format.

```ts
// current code anchor — C:/my-pi/extensions/subagents.ts
function discoverCustomAgents(cwd: string): CustomAgent[] {
	const userDir = path.join(getAgentDir(), "agents");
	const projectDir = findProjectAgentsDir(cwd);
	const byName = new Map<string, CustomAgent>();
	for (const agent of loadCustomAgentsFromDir(userDir, "user")) byName.set(agent.name, agent);
	if (projectDir) {
		for (const agent of loadCustomAgentsFromDir(projectDir, "project")) byName.set(agent.name, agent);
	}
	return [...byName.values()];
}
```

Normative: place project agents under `.pi/agents`; project names override user names.

```yaml
# decision artifact — frontmatter shape, normative
---
name: explore-fast
description: Fast read-only repo reconnaissance with concise evidence
tools: read, grep, find, ls
model: inherit
---
```

Normative: `tools` is a comma-separated string, not a YAML array.

#### Required agent contracts

1. `explore-fast.md`
   - Frontmatter:
     - `name: explore-fast`
     - `description: Fast read-only repo reconnaissance with concise evidence`
     - `tools: read, grep, find, ls`
     - `model: inherit`
   - Body contract:
     - Read-only repo reconnaissance.
     - Prefer `grep`, `find`, `ls`, targeted `read`.
     - Return relevant files/symbols, key observations, path+line evidence, risks/unknowns, and next steps.
     - Keep output concise; no implementation unless asked.

2. `review-diff.md`
   - Frontmatter:
     - `name: review-diff`
     - `description: Review changed files/diffs for bugs, regressions, and maintainability`
     - `tools: read, grep, find, ls`
     - `model: inherit`
   - Body contract:
     - Review changed files/diff context in fresh context.
     - Focus on correctness, regressions, security, edge cases, and tests.
     - Return findings grouped by severity with file/path/line, issue, impact, and suggested fix.
     - Explicitly say if no high-confidence findings.

3. `find-callers.md`
   - Frontmatter:
     - `name: find-callers`
     - `description: Find definitions, callers, imports, and usage paths for symbols`
     - `tools: read, grep, find, ls`
     - `model: inherit`
   - Body contract:
     - Given a symbol, locate definition, exports/imports, direct callers, important indirect paths, tests/mocks.
     - Use exact grep patterns first, then broader variants.
     - Return concise call graph with evidence paths/lines.
     - Mention ambiguous matches separately.

4. `test-runner.md`
   - Frontmatter:
     - `name: test-runner`
     - `description: Run focused tests and summarize failures with diagnosis`
     - `tools: read, grep, find, ls, bash`
     - `model: inherit`
   - Body contract:
     - Run focused, safe test commands requested by parent.
     - Do not edit files.
     - Return commands run, pass/fail status, important failure output, suspected cause, next debugging/fix steps.
     - Avoid dumping long logs; summarize.

### Area: Subagent mode and rich guidance integration

- **Decision IDs**: `MACRO-001`, `MACRO-002`, `MESO-001`
- **Current code anchors**:
  - `C:/my-pi/extensions/subagents.ts` — `subagentModeEnabled`, `/subagent` command, `before_agent_start` rich guidance hook.
- **Existing behavior**: `subagentModeEnabled` starts false, can be toggled by `/subagent`, and the rich guidance block is appended only when the mode is enabled.
- **Required edits**:
  - Preserve default OFF behavior.
  - Do not add always-on custom-agent listing.
  - Verify custom agents appear through the existing rich guidance path when `/subagent on` is active.

```ts
// current code anchor — C:/my-pi/extensions/subagents.ts
pi.on("before_agent_start", async (event, ctx) => {
	if (!subagentModeEnabled) return;
	const customAgents = discoverCustomAgents(ctx.cwd)
		.slice(0, 20)
		.map((agent) => `- ${agent.name} (${agent.source}): ${agent.description || agent.filePath}`)
		.join("\n");
	const customAgentsText = customAgents.length > 0 ? customAgents : "- none discovered";
	return {
```

## Acceptance criteria

- [ ] `.pi/agents/explore-fast.md`, `.pi/agents/review-diff.md`, `.pi/agents/find-callers.md`, and `.pi/agents/test-runner.md` exist.
- [ ] Each file has supported frontmatter using comma-separated `tools`.
- [ ] `test-runner` is the only new custom agent with `bash` in its tools list.
- [ ] `/subagents` shows all four project agents.
- [ ] With `/subagent on`, the rich guidance lists all four custom agents.
- [ ] With `/subagent off`, no new always-on custom-agent prompt text is added.
- [ ] Runtime evidence captured: output from `/subagents` or a screenshot/transcript showing the four agents discovered.
- [ ] `npm run check` succeeds.

## Blocked by

None - can start immediately
