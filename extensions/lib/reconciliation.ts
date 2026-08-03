import type { EvidencePacketV1, VerificationClaim, VerificationReportV1 } from "./evidence-packet.ts";

export type PacketTermination = "completed" | "turn-limit" | "tool-limit" | "timeout" | "cancelled" | "error";

export type ReconciledVerification = {
	claims: VerificationClaim[];
	newLeads: VerificationReportV1["newLeads"];
	incomplete: boolean;
	termination: PacketTermination;
};

export type LeadStatus = "covered" | "irrelevant" | "assigned-once";
export type ReconciledLead = VerificationReportV1["newLeads"][number] & { status: LeadStatus };

export type OwnershipReconciliation =
	| { ok: true; claims: VerificationClaim[]; leads: ReconciledLead[] }
	| { ok: false; errors: string[] };

export type FollowUpSelection =
	| { kind: "follow-up"; claimIds: string[]; leadIds: string[] }
	| { kind: "report-unresolved"; claimIds: string[]; leadIds: string[] };

export function reconcileVerification(
	packet: EvidencePacketV1,
	report: VerificationReportV1 | undefined,
	termination: PacketTermination,
): ReconciledVerification {
	const errors: string[] = [];
	const packetClaimIds = duplicateIds(packet.claims, (claim) => claim.id, "packet claim", errors);
	const reportedClaims = report?.claims ?? [];
	const reportedClaimIds = duplicateIds(reportedClaims, (claim) => claim.claimId, "claim", errors);
	const reportedLeads = report?.newLeads ?? [];
	duplicateIds(reportedLeads, (lead) => lead.id, "lead", errors);
	for (const claim of reportedClaims) if (!packetClaimIds.has(claim.claimId)) errors.push(`claim is not owned: ${claim.claimId}`);
	if (errors.length > 0) throw new Error(errors.join("; "));
	const reported = new Map(reportedClaims.map((claim) => [claim.claimId, claim]));
	const claims = packet.claims.map((claim) => reported.get(claim.id) ?? {
		claimId: claim.id,
		status: "unresolved" as const,
		explanation: `No verification report was received before termination (${termination}).`,
		evidence: [],
	});
	return {
		claims,
		newLeads: report?.newLeads ?? [],
		incomplete: claims.some((claim) => claim.status === "unresolved" && !reported.has(claim.claimId)),
		termination,
	};
}

function duplicateIds<T>(values: readonly T[], getId: (value: T) => string, label: string, errors: string[]): Set<string> {
	const seen = new Set<string>();
	for (const value of values) {
		const id = getId(value);
		if (seen.has(id)) errors.push(`duplicate ${label}: ${id}`);
		seen.add(id);
	}
	return seen;
}

export function reconcileOwnership(
	packet: EvidencePacketV1,
	report: VerificationReportV1 | undefined,
	options: { coveredLeadIds?: ReadonlySet<string> } = {},
): OwnershipReconciliation {
	const errors: string[] = [];
	const packetClaimIds = duplicateIds(packet.claims, (claim) => claim.id, "packet claim", errors);
	const reportedClaims = report?.claims ?? [];
	const reportedClaimIds = duplicateIds(reportedClaims, (claim) => claim.claimId, "claim", errors);
	const reportedLeads = report?.newLeads ?? [];
	duplicateIds(reportedLeads, (lead) => lead.id, "lead", errors);
	for (const claim of reportedClaims) if (!packetClaimIds.has(claim.claimId)) errors.push(`claim is not owned: ${claim.claimId}`);
	if (errors.length > 0) return { ok: false, errors };

	const reportedById = new Map(reportedClaims.map((claim) => [claim.claimId, claim]));
	const claims = packet.claims.map((claim) => reportedById.get(claim.id) ?? {
		claimId: claim.id,
		status: "unresolved" as const,
		explanation: "No verification result was assigned to this claim.",
		evidence: [],
	});
	const coveredLeadIds = options.coveredLeadIds ?? new Set<string>();
	const leads = reportedLeads.map((lead) => ({
		...lead,
		status: coveredLeadIds.has(lead.id) ? "covered" as const : lead.material ? "assigned-once" as const : "irrelevant" as const,
	}));
	return { ok: true, claims, leads };
}

export const reconcileLeadOwnership = reconcileOwnership;

export function selectFollowUpBatch(
	originalClaims: readonly EvidencePacketV1["claims"][number][],
	claims: readonly VerificationClaim[],
	leads: readonly ReconciledLead[],
	followUpUsed: boolean,
): FollowUpSelection {
	const outcomeById = new Map(claims.map((claim) => [claim.claimId, claim]));
	const unresolvedClaimIds = originalClaims
		.filter((claim) => outcomeById.get(claim.id)?.status === "unresolved" || !outcomeById.has(claim.id))
		.map((claim) => claim.id);
	const materialUnresolvedClaimIds = originalClaims
		.filter((claim) => claim.priority === "material" && unresolvedClaimIds.includes(claim.id))
		.map((claim) => claim.id);
	const assignedLeadIds = leads.filter((lead) => lead.status === "assigned-once").map((lead) => lead.id);
	if (!followUpUsed && (materialUnresolvedClaimIds.length > 0 || assignedLeadIds.length > 0)) {
		return { kind: "follow-up", claimIds: materialUnresolvedClaimIds, leadIds: assignedLeadIds };
	}
	return { kind: "report-unresolved", claimIds: unresolvedClaimIds, leadIds: assignedLeadIds };
}
