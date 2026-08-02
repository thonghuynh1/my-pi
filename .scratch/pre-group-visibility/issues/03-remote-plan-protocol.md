---
status: closed
---

# Remote Pre-Group plan protocol and bundled conductor migration

Type: AFK
Status: ready-for-agent

## Parent

`.scratch/pre-group-visibility/PRD.md`

## What to build

Mirror Issue 01’s complete-plan contract over the WebSocket escape hatch. A revisioned `conductor/commands` message must carry optional complete Pre-Group membership, pass it through `RemoteRunner` into the real store atomically with commands, reject stale membership with stale commands, and keep conductor status display-only. Move the accepted conductor protocol version, bundled remote conductors, smoke fixtures, and developer documentation together.

Covers `DEC-005`, `DEC-006`, `RB-002`, `RB-003`, `RB-004`, and `RB-014`.

## Implementation map

### Blocking contract consumed from Issue 01

Producer: `01-authoritative-pre-group-map.md`.

Required output:

- `PreGroupRegion`, `ConductorPlan`, and `ConductorResult` exported from `extensions/accordion/conductors/contract/conductor.ts`;
- a store path that accepts one complete normalized plan and atomically exposes membership plus commands;
- legacy/no-region plans normalize to empty membership.

Consumer: `RemoteRunner` in `extensions/accordion/app/src/lib/live/conductorClient.svelte.ts`. This issue owns wiring the remote message into that existing store seam. Do not create a remote-only membership store or use the status module.

### Wire contract

Edit `extensions/accordion/conductors/contract/protocol.ts` at `CONDUCTOR_PROTOCOL_VERSION` and `ConductorCommandsMessage`:

```ts
interface ConductorCommandsMessage {
  type: "conductor/commands";
  rev?: number;
  commands: Command[];
  preGroup?: PreGroupRegion;
}
```

The field is complete next membership for that revision. Omission owns no region. Keep `Command` unchanged. Bump the accepted conductor protocol version from 3 to 4 and document the history entry as complete plan-region metadata.

### Remote runner

In the `conductor/commands` handler, retain the existing greeted gate and stale-revision check before changing desired state. Store commands and `preGroup` as one complete plan, then call the existing refold/application path. A stale message changes neither. A message without `preGroup` clears remote region ownership. `conductor/status` must remain display-only and must never mutate region membership.

Update `extensions/accordion/app/src/lib/live/conductorClient.test.ts` with real `FakeWebSocket → RemoteRunner → AccordionStore` tests. Use fixture IDs that differ from any ambient/default block IDs and assert public store behavior, including human fold refusal, so a runner that merely stores JSON without wiring it fails.

### Version migration and documentation

Update all bundled version literals and comments discovered at:

- `extensions/accordion/conductors/the-conductor/the-conductor.ts`
- `extensions/accordion/conductors/the-conductor-v2/the-conductor.ts`
- `extensions/accordion/conductors/tiered-relevance/tiered-relevance.mjs`
- corresponding smoke tests and handshake fixtures
- `extensions/accordion/docs/conductor-protocol.md`
- `extensions/accordion/conductors/README.md`

Bundled conductors need not declare a Pre-Group region; omission must continue to mean no ownership. Their v4 handshake and existing command behavior must pass unchanged.

Grounding: `GROUND-003`, `GROUND-005`, and `GROUND-006` in `.scratch/grills/k7p3n9v2x4qm/grounding.md`. Governing decisions: Accordion ADR 0007’s complete desired state, ADR 0008’s one public contract, and ADR 0011’s distinction between observation and steering.

## Acceptance criteria

- [ ] **AC-03-01 — Remote metadata reaches real store behavior:** a greeted v4 message carrying `remote:pg:17` reaches exact store membership and its same-message commands apply.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts -t "applies remote pre-group metadata with commands as one plan"`
  - Expected: `store.isPreGroup("remote:pg:17")` is true, an unrelated command effect is visible, and a human fold of the member creates no override; a runner that only stores JSON fails.

- [ ] **AC-03-02 — Stale revisions are atomic no-ops:** after revision 2 is current, a revision 1 message with different commands and membership changes neither.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts -t "drops stale remote commands and pre-group membership together"`
  - Expected: revision 2 membership and fold state remain byte-for-byte unchanged.

