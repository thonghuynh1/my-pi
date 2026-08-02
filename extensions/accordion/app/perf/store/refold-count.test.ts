import { describe, expect, it, vi } from "vitest";
import { blk, loadSampleSession, mockHarness } from "../fixtures/helpers";

describe("AccordionStore.applySync refold transaction", () => {
  it("runs the conductor exactly once for harness plus fresh blocks", () => {
    const store = loadSampleSession();
    store.setBudget(80_000);
    const runConductor = vi.spyOn(store as any, "runConductor");

    store.applySync({ harness: mockHarness, blocks: [blk(982)] });

    expect(runConductor).toHaveBeenCalledTimes(1);
  });
});
