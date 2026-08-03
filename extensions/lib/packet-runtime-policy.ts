export const PACKET_RUNTIME_CAPS = {
	maxTurns: 16,
	maxToolCalls: 30,
	maxSourceTurns: 15,
	maxSourceToolCalls: 29,
	timeoutSeconds: 300,
} as const;

export type PacketRuntimeCapConfig = {
	maxTurns: number;
	maxToolCalls: number;
	maxSourceTurns?: number;
	maxSourceToolCalls?: number;
	timeoutSeconds: number;
};

export type PacketRuntimeLimits = {
	maxTurns: number;
	maxToolCalls: number;
	maxSourceTurns: number;
	maxSourceToolCalls: number;
};

export type PacketEffectiveLimits = PacketRuntimeLimits & {
	timeoutSeconds: number;
};

export type PacketRuntimePhase = "investigating" | "report-only" | "finished";
export type PacketRuntimeState = { phase: PacketRuntimePhase; turns: number; toolCalls: number; reportCalls: number; limits: PacketRuntimeLimits };
export type PacketRuntimeEvent =
	| { type: "source-call-start" }
	| { type: "report-call-start" }
	| { type: "turn-end" }
	| { type: "report-accepted" }
	| { type: "terminate" };

export function packetRuntimeLimits(
	requested?: { maxTurns?: number; maxToolCalls?: number },
	caps: PacketRuntimeCapConfig = PACKET_RUNTIME_CAPS,
): PacketRuntimeLimits {
	const maxTurns = Math.min(Math.max(1, Math.floor(requested?.maxTurns ?? caps.maxTurns)), caps.maxTurns);
	const maxToolCalls = Math.min(Math.max(1, Math.floor(requested?.maxToolCalls ?? caps.maxToolCalls)), caps.maxToolCalls);
	const maxSourceTurns = caps.maxSourceTurns ?? Math.max(0, caps.maxTurns - 1);
	const maxSourceToolCalls = caps.maxSourceToolCalls ?? Math.max(0, caps.maxToolCalls - 1);
	return {
		maxTurns,
		maxToolCalls,
		maxSourceTurns: Math.max(0, Math.min(maxTurns - 1, maxSourceTurns)),
		maxSourceToolCalls: Math.max(0, Math.min(maxToolCalls - 1, maxSourceToolCalls)),
	};
}

export function initialPacketRuntimeState(
	requested?: { maxTurns?: number; maxToolCalls?: number },
	caps?: PacketRuntimeCapConfig,
): PacketRuntimeState {
	const limits = packetRuntimeLimits(requested, caps);
	const phase: PacketRuntimePhase = limits.maxSourceTurns === 0 || limits.maxSourceToolCalls === 0 ? "report-only" : "investigating";
	return { phase, turns: 0, toolCalls: 0, reportCalls: 0, limits };
}

export function canStartSourceOperation(state: PacketRuntimeState): boolean {
	return state.phase === "investigating" && state.turns < state.limits.maxSourceTurns && state.toolCalls < state.limits.maxSourceToolCalls;
}

export function transitionPacketRuntime(state: PacketRuntimeState, event: PacketRuntimeEvent): PacketRuntimeState {
	if (event.type === "turn-end") {
		const turns = Math.min(state.turns + 1, state.limits.maxTurns);
		if (state.phase === "finished") {
			return state.reportCalls > 0 && state.turns < state.limits.maxTurns ? { ...state, turns } : state;
		}
		const phase = state.phase === "investigating" && turns >= state.limits.maxSourceTurns ? "report-only" : state.phase;
		return { ...state, turns, phase };
	}
	if (state.phase === "finished") return state;
	if (event.type === "terminate") return { ...state, phase: "finished" };
	if (event.type === "report-accepted") {
		if (state.phase !== "report-only" || state.reportCalls !== 1) return state;
		return { ...state, phase: "finished" };
	}
	if (event.type === "source-call-start") {
		if (!canStartSourceOperation(state)) return state;
		const next = { ...state, toolCalls: state.toolCalls + 1 };
		return next.toolCalls >= next.limits.maxSourceToolCalls ? { ...next, phase: "report-only" } : next;
	}
	if (event.type === "report-call-start") {
		if (state.phase !== "report-only" || state.reportCalls >= 1 || state.toolCalls >= state.limits.maxToolCalls || state.turns >= state.limits.maxTurns) return state;
		return { ...state, toolCalls: state.toolCalls + 1, reportCalls: state.reportCalls + 1 };
	}
	return state;
}

export function reportToolsOnly(state: PacketRuntimeState): boolean { return state.phase === "report-only"; }

export function packetTimeoutSeconds(requested: number | undefined, cap: number = PACKET_RUNTIME_CAPS.timeoutSeconds): number {
	if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return cap;
	return Math.max(1, Math.min(Math.floor(requested), cap));
}
