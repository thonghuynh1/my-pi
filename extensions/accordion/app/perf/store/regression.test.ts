import { describe, expect, it, vi } from "vitest";
import type { Conductor } from "$conductors/contract";
import { blk, loadSampleSession, makeStore, mockHarness } from "../fixtures/helpers";

describe("AccordionStore.applySync regressions", () => {
  it("returns false and does not refold when harness and blocks are unchanged", () => {
    const store = loadSampleSession();
    store.setBudget(80_000);
    store.applySync({ harness: mockHarness, blocks: [] });
    const runConductor = vi.spyOn(store as any, "runConductor");

    const changed = store.applySync({ harness: { ...mockHarness }, blocks: [] });

    expect(changed).toBe(false);
    expect(runConductor).not.toHaveBeenCalled();
  });

  it("keeps the pre-group array when a new plan has unchanged membership", () => {
    const conductor: Conductor = {
      id: "pre-group-test",
      label: "pre-group-test",
      conduct: (view) => ({
        commands: [],
        preGroup: { memberIds: view.blocks.length ? [view.blocks[0].id] : [] },
      }),
    };
    const store = makeStore([blk(0)]);
    store.attach(conductor);
    store.applySync({ blocks: [blk(1)] });
    const firstMembership = store.preGroupIds;

    store.applySync({ blocks: [blk(2)] });

    expect(store.preGroupIds).toBe(firstMembership);
  });
});
