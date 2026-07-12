Status: ready-for-agent

## Parent

`.scratch/accordion-authoritative-runtime/PRD.md`

## What to build

Add defensive multi-dashboard conflict handling: semantically rebase stale commands against independent targets and reject stale commands against the same target. Cover `DEC-018` and `RB-013`.

## Implementation map

- Consume typed commands/acks and optimistic rollback behavior from `10-optimistic-dashboard-controls.md`.
- Maintain authoritative command/revision history sufficient to identify targets changed since `expectedRevision`. Keep it bounded to active revision/conflict needs.
- Current revision commands apply normally. A stale command rebases only if no intervening accepted command changed the same typed target. Same-target stale commands return `rejected` with current revision and authoritative target snapshot.
- No command silently overwrites another dashboard's same-target action. All observers receive the same ordered authoritative revision broadcast.
- Rejected optimistic state rolls back through issue 10's real acknowledgement path; do not add a separate browser conflict mechanism.
- Dependency proof: two actual observer sockets must exercise extension arbitration and one browser's rollback. The test fails if the broker or browser decides the conflict.
- Grounding: `GROUND-007`, `GROUND-010`, `GROUND-011`.

## Acceptance criteria

- [ ] Two stale commands for different blocks/settings both succeed, with the second acknowledged as `rebased` and ordered in the authoritative revision stream.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-conflicts.test.ts`
  - Expected: independent-target two-client test applies both intents in revision order.
- [ ] Two stale commands for the same block/group/setting reject the later command without changing authoritative state.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-conflicts.test.ts`
  - Expected: same-target matrix returns `rejected` and preserves the first accepted value.
- [ ] Rejection broadcasts current target state and causes only the losing dashboard's optimistic target to roll back.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-conflicts.test.ts vendor/accordion/app/src/lib/live/dashboard-controls.test.ts`
  - Expected: end-to-end rollback test leaves unrelated pending/authoritative targets unchanged.
- [ ] Reconnect does not reset command revision or permit an old expected revision to overwrite current state.
  - Run: `npx vitest run vendor/accordion/extension/runtime/dashboard-conflicts.test.ts`
  - Expected: reconnect/stale-command test rejects the conflict and both observers converge.

## Blocked by

- `10-optimistic-dashboard-controls.md`
