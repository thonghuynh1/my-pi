import { selectEvidencePacket, type EvidencePacketV1, type VerificationReportV1 } from "./evidence-packet.ts";
import { reconcileVerification, type PacketTermination, type ReconciledVerification } from "./reconciliation.ts";
import type { PacketEffectiveLimits } from "./packet-runtime-policy.ts";

export const PACKET_FALLBACK_MESSAGE = "Evidence packet rejected; running ordinary prose mode. Prose output is not structured verification.";

type OmittedPacket = {
	provided: false;
	packet?: undefined;
	mode?: undefined;
	packetAccepted?: undefined;
	packetDiagnostics?: undefined;
};

type AcceptedPacket = {
	provided: true;
	packet: EvidencePacketV1;
	mode: "packet";
	packetAccepted: true;
	packetDiagnostics: [];
};

type RejectedPacket = {
	provided: true;
	packet?: undefined;
	mode: "prose-fallback";
	packetAccepted: false;
	packetDiagnostics: string[];
};

export type PacketSelection = OmittedPacket | AcceptedPacket | RejectedPacket;

export type PacketResultProjection = {
	mode?: "packet" | "prose-fallback";
	packetAccepted?: boolean;
	packetDiagnostics?: string[];
	packetId?: string;
	groupId?: string;
	shape?: EvidencePacketV1["shape"];
	effectiveLimits?: PacketEffectiveLimits;
	verification?: Pick<ReconciledVerification, "claims" | "newLeads">;
	incomplete?: boolean;
	termination?: PacketTermination;
};

export function buildEvidencePacketPrompt(packet: EvidencePacketV1, effectiveLimits?: PacketEffectiveLimits): string {
	const references = packet.crossGroupReferences ?? [];
	const effectiveLimitLine = effectiveLimits
		? `Effective limits: ${effectiveLimits.maxTurns} turns, ${effectiveLimits.maxToolCalls} tool calls, ${effectiveLimits.timeoutSeconds} seconds (source: ${effectiveLimits.maxSourceTurns} turns, ${effectiveLimits.maxSourceToolCalls} tool calls)`
		: packet.limits
			? `Packet limits: ${packet.limits.maxTurns ?? "default"} turns, ${packet.limits.maxToolCalls ?? "default"} tool calls, ${packet.limits.timeoutSeconds ?? "default"} seconds`
			: "Effective limits: runtime defaults apply.";
	return [
		"Verify the selected evidence packet slice using native source tools.",
		`Packet ${packet.packetId}, group ${packet.groupId}.`,
		"Owned claims:",
		...packet.claims.map((claim) => `- ${claim.id} [${claim.priority}]: ${claim.summary}`),
		"Routing anchors:",
		...packet.anchors.map((anchor) => `- ${anchor.path}:${anchor.line}${anchor.endLine ? `-${anchor.endLine}` : ""} ${anchor.symbol}`),
		"Cross-group references:",
		...(references.length > 0
			? references.map((reference) => `- ${reference.groupId}: ${reference.path}${reference.line ? `:${reference.line}` : ""}${reference.symbol ? ` ${reference.symbol}` : ""} (${reference.reason})`)
			: ["- none"]),
		effectiveLimitLine,
		"Report every owned claim exactly once with report_verification. Indexed summaries are unverified until native evidence confirms them.",
	].join("\n");
}

export function resolveEvidencePacket(value: unknown): PacketSelection {
	if (value === undefined) return { provided: false };
	const validation = selectEvidencePacket(value);
	if (validation.ok) {
		return { provided: true, packet: validation.value, mode: "packet", packetAccepted: true, packetDiagnostics: [] };
	}
	return {
		provided: true,
		mode: "prose-fallback",
		packetAccepted: false,
		packetDiagnostics: [PACKET_FALLBACK_MESSAGE, ...validation.errors],
	};
}

export function projectPacketResult(
	selection: PacketSelection,
	report: VerificationReportV1 | undefined,
	termination: PacketTermination,
	effectiveLimits?: PacketEffectiveLimits,
): PacketResultProjection {
	if (!selection.provided) return {};
	if (!selection.packet) {
		return {
			mode: selection.mode,
			packetAccepted: false,
			packetDiagnostics: selection.packetDiagnostics,
		};
	}
	const reconciled = reconcileVerification(selection.packet, report, termination);
	return {
		mode: "packet",
		packetAccepted: true,
		packetDiagnostics: [],
		packetId: selection.packet.packetId,
		groupId: selection.packet.groupId,
		shape: selection.packet.shape,
		...(effectiveLimits ? { effectiveLimits } : {}),
		verification: { claims: reconciled.claims, newLeads: reconciled.newLeads },
		incomplete: reconciled.incomplete,
		termination: reconciled.termination,
	};
}

export function formatPacketResultForParent(
	selection: PacketSelection,
	projection: PacketResultProjection,
	output: string,
): string {
	if (!selection.provided) return output;
	if (!selection.packet) return `${selection.packetDiagnostics.join("\n")}\n\n${output}`.trim();
	const claims = projection.verification?.claims ?? [];
	const report = claims.map((claim) => `- ${claim.claimId}: ${claim.status}. ${claim.explanation}`).join("\n");
	const status = projection.incomplete
		? `Structured verification is incomplete (${projection.termination ?? "error"}).`
		: "Structured verification report accepted.";
	return `${output}\n\n${status}\n${report}`.trim();
}
