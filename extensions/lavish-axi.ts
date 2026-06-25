import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

const LAVISH_AXI_PROMPT = `

=== Lavish AXI visual review workflow ===

Use Lavish AXI only when the user explicitly asks for Lavish, a visual review, an annotation workflow, or uses the /lavish command. Do not proactively choose Lavish just because a topic could be visual.

Use Lavish through npx; do not require global install:

\`\`\`sh
npx -y lavish-axi <html-file>
npx -y lavish-axi poll <html-file>
\`\`\`

Preferred workflow:
1. Create a rich standalone HTML artifact under .lavish/, for example .lavish/plan-review.html.
2. If relevant, run a playbook before writing:
   \`npx -y lavish-axi playbook plan\`
   or: diagram, table, comparison, code, input, slides.
3. Open the artifact:
   \`npx -y lavish-axi .lavish/plan-review.html\`
4. Poll for user feedback:
   \`npx -y lavish-axi poll .lavish/plan-review.html\`
5. If poll returns layout_warnings, fix the HTML and reopen/poll again.
6. If poll returns human feedback, update the plan/artifact/code accordingly.
7. End when done:
   \`npx -y lavish-axi end .lavish/plan-review.html\`

Rules:
- Keep artifacts portable: inline or relative assets only.
- Do not use root-relative asset paths like /assets/logo.png.
- Lavish does not inject Tailwind/DaisyUI automatically.
- Use project design tokens/styles if available; otherwise run \`npx -y lavish-axi design\`.
- Re-running poll is safe; queued feedback is preserved.
- Do not start this workflow unless the user explicitly requested it.
`;

export const piExtension = { id: "lavish-axi" };

export default function lavishAxiExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		return {
			systemPrompt: event.systemPrompt + LAVISH_AXI_PROMPT,
		};
	});

	let piSettings: CapabilityVisibilitySettings = {};
	const visibilityResult = loadCapabilityVisibilitySettings();
	for (const warning of visibilityResult.warnings) {
		console.warn(`[lavish-axi] capability-visibility: ${warning.message}`);
	}
	piSettings = visibilityResult.settings;
	const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

	managed.registerCommand("lavish", {
		description: "Explicitly ask the agent to create/open a Lavish AXI HTML review artifact.",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			await ctx.waitForIdle();

			const request = args?.trim() || "Create a visual review artifact for the current work or plan.";

			await pi.sendUserMessage(`
Use Lavish AXI for this.

User request:
${request}

Create a standalone HTML artifact under .lavish/, open it with:

npx -y lavish-axi <html-file>

Then poll for my feedback with:

npx -y lavish-axi poll <html-file>

After I give feedback, update the artifact/plan/work accordingly.
`);
		},
	});
}
