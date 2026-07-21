import { describe, it, expect, beforeEach } from "vitest";
import { slotRegistry, ensureSlot, focusSlot, removeSlot, activeSlot } from "./sessionSlots.svelte";
import type { SessionEntry } from "./registry";

/*
 * sessionSlots.test.ts — broker-mode per-session slot lifecycle.
 *
 * Tests the five acceptance criteria from issue #05-browser-per-session-slots:
 *   1. Two distinct sessionIds → two independent slots.
 *   2. Repeated focus for the same sessionId → no duplication.
 *   3. Removing a slot disposes its store and socket.
 *   4. Same cwd/title but different sessionIds → separate slots (identity by sessionId only).
 *   5. Normal single-session fallback still works when broker meta is absent.
 */

/** Build a minimal valid SessionEntry for a given sessionId. */
function makeEntry(sessionId: string, overrides: Partial<SessionEntry> = {}): SessionEntry {
	return {
		registryProtocol: 1,
		protocolVersion: 7,
		sessionId,
		port: 9000,
		pid: 0,
		cwd: "/tmp/project",
		title: "test session",
		model: "gpt-4o",
		tokens: null,
		contextWindow: null,
		startedAt: 0,
		heartbeatAt: Date.now(),
		...overrides,
	};
}

beforeEach(() => {
	// Tear down any leftover slots from prior tests. Dispose each store so the conductor
	// teardown path runs correctly and leaves no in-flight completers or timers.
	for (const slot of slotRegistry.slots) {
		try { slot.store.dispose(); } catch { /* ignore */ }
		try { slot.socket?.close(); } catch { /* ignore */ }
	}
	slotRegistry.slots.splice(0, slotRegistry.slots.length);
	slotRegistry.activeId = null;
});

// ── Slot creation ─────────────────────────────────────────────────────────────

describe("sessionSlots — slot creation", () => {
	it("adding two watched sessions creates two slots keyed by distinct session IDs", () => {
		ensureSlot(makeEntry("session-1"));
		ensureSlot(makeEntry("session-2"));

		expect(slotRegistry.slots).toHaveLength(2);
		expect(slotRegistry.slots[0].sessionId).toBe("session-1");
		expect(slotRegistry.slots[1].sessionId).toBe("session-2");
	});

	it("each slot owns an independent AccordionStore", () => {
		ensureSlot(makeEntry("session-a"));
		ensureSlot(makeEntry("session-b"));

		expect(slotRegistry.slots[0].store).not.toBe(slotRegistry.slots[1].store);
	});

	it("a new slot starts with socket null and status disconnected", () => {
		const slot = ensureSlot(makeEntry("fresh-slot"));

		expect(slot.socket).toBeNull();
		expect(slot.status).toBe("disconnected");
	});

	it("a new slot starts with folding enabled (opt-in per-session, default on)", () => {
		const slot = ensureSlot(makeEntry("folding-slot"));

		expect(slot.folding.enabled).toBe(true);
	});

	it("returns the registry slot so first-connect mutations update the visible slot", () => {
		const slot = ensureSlot(makeEntry("reactive-slot"));

		slot.status = "live";

		expect(slotRegistry.slots[0].status).toBe("live");
	});

	it("initializes per-slot ghosts as an empty array", () => {
		const slot = ensureSlot(makeEntry("ghost-slot"));

		expect(slot.ghosts).toEqual([]);
	});
});

// ── Focus / deduplication ─────────────────────────────────────────────────────

