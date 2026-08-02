import { describe, expect, it } from "vitest";
import { blk, loadSampleSession, mockHarness } from "../fixtures/helpers";

describe("AccordionStore.applySync performance", () => {
  it("reconciles the 982-block sample plus one block in under 100ms", () => {
    const store = loadSampleSession();
    store.setBudget(80_000);
    const start = performance.now();

    store.applySync({ harness: mockHarness, blocks: [blk(982)] });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
