---
status: ready-for-agent
---

# Persist panic-undo tracker state and terminal reasons

Status: ready-for-agent

## What to build

Persist the panic-undo tracker state across restarts and record terminal reasons for each undo
entry so the recovery flow can explain why a file was reverted.

## Constraints

- Must not introduce synchronous file I/O on the hot path.
- State file must be written atomically to avoid partial reads on crash.

## Build notes

- Use the existing `AtomicWriter` helper from `src/lib/atomic-writer.ts`.
- Wire state loading in `src/tracker/tracker.ts` at the `initialize()` call site.

## Acceptance criteria

- [ ] Tracker state is read from disk at initialize and written on every mutation.
- [ ] Each undo entry records a terminal reason string (at most 200 chars).
- [ ] Tests cover missing state file, corrupted state file, and normal round-trip.
- [ ] `npm run check` passes with zero type errors.

## Blocked by

- [08-add-atomic-writer-utility.md](08-add-atomic-writer-utility.md)
