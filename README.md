# my-pi

Personal Pi package that bundles:

- `pi-mcp-adapter`
- `/poteto-me` prompt template
- `engineering-skills` helper/footer extension
- `usage-footer.ts` footer/status extension showing model and context usage

## Install locally

```bash
cd F:/MyWork/my-pi
npm install
pi install F:/MyWork/my-pi
```

Restart Pi or run `/reload`.

## Configure engineering-skills MCP

If your engineering-skills MCP repo is at the default local path:

```text
F:/MyWork/PrecioHackathon/hackathon-grill-me
```

run in Pi:

```text
/engineering-skills-mcp-setup
```

Or pass a repo path:

```text
/engineering-skills-mcp-setup D:/path/to/hackathon-grill-me
```

The command writes global MCP config to:

```text
~/.config/mcp/mcp.json
```

It expects the MCP server to already be built:

```bash
cd F:/MyWork/PrecioHackathon/hackathon-grill-me
npm install
npm run build
```

## Use

```text
/poteto-me fix this bug test-first
```

This loads `skill-pstack` with `name=poteto-mode` from the `engineering-skills` MCP server, then follows its routing instructions.

The package also adds a footer/status entry with the active model and context usage. Refresh manually with:

```text
/usage-footer
```

## Install on another PC

Push this package to git, then install:

```bash
pi install git:github.com/<you>/my-pi
```

Then clone/build `hackathon-grill-me` on that PC and run:

```text
/engineering-skills-mcp-setup <path-to-hackathon-grill-me>
```
