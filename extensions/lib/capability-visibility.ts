import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type ToolVisibility = "agent-visible" | "agent-hidden";
export type CommandVisibility = "enabled" | "disabled";

export type ToolVisibilityOverride =
	| ToolVisibility
	| {
			visibility: ToolVisibility;
			allowUnsafeOverride?: boolean;
		};

export interface CapabilityVisibilityExtensionSettings {
	tools?: Record<string, ToolVisibilityOverride>;
	commands?: Record<string, CommandVisibility>;
}

export interface CapabilityVisibilitySettings {
	capabilityVisibility?: Record<string, CapabilityVisibilityExtensionSettings>;
}

export type CapabilityVisibilityWarningCode =
	| "invalid-json"
	| "invalid-capability-visibility"
	| "invalid-tool-visibility"
	| "invalid-command-visibility"
	| "invalid-unsafe-override"
	| "unknown-tool"
	| "unknown-command"
	| "missing-managed-default-visibility"
	| "unsafe-override-rejected";

export interface CapabilityVisibilityWarning {
	code: CapabilityVisibilityWarningCode;
	message: string;
	source?: string;
	extensionId?: string;
	capabilityName?: string;
	capabilityType?: "tool" | "command";
}

export interface ParseCapabilityVisibilitySettingsResult {
	settings: CapabilityVisibilitySettings;
	warnings: CapabilityVisibilityWarning[];
}

export interface ResolveToolVisibilityParams {
	extensionId: string;
	toolName: string;
	configuredOverride?: ToolVisibilityOverride;
	defaultVisibility?: ToolVisibility;
	managed: boolean;
}

export interface ResolveToolVisibilityResult {
	visibility: ToolVisibility;
	warnings: CapabilityVisibilityWarning[];
}

export interface ExtensionToolMetadata {
	defaultVisibility?: ToolVisibility;
}

export interface ResolveExtensionCapabilityVisibilityParams {
	extensionId: string;
	managed: boolean;
	settings?: CapabilityVisibilitySettings;
	tools?: Record<string, ExtensionToolMetadata>;
	commands?: readonly string[];
}

