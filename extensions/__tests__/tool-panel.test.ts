import assert from "node:assert/strict";
import { test } from "node:test";
import toolPanel from "../tool-panel.ts";

test("tool history remains available on demand without an activity widget", async () => {
	const handlers = new Map<string, Function>();
	const commands = new Map<string, any>();
	toolPanel({
		on: (name: string, handler: Function) => handlers.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerTool: () => {},
	} as any);

	assert.ok(commands.has("tools"));
	assert.equal(commands.has("tool-panel"), false);
	let overlays = 0;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			setWidget: () => assert.fail("Tool activity must not render a widget"),
			custom: async (_factory: unknown, options: any) => {
				assert.equal(options.overlay, true);
				overlays++;
			},
		},
	};
	await handlers.get("session_start")!({}, ctx);
	await handlers.get("tool_execution_start")!({ toolCallId: "read-1", toolName: "read", args: { path: "README.md" } }, ctx);
	await handlers.get("tool_execution_end")!({ toolCallId: "read-1", toolName: "read", result: { content: [{ type: "text", text: "contents" }] } }, ctx);
	await handlers.get("turn_end")!({}, ctx);
	await handlers.get("agent_end")!({}, ctx);
	assert.equal(overlays, 0);
	await commands.get("tools").handler("", ctx);
	assert.equal(overlays, 1);
});
