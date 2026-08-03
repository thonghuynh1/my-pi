export const PACKET_RUNTIME_CAPS = {
	maxTurns: 16,
	maxToolCalls: 30,
	maxSourceTurns: 15,
	maxSourceToolCalls: 29,
	timeoutSeconds: 300,
} as const;

export type PacketRuntimeLimits = {
	maxTurns: number;
	maxToolCalls: number;
	maxSourceTurns: number;
	maxSourceToolCalls: number;
};

export type PacketRuntimePhase = "investigating" | "report-only" | "finished";
export type PacketRuntimeState = { phase: PacketRuntimePhase; turns: number; toolCalls: number; reportCalls: number; limits: PacketRuntimeLimits };
export type PacketRuntimeEvent =
	| { type: "source-call-start" }
	| { type: "report-call-start" }
	| { type: "turn-end" }
	| { type: "report-accepted" }
	| { type: "terminate" };

export function packetRuntimeLimits(requested?: { maxTurns?: number; maxToolCalls?: number }): PacketRuntimeLimits {
	const maxTurns = Math.min(Math.max(2, Math.floor(requested?.maxTurns ?? PACKET_RUNTIME_CAPS.maxTurns)), PACKET_RUNTIME_CAPS.maxTurns);
	const maxToolCalls = Math.min(Math.max(2, Math.floor(requested?.maxToolCalls ?? PACKET_RUNTIME_CAPS.maxToolCalls)), PACKET_RUNTIME_CAPS.maxToolCalls);
	return { maxTurns, maxToolCalls, maxSourceTurns: Math.min(maxTurns - 1, 15), maxSourceToolCalls: Math.min(maxToolCalls - 1, 29) };
}

export function initialPacketRuntimeState(requested?: { maxTurns?: number; maxToolCalls?: number }): PacketRuntimeState {
	return { phase: "investigating", turns: 0, toolCalls: 0, reportCalls: 0, limits: packetRuntimeLimits(requested) };
}

export function canStartSourceOperation(state: PacketRuntimeState): boolean {
	return state.phase === "investigating" && state.turns < state.limits.maxSourceTurns && state.toolCalls < state.limits.maxSourceToolCalls;
}

export function shouldReserveReport(state: PacketRuntimeState): boolean {
	return state.phase === "investigating" && (state.turns >= state.limits.maxSourceTurns || state.toolCalls >= state.limits.maxSourceToolCalls);
}

export function transitionPacketRuntime(state: PacketRuntimeState, event: PacketRuntimeEvent): PacketRuntimeState {
	if (event.type === "turn-end") return { ...state, turns: state.turns + 1 };
	if (state.phase === "finished") return state;
	if (event.type === "terminate" || event.type === "report-accepted") return { ...state, phase: "finished" };
	if (event.type === "source-call-start") {
		if (!canStartSourceOperation(state)) return { ...state, phase: "report-only" };
		const next = { ...state, toolCalls: state.toolCalls + 1 };
		return shouldReserveReport(next) ? { ...next, phase: "report-only" } : next;
	}
	if (event.type === "report-call-start") {
		if (state.phase !== "report-only" || state.reportCalls >= 1 || state.toolCalls >= state.limits.maxToolCalls) return state;
		return { ...state, toolCalls: state.toolCalls + 1, reportCalls: state.reportCalls + 1 };
	}
	return state;
}

export function reportToolsOnly(state: PacketRuntimeState): boolean { return state.phase === "report-only"; }

export function packetTimeoutSeconds(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return PACKET_RUNTIME_CAPS.timeoutSeconds;
	return Math.min(Math.floor(requested), PACKET_RUNTIME_CAPS.timeoutSeconds);
}
