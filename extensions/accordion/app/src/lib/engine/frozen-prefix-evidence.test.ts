/**
 * Frozen-prefix stability evidence capture.
 *
 * Simulates the exact cold-start 120k/70k scenario with advancing frozenFromIndex
 * across 6 turns and prints a structured report showing conductor decisions per turn.
 *
 * Run: cd extensions/accordion/app && npx vitest run src/lib/engine/frozen-prefix-evidence.test.ts
 */
import { describe, it, expect } from "vitest";
import { MyCustomizeConductor } from "$conductors";
import type { Command, ConductorView, ViewBlock } from "$conductors/contract";

function vb(
	id: string, kind: ViewBlock["kind"], order: number, tokens: number, foldedTokens: number,
	opts: Partial<Pick<ViewBlock, "held" | "folded" | "protected" | "grouped" | "callId" | "toolName" | "text" | "isError">> = {},
): ViewBlock {
	return {
		id, kind, turn: order + 1, order, tokens, foldedTokens,
		held: opts.held ?? false, folded: opts.folded ?? false, protected: opts.protected ?? false,
		grouped: opts.grouped ?? false, callId: opts.callId, toolName: opts.toolName, text: opts.text, isError: opts.isError,
	};
}

function makeView(blocks: ViewBlock[], budget: number, liveTokens: number, frozenFromIndex: number): ConductorView {
	const protectedFromIndex = blocks.findIndex((b) => b.protected);
	return {
		blocks, budget, liveTokens, contextWindow: 200_000,
		protectedFromIndex: protectedFromIndex < 0 ? blocks.length : protectedFromIndex,
		protectTokens: 0, frozenFromIndex,
	};
}

type TurnReport = {
	turn: number;
	frozenFromIndex: number;
	liveTokens: number;
	foldCount: number;
	groupCount: number;
	replaceCount: number;
	restoreCount: number;
	frozenTargeted: string[];
	unfrozenTargeted: string[];
};

function classifyCommands(commands: Command[], blocks: ViewBlock[], frozenFromIndex: number): TurnReport["frozenTargeted" | "unfrozenTargeted"][] {
	const frozen: string[] = [];
	const unfrozen: string[] = [];
	const frozenIds = new Set(blocks.filter((b) => b.order < frozenFromIndex).map((b) => b.id));
	for (const cmd of commands) {
		const ids = cmd.kind === "fold" ? cmd.ids
			: cmd.kind === "replace" ? [cmd.id]
			: cmd.kind === "restore" ? cmd.ids
			: [];
		if (cmd.kind === "group") continue;
		const breakFrozen = (cmd.kind === "fold" || cmd.kind === "replace") && (cmd as Record<string, unknown>).breakFrozen === true;
		if (breakFrozen) continue;
		for (const id of ids) {
			if (frozenIds.has(id)) frozen.push(id);
			else unfrozen.push(id);
		}
	}
	return [frozen, unfrozen];
}

describe("frozen-prefix stability — evidence capture", () => {
	it("6-turn cold-start lifecycle report", () => {
		const conductor = new MyCustomizeConductor();
		const BUDGET = 70_000;

		// 20 blocks: mix of user, tool_call, tool_result, text, thinking.
		// Total ~125k tokens + 5k tail = 130k. Budget 70k → must fold.
		const content: ViewBlock[] = [];
		for (let i = 0; i < 20; i++) {
			const kinds: ViewBlock["kind"][] = ["user", "tool_call", "tool_result", "text", "thinking"];
			const kind = kinds[i % 5];
			const tokens = kind === "user" ? 4_000 : kind === "tool_call" ? 3_000 : kind === "tool_result" ? 8_000 : kind === "text" ? 7_000 : 5_000;
			const foldedTokens = kind === "user" || kind === "tool_call" ? tokens : 100;
			content.push(vb(
				`b:${i}`, kind, i, tokens, foldedTokens,
				{
					text: `content block ${i} (${kind})`,
					toolName: kind === "tool_call" || kind === "tool_result" ? "read" : undefined,
					callId: kind === "tool_call" ? `call:${i}` : kind === "tool_result" ? `call:${i - 1}` : undefined,
				},
			));
		}
		const tail = vb("tail", "user", 20, 5_000, 5_000, { protected: true, text: "continue working" });
		const allBlocks = [...content, tail];
		const totalTokens = allBlocks.reduce((s, b) => s + b.tokens, 0);

		const frozenSteps = [0, 4, 8, 12, 16, 20];
		const reports: TurnReport[] = [];

		for (const frozen of frozenSteps) {
			conductor.markDirty?.();
			const result = conductor.conduct(makeView(allBlocks, BUDGET, totalTokens, frozen));
			const foldCount = result.commands.filter((c) => c.kind === "fold").length;
			const groupCount = result.commands.filter((c) => c.kind === "group").length;
			const replaceCount = result.commands.filter((c) => c.kind === "replace").length;
			const restoreCount = result.commands.filter((c) => c.kind === "restore").length;
			const [frozenTargeted, unfrozenTargeted] = classifyCommands(result.commands, allBlocks, frozen);

			reports.push({
				turn: frozenSteps.indexOf(frozen) + 1,
				frozenFromIndex: frozen,
				liveTokens: totalTokens,
				foldCount, groupCount, replaceCount, restoreCount,
				frozenTargeted, unfrozenTargeted,
			});
		}

		// Print structured report
		console.log("\n╔══════════════════════════════════════════════════════════════╗");
		console.log("║   FROZEN-PREFIX STABILITY — 6-TURN EVIDENCE REPORT          ║");
		console.log("╠══════════════════════════════════════════════════════════════╣");
		console.log(`║ Blocks: ${allBlocks.length}  Budget: ${BUDGET}  Total: ${totalTokens}  Window: 200k`);
		console.log("╠══════════════════════════════════════════════════════════════╣");
		for (const r of reports) {
			console.log(`║ Turn ${r.turn}  frozenFromIndex=${r.frozenFromIndex}`);
			console.log(`║   folds=${r.foldCount}  groups=${r.groupCount}  replaces=${r.replaceCount}  restores=${r.restoreCount}`);
			console.log(`║   frozen-targeted: ${r.frozenTargeted.length === 0 ? "NONE ✅" : r.frozenTargeted.join(", ") + " ❌"}`);
			console.log(`║   unfrozen-targeted: ${r.unfrozenTargeted.length === 0 ? "none" : r.unfrozenTargeted.join(", ")}`);
			console.log("║");
		}
		console.log("╚══════════════════════════════════════════════════════════════╝\n");

		// Assertions: the actual proof
		for (const r of reports) {
			expect(r.restoreCount, `turn ${r.turn}: no restores`).toBe(0);
			expect(r.frozenTargeted.length, `turn ${r.turn}: nothing targets frozen blocks`).toBe(0);
		}
	});
});
