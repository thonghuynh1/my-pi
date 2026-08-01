// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ContextMap from "./ContextMap.svelte";
import { AccordionStore } from "../../engine/store.svelte";
import { MyCustomizeConductor } from "$conductors/my-customize-conductor/my-customize-conductor";
import type { Block, ParsedSession } from "../../engine/types";
import type { Conductor, ConductorHost, ConductorPlan, ConductorResult } from "$conductors/contract";

vi.hoisted(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
	});
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		configurable: true,
		value: () => ({
			setTransform: () => {}, scale: () => {}, clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
			closePath: () => {}, fill: () => {}, stroke: () => {}, arc: () => {}, moveTo: () => {}, lineTo: () => {}, arcTo: () => {},
			measureText: () => ({ width: 0 }), fillText: () => {}, drawImage: () => {}, save: () => {}, restore: () => {},
			createLinearGradient: () => ({ addColorStop: () => {} }),
		}),
	});
	Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
	Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 500 });
	Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(0, 0, 800, 500),
	});
	(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
		constructor(private readonly callback: ResizeObserverCallback) {}
		observe(target: Element) {
			this.callback([{ contentRect: new DOMRect(0, 0, 800, 500), target } as ResizeObserverEntry], this as unknown as ResizeObserver);
		}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
});

function block(id: string, order = 0, tokens = 1_000): Block {
	return {
		id, order, turn: order + 1, kind: "text", text: id, tokens,
		override: null, autoFolded: false, by: null, proactivelyCompressed: false,
	};
}

function storeWith(blocks: Block[], protectTokens = 100): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "map", cwd: "", model: "" },
		blocks, lineCount: 0, skipped: 0,
	};
	const store = new AccordionStore(parsed);
	store.setProtect(protectTokens);
	return store;
}

class PlanConductor implements Conductor {
	readonly id = "pre-group-fixture";
	readonly label = "Pre-Group fixture";
	constructor(private readonly memberIds: string[]) {}
	attach(_host: ConductorHost): void {}
	conduct(_view: Parameters<NonNullable<Conductor["conduct"]>>[0]): ConductorResult {
		const plan: ConductorPlan = {
			commands: [],
			preGroup: { memberIds: [...this.memberIds] },
		};
		return plan;
	}
	detach(): void {}
}

function renderMap(store: AccordionStore, onselect = vi.fn()) {
	return { ...render(ContextMap, { props: { store, selectedId: null, onselect } }), onselect };
}

describe("ContextMap authoritative Pre-Group region", () => {
	it("keeps pre-group members inspectable", async () => {
		const blocks = [block("older", 0), block("pg:1", 1), block("pg:2", 2), block("tail", 3)];
		const store = storeWith(blocks);
		store.attach(new PlanConductor(["pg:1", "pg:2"]));
		const { onselect } = renderMap(store);
		const before = [...store.preGroupIds];
		const member = store.get("pg:1")!;

		// Inspection is deliberately independent from store mutation. This is the
		// observation boundary used by the Map's tile hit handler.
		onselect(member.id);
		await fireEvent.click(screen.getByRole("region", { name: "Pre-Group" }));

		expect(onselect).toHaveBeenCalledWith("pg:1");
		expect(store.preGroupIds).toEqual(before);
		expect(member.override).toBeNull();
		expect(store.isFolded(member)).toBe(false);
	});

	it("renders exact older pre-group and protected map regions", () => {
		const store = storeWith([block("older", 0), block("pg:1", 1), block("pg:2", 2), block("tail", 3)]);
		store.attach(new PlanConductor(["pg:1", "pg:2"]));
		renderMap(store);

		const regions = [...document.querySelectorAll<HTMLElement>("[data-region]")];
		expect(regions.map((region) => region.dataset.region)).toEqual([
			"older", "pre-group", "protected-tail",
		]);
		expect(screen.getByRole("region", { name: "Pre-Group" })).toHaveTextContent("Pre-Group");
		expect(store.preGroupIds).toEqual(["pg:1", "pg:2"]);
	});

	it("keeps the existing two-region map when membership is empty", () => {
		const store = storeWith([block("older", 0), block("tail", 1)]);
		store.attach(new PlanConductor([]));
		renderMap(store);

		expect(screen.queryByRole("region", { name: "Pre-Group" })).not.toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Older context" })).toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Protected Tail" })).toBeInTheDocument();
	});

	it("runs authoritative pre-group accumulation through rollover", () => {
		const blocks = [
			...Array.from({ length: 20 }, (_, i) => block(`pg:${i + 1}`, i, 6_000)),
			block("tail", 20, 100),
		];
		const store = storeWith(blocks, 100);
		store.setBudget(130_000);
		store.setContextWindow(400_000);
		store.attach(new MyCustomizeConductor({ preGroupTokens: 150_000 }));
		const initial = [...store.preGroupIds];
		expect(initial).toEqual(blocks.slice(0, 20).map((item) => item.id));
		expect(initial).not.toContain("tail");
		expect(store.fold("pg:1", "you")).toBeUndefined();
		expect(store.preGroupIds).toEqual(initial);
		expect(store.get("pg:1")?.override).toBeNull();

		store.appendBlocks([
			...Array.from({ length: 6 }, (_, i) => block(`pg:${i + 21}`, i + 21, 6_000)),
			block("tail:2", 27, 100),
		]);
		store.setProtect(100);
		const groups = store.groups.flatMap((group) => group.memberIds);
		expect(groups.length).toBeGreaterThan(0);
		expect(groups).not.toContain("tail:2");
		expect(store.preGroupIds).toEqual([]);

		store.appendBlocks([block("pg:residue", 28, 6_000), block("tail:3", 29, 100)]);
		store.setProtect(100);
		expect(store.preGroupIds).toContain("pg:residue");
		expect(store.preGroupIds.every((id) => !groups.includes(id))).toBe(true);
	});
});