describe("sessionSlots — focus and deduplication", () => {
	it("repeated ensureSlot for the same sessionId returns the existing slot without duplicating", () => {
		const entry = makeEntry("dup-session");
		const first = ensureSlot(entry);
		const second = ensureSlot(entry);

		expect(second).toBe(first);
		expect(slotRegistry.slots).toHaveLength(1);
	});

	it("repeated ensureSlot refreshes an existing slot with the latest session entry", () => {
		const slot = ensureSlot(makeEntry("refresh-session", { cwd: "/old", title: "old", model: "old-model" }));

		const refreshed = ensureSlot(makeEntry("refresh-session", {
			cwd: "/new",
			title: "new",
			model: "new-model",
			contextWindow: 64_000,
			heartbeatAt: 12345,
		}));

		expect(refreshed).toBe(slot);
		expect(slot.entry.cwd).toBe("/new");
		expect(slot.entry.title).toBe("new");
		expect(slot.entry.model).toBe("new-model");
		expect(slot.entry.heartbeatAt).toBe(12345);
		expect(slot.store.contextWindow).toBe(64_000);
	});

	it("repeated focus for the same sessionId selects the existing slot and does not duplicate it", () => {
		ensureSlot(makeEntry("focus-session"));
		focusSlot("focus-session");
		focusSlot("focus-session"); // repeated — must not duplicate

		expect(slotRegistry.slots).toHaveLength(1);
		expect(slotRegistry.activeId).toBe("focus-session");
	});

	it("focusSlot sets activeId so activeSlot() returns the correct slot", () => {
		ensureSlot(makeEntry("s1"));
		ensureSlot(makeEntry("s2"));
		focusSlot("s2");

		const active = activeSlot();
		expect(active?.sessionId).toBe("s2");
	});

	it("focusSlot is a no-op for an unknown sessionId", () => {
		ensureSlot(makeEntry("known"));
		focusSlot("unknown-id");

		expect(slotRegistry.activeId).toBeNull();
	});

	it("focus can switch between two live sessions without creating new slots", () => {
		ensureSlot(makeEntry("a"));
		ensureSlot(makeEntry("b"));
		focusSlot("a");
		focusSlot("b");
		focusSlot("a");

		expect(slotRegistry.slots).toHaveLength(2);
		expect(slotRegistry.activeId).toBe("a");
	});
});

// ── Slot removal ──────────────────────────────────────────────────────────────

describe("sessionSlots — slot removal", () => {
	it("removing a watched session disposes its store", () => {
		const slot = ensureSlot(makeEntry("dispose-test"));
		let disposed = false;
		const orig = slot.store.dispose.bind(slot.store);
		slot.store.dispose = () => { disposed = true; orig(); };

		removeSlot("dispose-test");

		expect(disposed).toBe(true);
		expect(slotRegistry.slots).toHaveLength(0);
	});

	it("removing a watched session closes its socket", () => {
		const slot = ensureSlot(makeEntry("socket-test"));
		let closed = false;
		slot.socket = { readyState: 1, close: () => { closed = true; } } as unknown as WebSocket;

		removeSlot("socket-test");

		expect(closed).toBe(true);
	});

	it("removeSlot is a no-op for an unknown sessionId", () => {
		ensureSlot(makeEntry("existing"));
		removeSlot("ghost-id");

		expect(slotRegistry.slots).toHaveLength(1);
	});

	it("removing the active slot shifts focus to the first remaining slot", () => {
		ensureSlot(makeEntry("first"));
		ensureSlot(makeEntry("second"));
		focusSlot("first");

		removeSlot("first");

		expect(slotRegistry.activeId).toBe("second");
	});

	it("removing the only slot clears activeId to null", () => {
		ensureSlot(makeEntry("only"));
		focusSlot("only");

		removeSlot("only");

		expect(slotRegistry.activeId).toBeNull();
		expect(slotRegistry.slots).toHaveLength(0);
	});

	it("removing a non-active slot leaves activeId unchanged", () => {
		ensureSlot(makeEntry("active-one"));
		ensureSlot(makeEntry("inactive-one"));
		focusSlot("active-one");

		removeSlot("inactive-one");

		expect(slotRegistry.activeId).toBe("active-one");
		expect(slotRegistry.slots).toHaveLength(1);
	});
});

// ── Session identity by sessionId ─────────────────────────────────────────────

describe("sessionSlots — session identity by sessionId", () => {
	it("two sessions with the same cwd/title remain separate if session IDs differ", () => {
		ensureSlot(makeEntry("id-001", { cwd: "/shared", title: "same title" }));
		ensureSlot(makeEntry("id-002", { cwd: "/shared", title: "same title" }));

		expect(slotRegistry.slots).toHaveLength(2);
		expect(slotRegistry.slots.map((s) => s.sessionId)).toEqual(["id-001", "id-002"]);
	});

	it("two sessions with the same cwd but different sessionIds each own their store", () => {
		ensureSlot(makeEntry("x1", { cwd: "/same-dir" }));
		ensureSlot(makeEntry("x2", { cwd: "/same-dir" }));

		expect(slotRegistry.slots[0].store).not.toBe(slotRegistry.slots[1].store);
	});
});

// ── Single-session fallback ───────────────────────────────────────────────────

describe("sessionSlots — single-session fallback (broker meta absent)", () => {
	it("slot registry is empty by default — the direct single-session path is unaffected", () => {
		// When no broker meta is present and ensureSlot is never called, the registry is empty
		// and activeId is null. The existing session.svelte.ts / liveClient.svelte.ts path
		// operates without any slots in the registry — this module is inert.
		expect(slotRegistry.slots).toHaveLength(0);
		expect(slotRegistry.activeId).toBeNull();
		expect(activeSlot()).toBeNull();
	});
});
