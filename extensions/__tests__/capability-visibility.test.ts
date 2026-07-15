import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mergeCapabilityVisibility,
	parseCapabilityVisibilitySettings,
	resolveExtensionCapabilityVisibility,
	resolveToolVisibility,
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilityWarning,
	type ManagedExtensionPiApi,
} from "../lib/capability-visibility.ts";
import { piExtension } from "../frontend-coach/index.ts";

import { piExtension as subagentsExtension } from "../subagents.ts";
import { piExtension as lavishAxiExtension } from "../lavish-axi.ts";
import { piExtension as engineeringSkillsExtension } from "../engineering-skills.ts";
import { piExtension as usageFooterExtension } from "../usage-footer.ts";
import { piExtension as herdrAgentReportExtension } from "../herdr-agent-report.ts";
import { piExtension as toolPanelExtension } from "../tool-panel.ts";

function warningCodes(warnings: ReadonlyArray<CapabilityVisibilityWarning>): string[] {
	return warnings.map((warning) => warning.code);
}

test("global override precedence", () => {
	const packageDefaults = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			"frontend-coach": {
				tools: {
					browser_eval: "agent-hidden",
				},
			},
		},
	}).settings;
	const projectSettings = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			"frontend-coach": {
				tools: {
					browser_eval: "agent-visible",
				},
			},
		},
	}).settings;
	const globalSettings = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			"frontend-coach": {
				tools: {
					browser_eval: "agent-hidden",
				},
			},
		},
	}).settings;

	const merged = mergeCapabilityVisibility(packageDefaults, projectSettings, globalSettings);

	assert.equal(
		merged.capabilityVisibility?.["frontend-coach"]?.tools?.browser_eval,
		"agent-hidden",
	);
});

test("loadCapabilityVisibilitySettings merges project and global settings with global precedence", () => {
	const workspaceDir = mkdtempSync(path.join(tmpdir(), "capability-visibility-"));
	const globalDir = path.join(workspaceDir, "global");
	const projectDir = path.join(workspaceDir, "project");
	mkdirSync(globalDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });

	const globalSettingsPath = path.join(globalDir, "pi.settings.json");
	const projectSettingsPath = path.join(projectDir, "pi.settings.json");
	writeFileSync(projectSettingsPath, JSON.stringify({
		capabilityVisibility: {
			"example-ext": {
				tools: {
					example_tool: "agent-visible",
				},
			},
		},
	}));
	writeFileSync(globalSettingsPath, JSON.stringify({
		capabilityVisibility: {
			"example-ext": {
				tools: {
					example_tool: "agent-hidden",
				},
				commands: {
					"example-cmd": "disabled",
				},
			},
		},
	}));

	try {
		const result = loadCapabilityVisibilitySettings({
			cwd: projectDir,
			projectSettingsPath,
			globalSettingsPath,
		});

		assert.equal(
			result.settings.capabilityVisibility?.["example-ext"]?.tools?.example_tool,
			"agent-hidden",
		);
		assert.equal(
			result.settings.capabilityVisibility?.["example-ext"]?.commands?.["example-cmd"],
			"disabled",
		);
		assert.deepEqual(result.warnings, []);
	} finally {
		rmSync(workspaceDir, { recursive: true, force: true });
	}
});

test("invalid tool value warning", () => {
	const result = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				tools: {
					hammer: "visible-to-all",
				},
			},
		},
	});

	assert.equal(result.settings.capabilityVisibility?.toolshed?.tools?.hammer, undefined);
	assert.deepEqual(warningCodes(result.warnings), ["invalid-tool-visibility"]);
});

test("invalid command value warning", () => {
	const result = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				commands: {
					build: "sometimes",
				},
			},
		},
	});

	assert.equal(result.settings.capabilityVisibility?.toolshed?.commands?.build, undefined);
	assert.deepEqual(warningCodes(result.warnings), ["invalid-command-visibility"]);
});

