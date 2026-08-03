import type { EvidencePacketV1, VerificationClaim, VerificationReportV1 } from "./evidence-packet.ts";

export type PacketTermination = "completed" | "turn-limit" | "tool-limit" | "timeout" | "cancelled" | "error";

export type ReconciledVerification = {
	claims: VerificationClaim[];
	newLeads: VerificationReportV1["newLeads"];
	incomplete: boolean;
	termination: PacketTermination;
};

export function reconcileVerification(
	packet: EvidencePacketV1,
	report: VerificationReportV1 | undefined,
	termination: PacketTermination,
): ReconciledVerification {
	const reported = new Map((report?.claims ?? []).map((claim) => [claim.claimId, claim]));
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
