import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildEvidencePacketPrompt, formatPacketResultForParent, projectPacketResult, resolveEvidencePacket } from "../lib/subagent-runtime.ts";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "subagents.ts"), "utf8");

const validPacket = {
	version: 1,
	packetId: "packet",
	groupId: "group",
	claims: [{ id: "claim", summary: "claim summary", priority: "normal" }],
	anchors: [{ path: "src/verified.ts", line: 4, symbol: "verified" }],
	shape: { fileCount: 1, anchorCount: 1, subsystem: "tests", crossFileFlow: false },
};

test("ordinary subagents remain isolated from packet-only SDK tools", () => {
	assert.doesNotMatch(source, /aiknow/);
	assert.match(source, /resourceLoaderOptions:\s*\{[\s\S]*?noExtensions:\s*true/);
	assert.match(source, /customTools: reportTool \? \[reportTool\] : undefined/);
	assert.match(source, /tools: packet\s*\?[\s\S]*?\[\.\.\.config\.tools, "report_verification"\][\s\S]*?: config\.tools/);
});

test("rejected packets fall back visibly without retaining packet data", () => {
	const selection = resolveEvidencePacket({ ...validPacket, version: 2, packetId: "secret-packet", claims: [{ id: "secret-claim", summary: "secret summary", priority: "normal" }] });
	assert.equal(selection.mode, "prose-fallback");
	assert.equal(selection.packetAccepted, false);
	assert.equal("packet" in selection, false);
	assert.match(selection.packetDiagnostics.join("\n"), /unsupported packet version/);
	const projection = projectPacketResult(selection, undefined, "error");
	assert.deepEqual(projection, {
		mode: "prose-fallback",
		packetAccepted: false,
		packetDiagnostics: selection.packetDiagnostics,
	});
	const parentOutput = formatPacketResultForParent(selection, projection, "ordinary findings");
	assert.match(parentOutput, /ordinary findings/);
	assert.match(parentOutput, /prose mode/);
	assert.doesNotMatch(parentOutput, /secret-packet|secret-claim|secret summary/);
});

test("telemetry detail projections by mode", () => {
	const effectiveLimits = {
		maxTurns: 16,
		maxToolCalls: 30,
		maxSourceTurns: 15,
		maxSourceToolCalls: 29,
		timeoutSeconds: 300,
	};
	const accepted = resolveEvidencePacket(validPacket);
	if (accepted.mode !== "packet") throw new Error("valid fixture was not accepted");
	const report = {
		claims: [{
			claimId: "claim",
			status: "confirmed" as const,
			explanation: "native evidence",
			evidence: [{ path: "src/verified.ts", line: 4, symbol: "verified" }],
		}],
		newLeads: [{ id: "lead", summary: "follow-up lead", material: true, anchors: [] }],
	};
	assert.deepEqual(projectPacketResult(accepted, report, "completed", effectiveLimits), {
		mode: "packet",
		packetAccepted: true,
		packetDiagnostics: [],
		packetId: "packet",
		groupId: "group",
		shape: validPacket.shape,
		effectiveLimits,
		verification: report,
		incomplete: false,
		termination: "completed",
	});

	const rejected = resolveEvidencePacket({ ...validPacket, version: 2 });
	const fallback = projectPacketResult(rejected, undefined, "error", effectiveLimits);
	assert.equal(fallback.mode, "prose-fallback");
	assert.equal(fallback.packetAccepted, false);
	assert.equal("packetId" in fallback, false);
	assert.equal("effectiveLimits" in fallback, false);
	assert.equal(fallback.packetDiagnostics?.length, 2);

	const ordinary = projectPacketResult({ provided: false }, undefined, "completed", effectiveLimits);
	assert.deepEqual(ordinary, {});
	assert.match(source, /usage:\s*\{/);
	assert.match(source, /inputTokens/);
});

test("packet prompts include references and effective limits", () => {
	const packet = {
		...validPacket,
		crossGroupReferences: [{ groupId: "other", path: "src/related.ts", line: 9, symbol: "related", reason: "shared caller" }],
		limits: { maxTurns: 8, maxToolCalls: 12, timeoutSeconds: 120 },
	};
	const prompt = buildEvidencePacketPrompt(packet, {
		maxTurns: 8,
		maxToolCalls: 12,
		maxSourceTurns: 7,
		maxSourceToolCalls: 11,
		timeoutSeconds: 120,
	});
	assert.match(prompt, /Cross-group references:/);
	assert.match(prompt, /other.*src\/related\.ts:9.*shared caller/);
	assert.match(prompt, /Effective limits: 8 turns, 12 tool calls, 120 seconds/);
	assert.match(prompt, /source: 7 turns, 11 tool calls/);
});

test("omitted packet preserves the ordinary result projection", () => {
	assert.deepEqual(resolveEvidencePacket(undefined), { provided: false });
	assert.deepEqual(projectPacketResult({ provided: false }, undefined, "completed"), {});
});

test("JSON string packets are deserialized and accepted", () => {
	const asString = JSON.stringify(validPacket);
	const selection = resolveEvidencePacket(asString);
	assert.equal(selection.mode, "packet");
	assert.equal(selection.packetAccepted, true);
	if (selection.mode !== "packet") return;
	assert.equal(selection.packet.packetId, "packet");
	assert.equal(selection.packet.groupId, "group");

	// Malformed JSON string falls back gracefully
	const broken = resolveEvidencePacket("{not json");
	assert.equal(broken.mode, "prose-fallback");
	assert.equal(broken.packetAccepted, false);
});

test("partial packet reports synthesize unresolved claims", () => {
	const selection = resolveEvidencePacket({
		...validPacket,
		claims: [
			{ id: "confirmed", summary: "confirmed", priority: "normal" },
			{ id: "missing", summary: "missing", priority: "material" },
		],
	});
	assert.equal(selection.mode, "packet");
	if (selection.mode !== "packet") return;
	const projection = projectPacketResult(selection, {
		claims: [{ claimId: "confirmed", status: "confirmed", explanation: "native evidence", evidence: [{ path: "src/verified.ts", line: 4, symbol: "verified" }] }],
		newLeads: [],
	}, "timeout");
	assert.equal(projection.incomplete, true);
	assert.equal(projection.termination, "timeout");
	assert.equal(projection.verification?.claims.find((claim) => claim.claimId === "missing")?.status, "unresolved");
});
