import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEFAULT_ROUTING_CONFIG,
	classifyGroups,
	resolveRoutingConfig,
	type RoutingGroup,
} from "../lib/routing-policy.ts";

function group(overrides: Partial<RoutingGroup> = {}): RoutingGroup {
	return {
		groupId: "group-1",
		claims: [{ id: "claim-1", summary: "claim", priority: "material" }],
		shape: { fileCount: 1, anchorCount: 1, subsystem: "test", crossFileFlow: false },
		confirmed: false,
		...overrides,
	};
}

test("adaptive route matrix", () => {
	assert.equal(classifyGroups([group({ shape: { ...group().shape, fileCount: 3, anchorCount: 6 } })], DEFAULT_ROUTING_CONFIG).kind, "direct");
	assert.equal(classifyGroups([group({ shape: { ...group().shape, fileCount: 4 } })], DEFAULT_ROUTING_CONFIG).kind, "single-child");
	assert.equal(classifyGroups([group({ shape: { ...group().shape, anchorCount: 7 } })], DEFAULT_ROUTING_CONFIG).kind, "single-child");
	assert.equal(classifyGroups([group({ shape: { ...group().shape, crossFileFlow: true } })], DEFAULT_ROUTING_CONFIG).kind, "single-child");

	const first = group({ groupId: "first", shape: { ...group().shape, fileCount: 4 }, independentWith: ["second"] });
	const second = group({ groupId: "second", shape: { ...group().shape, fileCount: 4 }, independentWith: ["first"] });
	assert.deepEqual(classifyGroups([first, second], DEFAULT_ROUTING_CONFIG), {
		kind: "parallel-child",
		groupIds: ["first", "second"],
	});
	const third = group({ groupId: "third", shape: { ...group().shape, fileCount: 4 }, independentWith: ["first", "second"] });
	assert.deepEqual(classifyGroups([first, second, third], DEFAULT_ROUTING_CONFIG), {
		kind: "parallel-child",
		groupIds: ["first", "second", "third"],
	});

	assert.equal(classifyGroups([group({ confirmed: true })], DEFAULT_ROUTING_CONFIG).kind, "skip");
	assert.equal(classifyGroups([], DEFAULT_ROUTING_CONFIG).kind, "unresolved-reporting");

	const relatedFirst = group({ groupId: "related-first", shape: { ...group().shape, fileCount: 4 } });
	const relatedSecond = group({ groupId: "related-second", shape: { ...group().shape, fileCount: 4 } });
	assert.equal(classifyGroups([relatedFirst, relatedSecond], DEFAULT_ROUTING_CONFIG).kind, "single-child");
});

test("configuration precedence and limit clamping", () => {
	const layered = resolveRoutingConfig({
		package: { directMaxFiles: 4, maxTurns: 16, maxToolCalls: 30, timeoutSeconds: 300 },
		user: { directMaxFiles: 5, maxTurns: 12 },
		project: { directMaxFiles: 6, maxToolCalls: 20 },
	});
	assert.deepEqual(layered, {
		directMaxFiles: 6,
		directMaxAnchors: 6,
		maxTurns: 12,
		maxToolCalls: 20,
		timeoutSeconds: 300,
	});

	assert.deepEqual(resolveRoutingConfig({}, { maxTurns: 8, maxToolCalls: 12, timeoutSeconds: 120 }), {
		...DEFAULT_ROUTING_CONFIG,
		maxTurns: 8,
		maxToolCalls: 12,
		timeoutSeconds: 120,
	});
	assert.deepEqual(resolveRoutingConfig({}, { maxTurns: 17, maxToolCalls: 31, timeoutSeconds: 301 }), DEFAULT_ROUTING_CONFIG);
	assert.equal(resolveRoutingConfig({ project: { directMaxFiles: 4 } }).directMaxFiles, 4);
});