test("unknown configured tool and command names warn only", () => {
	const parsed = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				tools: {
					unknownTool: "agent-hidden",
				},
				commands: {
					unknownCommand: "disabled",
				},
			},
		},
	});

	const result = resolveExtensionCapabilityVisibility({
		extensionId: "toolshed",
		managed: true,
		settings: parsed.settings,
		tools: {
			knownTool: { defaultVisibility: "agent-visible" },
		},
		commands: ["knownCommand"],
	});

	assert.equal(result.tools.knownTool, "agent-visible");
	assert.equal(result.commands.knownCommand, "enabled");
	assert.deepEqual(warningCodes(result.warnings), ["unknown-tool", "unknown-command"]);
});

test("managed missing default fallback", () => {
	const result = resolveToolVisibility({
		extensionId: "toolshed",
		toolName: "hammer",
		managed: true,
	});

	assert.equal(result.visibility, "agent-visible");
	assert.deepEqual(warningCodes(result.warnings), ["missing-managed-default-visibility"]);
});

test("unmanaged missing default behavior", () => {
	const result = resolveToolVisibility({
		extensionId: "toolshed",
		toolName: "hammer",
		managed: false,
	});

	assert.equal(result.visibility, "agent-visible");
	assert.deepEqual(result.warnings, []);
});

test("unsafe override rejection", () => {
	const parsed = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				tools: {
					hammer: "agent-visible",
				},
			},
		},
	});

	const result = resolveToolVisibility({
		extensionId: "toolshed",
		toolName: "hammer",
		managed: true,
		defaultVisibility: "agent-hidden",
		configuredOverride: parsed.settings.capabilityVisibility?.toolshed?.tools?.hammer,
	});

	assert.equal(result.visibility, "agent-hidden");
	assert.deepEqual(warningCodes(result.warnings), ["unsafe-override-rejected"]);
});

test("explicit unsafe override acceptance", () => {
	const parsed = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				tools: {
					hammer: {
						visibility: "agent-visible",
						allowUnsafeOverride: true,
					},
				},
			},
		},
	});

	const result = resolveToolVisibility({
		extensionId: "toolshed",
		toolName: "hammer",
		managed: true,
		defaultVisibility: "agent-hidden",
		configuredOverride: parsed.settings.capabilityVisibility?.toolshed?.tools?.hammer,
	});

	assert.equal(result.visibility, "agent-visible");
	assert.deepEqual(result.warnings, []);
});

test("invalid unsafe override warns and keeps hidden", () => {
	const parsed = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			toolshed: {
				tools: {
					hammer: {
						visibility: "agent-visible",
						allowUnsafeOverride: "yes",
					},
				},
			},
		},
	});

	assert.deepEqual(warningCodes(parsed.warnings), ["invalid-unsafe-override"]);

	const result = resolveToolVisibility({
		extensionId: "toolshed",
		toolName: "hammer",
		managed: true,
		defaultVisibility: "agent-hidden",
		configuredOverride: parsed.settings.capabilityVisibility?.toolshed?.tools?.hammer,
	});

	assert.equal(result.visibility, "agent-hidden");
	assert.deepEqual(warningCodes(result.warnings), ["unsafe-override-rejected"]);
});

// ── Package-default wiring tests (issue 02) ──────────────────────────────────


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("package.json points to pi.settings.json", () => {
	const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
	assert.equal(pkg.pi?.settings, "./pi.settings.json");
});

test("pi.settings.json is valid capability visibility JSON", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const result = parseCapabilityVisibilitySettings(raw);
	assert.equal(
		result.warnings.length,
		0,
		`unexpected parse warnings: ${JSON.stringify(result.warnings)}`,
	);
});

test("frontend-coach browser_eval package default is agent-hidden", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	assert.equal(
		settings.capabilityVisibility?.["frontend-coach"]?.tools?.browser_eval,
		"agent-hidden",
	);
});

