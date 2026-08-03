import assert from "node:assert/strict";
import { test } from "node:test";
import {
	reconcileOwnership,
	reconcileVerification,
	selectFollowUpBatch,
} from "../lib/reconciliation.ts";
import { selectEvidencePacket } from "../lib/evidence-packet.ts";

function makePacket() {
	const packetResult = selectEvidencePacket({
		version: 1, packetId: "p", groupId: "g",
		claims: [
			{ id: "material-unresolved", summary: "material unresolved", priority: "material" },
			{ id: "normal-unresolved", summary: "normal unresolved", priority: "normal" },
			{ id: "confirmed", summary: "confirmed", priority: "material" },
		],
		anchors: [{ path: "src/a.ts", line: 1, symbol: "a" }],
		shape: { fileCount: 1, anchorCount: 1, subsystem: "test", crossFileFlow: false },
	});
	assert.equal(packetResult.ok, true);
	if (!packetResult.ok) throw new Error(packetResult.errors.join(", "));
	return packetResult.value;
}

test("incomplete termination synthesis", () => {
	const packet = makePacket();
	const result = reconcileVerification(packet, {
		claims: [{ claimId: "confirmed", status: "confirmed", explanation: "found", evidence: [{ path: "src/a.ts", line: 1, symbol: "a" }] }],
		newLeads: [],
	}, "timeout");
	assert.equal(result.incomplete, true);
	assert.equal(result.termination, "timeout");
	assert.equal(result.claims.find((claim) => claim.claimId === "normal-unresolved")?.status, "unresolved");
});

test("claim and lead ownership reconciliation", () => {
	const packet = makePacket();
	const result = reconcileOwnership(packet, {
		claims: packet.claims.map((claim) => ({
			claimId: claim.id,
			status: claim.id === "confirmed" ? "confirmed" as const : "unresolved" as const,
			explanation: "reported",
			evidence: claim.id === "confirmed" ? [{ path: "src/a.ts", line: 1, symbol: "a" }] : [],
		})),
		newLeads: [
			{ id: "covered", summary: "already covered", material: true, anchors: [] },
			{ id: "irrelevant", summary: "not useful", material: false, anchors: [] },
			{ id: "assigned", summary: "needs one owner", material: true, anchors: [] },
		],
	}, { coveredLeadIds: new Set(["covered"]) });
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.claims.map((claim) => claim.status), ["unresolved", "unresolved", "confirmed"]);
	assert.deepEqual(result.leads.map((lead) => lead.status), ["covered", "irrelevant", "assigned-once"]);

	const duplicateReport = {
		claims: [
			{ claimId: "confirmed", status: "confirmed" as const, explanation: "one", evidence: [{ path: "src/a.ts", line: 1, symbol: "a" }] },
			{ claimId: "confirmed", status: "confirmed" as const, explanation: "two", evidence: [{ path: "src/a.ts", line: 1, symbol: "a" }] },
		],
		newLeads: [],
	};
	const duplicate = reconcileOwnership(packet, duplicateReport);
	assert.equal(duplicate.ok, false);
	if (!duplicate.ok) assert.match(duplicate.errors.join("\n"), /duplicate claim/);
	assert.throws(() => reconcileVerification(packet, duplicateReport, "completed"), /duplicate claim/);
});

test("single material follow-up", () => {
	const packet = makePacket();
	const ownership = reconcileOwnership(packet, {
		claims: packet.claims.map((claim) => ({
			claimId: claim.id,
			status: claim.id === "confirmed" ? "confirmed" as const : "unresolved" as const,
			explanation: "reported",
			evidence: claim.id === "confirmed" ? [{ path: "src/a.ts", line: 1, symbol: "a" }] : [],
		})),
		newLeads: [
			{ id: "assigned", summary: "needs one owner", material: true, anchors: [] },
			{ id: "irrelevant", summary: "not useful", material: false, anchors: [] },
		],
	});
	assert.equal(ownership.ok, true);
	if (!ownership.ok) return;

	assert.deepEqual(selectFollowUpBatch(packet.claims, ownership.claims, ownership.leads, false), {
		kind: "follow-up",
		claimIds: ["material-unresolved"],
		leadIds: ["assigned"],
	});
	assert.deepEqual(selectFollowUpBatch(packet.claims, ownership.claims, ownership.leads, true), {
		kind: "report-unresolved",
		claimIds: ["material-unresolved", "normal-unresolved"],
		leadIds: ["assigned"],
	});
});