- [ ] **AC-03-03 — Omitted metadata clears remote ownership:** a current command message without `preGroup` clears prior remote membership.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts -t "treats omitted remote pre-group metadata as no region"`
  - Expected: commands apply and membership becomes empty in that revision.

- [ ] **AC-03-04 — Remote status remains display-only:** a status message containing pre-group-like metrics cannot create membership.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts -t "does not steer pre-group membership from remote status"`
  - Expected: membership remains empty while status text and metrics are retained.

- [ ] **AC-03-05 — Host and client fixtures speak protocol 4:** the canonical constant and client handshake tests accept version 4 and reject a distinct mismatch.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts -t "protocol"`
  - Expected: accepted hello fixtures report 4 and the existing `999` mismatch follows the error path.

- [ ] **AC-03-06 — Tiered relevance migrates to v4:** its hello and smoke fixture use protocol 4 without changing command behavior.
  - Run: `node --test smoke.test.mjs` from `extensions/accordion/conductors/tiered-relevance`
  - Expected: smoke passes and asserts hello `conductorProtocol === 4`.

- [ ] **AC-03-07 — The Conductor migrates to v4:** its hello and smoke fixture use protocol 4 without changing command behavior.
  - Run: `node --test smoke.test.ts` from `extensions/accordion/conductors/the-conductor`
  - Expected: smoke passes and accepts the v4 host handshake.

- [ ] **AC-03-08 — The Conductor v2 migrates to v4:** its hello and smoke fixture use protocol 4 without changing command behavior.
  - Run: `node --test smoke.test.ts` from `extensions/accordion/conductors/the-conductor-v2`
  - Expected: smoke passes and accepts the v4 host handshake.

- [ ] **AC-03-09 — Developer docs preserve the legacy-array branch:** the reference states that `Command[]` is a complete command snapshot with no owned region.
  - Run: `node -e "const s=require('fs').readFileSync('extensions/accordion/docs/conductor-protocol.md','utf8');if(!/Command\[\][\s\S]*no (owned )?region/i.test(s))process.exit(1)"` from repository root
  - Expected: command exits 0 only when the legacy branch and no-region outcome are documented together.

- [ ] **AC-03-10 — Developer docs define the plan-envelope branch:** the reference shows `ConductorPlan` with `preGroup.memberIds` as complete next membership.
  - Run: `node -e "const s=require('fs').readFileSync('extensions/accordion/docs/conductor-protocol.md','utf8');for(const x of ['ConductorPlan','preGroup','memberIds','complete next membership'])if(!s.includes(x))process.exit(1)"` from repository root
  - Expected: command exits 0 only when all normative envelope terms are present.

- [ ] **AC-03-11 — Developer docs preserve the null branch:** the reference states that `null` holds previous commands and membership.
  - Run: `node -e "const s=require('fs').readFileSync('extensions/accordion/docs/conductor-protocol.md','utf8');if(!/null[\s\S]*hold[\s\S]*membership/i.test(s))process.exit(1)"` from repository root
  - Expected: command exits 0 only when the complete hold semantics are documented.

- [ ] **AC-03-12 — Developer docs keep status non-authoritative:** the reference explicitly calls conductor status display-only for membership.
  - Run: `node -e "const s=require('fs').readFileSync('extensions/accordion/docs/conductor-protocol.md','utf8');if(!/status[\s\S]*display-only[\s\S]*membership/i.test(s))process.exit(1)"` from repository root
  - Expected: command exits 0 only when the prohibition is explicit.

- [ ] **AC-03-13 — Focused remote regression suite passes:** existing greeting, pre-greeting refusal, revision, command-result, capability, and status tests remain green.
  - Run: `npx vitest run src/lib/live/conductorClient.test.ts` from `extensions/accordion/app`
  - Expected: the complete focused suite passes with no failed legacy or new remote-plan cases.

## Blocked by

- `01-authoritative-pre-group-map.md`
