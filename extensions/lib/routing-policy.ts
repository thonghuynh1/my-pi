import type { EvidencePacketV1 } from "./evidence-packet.ts";

export type RoutingConfigOverrides = {
	directMaxFiles?: number;
	directMaxAnchors?: number;
	maxTurns?: number;
	maxToolCalls?: number;
	timeoutSeconds?: number;
};

export type EffectiveRoutingConfig = {
	directMaxFiles: number;
	directMaxAnchors: number;
	maxTurns: number;
	maxToolCalls: number;
	timeoutSeconds: number;
};

export type RoutingConfigLayers = {
	package?: RoutingConfigOverrides;
	user?: RoutingConfigOverrides;
	project?: RoutingConfigOverrides;
};

export const DEFAULT_ROUTING_CONFIG: EffectiveRoutingConfig = {
	directMaxFiles: 3,
	directMaxAnchors: 6,
	maxTurns: 16,
	maxToolCalls: 30,
	timeoutSeconds: 300,
};

export type RoutingGroup = Pick<EvidencePacketV1, "groupId" | "claims" | "shape"> & {
	confirmed: boolean;
	independent?: boolean;
	independentWith?: readonly string[];
};

type RouteMetadata = {
	directGroupIds?: readonly string[];
	singleChildGroupIds?: readonly string[];
	unresolvedGroupIds?: readonly string[];
	skippedGroupIds?: readonly string[];
};

export type RouteDecision = (
	| { kind: "direct"; groupIds: readonly string[] }
	| { kind: "single-child"; groupIds: readonly string[] }
	| { kind: "parallel-child"; groupIds: readonly string[] }
	| { kind: "skip"; groupIds: readonly string[] }
	| { kind: "unresolved-reporting"; groupIds: readonly string[] }
) & RouteMetadata;

type RoutingValue = keyof RoutingConfigOverrides;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidValue(key: RoutingValue, value: unknown): value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) return false;
	if (key === "maxTurns" || key === "maxToolCalls") return value >= 1;
	return value >= 1;
}

