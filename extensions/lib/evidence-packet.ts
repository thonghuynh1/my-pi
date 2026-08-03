export type EvidenceAnchor = {
	path: string;
	line: number;
	endLine?: number;
	symbol: string;
	kind?: string;
};

export type EvidenceClaim = {
	id: string;
	summary: string;
	priority: "material" | "normal";
};

export type EvidencePacketV1 = {
	version: 1;
	packetId: string;
	groupId: string;
	claims: EvidenceClaim[];
	anchors: EvidenceAnchor[];
	shape: {
		fileCount: number;
		anchorCount: number;
		subsystem: string;
		crossFileFlow: boolean;
	};
	crossGroupReferences?: Array<{ groupId: string; path: string; line?: number; symbol?: string; reason: string }>;
	limits?: { maxTurns?: number; maxToolCalls?: number; timeoutSeconds?: number };
};

export type VerificationClaim = {
	claimId: string;
	status: "confirmed" | "contradicted" | "unresolved";
	explanation: string;
	evidence: Array<{ path: string; line: number; endLine?: number; symbol: string }>;
};

export type VerificationReportV1 = {
	claims: VerificationClaim[];
	newLeads: Array<{ id: string; summary: string; material: boolean; anchors: EvidenceAnchor[] }>;
};

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: string[] };

const statuses = new Set(["confirmed", "contradicted", "unresolved"]);

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validAnchor(value: unknown, errors: string[], label: string): value is EvidenceAnchor {
	if (!record(value)) { errors.push(`${label} must be an object`); return false; }
	const pathValue = value.path;
	const lineValue = value.line;
	const symbolValue = value.symbol;
	if (!nonEmpty(pathValue) || typeof lineValue !== "number" || !Number.isInteger(lineValue) || lineValue < 1 || !nonEmpty(symbolValue)) {
		errors.push(`${label} must contain path, positive integer line, and symbol`);
		return false;
	}
	const endLineValue = value.endLine;
	if (endLineValue !== undefined && (typeof endLineValue !== "number" || !Number.isInteger(endLineValue) || endLineValue < lineValue)) errors.push(`${label}.endLine is invalid`);
	if (value.kind !== undefined && !nonEmpty(value.kind)) errors.push(`${label}.kind is invalid`);
	return errors.length === 0;
}

export function validateEvidencePacket(value: unknown): ValidationResult<EvidencePacketV1> {
	const errors: string[] = [];
	if (!record(value)) return { ok: false, errors: ["packet must be an object"] };
	if (value.version !== 1) errors.push("unsupported packet version");
	for (const field of ["packetId", "groupId"] as const) if (!nonEmpty(value[field])) errors.push(`${field} is required`);
	if (!Array.isArray(value.claims) || value.claims.length === 0) errors.push("claims must be a non-empty array");
	if (!Array.isArray(value.anchors) || value.anchors.length === 0) errors.push("anchors must be a non-empty array");
	if (!record(value.shape)) errors.push("shape is required");
	const claimIds = new Set<string>();
	if (Array.isArray(value.claims)) value.claims.forEach((claim, index) => {
		if (!record(claim)) { errors.push(`claims[${index}] is invalid`); return; }
		const id = claim.id;
		const summary = claim.summary;
		const priority = claim.priority;
		if (!nonEmpty(id) || !nonEmpty(summary) || (priority !== "material" && priority !== "normal")) errors.push(`claims[${index}] is invalid`);
		else if (claimIds.has(id)) errors.push(`duplicate claim id: ${id}`);
		else claimIds.add(id);
	});
	if (Array.isArray(value.anchors)) value.anchors.forEach((anchor, index) => validAnchor(anchor, errors, `anchors[${index}]`));
	if (record(value.shape)) {
		const fileCount = value.shape.fileCount;
		const anchorCount = value.shape.anchorCount;
		if (typeof fileCount !== "number" || !Number.isInteger(fileCount) || fileCount < 1) errors.push("shape.fileCount is invalid");
		if (typeof anchorCount !== "number" || !Number.isInteger(anchorCount) || anchorCount < 1) errors.push("shape.anchorCount is invalid");
		if (!nonEmpty(value.shape.subsystem) || typeof value.shape.crossFileFlow !== "boolean") errors.push("shape is invalid");
	}
	if (value.crossGroupReferences !== undefined) {
		if (!Array.isArray(value.crossGroupReferences)) errors.push("crossGroupReferences are invalid");
		else value.crossGroupReferences.forEach((reference, index) => {
			if (!record(reference) || !nonEmpty(reference.groupId) || !nonEmpty(reference.path) || !nonEmpty(reference.reason)) {
				errors.push(`crossGroupReferences[${index}] is invalid`);
				return;
			}
			if (reference.line !== undefined && (typeof reference.line !== "number" || !Number.isInteger(reference.line) || reference.line < 1)) errors.push(`crossGroupReferences[${index}].line is invalid`);
			if (reference.symbol !== undefined && !nonEmpty(reference.symbol)) errors.push(`crossGroupReferences[${index}].symbol is invalid`);
		});
	}
	if (value.limits !== undefined) {
		if (!record(value.limits)) errors.push("limits are invalid");
		else for (const limit of [value.limits.maxTurns, value.limits.maxToolCalls, value.limits.timeoutSeconds]) if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1)) errors.push("limits are invalid");
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, value: value as EvidencePacketV1 };
}

