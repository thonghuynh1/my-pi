# Frozen Accordion tab diagnosis

## Diagnosis

The tab is trapped in an unbounded microtask rerun cycle inside `AccordionStore`.

The active conductor emits a mutable group without a digest. The store applies that group while the session remains over budget. It then schedules another conductor pass. The next pass removes the mutable digestless group, recreates it from the cached conductor result, sees that the session is still over budget, and schedules another microtask. The queue never drains, so the renderer cannot process input or CDP commands.

## Live evidence

- Orca browser page `b5aac5ce-780d-4122-a131-f67c2a17eb2a` timed out for snapshot, screenshot, eval, console, and exec commands.
- The broker HTTP server remained responsive.
- `GET /__accordion/sessions` reported `tokens=230995` and `contextWindow=272000`.
- Orca renderer PID 35464 consumed 3.000 CPU seconds over 3 wall-clock seconds after the Pi agent stopped.
- A five-second sample recorded 108.6 percent of one logical core. The hottest thread accounted for 89.6 percent of process CPU.
- The spin continued after all tool reads stopped. This rules out streaming load as the sustaining cause.

CPU samples are in `renderer-35464-cpu-samples.csv`.

## Actual served bundle

The frozen page serves `extensions/accordion/app/build/_app/immutable/chunks/DDxkD2-d.js`.

The bundle contains the rerun condition:

```js
this.groups.some(h=>!u.has(h.id))&&this.liveTokens>Ot(this.buildView(s))&&this.conductor&&this.requestConductorRerun(this.conductor,this.conductorEpoch)
```

Its `clearConductorState` keeps conductor groups only when their digest starts with the chunked-compaction prefix or a member touches the frozen prefix.

The same served bundle contains this production conductor path:

```js
createDefaultGroup(t,e){const o=Xn(t.map(s=>s.id),e.blocks);return o.length>=2?{kind:"group",ids:o}:null}
```

That group has no digest. `planNormalPressure` pushes it into the command list.

Relevant bundle excerpts are in:

- `live-bundle-store-focused.js`
- `live-bundle-digestless-group-excerpt.js`

## Source mapping

- `extensions/accordion/app/src/lib/engine/store.svelte.ts:688` owns `requestConductorRerun`.
- `extensions/accordion/app/src/lib/engine/store.svelte.ts:1000` owns `runConductor`.
- `extensions/accordion/app/src/lib/engine/store.svelte.ts:1060` rearms the rerun when a group was created and the store remains over cap.
- `extensions/accordion/app/src/lib/engine/store.svelte.ts:1085` removes mutable conductor groups before every pass.
- `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:293` creates the digestless default group.
- `extensions/accordion/conductors/my-customize-conductor/my-customize-conductor.ts:299` emits it during normal pressure.

## Deterministic proof

`rerun-loop.probe.test.ts` replaces `queueMicrotask` with a bounded queue. A store with two old blocks, one protected 5000-token tail block, a 1000-token budget, and a conductor that emits the digestless group schedules a new rerun after every manually executed callback.

The probe passed for five consecutive reruns. `conductCalls` reached six and one new callback remained queued after every pass.

Command used:

```text
npx vitest run src/lib/engine/rerun-loop.probe.test.ts
```

Result:

```text
Tests  1 passed (1)
```

The temporary in-tree copy was removed. The rerunnable probe remains in this artifact directory.

## Secondary costs

The unconditional `version++` in `runConductor` triggers `runFoldCheck` through `+page.svelte`. That adds repeated full-block scans to every loop iteration. It makes the freeze more expensive but does not create the loop.

Broker slot conductor thrashing and streaming render work are real risks. They can help the session reach the triggering state faster. They do not explain why one renderer core remains saturated after streaming stops.
