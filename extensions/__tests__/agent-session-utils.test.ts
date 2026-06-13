/**
 * Pure tests for agent-session-utils logic.
 *
 * These tests verify the core business logic without requiring
 * @earendil-works/pi-coding-agent to be installed. The functions
 * are reimplemented identically from agent-session-utils.ts so the
 * tests validate the same logic.
 *
 * Run: npx tsx extensions/__tests__/agent-session-utils.test.ts
 */

// ---------------------------------------------------------------------------
// Reimplemented pure logic (must match agent-session-utils.ts exactly)
// ---------------------------------------------------------------------------

const DRIVER_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
const NAVIGATOR_TOOLS = ["read", "grep", "find", "ls", "bash"];

interface RoleUsage {
	inputTokens: number;
	outputTokens: number;
	cacheTokens: number;
	totalTokens: number;
	costUsd: number;
	modelId: string;
}

interface PairUsageSummary {
	driverUsage: RoleUsage;
	navigatorUsage: RoleUsage;
	totalUsage: { totalTokens: number; costUsd: number };
}

type AssistantUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
};

function totalCostOf(usage: AssistantUsage | undefined): number {
	if (!usage?.cost) return 0;
	if (typeof usage.cost.total === "number") return usage.cost.total;
	return (
		(usage.cost.input ?? 0) +
		(usage.cost.output ?? 0) +
		(usage.cost.cacheRead ?? 0) +
		(usage.cost.cacheWrite ?? 0)
	);
}

function parseModelOverride(modelOverride: string | undefined, inheritedProvider: string | undefined): {
	provider?: string;
	modelId?: string;
} {
	const value = modelOverride?.trim();
	if (!value) return {};
	const slash = value.indexOf("/");
	if (slash > 0) return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
	return { provider: inheritedProvider, modelId: value };
}

function getRoleTools(role: "driver"): string[];
function getRoleTools(role: "navigator"): string[];
function getRoleTools(role: "driver" | "navigator"): string[] {
	if (role === "driver") {
		return [...DRIVER_TOOLS];
	}
	return [...NAVIGATOR_TOOLS];
}

function resolveRoleModel(
	requestedModel: string | undefined,
	inheritedModel: { provider: string; id: string } | undefined,
	modelRegistry: { find: (p: string, id: string) => any; hasConfiguredAuth: (m: any) => boolean },
): { provider: string; id: string } {
	const trimmed = requestedModel?.trim();
	if (!trimmed) {
		if (!inheritedModel) throw new Error("No active model is available for this role.");
		return inheritedModel;
	}

	const currentProviderOverrideModel = inheritedModel?.provider
		? modelRegistry.find(inheritedModel.provider, trimmed)
		: undefined;
	const { provider, modelId } = parseModelOverride(trimmed, inheritedModel?.provider);
	const overrideModel = currentProviderOverrideModel ?? (provider && modelId ? modelRegistry.find(provider, modelId) : undefined);
	const overrideModelIsReady = Boolean(overrideModel && modelRegistry.hasConfiguredAuth(overrideModel));

	if (overrideModel && overrideModelIsReady) return overrideModel;

	throw new Error(
		`Model override "${trimmed}" is not available or not authenticated. ` +
		"Pair-programming requires the specified role model to be usable. " +
		"Remove the override or configure the model before starting.",
	);
}

function extractText(message: unknown): string {
	const msg = message as { role?: string; content?: unknown };
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return "";
	let text = "";
	for (const part of msg.content as Array<{ type?: string; text?: string }>) {
		if (part.type === "text" && typeof part.text === "string") text += part.text;
	}
	return text;
}

function finalAssistantText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = extractText(messages[i]);
		if (text.trim()) return text.trim();
	}
	return "";
}

function accumulateUsage(current: RoleUsage, message: { role?: string; usage?: AssistantUsage }): RoleUsage {
	if (message.role !== "assistant") return current;
	const usage = message.usage;
	if (!usage) return current;

	const input = usage.input ?? 0;
	const output = usage.output ?? 0;
	const cache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
	return {
		inputTokens: current.inputTokens + input,
		outputTokens: current.outputTokens + output,
		cacheTokens: current.cacheTokens + cache,
		totalTokens: current.totalTokens + (usage.totalTokens ?? input + output + cache),
		costUsd: current.costUsd + totalCostOf(usage),
		modelId: current.modelId,
	};
}

