// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ContextMap from "./ContextMap.svelte";
import { AccordionStore } from "../../engine/store.svelte";
import type { Block, ParsedSession } from "../../engine/types";
import type { Conductor, ConductorHost, ConductorPlan, ConductorResult } from "$conductors/contract";

import "./ContextMap.test-support";

function block(id: string, order: number, tokens = 1_000): Block {
	return { id, order, turn: order + 1, kind: "text", text: id, tokens, override: null, autoFolded: false, by: null, proactivelyCompressed: false };
}

type Phase = "accumulating" | "waiting-safe-rollover" | "rolled-over";
function storeWith(memberIds: string[], metrics?: { tokens: number; target: number; pct: number; phase: Phase }) {
	const blocks = [block("older", 0), block(memberIds[0] ?? "pg:1", 1), block(memberIds[1] ?? "pg:2", 2), block("tail", 3)];
	const parsed: ParsedSession = { meta: { format: "pi", title: "transcript", cwd: "", model: "" }, blocks, lineCount: 0, skipped: 0 };
	const store = new AccordionStore(parsed);
	store.setProtect(100);
	store.attach(new StatusConductor(memberIds, metrics));
	return store;
}

class StatusConductor implements Conductor {
	readonly id = "pre-group-transcript-fixture";
	readonly label = "Pre-Group transcript fixture";
	private host: ConductorHost | null = null;
	constructor(private readonly memberIds: string[], private readonly metrics?: { tokens: number; target: number; pct: number; phase: Phase }) {}
	attach(host: ConductorHost): void {
		this.host = host;
		if (this.metrics) host.setStatus("pre-group fixture", {
			preGroupTokens: this.metrics.tokens,
			preGroupTargetTokens: this.metrics.target,
			preGroupFillPct: this.metrics.pct,
			preGroupPhase: this.metrics.phase,
		});
	}
	conduct(): ConductorResult {
		const plan: ConductorPlan = { commands: [], preGroup: { memberIds: [...this.memberIds] } };
		return plan;
	}
	detach(): void { this.host = null; }
}

function renderTranscript(store: AccordionStore, onselect = vi.fn()) {
	const result = render(ContextMap, { props: { store, selectedId: null, onselect } });
	fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
	return { ...result, onselect };
}

function progress() {
	return { tokens: 10_000, target: 15_000, pct: 67, phase: "accumulating" as const };
}

describe("ContextMap Pre-Group transcript", () => {
	it("mirrors authoritative pre-group membership in transcript", () => {
		const store = storeWith(["pg:1", "pg:2"], progress());
		renderTranscript(store);
		expect(screen.getByRole("region", { name: "Pre-Group" })).toBeInTheDocument();
		expect(screen.getByLabelText(/pg:1.*Pre-Group/)).toBeInTheDocument();
		expect(screen.getByLabelText(/pg:2.*Pre-Group/)).toBeInTheDocument();
		expect(screen.getByLabelText("Assistant older")).not.toHaveTextContent("Pre-Group");
		expect(screen.getByLabelText("Assistant tail")).not.toHaveTextContent("Pre-Group");
	});

	it("shows accumulating pre-group progress in map", () => {
		const store = storeWith(["pg:1", "pg:2"], progress());
		render(ContextMap, { props: { store, selectedId: null, onselect: vi.fn() } });
		expect(screen.getByRole("region", { name: "Pre-Group" })).toHaveTextContent("10k / 15k · 67% · accumulating");
	});

	it("shows accumulating pre-group progress and lifecycle in transcript", () => {
		const store = storeWith(["pg:1", "pg:2"], progress());
		renderTranscript(store);
		const region = screen.getByRole("region", { name: "Pre-Group" });
		expect(region).toHaveTextContent("10k / 15k · 67% · accumulating");
		expect(region).toHaveTextContent("stays full until safe rollover");
	});

	it("labels above-target membership as waiting for safe rollover", () => {
		const store = storeWith(["pg:1", "pg:2"], { tokens: 16_000, target: 15_000, pct: 107, phase: "waiting-safe-rollover" });
		renderTranscript(store);
		expect(screen.getByRole("region", { name: "Pre-Group" })).toHaveTextContent("waiting for safe rollover");
		expect(screen.getByLabelText(/pg:1.*Pre-Group/)).toBeInTheDocument();
		expect(screen.queryByText("safe rollover")).not.toBeInTheDocument();
	});

	it("reports safe early rollover below the target percentage", () => {
		const store = storeWith(["pg:1"], { tokens: 8_000, target: 15_000, pct: 53, phase: "rolled-over" });
		renderTranscript(store);
		expect(screen.getByRole("region", { name: "Pre-Group" })).toHaveTextContent("53% · safe rollover");
		expect(screen.queryByLabelText(/pg:2.*Pre-Group/)).not.toBeInTheDocument();
		expect(screen.getByLabelText(/pg:1.*Pre-Group/)).toBeInTheDocument();
	});

	it("keeps pre-group transcript rows inspectable", async () => {
		const store = storeWith(["pg:1", "pg:2"], progress());
		const { onselect } = renderTranscript(store);
		await fireEvent.click(screen.getByLabelText(/pg:1.*Pre-Group/));
		await waitFor(() => expect(onselect).toHaveBeenCalledWith("pg:1"));
		expect(store.preGroupIds).toEqual(["pg:1", "pg:2"]);
	});

	it("hides fold controls for pre-group transcript rows", () => {
		const store = storeWith(["pg:1", "pg:2"], progress());
		renderTranscript(store);
		expect(screen.getByLabelText(/pg:1.*Pre-Group/).querySelector("button")).toBeNull();
		expect(screen.getByLabelText("Assistant older").querySelector("button")).not.toBeNull();
	});

	it("omits transcript pre-group UI for empty membership", () => {
		const store = storeWith([], undefined);
		renderTranscript(store);
		expect(screen.queryByRole("region", { name: "Pre-Group" })).not.toBeInTheDocument();
		expect(screen.queryByText(/Pre-Group/)).not.toBeInTheDocument();
		expect(screen.getByLabelText("Assistant older")).toBeInTheDocument();
		expect(screen.getByLabelText("Assistant tail")).toBeInTheDocument();
	});
});
