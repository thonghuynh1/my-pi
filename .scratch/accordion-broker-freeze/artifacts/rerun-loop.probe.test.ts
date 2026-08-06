import { afterEach, describe, expect, it, vi } from "vitest";
import { AccordionStore } from "../../../extensions/accordion/app/src/lib/engine/store.svelte";
import type { Conductor, ConductorResult, ConductorView } from "../../../extensions/accordion/conductors/contract";
import type { Block, ParsedSession } from "../../../extensions/accordion/app/src/lib/engine/types";

function block(id: string, order: number, tokens: number, kind: Block["kind"] = "text"): Block {
	return {
		id,
		kind,
		turn: order + 1,
		order,
		text: id,
		tokens,
		override: null,
		autoFolded: false,
		by: null,
		proactivelyCompressed: false,
	};
}

class DigestlessGroupConductor implements Conductor {
	readonly id = "digestless-group-probe";
	readonly label = "Digestless group probe";
	conductCalls = 0;
	conduct(_view: ConductorView): ConductorResult {
		this.conductCalls++;
		return [{ kind: "group", ids: ["old:0", "old:1"] }];
	}
}

afterEach(() => vi.unstubAllGlobals());

describe("conductor rerun probe", () => {
	it("keeps scheduling reruns when a mutable digestless group leaves the store over cap", () => {
		const queued: Array<() => void> = [];
		vi.stubGlobal("queueMicrotask", (fn: () => void) => queued.push(fn));
		const parsed: ParsedSession = {
			meta: { format: "pi", title: "probe", cwd: "", model: "" },
			blocks: [
				block("old:0", 0, 1_000),
				block("old:1", 1, 1_000),
				block("tail:2", 2, 5_000, "user"),
			],
			lineCount: 0,
			skipped: 0,
		};
		const store = new AccordionStore(parsed);
		store.setProtect(5_000);
		store.setBudget(1_000);
		const conductor = new DigestlessGroupConductor();
		store.attach(conductor);

		expect(queued).toHaveLength(1);
		for (let pass = 0; pass < 5; pass++) {
			queued.shift()!();
			expect(queued, `pass ${pass + 1} scheduled another rerun`).toHaveLength(1);
			expect(store.liveTokens).toBeGreaterThan(store.budget);
		}
		expect(conductor.conductCalls).toBe(6);
	});
});
