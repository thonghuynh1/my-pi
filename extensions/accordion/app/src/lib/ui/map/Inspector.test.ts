// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import Inspector from "./Inspector.svelte";
import { AccordionStore } from "../../engine/store.svelte";
import type { Block, Group, ParsedSession } from "../../engine/types";

function block(overrides: Partial<Block> = {}): Block {
	return {
		id: "b:pcc",
		kind: "text",
		turn: 1,
		order: 0,
		text: "assistant reply",
		tokens: 100,
		proactivelyCompressed: false,
		override: null,
		autoFolded: false,
		by: null,
		...overrides,
	};
}

function storeWith(blocks: Block[]): AccordionStore {
	const parsed: ParsedSession = {
		meta: { format: "pi", title: "test", cwd: "", model: "" },
		blocks,
		lineCount: 0,
		skipped: 0,
	};
	const store = new AccordionStore(parsed);
	store.setProtect(0);
	return store;
}

function renderBlock(selected: Block) {
	return render(Inspector, {
		props: {
			store: storeWith([selected]),
			block: selected,
			group: null,
			onselect: () => {},
			onclose: () => {},
		},
	});
}

function renderGroup(members: Block[], group: Group) {
	return render(Inspector, {
		props: {
			store: storeWith(members),
			block: null,
			group,
			onselect: () => {},
			onclose: () => {},
		},
	});
}

describe("Inspector PCC state", () => {
	it("renders PCC pill when block.proactivelyCompressed is true", () => {
		renderBlock(block({ proactivelyCompressed: true }));

		expect(screen.getByTestId("pcc-pill")).toHaveTextContent("PCC");
	});

	it("does not render PCC pill when block.proactivelyCompressed is false", () => {
		renderBlock(block());

		expect(screen.queryByTestId("pcc-pill")).not.toBeInTheDocument();
	});

	it("disables fold and unfold buttons on a PCC block, keeps pin enabled", () => {
		renderBlock(block({ proactivelyCompressed: true }));

		expect(screen.getByRole("button", { name: "Fold" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Pin" })).not.toBeDisabled();

		cleanup();
		renderBlock(block({ proactivelyCompressed: true, override: "folded" }));

		expect(screen.getByRole("button", { name: "Unfold" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Pin" })).not.toBeDisabled();
	});

	it("renders PCC pill on PCC members inside an expanded group", () => {
		const pccMember = block({ id: "member:pcc", proactivelyCompressed: true });
		const regularMember = block({ id: "member:regular", order: 1 });
		const group: Group = {
			id: "g:member:pcc",
			memberIds: [pccMember.id, regularMember.id],
			folded: false,
		};

		renderGroup([pccMember, regularMember], group);

		expect(within(screen.getByTestId("group-member-list")).getByTestId("pcc-pill")).toHaveTextContent("PCC");
	});
});
