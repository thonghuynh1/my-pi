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
import { wireToBlock } from "./mapping";
import { computeFoldOps, computeGroupOps, resolveUnfold, resolveRecall } from "./plan";
import {
	PROTOCOL_VERSION,
	isServerMessage,
	type PlanMessage,
	type FoldOp,
	type GroupOp,
	type UnfoldResultMessage,
	type RecallResultMessage,
	type CompleteRequestMessage,
} from "./protocol";
import type { CompletionRequest, CompletionResult } from "$conductors/contract";
import type { Ghost } from "./ghostState.svelte";
import { attachActiveConductor } from "./activeConductor";

/** Send a JSON message over a WebSocket, swallowing errors if the socket is gone. */
function trySend(ws: WebSocket, msg: unknown): void {
	try {
		ws.send(JSON.stringify(msg));
	} catch {
		/* socket gone */
	}
}

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
	/** Per-slot ghost state — active streaming placeholders for this session only. */
	ghosts: Ghost[];
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
	if (existing) {
		existing.entry = entry;
		existing.store.meta = {
			...existing.store.meta,
			title: existing.store.meta.title || entry.title || "pi session",
			cwd: existing.store.meta.cwd || entry.cwd || "",
			model: existing.store.meta.model || entry.model || "",
		};
		if (typeof entry.contextWindow === "number" && entry.contextWindow > 0 && existing.store.contextWindow === null) {
			existing.store.setContextWindow(entry.contextWindow);
			existing.store.setBudget(Math.min(entry.contextWindow, 100_000));
		}
		return existing;
	}

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
		ghosts: [],
	};
	slotRegistry.slots.push(slot);
	return slotRegistry.slots[slotRegistry.slots.length - 1];
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

/**
 * Open a proxied WebSocket for the given slot and wire it to the Accordion protocol.
 *
 * Each slot gets its own isolated connection lifecycle. The slot's store, status, and
 * folding state are mutated in place as the connection progresses, so all other slots
 * remain untouched. All watched sessions stay connected in the background — only the
 * active slot's store drives the visible context map.
 *
 * Idempotent: returns immediately if the slot already has an open socket (slot.socket
 * is non-null). Call removeSlot first if you want to force a reconnect.
 *
 * Protocol handling mirrors liveClient.svelte.ts but scoped to the slot:
 *   hello       — builds a fresh AccordionStore, records meta, sets status "live".
 *   sync        — appends blocks, sends fold plan using slot.folding.enabled.
 *   unfoldRequest — resolves against slot.store, replies immediately.
 *   recallRequest — resolves against slot.store (pure read), replies immediately.
 *   completeResult — settles per-slot pending completion promises.
 *   stream      — ghost state is intentionally skipped (follow-up work).
 */