test("no Pi built-in tool defaults in pi.settings.json", () => {
	const builtins = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	for (const [extId, ext] of Object.entries(settings.capabilityVisibility ?? {})) {
		for (const toolName of Object.keys(ext?.tools ?? {})) {
			assert.ok(
				!builtins.has(toolName),
				`built-in tool "${toolName}" found under extension "${extId}" in pi.settings.json`,
			);
		}
	}
});

// ── Managed extension registration helper tests (issue 03) ─────────────────

function createFakePi(): ManagedExtensionPiApi & {
	tools: Map<string, unknown>;
	commands: Map<string, unknown>;
	emit(event: string): void;
} {
	const tools = new Map<string, unknown>();
	const commands = new Map<string, unknown>();
	let activeTools: string[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => void>>();

	return {
		tools,
		commands,
		registerTool(tool: unknown) {
			const t = tool as { name: string };
			tools.set(t.name, tool);
			if (!activeTools.includes(t.name)) activeTools = [...activeTools, t.name];
		},
		registerCommand(name: string, options: unknown) {
			commands.set(name, options);
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		on(event: string, handler: (...args: unknown[]) => void) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		emit(event: string) {
			for (const handler of handlers.get(event) ?? []) handler();
		},
	};
}

test("managed disabled command is not registered", () => {
	const pi = createFakePi();
	const managed = createManagedExtension(pi, {
		id: "cv-test-disabled-cmd",
		visibility: {
			capabilityVisibility: {
				"cv-test-disabled-cmd": { commands: { "launch-edge": "disabled" } },
			},
		},
	});
	managed.registerCommand("launch-edge", { handler: async () => {} });
	assert.equal(pi.commands.has("launch-edge"), false, "disabled command must not reach pi.registerCommand");
});

test("managed unlisted command is registered by default", () => {
	const pi = createFakePi();
	const managed = createManagedExtension(pi, { id: "cv-test-unlisted-cmd" });
	managed.registerCommand("coach-status", { handler: async () => {} });
	assert.ok(pi.commands.has("coach-status"), "unlisted command must be registered as enabled");
});

test("duplicate managed extension ID throws", () => {
	const pi = createFakePi();
	createManagedExtension(pi, { id: "cv-test-dup" });
	assert.throws(
		() => createManagedExtension(pi, { id: "cv-test-dup" }),
		/duplicate/i,
		"second registration of the same ID must throw",
	);
});

test("managed agent-hidden tool is excluded from active tools", () => {
	const pi = createFakePi();
	const managed = createManagedExtension(pi, { id: "cv-test-hidden-tool" });
	managed.registerTool({
		name: "secret_tool",
		defaultVisibility: "agent-hidden",
		label: "Secret",
		description: "runs in shadow",
		parameters: {},
		execute: async () => ({ type: "text", text: "noop" }),
	});
	pi.emit("session_start"); // deferred visibility is applied at session_start
	assert.ok(pi.tools.has("secret_tool"), "tool must still be registered (internal metadata preserved)");
	assert.equal(
		pi.getActiveTools().includes("secret_tool"),
		false,
		"agent-hidden tool must not appear in active tools",
	);
});

test("managed tool visibility override via settings overrides defaultVisibility", () => {
	const pi = createFakePi();
	const managed = createManagedExtension(pi, {
		id: "cv-test-override-path",
		visibility: {
			capabilityVisibility: {
				"cv-test-override-path": { tools: { spy_tool: "agent-hidden" } },
			},
		},
	});
	managed.registerTool({
		name: "spy_tool",
		defaultVisibility: "agent-visible",
		label: "Spy",
		description: "default visible but settings override to hidden",
		parameters: {},
		execute: async () => ({ type: "text", text: "noop" }),
	});
	pi.emit("session_start"); // deferred visibility is applied at session_start
	assert.ok(pi.tools.has("spy_tool"), "tool is registered");
	assert.equal(
		pi.getActiveTools().includes("spy_tool"),
		false,
		"settings override to agent-hidden must exclude tool from active tools",
	);
});

test("direct pi registration is unaffected by managed helper", () => {
	const pi = createFakePi();
	pi.registerTool({ name: "direct_tool", label: "Direct", description: "ok", parameters: {}, execute: async () => {} });
	pi.registerCommand("direct-cmd", { handler: async () => {} });
	assert.ok(pi.tools.has("direct_tool"), "direct tool registration must succeed without managed wrapper");
	assert.ok(pi.commands.has("direct-cmd"), "direct command registration must succeed without managed wrapper");
});

// ── Frontend-coach tracer migration tests (issue 04) ─────────────────────────

test("frontend-coach piExtension.id is 'frontend-coach'", () => {
	assert.equal(piExtension.id, "frontend-coach");
});

test("frontend-coach browser_eval resolves agent-hidden from package defaults", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	const result = resolveToolVisibility({
		extensionId: "frontend-coach",
		toolName: "browser_eval",
		managed: true,
		defaultVisibility: "agent-hidden",
		configuredOverride: settings.capabilityVisibility?.["frontend-coach"]?.tools?.browser_eval,
	});
	assert.equal(result.visibility, "agent-hidden");
	assert.deepEqual(result.warnings, []);
});

test("frontend-coach browser_record_test resolves agent-visible from package defaults", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	const result = resolveToolVisibility({
		extensionId: "frontend-coach",
		toolName: "browser_record_test",
		managed: true,
		defaultVisibility: "agent-visible",
		configuredOverride: settings.capabilityVisibility?.["frontend-coach"]?.tools?.browser_record_test,
	});
	assert.equal(result.visibility, "agent-visible");
	assert.deepEqual(result.warnings, []);
});

