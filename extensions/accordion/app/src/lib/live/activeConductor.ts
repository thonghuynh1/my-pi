import type { AccordionStore } from "../engine/store.svelte";
import { attachConductor } from "./conductorClient.svelte";
import { conductorState } from "./conductor.svelte";
import { allConductors, isLaunching } from "./conductorDiscovery.svelte";

/**
 * Attach the user's selected conductor to a store before a live fold plan is computed.
 *
 * Data shape: the store is the mutable engine state for one session. The selected
 * conductor id and discovered remote list are process-global UI state. This function
 * reads that state once and converges the store to the same conductor the route effect
 * would attach on the next Svelte flush.
 */
export function attachActiveConductor(store: AccordionStore): boolean {
	const activeId = conductorState.activeId;
	const available = allConductors();
	if (isLaunching(activeId) && !available.some((c) => c.id === activeId)) return false;
	attachConductor(store, activeId, available);
	return true;
}
