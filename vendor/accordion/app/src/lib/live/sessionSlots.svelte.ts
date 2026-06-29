/**
 * sessionSlots.svelte.ts — per-session slot state for broker-mode multi-session dashboards.
 *
 * In broker mode the Accordion app watches multiple Pi sessions at once. Each watched session
 * gets its own slot: an isolated (store, socket, status, folding) unit. The active slot drives
 * the main context map; all other slots remain connected in the background.
 *
 * In direct/single-session mode this module is never populated — the existing session.svelte.ts
 * + liveClient.svelte.ts path continues to work unchanged.
 *
 * Session identity is sessionId only. Two entries that share cwd/title but have different
 * sessionIds are kept as separate slots — no deduplication by label.
 *
 * Implements DEC-004, DEC-005, DEC-006, DEC-007, DEC-008 from the PRD.
 */
import type { SessionEntry } from "./registry";
import { AccordionStore } from "../engine/store.svelte";

/** Lifecycle status of one slot's proxied WebSocket connection. */
export type SlotStatus = "connecting" | "live" | "stale" | "disconnected" | "error";

/**
 * One broker-mode session slot.
 *
 * This is the normative shape from the issue's decision artifact. Every field is mutated in
 * place so Svelte 5's deep proxy can track changes reactively. Ghost state, pending completion
 * maps, and conductor handles are owned here conceptually; the connect layer wires them once it
 * upgrades the slot to a full live session — sessionSlots owns only the lifecycle skeleton.
 */
export interface SessionSlot {
	/** Stable session identity — dedup key; never replaced by cwd or title. */
	sessionId: string;
	/** The raw registry entry that describes this session (cwd, title, model — labels only). */
	entry: SessionEntry;
	/** This slot's isolated AccordionStore — rebuilt fresh for each slot, never shared. */
	store: AccordionStore;
	/** The active proxied WebSocket for this slot, or null when disconnected. */
	socket: WebSocket | null;
	/** Connection lifecycle status for the UI. */
	status: SlotStatus;
	/** Per-slot folding arm — whether the fold plan is applied to the live model call. */
	folding: { enabled: boolean };
}

/**
 * Reactive registry of all active session slots, exported as a single mutating $state object.
 *
 * Consumers read `slotRegistry.slots` and `slotRegistry.activeId`. The manager functions below
 * mutate it. Direct $state export is the cross-module pattern used throughout this codebase
 * (matches session.svelte.ts, conductorClient.svelte.ts, etc.).
 */
export const slotRegistry = $state<{
	/** All active slots in arrival order. */
	slots: SessionSlot[];
	/** The sessionId of the currently focused slot, or null (direct mode / no sessions). */
	activeId: string | null;
}>({
	slots: [],
	activeId: null,
});

/**
 * The currently active slot, or null if no slot is focused.
 *
 * Returns null in direct/single-session mode (slotRegistry is empty), and null in broker mode
 * before any session is explicitly focused. Callers use this to drive the main context map.
 */
export function activeSlot(): SessionSlot | null {
	if (!slotRegistry.activeId) return null;
	return slotRegistry.slots.find((s) => s.sessionId === slotRegistry.activeId) ?? null;
}

/**
 * Ensure a slot exists for the given session entry.
 *
 * Idempotent: if a slot for this sessionId already exists, returns it unchanged without
 * duplicating. If no slot exists, creates a fresh one with a new AccordionStore and no
 * active socket.
 *
 * Session identity is sessionId only — two entries with the same cwd/title but different
 * sessionIds each get their own independent slot (DEC-007: no dedup by label).
 */
export function ensureSlot(entry: SessionEntry): SessionSlot {
	const existing = slotRegistry.slots.find((s) => s.sessionId === entry.sessionId);
	if (existing) return existing;

	const store = new AccordionStore({
		meta: {
			format: "pi",
			title: entry.title || "pi session",
			cwd: entry.cwd || "",
			model: entry.model || "",
		},
		blocks: [],
		lineCount: 0,
		skipped: 0,
	});

	const slot: SessionSlot = {
		sessionId: entry.sessionId,
		entry,
		store,
		socket: null,
		status: "disconnected",
		folding: { enabled: true },
	};
	slotRegistry.slots.push(slot);
	return slot;
}

/**
 * Focus the slot with the given sessionId — it becomes the active/visible slot driving
 * the main context map.
 *
 * No-op if the sessionId is not in the registry. A focus event from `/accordion` routes
 * here; if the slot already exists it is selected without duplicating it (DEC-006).
 */
export function focusSlot(sessionId: string): void {
	const exists = slotRegistry.slots.some((s) => s.sessionId === sessionId);
	if (exists) slotRegistry.activeId = sessionId;
}

/**
 * Remove the slot for the given sessionId, disposing its resources.
 *
 * Disposal order:
 *   1. store.dispose() — aborts any in-flight conductor and clears the completer.
 *   2. socket.close() — tears down the proxied WebSocket.
 *
 * If the removed slot was the active one, focus shifts to the first remaining slot,
 * or null if the registry is now empty.
 *
 * No-op when the sessionId is not in the registry.
 */
export function removeSlot(sessionId: string): void {
	const idx = slotRegistry.slots.findIndex((s) => s.sessionId === sessionId);
	if (idx < 0) return;

	const slot = slotRegistry.slots[idx];

	// 1. Abort any in-flight conductor / completer on the outgoing store.
	slot.store.dispose();

	// 2. Close the proxied WebSocket if one is open.
	if (slot.socket) {
		try {
			slot.socket.close();
		} catch {
			/* already gone */
		}
		slot.socket = null;
	}

	slotRegistry.slots.splice(idx, 1);

	// Shift focus if this was the active slot.
	if (slotRegistry.activeId === sessionId) {
		slotRegistry.activeId = slotRegistry.slots[0]?.sessionId ?? null;
	}
}