export function selectEvidencePacket(value: unknown, groupId?: string): ValidationResult<EvidencePacketV1> {
	const result = validateEvidencePacket(value);
	if (!result.ok) return result;
	if (groupId !== undefined && result.value.groupId !== groupId) return { ok: false, errors: ["selected group does not match packet"] };
	return result;
}

export function validateVerificationReport(report: unknown, packet: EvidencePacketV1): ValidationResult<VerificationReportV1> {
	const errors: string[] = [];
	if (!record(report) || !Array.isArray(report.claims) || !Array.isArray(report.newLeads)) return { ok: false, errors: ["report requires claims and newLeads arrays"] };
	const owned = new Set(packet.claims.map(claim => claim.id));
	const seen = new Set<string>();
	const claims: VerificationClaim[] = [];
	for (const [index, raw] of report.claims.entries()) {
		if (!record(raw) || !nonEmpty(raw.claimId) || typeof raw.status !== "string" || !statuses.has(raw.status) || !nonEmpty(raw.explanation) || !Array.isArray(raw.evidence)) {
			errors.push(`claims[${index}] is invalid`); continue;
		}
		if (!owned.has(raw.claimId)) errors.push(`claim is not owned: ${raw.claimId}`);
		if (seen.has(raw.claimId)) errors.push(`duplicate reported claim: ${raw.claimId}`);
		seen.add(raw.claimId);
		const evidence: Array<{ path: string; line: number; endLine?: number; symbol: string }> = [];
		raw.evidence.forEach((item, evidenceIndex) => {
			if (!validAnchor(item, errors, `claims[${index}].evidence[${evidenceIndex}]`)) return;
			evidence.push(item);
		});
		if (raw.status !== "unresolved" && (evidence.length === 0 || !nonEmpty(raw.explanation))) errors.push(`resolved claim ${raw.claimId} requires native evidence and explanation`);
		const status = raw.status;
		if (status !== "confirmed" && status !== "contradicted" && status !== "unresolved") continue;
		claims.push({ claimId: raw.claimId, status, explanation: raw.explanation, evidence });
	}
	for (const claim of packet.claims) if (!seen.has(claim.id)) errors.push(`missing reported claim: ${claim.id}`);
	const newLeads = report.newLeads.map((lead, index) => {
		if (!record(lead) || !nonEmpty(lead.id) || !nonEmpty(lead.summary) || typeof lead.material !== "boolean" || !Array.isArray(lead.anchors)) {
			errors.push(`newLeads[${index}] is invalid`); return undefined;
		}
		const anchors: EvidenceAnchor[] = [];
		lead.anchors.forEach((anchor, anchorIndex) => { if (validAnchor(anchor, errors, `newLeads[${index}].anchors[${anchorIndex}]`)) anchors.push(anchor); });
		return { id: lead.id, summary: lead.summary, material: lead.material, anchors };
	}).filter((lead): lead is VerificationReportV1["newLeads"][number] => lead !== undefined);
	return errors.length ? { ok: false, errors } : { ok: true, value: { claims, newLeads } };
}