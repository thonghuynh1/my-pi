import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mergeCapabilityVisibility,
	parseCapabilityVisibilitySettings,
	resolveExtensionCapabilityVisibility,
	resolveToolVisibility,
	type CapabilityVisibilityWarning,
} from "../lib/capability-visibility.ts";

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
