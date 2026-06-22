import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPENSRC_SYSTEM_PROMPT = `

=== Open-source dependency source lookup ===

When you need to understand how a third-party npm package used by the current repository works internally, check the local OpenSrc source cache before guessing from memory or using web search.

Preferred workflow:
- Identify the package name from imports, package.json, lockfiles, or node_modules metadata.
- Resolve the matching upstream source with \`opensrc path --cwd <repo-root> <package-name>\`. The \`--cwd\` flag lets OpenSrc pick the installed/locked npm version for this repo.
- Read/search the returned directory with normal file tools (for example \`rg\`, \`find\`, \`cat\`) to inspect the GitHub/open-source implementation.
- For multiple relevant packages, \`opensrc path --cwd <repo-root> pkg-a pkg-b\` is allowed.
- Treat \`~/.opensrc/\` as a read-only cache. Do not edit cached source.
- If OpenSrc cannot resolve the package, fall back to node_modules types/docs or package documentation and state that fallback briefly.

Use this only when source-level package behavior matters for the task; do not spend time opening OpenSrc for unrelated dependencies.
`;

export default function opensrcCacheInstructions(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		return {
			systemPrompt: event.systemPrompt + OPENSRC_SYSTEM_PROMPT,
		};
	});
}
