/**
 * Grill With Scouts extension — registers `/grill-with-scouts <goal>` command.
 *
 * Starts a managed planning session and writes canonical artifacts to
 * `.scratch/grill-with-scouts/` in the active target repo.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSession, ARTIFACT_ROOT } from "./lib/grill-with-scouts-helpers.ts";

export default function grillWithScouts(pi: ExtensionAPI) {
	pi.registerCommand("grill-with-scouts", {
		description:
			"Start or show a Grill With Scouts planning session. Usage: /grill-with-scouts <goal>",
		async handler(args, ctx) {
			const goal = args?.trim();

			if (!goal) {
				ctx.ui.notify(
					"Usage: /grill-with-scouts <goal>\nExample: /grill-with-scouts Design a plugin system",
					"warning",
				);
				return;
			}

			const result = createSession(goal, ctx.cwd);

			if (result.created) {
				ctx.ui.notify(
					`Grill With Scouts session started: ${result.state.id}\nArtifacts: ${ARTIFACT_ROOT}/sessions/${result.state.id}/`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Grill With Scouts session already exists: ${result.state.id}\nArtifacts: ${ARTIFACT_ROOT}/sessions/${result.state.id}/`,
					"info",
				);
			}
		},
	});
}
