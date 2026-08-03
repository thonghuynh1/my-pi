import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { selectEvidencePacket, validateEvidencePacket, validateVerificationReport } from "../lib/evidence-packet.ts";

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "evidence-packet-v1.json"), "utf8"));

test("canonical fixture and invalid variants", () => {
	assert.equal(selectEvidencePacket(fixture).ok, true);
	assert.equal(selectEvidencePacket({ ...fixture, version: 2 }).ok, false);
	assert.equal(selectEvidencePacket({ ...fixture, claims: undefined }).ok, false);
	assert.equal(selectEvidencePacket({ ...fixture, claims: [{ ...fixture.claims[0] }, { ...fixture.claims[0] }] }).ok, false);
});

test("verification report requires every claim exactly once and native evidence for resolved claims", () => {
	const unresolved = { claims: [{ claimId: "claim-1", status: "unresolved", explanation: "The source path was unavailable.", evidence: [] }], newLeads: [] };
	assert.equal(validateVerificationReport(unresolved, fixture).ok, true);
	const confirmed = { claims: [{ claimId: "claim-1", status: "confirmed", explanation: "Native source confirms the definition.", evidence: [{ path: "src/example.ts", line: 10, symbol: "example" }] }], newLeads: [] };
	assert.equal(validateVerificationReport(confirmed, fixture).ok, true);
	assert.equal(validateVerificationReport({ ...confirmed, claims: [{ ...confirmed.claims[0], evidence: [] }] }, fixture).ok, false);
	assert.equal(validateVerificationReport({ ...confirmed, claims: [] }, fixture).ok, false);
	assert.equal(validateVerificationReport({ ...confirmed, claims: [confirmed.claims[0], confirmed.claims[0]] }, fixture).ok, false);
});

assert.equal(validateEvidencePacket(fixture).ok, true);