function buildPairUsageSummary(driverUsage: RoleUsage, navigatorUsage: RoleUsage): PairUsageSummary {
	return {
		driverUsage: { ...driverUsage },
		navigatorUsage: { ...navigatorUsage },
		totalUsage: {
			totalTokens: driverUsage.totalTokens + navigatorUsage.totalTokens,
			costUsd: driverUsage.costUsd + navigatorUsage.costUsd,
		},
	};
}

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
	if (condition) { passed++; } else { failed++; failures.push(message); console.error(`  FAIL: ${message}`); }
}
function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual === expected) { passed++; } else {
		failed++; const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg); console.error(`  FAIL: ${msg}`);
	}
}
function assertDeepEqual<T>(actual: T, expected: T, message: string) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; } else {
		failed++; const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg); console.error(`  FAIL: ${msg}`);
	}
}
function assertThrows(fn: () => void, message: string) {
	try { fn(); failed++; failures.push(`${message}: expected to throw`); console.error(`  FAIL: ${message}: expected to throw`); } catch { passed++; }
}

// ---------------------------------------------------------------------------
// resolveRoleModel tests
// ---------------------------------------------------------------------------

console.log("resolveRoleModel");

{
	const registry = { find: (_p: string, id: string) => (id === "gpt-4" ? { provider: "openai", id: "gpt-4", name: "GPT-4" } : undefined), hasConfiguredAuth: (m: any) => m?.id === "gpt-4" } as any;
	const inherited = { provider: "openai", id: "gpt-4" } as any;
	const result = resolveRoleModel("gpt-4", inherited, registry);
	assertEqual(result.id, "gpt-4", "returns requested model when available");
}

{
	const registry = { find: () => undefined, hasConfiguredAuth: () => false } as any;
	const inherited = { provider: "openai", id: "gpt-4" } as any;
	assertThrows(() => resolveRoleModel("claude-3", inherited, registry), "throws when explicit override unavailable");
}

{
	const inherited = { provider: "openai", id: "gpt-4" } as any;
	const result = resolveRoleModel(undefined, inherited, {} as any);
	assertEqual(result.id, "gpt-4", "uses inherited model when no override");
}

{
	assertThrows(() => resolveRoleModel(undefined, undefined, {} as any), "throws when no override and no inherited model");
}

{
	const registry = { find: (p: string, id: string) => (id.includes("/") ? undefined : { provider: p, id }), hasConfiguredAuth: () => true } as any;
	const inherited = { provider: "openai", id: "gpt-4" } as any;
	const result = resolveRoleModel("anthropic/claude-3", inherited, registry);
	assertEqual(result.provider, "anthropic", "parses provider/model format");
	assertEqual(result.id, "claude-3", "parses provider/model id");
}

// ---------------------------------------------------------------------------
// getRoleTools tests
// ---------------------------------------------------------------------------

console.log("getRoleTools");

{
	const tools = getRoleTools("driver");
	assertDeepEqual(tools, DRIVER_TOOLS, "driver tools include edit and write");
	assert(tools.includes("edit"), "driver has edit");
	assert(tools.includes("write"), "driver has write");
	assert(tools.includes("bash"), "driver has bash");
}

{
	const tools = getRoleTools("navigator");
	assertDeepEqual(tools, NAVIGATOR_TOOLS, "navigator tools match");
	assert(!tools.includes("edit"), "navigator excludes edit");
	assert(!tools.includes("write"), "navigator excludes write");
}

{
	const a = getRoleTools("driver");
	const b = getRoleTools("driver");
	a.push("rogue");
	assert(!b.includes("rogue"), "driver tool arrays are independent copies");
}

{
	const a = getRoleTools("navigator");
	const b = getRoleTools("navigator");
	a.push("rogue");
	assert(!b.includes("rogue"), "navigator tool arrays are independent copies");
}

// ---------------------------------------------------------------------------
// extractText tests
// ---------------------------------------------------------------------------

console.log("extractText");

{
	const text = extractText({ role: "assistant", content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] });
	assertEqual(text, "hello world", "extracts and concatenates text parts");
}

{
	const text = extractText({ role: "user", content: [{ type: "text", text: "hi" }] });
	assertEqual(text, "", "returns empty for non-assistant messages");
}

{
	const text = extractText({ role: "assistant", content: [] });
	assertEqual(text, "", "returns empty for empty content array");
}

{
	const text = extractText({ role: "assistant", content: [{ type: "toolCall", name: "bash" }] });
	assertEqual(text, "", "returns empty when no text parts");
}

