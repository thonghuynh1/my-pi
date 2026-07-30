// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: () => ({
			matches: false,
			media: "",
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
	});
});

import MapHeader from "./MapHeader.svelte";
import { AccordionStore } from "../../engine/store.svelte";
import type { ParsedSession } from "../../engine/types";

function storeWithNoBlocks(): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "test", cwd: "", model: "" },
		blocks: [],
		lineCount: 0,
		skipped: 0,
	};
	return new AccordionStore(parsed);
}

describe("MapHeader budget controls", () => {
	it("budget range has a 50k minimum", () => {
		const store = storeWithNoBlocks();

		render(MapHeader, { props: { store } });

		expect(screen.getByRole("slider", { name: "Context budget" })).toHaveAttribute("min", "50000");
	});

	it("editable budget clamps to 50k", async () => {
		const store = storeWithNoBlocks();
		const setBudget = vi.spyOn(store, "setBudget");

		render(MapHeader, { props: { store } });
		await fireEvent.click(screen.getByRole("button", { name: "70k" }));
		const input = screen.getByRole("textbox", { name: "Context budget in thousands of tokens" });
		await fireEvent.input(input, { target: { value: "12" } });
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(setBudget).toHaveBeenCalledWith(50_000);
		expect(setBudget).not.toHaveBeenCalledWith(12_000);
	});

	it("programmatic setBudget still accepts values below 50k", () => {
		const store = storeWithNoBlocks();

		store.setBudget(12_000);

		expect(store.budget).toBe(12_000);
	});
});