export function parseRoutingConfig(value: unknown): RoutingConfigOverrides | undefined {
	if (!isRecord(value)) return undefined;
	const parsed: RoutingConfigOverrides = {};
	for (const key of ["directMaxFiles", "directMaxAnchors", "maxTurns", "maxToolCalls", "timeoutSeconds"] as const) {
		if (isValidValue(key, value[key])) parsed[key] = value[key];
	}
	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function resolveRoutingConfig(
	layers: RoutingConfigLayers,
	packetLimits?: EvidencePacketV1["limits"],
): EffectiveRoutingConfig {
	const resolved: EffectiveRoutingConfig = { ...DEFAULT_ROUTING_CONFIG };
	for (const layer of [layers.package, layers.user, layers.project]) {
		if (!layer) continue;
		for (const key of Object.keys(resolved) as RoutingValue[]) {
			const value = layer[key];
			if (isValidValue(key, value)) resolved[key] = value;
		}
	}
	if (packetLimits?.maxTurns !== undefined && Number.isFinite(packetLimits.maxTurns)) {
		resolved.maxTurns = Math.max(1, Math.min(resolved.maxTurns, Math.floor(packetLimits.maxTurns)));
	}
	if (packetLimits?.maxToolCalls !== undefined && Number.isFinite(packetLimits.maxToolCalls)) {
		resolved.maxToolCalls = Math.max(1, Math.min(resolved.maxToolCalls, Math.floor(packetLimits.maxToolCalls)));
	}
	if (packetLimits?.timeoutSeconds !== undefined && Number.isFinite(packetLimits.timeoutSeconds) && packetLimits.timeoutSeconds > 0) {
		resolved.timeoutSeconds = Math.min(resolved.timeoutSeconds, Math.floor(packetLimits.timeoutSeconds));
	}
	return resolved;
}

function isConfirmed(group: RoutingGroup): boolean {
	return group.confirmed;
}

function isDirect(group: RoutingGroup, config: EffectiveRoutingConfig): boolean {
	return group.shape.fileCount <= config.directMaxFiles
		&& group.shape.anchorCount <= config.directMaxAnchors
		&& !group.shape.crossFileFlow;
}

export function classifyGroup(group: RoutingGroup, config: EffectiveRoutingConfig = DEFAULT_ROUTING_CONFIG): RouteDecision {
	if (isConfirmed(group)) return { kind: "skip", groupIds: [group.groupId] };
	if (group.claims.length === 0) return { kind: "unresolved-reporting", groupIds: [group.groupId] };
	return isDirect(group, config)
		? { kind: "direct", groupIds: [group.groupId] }
		: { kind: "single-child", groupIds: [group.groupId] };
}

function areIndependent(left: RoutingGroup, right: RoutingGroup): boolean {
	return (left.independent === true && right.independent === true)
		|| Boolean(left.independentWith?.includes(right.groupId) || right.independentWith?.includes(left.groupId));
}

function largestIndependentSet(groups: readonly RoutingGroup[]): RoutingGroup[] {
	let best: RoutingGroup[] = [];
	const search = (index: number, candidate: RoutingGroup[]): void => {
		if (candidate.length + groups.length - index <= best.length) return;
		if (index === groups.length) {
			if (candidate.length > best.length) best = candidate;
			return;
		}
		const group = groups[index];
		if (group && candidate.every((selected) => areIndependent(selected, group))) search(index + 1, [...candidate, group]);
		search(index + 1, candidate);
	};
	search(0, []);
	return best;
}

function addSecondaryGroups(
	decision: RouteDecision,
	groups: readonly RoutingGroup[],
	config: EffectiveRoutingConfig,
	remainingChildGroupIds: readonly string[] = [],
): RouteDecision {
	const primary = new Set(decision.groupIds);
	const add = (key: "directGroupIds" | "singleChildGroupIds" | "unresolvedGroupIds" | "skippedGroupIds", ids: readonly string[]) => {
		const secondary = ids.filter((id) => !primary.has(id));
		if (secondary.length > 0) decision[key] = secondary;
	};
	add("directGroupIds", groups.filter((group) => !isConfirmed(group) && group.claims.length > 0 && isDirect(group, config)).map((group) => group.groupId));
	add("singleChildGroupIds", remainingChildGroupIds);
	add("unresolvedGroupIds", groups.filter((group) => !isConfirmed(group) && group.claims.length === 0).map((group) => group.groupId));
	add("skippedGroupIds", groups.filter(isConfirmed).map((group) => group.groupId));
	return decision;
}

export function classifyGroups(
	groups: readonly RoutingGroup[],
	config: EffectiveRoutingConfig = DEFAULT_ROUTING_CONFIG,
): RouteDecision {
	if (groups.length === 0) return { kind: "unresolved-reporting", groupIds: [] };
	const active = groups.filter((group) => !isConfirmed(group));
	if (active.length === 0) return { kind: "skip", groupIds: groups.map((group) => group.groupId) };

	const childGroups = active.filter((group) => classifyGroup(group, config).kind === "single-child");
	if (childGroups.length > 0) {
		const independentSet = largestIndependentSet(childGroups);
		if (independentSet.length >= 2) {
			return addSecondaryGroups(
				{ kind: "parallel-child", groupIds: independentSet.map((group) => group.groupId) },
				groups,
				config,
				childGroups.filter((group) => !independentSet.includes(group)).map((group) => group.groupId),
			);
		}
		return addSecondaryGroups({ kind: "single-child", groupIds: childGroups.map((group) => group.groupId) }, groups, config);
	}
	if (active.some((group) => group.claims.length === 0)) {
		return addSecondaryGroups({ kind: "unresolved-reporting", groupIds: active.filter((group) => group.claims.length === 0).map((group) => group.groupId) }, groups, config);
	}
	return addSecondaryGroups({ kind: "direct", groupIds: active.map((group) => group.groupId) }, groups, config);
}