test("frontend-coach coach-launch-edge command is enabled by default", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	assert.equal(
		settings.capabilityVisibility?.["frontend-coach"]?.commands?.["coach-launch-edge"],
		"enabled",
	);
});

test("frontend-coach unsafe override attempt for browser_eval without allowUnsafeOverride warns and keeps hidden", () => {
	const parsed = parseCapabilityVisibilitySettings({
		capabilityVisibility: {
			"frontend-coach": {
				tools: { browser_eval: "agent-visible" },
			},
		},
	});
	const result = resolveToolVisibility({
		extensionId: "frontend-coach",
		toolName: "browser_eval",
		managed: true,
		defaultVisibility: "agent-hidden",
		configuredOverride: parsed.settings.capabilityVisibility?.["frontend-coach"]?.tools?.browser_eval,
	});
	assert.equal(result.visibility, "agent-hidden");
	assert.deepEqual(warningCodes(result.warnings), ["unsafe-override-rejected"]);
});

// ── Issue 05: remaining active extensions migration tests ─────────────────

test("all remaining active extensions have stable piExtension.id values", () => {
	assert.equal(subagentsExtension.id, "subagents");
	assert.equal(lavishAxiExtension.id, "lavish-axi");
	assert.equal(engineeringSkillsExtension.id, "engineering-skills");
	assert.equal(usageFooterExtension.id, "usage-footer");
	assert.equal(herdrAgentReportExtension.id, "herdr-agent-report");
	assert.equal(toolPanelExtension.id, "tool-panel");
});




test("subagent resolves agent-visible from package defaults", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	const result = resolveToolVisibility({
		extensionId: "subagents",
		toolName: "subagent",
		managed: true,
		defaultVisibility: "agent-visible",
		configuredOverride: settings.capabilityVisibility?.["subagents"]?.tools?.subagent,
	});
	assert.equal(result.visibility, "agent-visible");
	assert.deepEqual(result.warnings, []);
});

test("lavish command is enabled by default in package defaults", () => {
	const raw = JSON.parse(readFileSync(path.join(repoRoot, "pi.settings.json"), "utf8"));
	const { settings } = parseCapabilityVisibilitySettings(raw);
	assert.equal(
		settings.capabilityVisibility?.["lavish-axi"]?.commands?.lavish,
		"enabled",
	);
});


