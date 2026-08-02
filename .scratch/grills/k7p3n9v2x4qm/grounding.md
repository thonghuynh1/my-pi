# Grill grounding

### GROUND-001 — Context-map partition
- **Source:** `extensions/accordion/app/src/lib/ui/map/ContextMap.svelte` → `protectedFrom`, `olderTiles`, `protectedTiles`, `displayRows`, `protSpecs`
- **Existing behavior:** The map partitions blocks only at `store.protectedFromIndex`: an older/foldable box and a visually emphasized Protected Tail box. Pre-Group blocks are included in the older box. Transcript rows only distinguish Protected Tail through `store.isProtected(b)`.
- **Current excerpt:** `olderTiles = tiles.slice(0, protectedFrom)` and `protectedTiles = tiles.slice(protectedFrom)`; map markup renders `.box.older` and `.box.prot`.
- **Test prior art:** `extensions/accordion/app/src/lib/ui/map/MapHeader.budget.test.ts` uses Testing Library + jsdom for Svelte UI; `drain.test.ts` covers protected-box movement bookkeeping.

### GROUND-002 — Authoritative Pre-Group calculation
- **Source:** `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `conduct`, `preGroupFromIndex`, `preGroupBlocks`, `finishConduct`
- **Existing behavior:** `MyCustomizeConductor` computes the interval, excludes its IDs from normal fold candidates and ordinary group runs, restores folded members, and emits rollover groups through existing safe-range logic.
- **Current excerpt:** `const preGroupBlocks = view.blocks.slice(preGroupFromIndex, view.protectedFromIndex)` and ordinary groups require `!preGroupBlockIds.has(block.id)`.
- **Test prior art:** `extensions/accordion/app/src/lib/engine/conductor.compaction-naive.test.ts` → chunked-compaction status, no-fold, complete-turn, open-tool-pair, early-rollover, and atomic-rebase tests.

### GROUND-003 — Display-only conductor status
- **Source:** `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `buildHost().setStatus`; `extensions/accordion/app/src/lib/live/conductorClient.svelte.ts` → `conductor/status`
- **Existing behavior:** Status carries text, primitive metrics, and JSON details only for display. The remote handler explicitly does not refold or touch command paths.
- **Current excerpt:** `// Display-only ... this channel never steers context.`
- **Test prior art:** `extensions/accordion/app/src/lib/engine/store.host.test.ts` → `setStatus()` display telemetry; `extensions/accordion/app/src/lib/live/conductorClient.test.ts` → remote status storage and clearing.

### GROUND-004 — Behavioral control and group gates
- **Source:** `extensions/accordion/conductors/contract/conductor.ts` → `Conductor`, `Command`; `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `canFold`, `fold`, `createGroup`, `applyCommands`
- **Existing behavior:** `conduct()` returns a complete `Command[] | null`; the store owns fold/group enforcement. Involvement locks disable whole steering domains but cannot reserve a contiguous subregion. Human groups snap to whole messages and are rejected for Protected Tail or overlap.
- **Current excerpt:** `conduct(view: ConductorView): Command[] | null`; `canFold` checks wire foldability, Protected Tail, folded-group membership, and pins.
- **Test prior art:** `extensions/accordion/app/src/lib/engine/store.host.test.ts`, store fold/group tests, and `conductor.my-customize-conductor.test.ts`.

### GROUND-005 — Atomic plan application and remote revisions
- **Source:** `extensions/accordion/app/src/lib/engine/store.svelte.ts` → `runConductor`; `extensions/accordion/conductors/contract/protocol.ts` → `ConductorCommandsMessage`; `extensions/accordion/app/src/lib/live/conductorClient.svelte.ts` → remote `conductor/commands`
- **Existing behavior:** The store resets conductor-owned mutable state, receives a complete desired command state, and applies it. Remote replies echo a revision and stale replies are dropped.
- **Current excerpt:** `commands: Command[]`; stale remote replies satisfy `m.rev !== undefined && m.rev < this.rev` and are ignored.
- **Test prior art:** `extensions/accordion/app/src/lib/live/conductorClient.test.ts` → stale revision, missing revision compatibility, handshake, and command application tests.

### GROUND-006 — Conductor protocol documentation and compatibility wiring
- **Source:** `extensions/accordion/conductors/contract/protocol.ts` → `CONDUCTOR_PROTOCOL_VERSION`; `extensions/accordion/docs/conductor-protocol.md` → return contract; bundled remote conductors under `extensions/accordion/conductors/`
- **Existing behavior:** Protocol version is 3. The developer reference documents `conduct(view) → Command[] | null`; bundled wire conductors inline version 3 and smoke tests pin it.
- **Current excerpt:** `export const CONDUCTOR_PROTOCOL_VERSION = 3`.
- **Test prior art:** `conductorClient.test.ts` validates handshake mismatch; `tiered-relevance/smoke.test.mjs` pins its wire version.
