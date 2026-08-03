import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileVerification } from "../lib/reconciliation.ts";
import { selectEvidencePacket } from "../lib/evidence-packet.ts";

test("incomplete termination synthesis", () => {
	const packetResult = selectEvidencePacket({
		version: 1, packetId: "p", groupId: "g",
		claims: [{ id: "a", summary: "a", priority: "normal" }, { id: "b", summary: "b", priority: "material" }],
		anchors: [{ path: "src/a.ts", line: 1, symbol: "a" }],
		shape: { fileCount: 1, anchorCount: 1, subsystem: "test", crossFileFlow: false },
	});
	assert.equal(packetResult.ok, true);
	if (!packetResult.ok) return;
	const result = reconcileVerification(packetResult.value, { claims: [{ claimId: "a", status: "confirmed", explanation: "found", evidence: [{ path: "src/a.ts", line: 1, symbol: "a" }] }], newLeads: [] }, "timeout");
	assert.equal(result.incomplete, true);
	assert.equal(result.termination, "timeout");
	assert.equal(result.claims.find((claim) => claim.claimId === "b")?.status, "unresolved");
});
