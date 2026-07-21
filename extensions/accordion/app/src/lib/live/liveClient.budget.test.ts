import { describe, it, expect } from "vitest";
import { liveBudgetForContextWindow } from "./liveClient.svelte";

describe("live budget defaults", () => {
	it("uses the same capped default budget for hello and sync context windows", () => {
		expect(liveBudgetForContextWindow(200_000)).toBe(100_000);
		expect(liveBudgetForContextWindow(64_000)).toBe(64_000);
	});
});