export interface ResolveExtensionCapabilityVisibilityResult {
	tools: Record<string, ToolVisibility>;
	commands: Record<string, CommandVisibility>;
	warnings: CapabilityVisibilityWarning[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolVisibility(value: unknown): value is ToolVisibility {
	return value === "agent-visible" || value === "agent-hidden";
}

function isCommandVisibility(value: unknown): value is CommandVisibility {
	return value === "enabled" || value === "disabled";
}

function buildWarning(
	code: CapabilityVisibilityWarningCode,
	message: string,
	extra: Omit<CapabilityVisibilityWarning, "code" | "message"> = {},
): CapabilityVisibilityWarning {
	return { code, message, ...extra };
}

function parseToolVisibilityOverride(
	rawValue: unknown,
	source: string,
	extensionId: string,
	toolName: string,
): { override?: ToolVisibilityOverride; warnings: CapabilityVisibilityWarning[] } {
	if (isToolVisibility(rawValue)) {
		return { override: rawValue, warnings: [] };
	}

	if (!isRecord(rawValue)) {
		return {
			warnings: [buildWarning(
				"invalid-tool-visibility",
				`Ignoring invalid tool visibility for ${extensionId}.${toolName}. Expected \"agent-visible\", \"agent-hidden\", or an object override.`,
				{ source, extensionId, capabilityName: toolName, capabilityType: "tool" },
			)],
		};
	}

	const visibilityRaw = rawValue.visibility;
	if (!isToolVisibility(visibilityRaw)) {
		return {
			warnings: [buildWarning(
				"invalid-tool-visibility",
				`Ignoring invalid tool visibility for ${extensionId}.${toolName}. Object overrides must include a valid visibility value.`,
				{ source, extensionId, capabilityName: toolName, capabilityType: "tool" },
			)],
		};
	}

	const override: { visibility: ToolVisibility; allowUnsafeOverride?: boolean } = {
		visibility: visibilityRaw,
	};
	const warnings: CapabilityVisibilityWarning[] = [];
	if (rawValue.allowUnsafeOverride !== undefined) {
		if (typeof rawValue.allowUnsafeOverride === "boolean") {
			override.allowUnsafeOverride = rawValue.allowUnsafeOverride;
		} else {
			warnings.push(buildWarning(
				"invalid-unsafe-override",
				`Ignoring invalid unsafe override for ${extensionId}.${toolName}. allowUnsafeOverride must be true or false.`,
				{ source, extensionId, capabilityName: toolName, capabilityType: "tool" },
			));
		}
	}

	return { override, warnings };
}

export function parseCapabilityVisibilityJson(
	jsonText: string,
	source = "settings",
): ParseCapabilityVisibilitySettingsResult {
	try {
		const parsed = JSON.parse(jsonText);
		return parseCapabilityVisibilitySettings(parsed, source);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			settings: {},
			warnings: [buildWarning("invalid-json", `Ignoring invalid JSON in ${source}. ${message}`, { source })],
		};
	}
}

export function parseCapabilityVisibilitySettings(
	input: unknown,
	source = "settings",
): ParseCapabilityVisibilitySettingsResult {
	if (input === undefined) return { settings: {}, warnings: [] };
	if (!isRecord(input)) {
		return {
			settings: {},
			warnings: [buildWarning(
				"invalid-capability-visibility",
				`Ignoring capabilityVisibility in ${source}. Expected a top-level JSON object.`,
				{ source },
			)],
		};
	}

	const rawCapabilityVisibility = input.capabilityVisibility;
	if (rawCapabilityVisibility === undefined) return { settings: {}, warnings: [] };
	if (!isRecord(rawCapabilityVisibility)) {
		return {
			settings: {},
			warnings: [buildWarning(
				"invalid-capability-visibility",
				`Ignoring capabilityVisibility in ${source}. Expected an object keyed by extension id.`,
				{ source },
			)],
		};
	}

	const capabilityVisibility: Record<string, CapabilityVisibilityExtensionSettings> = {};
	const warnings: CapabilityVisibilityWarning[] = [];

	for (const [extensionId, rawExtensionSettings] of Object.entries(rawCapabilityVisibility)) {
		if (!isRecord(rawExtensionSettings)) {
			warnings.push(buildWarning(
				"invalid-capability-visibility",
				`Ignoring capabilityVisibility entry for ${extensionId}. Expected an object containing tools and commands.`,
				{ source, extensionId },
			));
			continue;
		}

		const nextSettings: CapabilityVisibilityExtensionSettings = {};

		if (rawExtensionSettings.tools !== undefined) {
			if (!isRecord(rawExtensionSettings.tools)) {
				warnings.push(buildWarning(
					"invalid-capability-visibility",
					`Ignoring tools block for ${extensionId}. Expected an object keyed by tool name.`,
					{ source, extensionId },
				));
			} else {
				const parsedTools: Record<string, ToolVisibilityOverride> = {};
				for (const [toolName, rawToolValue] of Object.entries(rawExtensionSettings.tools)) {
					const parsed = parseToolVisibilityOverride(rawToolValue, source, extensionId, toolName);
					warnings.push(...parsed.warnings);
					if (parsed.override !== undefined) parsedTools[toolName] = parsed.override;
				}
				if (Object.keys(parsedTools).length > 0) nextSettings.tools = parsedTools;
			}
		}

		if (rawExtensionSettings.commands !== undefined) {
			if (!isRecord(rawExtensionSettings.commands)) {
				warnings.push(buildWarning(
					"invalid-capability-visibility",
					`Ignoring commands block for ${extensionId}. Expected an object keyed by command name.`,
					{ source, extensionId },
				));
			} else {
				const parsedCommands: Record<string, CommandVisibility> = {};
				for (const [commandName, rawCommandValue] of Object.entries(rawExtensionSettings.commands)) {
					if (!isCommandVisibility(rawCommandValue)) {
						warnings.push(buildWarning(
							"invalid-command-visibility",
							`Ignoring invalid command visibility for ${extensionId}.${commandName}. Expected \"enabled\" or \"disabled\".`,
							{ source, extensionId, capabilityName: commandName, capabilityType: "command" },
						));
						continue;
					}
					parsedCommands[commandName] = rawCommandValue;
				}
				if (Object.keys(parsedCommands).length > 0) nextSettings.commands = parsedCommands;
			}
		}

		if (nextSettings.tools || nextSettings.commands) capabilityVisibility[extensionId] = nextSettings;
	}

	return Object.keys(capabilityVisibility).length > 0
		? { settings: { capabilityVisibility }, warnings }
		: { settings: {}, warnings };
}

export function mergeCapabilityVisibility(
	...sources: ReadonlyArray<CapabilityVisibilitySettings | undefined>
): CapabilityVisibilitySettings {
	const merged: Record<string, CapabilityVisibilityExtensionSettings> = {};

	for (const source of sources) {
		const entries = source?.capabilityVisibility;
		if (!entries) continue;

		for (const [extensionId, extensionSettings] of Object.entries(entries)) {
			const current = merged[extensionId] ?? {};
			const nextSettings: CapabilityVisibilityExtensionSettings = {};
			const nextTools = extensionSettings.tools
				? { ...(current.tools ?? {}), ...extensionSettings.tools }
				: current.tools;
			const nextCommands = extensionSettings.commands
				? { ...(current.commands ?? {}), ...extensionSettings.commands }
				: current.commands;
			if (nextTools) nextSettings.tools = nextTools;
			if (nextCommands) nextSettings.commands = nextCommands;
			merged[extensionId] = nextSettings;
		}
	}

	return Object.keys(merged).length > 0 ? { capabilityVisibility: merged } : {};
}

function normalizeToolVisibilityOverride(override: ToolVisibilityOverride): {
	visibility: ToolVisibility;
	allowUnsafeOverride?: boolean;
} {
	if (typeof override === "string") return { visibility: override };
	return override;
}

export interface LoadCapabilityVisibilitySettingsOptions {
	cwd?: string;
	projectSettingsPath?: string;
	globalSettingsPath?: string;
}

export function loadCapabilityVisibilitySettings(
	options: LoadCapabilityVisibilitySettingsOptions = {},
): ParseCapabilityVisibilitySettingsResult {
	const cwd = options.cwd ?? process.cwd();
	const projectSettingsPath = options.projectSettingsPath ?? path.resolve(cwd, "pi.settings.json");
	const globalSettingsPath = options.globalSettingsPath ?? path.join(homedir(), ".pi", "agent", "pi.settings.json");
	const warnings: CapabilityVisibilityWarning[] = [];
	const settingsBySource: CapabilityVisibilitySettings[] = [];
	const seenPaths = new Set<string>();

	for (const settingsPath of [projectSettingsPath, globalSettingsPath]) {
		const resolvedPath = path.resolve(settingsPath);
		if (seenPaths.has(resolvedPath) || !existsSync(resolvedPath)) continue;
		seenPaths.add(resolvedPath);
		const parsed = parseCapabilityVisibilityJson(readFileSync(resolvedPath, "utf8"), resolvedPath);
		warnings.push(...parsed.warnings);
		settingsBySource.push(parsed.settings);
	}

	return {
		settings: mergeCapabilityVisibility(...settingsBySource),
		warnings,
	};
}

export function resolveToolVisibility(params: ResolveToolVisibilityParams): ResolveToolVisibilityResult {
	if (params.configuredOverride !== undefined) {
		const override = normalizeToolVisibilityOverride(params.configuredOverride);
		if (
			params.defaultVisibility === "agent-hidden" &&
			override.visibility === "agent-visible" &&
			override.allowUnsafeOverride !== true
		) {
			return {
				visibility: "agent-hidden",
				warnings: [buildWarning(
					"unsafe-override-rejected",
					`Keeping ${params.extensionId}.${params.toolName} hidden. agent-hidden defaults require allowUnsafeOverride: true before becoming agent-visible.`,
					{ extensionId: params.extensionId, capabilityName: params.toolName, capabilityType: "tool" },
				)],
			};
		}

		return { visibility: override.visibility, warnings: [] };
	}

	if (params.defaultVisibility !== undefined) {
		return { visibility: params.defaultVisibility, warnings: [] };
	}

	if (!params.managed) {
		return { visibility: "agent-visible", warnings: [] };
	}

	return {
		visibility: "agent-visible",
		warnings: [buildWarning(
			"missing-managed-default-visibility",
			`Managed tool ${params.extensionId}.${params.toolName} has no configured override and no defaultVisibility. Falling back to agent-visible.`,
			{ extensionId: params.extensionId, capabilityName: params.toolName, capabilityType: "tool" },
		)],
	};
}

// ── Managed extension registration helper ──────────────────────────────────

/**
 * Subset of ExtensionAPI required by createManagedExtension.
 * Structurally compatible with the real ExtensionAPI via TypeScript method bivariance.
 */
export interface ManagedExtensionPiApi {
	registerTool(tool: unknown): void;
	registerCommand(name: string, options: unknown): void;
	getActiveTools(): string[];
	setActiveTools(toolNames: string[]): void;
	/** Register a lifecycle event handler. Used internally to defer action-method calls past extension loading. */
	on(event: string, handler: (...args: any[]) => void): void;
}

export interface CreateManagedExtensionOptions {
	id: string;
	/** Merged capability visibility settings. If omitted, package defaults apply only. */
	visibility?: CapabilityVisibilitySettings;
}

const managedExtensionIdsByPi = new WeakMap<ManagedExtensionPiApi, Set<string>>();

export interface ManagedExtension {
	readonly id: string;
	/**
	 * Register a tool under the managed extension.
	 * Pass `defaultVisibility` alongside normal ToolDefinition fields.
	 * agent-hidden tools are registered (internal metadata preserved) but removed from active tools.
	 */
	registerTool(options: { name: string; defaultVisibility?: ToolVisibility; [key: string]: unknown }): void;
	/**
	 * Register a command under the managed extension.
	 * Disabled commands (via visibility settings) are silently skipped.
	 */
	registerCommand(name: string, options: { [key: string]: unknown }): void;
}

export function createManagedExtension(
	pi: ManagedExtensionPiApi,
	options: CreateManagedExtensionOptions,
): ManagedExtension {
	const { id, visibility } = options;
	const managedExtensionIds = managedExtensionIdsByPi.get(pi) ?? new Set<string>();
	if (managedExtensionIds.has(id)) {
		throw new Error(`Duplicate managed extension ID "${id}".`);
	}
	managedExtensionIds.add(id);
	managedExtensionIdsByPi.set(pi, managedExtensionIds);

	// Collect agent-hidden tool names during loading and apply them after loading
	// completes. pi forbids getActiveTools/setActiveTools during extension loading.
	const hiddenTools = new Set<string>();
	pi.on("session_start", () => {
		if (hiddenTools.size === 0) return;
		pi.setActiveTools(pi.getActiveTools().filter((n) => !hiddenTools.has(n)));
	});

	return {
		id,

		registerTool(toolOptions) {
			const toolName = toolOptions.name;
			const { defaultVisibility, ...toolDef } = toolOptions;

			const resolved = resolveToolVisibility({
				extensionId: id,
				toolName,
				configuredOverride: visibility?.capabilityVisibility?.[id]?.tools?.[toolName],
				defaultVisibility,
				managed: true,
			});

			for (const warning of resolved.warnings) {
				console.warn(`[capability-visibility] ${warning.message}`);
			}

			pi.registerTool(toolDef);

			if (resolved.visibility === "agent-hidden") {
				hiddenTools.add(toolName);
			}
		},

		registerCommand(name, commandOptions) {
			const commandVisibility =
				visibility?.capabilityVisibility?.[id]?.commands?.[name] ?? "enabled";

			if (commandVisibility === "disabled") return;

			pi.registerCommand(name, commandOptions);
		},
	};
}

export function resolveExtensionCapabilityVisibility(
	params: ResolveExtensionCapabilityVisibilityParams,
): ResolveExtensionCapabilityVisibilityResult {
	const extensionSettings = params.settings?.capabilityVisibility?.[params.extensionId];
	const configuredTools = extensionSettings?.tools ?? {};
	const configuredCommands = extensionSettings?.commands ?? {};
	const tools: Record<string, ToolVisibility> = {};
	const commands: Record<string, CommandVisibility> = {};
	const warnings: CapabilityVisibilityWarning[] = [];

	const toolMetadata = params.tools ?? {};
	const commandNames = params.commands ?? [];
	const knownToolNames = new Set(Object.keys(toolMetadata));
	const knownCommandNames = new Set(commandNames);

	for (const toolName of Object.keys(configuredTools)) {
		if (knownToolNames.has(toolName)) continue;
		warnings.push(buildWarning(
			"unknown-tool",
			`Ignoring unknown configured tool ${params.extensionId}.${toolName}.`,
			{ extensionId: params.extensionId, capabilityName: toolName, capabilityType: "tool" },
		));
	}

	for (const commandName of Object.keys(configuredCommands)) {
		if (knownCommandNames.has(commandName)) continue;
		warnings.push(buildWarning(
			"unknown-command",
			`Ignoring unknown configured command ${params.extensionId}.${commandName}.`,
			{ extensionId: params.extensionId, capabilityName: commandName, capabilityType: "command" },
		));
	}

	for (const [toolName, metadata] of Object.entries(toolMetadata)) {
		const resolved = resolveToolVisibility({
			extensionId: params.extensionId,
			toolName,
			configuredOverride: configuredTools[toolName],
			defaultVisibility: metadata.defaultVisibility,
			managed: params.managed,
		});
		tools[toolName] = resolved.visibility;
		warnings.push(...resolved.warnings);
	}

	for (const commandName of commandNames) {
		commands[commandName] = configuredCommands[commandName] ?? "enabled";
	}

	return { tools, commands, warnings };
}