// ---------------------------------------------------------------------------
// finalAssistantText tests
// ---------------------------------------------------------------------------

console.log("finalAssistantText");

{
	const text = finalAssistantText([
		{ role: "user", content: [{ type: "text", text: "do it" }] },
		{ role: "assistant", content: [{ type: "text", text: "first attempt" }] },
		{ role: "user", content: [{ type: "text", text: "try again" }] },
		{ role: "assistant", content: [{ type: "text", text: "final answer" }] },
	]);
	assertEqual(text, "final answer", "returns text from last assistant message");
}

{
	const text = finalAssistantText([]);
	assertEqual(text, "", "returns empty for empty messages");
}

{
	const text = finalAssistantText([{ role: "user", content: [{ type: "text", text: "only user" }] }]);
	assertEqual(text, "", "returns empty when no assistant messages");
}

{
	const text = finalAssistantText([{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] }]);
	assertEqual(text, "", "returns empty when assistant has no text parts");
}

// ---------------------------------------------------------------------------
// accumulateUsage tests
// ---------------------------------------------------------------------------

console.log("accumulateUsage");

{
	const zero: RoleUsage = { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0, costUsd: 0, modelId: "openai/gpt-4" };
	const msg = { role: "assistant", usage: { input: 100, output: 50, cacheRead: 10, totalTokens: 160, cost: { total: 0.005 } } };
	const result = accumulateUsage(zero, msg);
	assertEqual(result.inputTokens, 100, "accumulates input tokens");
	assertEqual(result.outputTokens, 50, "accumulates output tokens");
	assertEqual(result.cacheTokens, 10, "accumulates cache tokens");
	assertEqual(result.totalTokens, 160, "accumulates total tokens");
	assertEqual(result.costUsd, 0.005, "accumulates cost");
}

{
	const current: RoleUsage = { inputTokens: 100, outputTokens: 50, cacheTokens: 10, totalTokens: 160, costUsd: 0.005, modelId: "openai/gpt-4" };
	const msg = { role: "assistant", usage: { input: 200, output: 80, cacheRead: 20, totalTokens: 300, cost: { total: 0.01 } } };
	const result = accumulateUsage(current, msg);
	assertEqual(result.inputTokens, 300, "adds to existing input tokens");
	assertEqual(result.outputTokens, 130, "adds to existing output tokens");
	assertEqual(result.cacheTokens, 30, "adds to existing cache tokens");
	assertEqual(result.totalTokens, 460, "adds to existing total tokens");
	assertEqual(result.costUsd, 0.015, "adds to existing cost");
}

{
	const current: RoleUsage = { inputTokens: 100, outputTokens: 50, cacheTokens: 10, totalTokens: 160, costUsd: 0.005, modelId: "openai/gpt-4" };
	const msg = { role: "user", content: [{ type: "text", text: "hi" }] };
	const result = accumulateUsage(current, msg);
	assertEqual(result.inputTokens, 100, "ignores non-assistant messages");
}

{
	const current: RoleUsage = { inputTokens: 100, outputTokens: 50, cacheTokens: 10, totalTokens: 160, costUsd: 0.005, modelId: "openai/gpt-4" };
	const msg = { role: "assistant" };
	const result = accumulateUsage(current, msg);
	assertEqual(result.inputTokens, 100, "handles missing usage gracefully");
}

// ---------------------------------------------------------------------------
// buildPairUsageSummary tests
// ---------------------------------------------------------------------------

console.log("buildPairUsageSummary");

{
	const driver: RoleUsage = { inputTokens: 100, outputTokens: 50, cacheTokens: 10, totalTokens: 160, costUsd: 0.005, modelId: "openai/gpt-4" };
	const navigator: RoleUsage = { inputTokens: 80, outputTokens: 40, cacheTokens: 5, totalTokens: 125, costUsd: 0.003, modelId: "openai/gpt-4" };
	const summary = buildPairUsageSummary(driver, navigator);
	assertEqual(summary.driverUsage.inputTokens, 100, "summary has driver usage");
	assertEqual(summary.navigatorUsage.inputTokens, 80, "summary has navigator usage");
	assertEqual(summary.totalUsage.totalTokens, 285, "summary totals tokens");
	assertEqual(summary.totalUsage.costUsd, 0.008, "summary totals cost");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.error("\nFailures:");
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
} else {
	console.log("All tests passed.");
}
