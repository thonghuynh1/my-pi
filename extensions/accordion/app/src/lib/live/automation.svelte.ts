import { session } from "../session.svelte";
import { live } from "./liveClient.svelte";
import { folding } from "./folding.svelte";
import { attachActiveConductor } from "./activeConductor";
import { setActiveConductor } from "./conductor.svelte";
import { slotRegistry } from "./sessionSlots.svelte";

export const BENCHMARK_TOKEN_QUERY = "accordion-benchmark-token";

export interface AccordionAutomationSnapshot {
	sessionId: string;
	status: string;
	budget: number | null;
	conductor: string | null;
	folding: boolean;
	steeringReady: boolean;
	ready: boolean;
	acknowledgedAt: number;
}

interface AccordionAutomationApi {
	readonly benchmarkOnly: true;
	configure(token: string, sessionId: string, config: { budget: number; conductor: string; folding: boolean }): AccordionAutomationSnapshot | null;
	snapshot(token: string, sessionId: string): AccordionAutomationSnapshot | null;
}

let acknowledgedAt = 0;
let acknowledgedSessionId: string | null = null;
let installedToken: string | null = null;

function target(sessionId: string) {
	const slot = slotRegistry.slots.find((candidate) => candidate.sessionId === sessionId);
	if (slot) return { store: slot.store, folding: slot.folding, status: slot.status };
	if (live.sessionId === sessionId && session.store) {
		return { store: session.store, folding, status: live.status };
	}
	return null;
}

export function benchmarkAutomationTokenFromLocation(location: Pick<Location, "search">): string | null {
	const token = new URLSearchParams(location.search).get(BENCHMARK_TOKEN_QUERY);
	return token && token.length >= 32 ? token : null;
}

function authorized(token: string): void {
	if (!installedToken || token !== installedToken) throw new Error("Accordion benchmark automation authorization failed");
}

/** Install only for an explicitly tokenized benchmark URL. Reinstalling is idempotent. */
export function installAccordionAutomation(token: string): void {
	if (typeof window === "undefined" || token.length < 32) return;
	const host = globalThis as typeof globalThis & { __accordionAutomation?: AccordionAutomationApi };
	if (host.__accordionAutomation?.benchmarkOnly && installedToken === token) return;
	installedToken = token;
	acknowledgedAt = 0;
	acknowledgedSessionId = null;
	const snapshot = (providedToken: string, sessionId: string): AccordionAutomationSnapshot | null => {
		authorized(providedToken);
		const selected = target(sessionId);
		if (!selected) return null;
		const connected = selected.status === "live" || selected.status === "connected";
		const conductor = selected.store.conductor?.id ?? null;
		const steeringReady = connected && selected.folding.enabled && conductor !== null;
		return {
			sessionId,
			status: selected.status,
			budget: selected.store.budget,
			conductor,
			folding: selected.folding.enabled,
			steeringReady,
			ready: steeringReady && acknowledgedSessionId === sessionId && acknowledgedAt > 0,
			acknowledgedAt: acknowledgedSessionId === sessionId ? acknowledgedAt : 0,
		};
	};
	host.__accordionAutomation = {
		benchmarkOnly: true,
		configure(providedToken, sessionId, config) {
			authorized(providedToken);
			const selected = target(sessionId);
			if (!selected) throw new Error(`Accordion session ${sessionId} is not attached`);
			setActiveConductor(config.conductor);
			attachActiveConductor(selected.store);
			selected.store.setBudget(config.budget);
			selected.folding.enabled = config.folding;
			acknowledgedSessionId = sessionId;
			acknowledgedAt = Date.now() / 1000;
			return snapshot(providedToken, sessionId);
		},
		snapshot,
	};
}
