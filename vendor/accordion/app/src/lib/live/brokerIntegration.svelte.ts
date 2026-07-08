/**
 * brokerIntegration.svelte.ts — broker-mode state and polling, extracted from +page.svelte.
 *
 * Owns the broker lifecycle so +page.svelte has minimal broker-specific code. All broker
 * state, detection, polling, and sidebar prop resolution live here. The page imports one
 * object and a few helpers instead of scattering broker ternaries across its template.
 *
 * Extracted to reduce merge-conflict surface with upstream accordion, which does not have
 * broker support. The fewer hunks we touch in +page.svelte, the easier upstream merges are.
 */
import { PROTOCOL_VERSION } from "./protocol";
import { REGISTRY_PROTOCOL, type SessionEntry } from "./registry";
import { detectBrokerMode, type BrokerMeta } from "./brokerMode";
import { normalizeBrokerSession } from "./brokerSessions";
import {
	slotRegistry,
	activeSlot,
	ensureSlot,
	focusSlot,
	removeSlot,
	connectSlot,
} from "./sessionSlots.svelte";

// ── Reactive state ────────────────────────────────────────────────────────────

export const broker = $state<{
	mode: "broker" | "direct" | null;
	meta: BrokerMeta | null;
}>({
	mode: null,
	meta: null,
});

let pollTimer: ReturnType<typeof setInterval> | null = null;

// ── Sidebar prop resolution ───────────────────────────────────────────────────

/**
 * Project slot data into SessionEntry shape for the existing SessionsSidebar.
 * Avoids forcing the sidebar to know about broker-mode types.
 */
export function brokerSessionEntries(): SessionEntry[] {
	return slotRegistry.slots.map((slot) => ({
		registryProtocol: REGISTRY_PROTOCOL,
		protocolVersion: PROTOCOL_VERSION,
		sessionId: slot.sessionId,
		port: 0,
		pid: 0,
		cwd: slot.store.meta.cwd || slot.entry.cwd,
		title: slot.store.meta.title || slot.entry.title || slot.sessionId,
		model: slot.store.meta.model || slot.entry.model,
		tokens: slot.entry.tokens,
		contextWindow: slot.store.contextWindow,
		estimatedWithoutAccordion: slot.store.estimatedWithoutAccordion,
		startedAt: slot.entry.startedAt,
		heartbeatAt: slot.entry.heartbeatAt,
	}));
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function pollBrokerSessions(): Promise<void> {
	if (!broker.meta) return;
	try {
		const res = await fetch("/__accordion/sessions", { credentials: "same-origin" });
		if (!res.ok) return;
		const body = (await res.json()) as unknown[];
		if (!Array.isArray(body)) return;

		const watched = body.flatMap((s) => {
			const session = normalizeBrokerSession(s);
			return session ? [session] : [];
		});

		const watchedIds = new Set(watched.map((w) => w.sessionId));
		for (const slot of [...slotRegistry.slots]) {
			if (!watchedIds.has(slot.sessionId)) removeSlot(slot.sessionId);
		}

		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		for (const entry of watched) {
			const slot = ensureSlot(entry);
			if (slot.socket === null) {
				const wsUrl = proto + "//" + window.location.host + "/ws/session/" + encodeURIComponent(entry.sessionId);
				connectSlot(slot, wsUrl);
			}
		}

		if (slotRegistry.activeId === null && slotRegistry.slots.length > 0) {
			focusSlot(slotRegistry.slots[0].sessionId);
		}
	} catch {
		// Transient network error — retry on next poll tick.
	}
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/**
 * Detect broker mode and start polling if the broker is serving this page.
 * Call stopBroker() for cleanup.
 */
export async function startBrokerDetection(): Promise<void> {
	const detected = await detectBrokerMode(PROTOCOL_VERSION);
	if (detected.kind === "broker") {
		broker.mode = "broker";
		broker.meta = detected.meta;
		void pollBrokerSessions();
		if (pollTimer !== null) clearInterval(pollTimer);
		pollTimer = setInterval(() => void pollBrokerSessions(), 2_000);
	} else if (detected.kind === "error") {
		broker.mode = "direct";
		console.warn("[accordion] broker-mode detection error:", detected.detail);
	} else {
		broker.mode = "direct";
	}
}

/** Clean up broker polling and all slots. Called from onMount cleanup. */
export function stopBroker(): void {
	if (pollTimer !== null) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	for (const slot of [...slotRegistry.slots]) {
		removeSlot(slot.sessionId);
	}
}

/**
 * Handle a focus request in broker mode. Returns true if broker mode is active
 * (regardless of whether the session was found), false otherwise so the caller
 * can fall through to direct-mode logic.
 */
export function handleBrokerFocus(sessionId: string): boolean {
	if (broker.mode !== "broker") return false;
	if (slotRegistry.slots.some((s) => s.sessionId === sessionId)) {
		focusSlot(sessionId);
	}
	return true;
}

// Re-export what the page needs from sessionSlots so it doesn't need a separate import.
export { slotRegistry, activeSlot, focusSlot } from "./sessionSlots.svelte";
