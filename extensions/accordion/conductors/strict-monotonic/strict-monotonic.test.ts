import assert from "node:assert/strict";
import { test } from "node:test";
import { StrictMonotonicConductor } from "./strict-monotonic.ts";
import type { ConductorView, ViewBlock } from "../contract/index.ts";

function block(id: string, order: number, folded: boolean): ViewBlock {
	return {
		id,
		kind: "text",
		turn: order,
		order,
		tokens: 80,
		foldedTokens: 10,
		proactivelyCompressed: false,
		held: false,
		folded,
		protected: false,
		grouped: false,
	};
}

test("does not reissue folds for blocks already folded", () => {
	const commands = new StrictMonotonicConductor().conduct({
		blocks: [block("already-folded", 0, true), block("live", 1, false)],
		budget: 100,
		contextWindow: 100,
		liveTokens: 160,
		protectedFromIndex: 2,
		protectTokens: 0,
		frozenFromIndex: 0,
	} satisfies ConductorView);

	assert.deepEqual(commands, [{ kind: "fold", ids: ["live"] }]);
});