export function connectSlot(slot: SessionSlot, wsUrl: string): void {
	if (slot.socket !== null) return;
	slot.status = "connecting";

	let ws: WebSocket;
	try {
		ws = new WebSocket(wsUrl);
	} catch {
		slot.status = "error";
		return;
	}
	slot.socket = ws;

	// Per-slot pending out-of-band completion state, managed entirely in this closure.
	// Mirrors the module-level structure in liveClient.svelte.ts but isolated to this slot.
	const pending = new Map<
		number,
		{
			resolve: (r: CompletionResult) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let completionReqId = 0;
	let budgetLive = false;

	function drainPending(reason: string): void {
		for (const { reject, timer } of pending.values()) {
			clearTimeout(timer);
			reject(new Error(reason));
		}
		pending.clear();
	}

	/**
	 * Out-of-band completion relay for conductors attached to this slot's store.
	 * Uses the slot's own WebSocket, not the module-level singleton in liveClient.
	 */
	function sendCompletion(req: CompletionRequest): Promise<CompletionResult> {
		if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("not connected");
		if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
		const reqId = ++completionReqId;
		const msg: CompleteRequestMessage = {
			type: "completeRequest",
			reqId,
			system: req.system,
			prompt: req.prompt,
			maxOutputTokens: req.maxOutputTokens,
		};
		return new Promise<CompletionResult>((resolve, reject) => {
			let abortListener: (() => void) | null = null;
			let timeoutHandle: ReturnType<typeof setTimeout>;
			const settle = (fn: () => void): void => {
				clearTimeout(timeoutHandle);
				if (abortListener && req.signal) {
					req.signal.removeEventListener("abort", abortListener);
					abortListener = null;
				}
				pending.delete(reqId);
				fn();
			};
			timeoutHandle = setTimeout(() => {
				if (pending.has(reqId)) settle(() => reject(new Error("completion timed out")));
			}, 120_000);
			pending.set(reqId, {
				resolve: (r) => settle(() => resolve(r)),
				reject: (e) => settle(() => reject(e)),
				timer: timeoutHandle,
			});
			if (req.signal) {
				abortListener = () => settle(() => reject(new DOMException("aborted", "AbortError")));
				req.signal.addEventListener("abort", abortListener, { once: true });
			}
			try {
				ws.send(JSON.stringify(msg));
			} catch (e) {
				settle(() => reject(new Error(e instanceof Error ? e.message : "send failed")));
			}
		});
	}

	ws.onmessage = (ev) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
		} catch {
			return;
		}
		if (!isServerMessage(parsed)) return;
		const msg = parsed;

		if (msg.type === "hello") {
			if (msg.protocolVersion !== PROTOCOL_VERSION) {
				slot.status = "error";
				try {
					ws.close();
				} catch {
					/* ignore */
				}
				return;
			}
			slot.status = "live";
			slot.ghosts.length = 0;
			// Update the slot's entry labels from the authoritative hello meta.
			slot.entry = {
				...slot.entry,
				title: msg.meta.title || slot.entry.title,
				cwd: msg.meta.cwd || slot.entry.cwd,
				model: msg.meta.model || slot.entry.model,
				contextWindow: msg.meta.contextWindow ?? slot.entry.contextWindow,
			};
			budgetLive = false;
			slot.store.dispose();
			slot.store = new AccordionStore({
				meta: {
					format: "pi",
					title: msg.meta.title || "live pi session",
					cwd: msg.meta.cwd || "",
					model: msg.meta.model || "",
				},
				blocks: [],
				lineCount: 0,
				skipped: 0,
			});
			// Expose the per-slot completion relay so conductors can call host.complete().
			// Also attach the selected conductor synchronously; the broker may compute a
			// fold plan before the route-level Svelte effect gets a turn.
			slot.store.completer = sendCompletion;
			attachActiveConductor(slot.store);
			if (typeof msg.meta.contextWindow === "number" && msg.meta.contextWindow > 0) {
				slot.store.setContextWindow(msg.meta.contextWindow);
				slot.store.setBudget(Math.min(msg.meta.contextWindow, 100_000));
				budgetLive = true;
			}
		} else if (msg.type === "sync") {
			if (msg.full) {
				slot.ghosts.length = 0;
				const prevMeta = slot.store.meta;
				const prevContextWindow = slot.store.contextWindow;
				const prevBudget = slot.store.budget;
				const prevProtect = slot.store.protectTokens;
				slot.store.dispose();
				slot.store = new AccordionStore({
					meta: prevMeta,
					blocks: [],
					lineCount: 0,
					skipped: 0,
				});
				if (prevContextWindow !== null) slot.store.setContextWindow(prevContextWindow);
				slot.store.setBudget(prevBudget);
				slot.store.setProtect(prevProtect);
				slot.store.completer = sendCompletion;
				attachActiveConductor(slot.store);
			}
			const cw = msg.contextWindow;
			let contextWindow: number | undefined;
			let budget: number | undefined;
			if (typeof cw === "number" && cw > 0) {
				const prev = slot.store.contextWindow;
				contextWindow = cw;
				const windowChanged = prev !== null && prev !== cw;
				if (!budgetLive || windowChanged) {
					budget = Math.min(cw, 100_000);
					budgetLive = true;
				}
			}
			attachActiveConductor(slot.store);
			const harness = msg.harness && typeof msg.harness === "object" ? msg.harness : undefined;
			slot.store.applySync({
				harness,
				blocks: msg.blocks.map(wireToBlock),
				contextWindow,
				budget,
			});
			const plan: { ops: FoldOp[]; groups: GroupOp[]; steeringOff?: boolean; budgetExceeded?: boolean } = slot.folding.enabled
				? { ops: computeFoldOps(slot.store), groups: computeGroupOps(slot.store), budgetExceeded: slot.store.fullTokens * slot.store.calibration > slot.store.budget }
				: { ops: [], groups: [], steeringOff: true };
			const reply: PlanMessage = {
				type: "plan",
				reqId: msg.reqId,
				ops: plan.ops,
				groups: plan.groups,
				...(plan.steeringOff && { steeringOff: true }),
				...(plan.budgetExceeded && { budgetExceeded: true }),
			};
			trySend(ws, reply);
		} else if (msg.type === "unfoldRequest") {
			const codes = Array.isArray(msg.codes) ? msg.codes : [];
			const { restored, missing } = slot.folding.enabled
				? resolveUnfold(slot.store, codes)
				: { restored: [], missing: codes };
			const reply: UnfoldResultMessage = {
				type: "unfoldResult",
				reqId: msg.reqId,
				restored,
				missing,
			};
			trySend(ws, reply);
		} else if (msg.type === "recallRequest") {
			const codes = Array.isArray(msg.codes) ? msg.codes : [];
			const { restored, missing } = resolveRecall(slot.store, codes);
			const reply: RecallResultMessage = {
				type: "recallResult",
				reqId: msg.reqId,
				restored,
				missing,
			};
			trySend(ws, reply);
		} else if (msg.type === "completeResult") {
			if (typeof msg.reqId !== "number") return;
			const p = pending.get(msg.reqId);
			if (p) {
				if (msg.ok) {
					p.resolve({
						text: msg.text ?? "",
						model: msg.model ?? "",
						inputTokens: msg.inputTokens,
						outputTokens: msg.outputTokens,
					});
				} else {
					p.reject(new Error(msg.error ?? "completion failed"));
				}
			}
		} else if (msg.type === "stream") {
			if (msg.phase === "start") {
				const idx = slot.ghosts.findIndex((g) => g.contentIndex === msg.contentIndex);
				if (idx >= 0) {
					slot.ghosts[idx] = { contentIndex: msg.contentIndex, kind: msg.kind };
				} else {
					slot.ghosts.push({ contentIndex: msg.contentIndex, kind: msg.kind });
				}
			} else if (msg.phase === "abort") {
				if (msg.contentIndex < 0) {
					slot.ghosts.length = 0;
				} else {
					const idx = slot.ghosts.findIndex((g) => g.contentIndex === msg.contentIndex);
					if (idx >= 0) slot.ghosts.splice(idx, 1);
				}
			}
			// phase === "end" is intentionally a no-op (ADR 0003 §3: committed blocks arrive at message_end).
		}
	};

	ws.onerror = () => {
		if (slot.socket === ws) slot.status = "error";
	};

	ws.onclose = () => {
		drainPending("disconnected");
		slot.ghosts.length = 0;
		if (slot.socket === ws) {
			slot.socket = null;
			slot.status = "disconnected";
		}
		slot.store.completer = null;
	};
}
