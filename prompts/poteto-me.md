---
description: Load pstack poteto-mode through the engineering-skills MCP server, then route and execute the task using its playbooks/principles.
argument-hint: "<task>"
---
Use the MCP server `engineering-skills` and load pstack `poteto-mode` before working on this task.

First call:

```ts
mcp({
  server: "engineering-skills",
  tool: "skill-pstack",
  args: "{\"name\":\"poteto-mode\"}"
})
```

Then apply the returned `poteto-mode` instructions to this task:

$ARGUMENTS

Important routing rules:

- If `poteto-mode` tells you to load another pstack skill, principle, or playbook, call MCP tool `skill-pstack` again with the requested `name`.
  - Example principle: `{"name":"principle-prove-it-works"}`
  - Example skill: `{"name":"architect"}`
  - Example playbook: `{"name":"poteto-mode/playbooks/bug-fix"}`
- If `poteto-mode` routes to a non-pstack engineering skill, call that MCP tool on `engineering-skills` directly.
  - Example: `skill-tdd` with `{}`
  - Example: `skill-to-prd` with `{}`
  - Example: `skill-to-issues` with `{}`
- Do not assume the contents of routed skills. Load them on demand through MCP.
- After loading the needed skill chain, execute the task in the current working repository.
