# Grounding — Authoritative Accordion Folding Runtime

### GROUND-001 — Pi context plan critical path
- Source: `vendor/accordion/extension/accordion.ts` → `pi.on("context")`, `requestPlan()`
- Existing behavior: Every provider context is fully linearized, sent to the attached GUI, and allowed to pass through or reuse a prior plan when the GUI is absent/late; normal/full waits are 250/2000 ms.
- Current excerpt: `const all = linearize(lastMessages)`; `if (!attached()) ... return`; `const plan = await requestPlan(...)`.
- Test prior art: `vendor/accordion/app/src/lib/live/mapping.test.ts`; `vendor/accordion/extension/cache-tracker.test.ts`.

### GROUND-002 — Activation and session lifecycle
- Source: `vendor/accordion/extension/accordion.ts` → `pi.registerCommand("accordion")`, `session_start`, `session_shutdown`, `session_before_compact`
- Existing behavior: `/accordion` focuses/launches the app and broker, then waits for GUI attachment; session startup writes a registry entry and shutdown removes it. Native compaction is suppressed only while a GUI is attached.
- Current excerpt: `/accordion` sets `attachGraceUntil`; no GUI means raw pass-through.
- Test prior art: extension hooks and broker integration currently rely on manual/integration coverage.

### GROUND-003 — Provider-safe mapping and application
- Source: `vendor/accordion/app/src/lib/live/mapping.ts` → `linearize()`, `applyPlan()`, `isDurableId()`
- Existing behavior: Durable blocks are created from Pi messages; only text, thinking, and tool results may be substituted. User/tool-call blocks remain intact and group application preserves tool pairing.
- Current excerpt: unsafe/non-durable operations are filtered before two-phase fold/group application.
- Test prior art: `mapping.test.ts`, `mapping.groups.test.ts`, `mapping.dropgroup.test.ts`.

### GROUND-004 — Full-scan browser engine
- Source: `vendor/accordion/app/src/lib/engine/store.svelte.ts` → `AccordionStore.runConductor()`, `clearConductorState()`, `buildView()`
- Existing behavior: Every refold scans blocks to heal protection, clears conductor state, allocates a complete `ConductorView`, synchronously conducts, and reapplies commands—even when the conductor holds its prior plan.
- Current excerpt: `result = this.conductor ? this.conductor.conduct(this.buildView(protectedFrom)) : []`.
- Test prior art: `store.test.ts`, `store.host.test.ts`, `store.foldgate.test.ts`, `store.locks.test.ts`, `foldconsistency.property.test.ts`.

### GROUND-005 — Serializable conductor contract
- Source: `vendor/accordion/conductors/contract/conductor.ts` → `Conductor`, `ConductorView`, `Command`, `availableCap()`
- Existing behavior: View and command types are dependency-free serializable data; `conduct()` is synchronous and complete-state based. Host capabilities and rerun callbacks require adapters for worker execution.
- Current excerpt: `conduct(view: ConductorView): Command[] | null` where `null` means hold and `[]` means clear.
- Test prior art: `vendor/accordion/app/src/lib/engine/conductor.test.ts`, `store.host.test.ts`.

### GROUND-006 — My Customize warm-path bottlenecks
- Source: `vendor/accordion/conductors/my-customize-conductor/my-customize-conductor.ts` → `MyCustomizeConductor.conduct()`
- Existing behavior: The conductor caches its prior plan but builds an O(n) JSON `viewKey`, maps/scans all blocks, constructs reachability graphs, and may sort candidates before returning a plan.
- Current excerpt: `const viewKey = JSON.stringify([...view.blocks.map(...)])` runs before epoch-hold checks.
- Test prior art: `vendor/accordion/app/src/lib/engine/conductor.my-customize-conductor.test.ts`.

### GROUND-007 — Existing revisioned asynchronous adapter
- Source: `vendor/accordion/app/src/lib/live/conductorClient.svelte.ts` → `RemoteRunner`, `pushContext()`, `attachConductor()`
- Existing behavior: A monotonic revision is sent to an external WebSocket conductor; stale command replies are dropped and cached desired commands are returned synchronously while asynchronous work completes.
- Current excerpt: `conduct()` pushes context and returns cached desired state; replies trigger rerun.
- Test prior art: `vendor/accordion/app/src/lib/live/conductorClient.test.ts` fake-WebSocket handshake, stale-revision, lock, retry, and capability tests.

### GROUND-008 — External conductor parity gaps
- Source: `vendor/accordion/conductors/contract/protocol.ts` and `vendor/accordion/app/src/lib/live/conductorClient.svelte.ts` → `ContextUpdateMessage`, `ConductorHelloMessage`, `serveCapability()`
- Existing behavior: The wire omits `harnessOverhead`, `outputReserve`, `calibration`, and remote `tailTokens`; external conductors therefore do not receive the complete in-process budgeting/tail contract.
- Current excerpt: `ConductorView` has these fields while `ContextUpdateMessage`/`ConductorHelloMessage` do not.
- Test prior art: extend `conductorClient.test.ts`; smoke tests live at `vendor/accordion/conductors/the-conductor*/smoke.test.ts`.

### GROUND-009 — Dashboard currently calculates plans
- Source: `vendor/accordion/app/src/lib/live/liveClient.svelte.ts` → `computePlan()`; `sessionSlots.svelte.ts` → `connectSlot()`
- Existing behavior: Direct and broker modes append blocks into browser-owned stores, attach the selected conductor, calculate fold/group operations, and reply with `PlanMessage`.
- Current excerpt: `computeFoldOps(store)` and `computeGroupOps(store)` execute in each browser slot on sync.
- Test prior art: `liveClient.budget.test.ts`, `sessionSlots.test.ts`, `plan.test.ts`.

### GROUND-010 — Browser/session protocol and client ownership
- Source: `vendor/accordion/app/src/lib/live/protocol.ts` and `vendor/accordion/extension/accordion.ts` → `PROTOCOL_VERSION`, `SyncMessage`, `PlanMessage`, extension `client`/`epoch`
- Existing behavior: Protocol v5 supports one effective GUI client; a new connection supersedes the previous client. Request IDs are connection-scoped, and there are no authoritative runtime revisions, command acknowledgements, or multi-client conflict responses.
- Current excerpt: reconnect bumps `epoch`, flushes pending requests, and resets `sentCount`.
- Test prior art: `sessionSlots.test.ts`, `brokerMode.test.ts`, broker WebSocket proxy tests.

### GROUND-011 — Broker remains a transport seam
- Source: `packages/accordion-broker/src/server.ts` → `createBrokerServer()`, `proxySession()`
- Existing behavior: The broker is a transparent HTTP/WebSocket proxy and is stateless with respect to fold plans; session routing is based on watched, live registry entries.
- Current excerpt: frames are relayed without semantic inspection.
- Test prior art: `packages/accordion-broker/__tests__/broker.test.ts`, `registry.test.ts`.

### GROUND-012 — Per-session registry persistence
- Source: `vendor/accordion/app/src/lib/live/registry.ts` → `SessionEntry`; `vendor/accordion/extension/accordion.ts` → `writeEntry()`
- Existing behavior: Each active Pi session atomically writes `~/.accordion/sessions/<sessionId>.json` on a five-second heartbeat and deletes it on shutdown; entries currently contain discovery/model/token metadata only.
- Current excerpt: `REGISTRY_PROTOCOL = 1`, `HEARTBEAT_INTERVAL_MS = 5_000`, `STALE_AFTER_MS = 15_000`.
- Test prior art: broker registry tests and `sessionSlots.test.ts`.

### GROUND-013 — Browser-local runtime preferences
- Source: `vendor/accordion/app/src/lib/live/conductor.svelte.ts`, `conductorDiscovery.svelte.ts`, `settings.svelte.ts`
- Existing behavior: Active conductor and configured external URLs are browser `localStorage`; `my-customize-conductor` is the fallback. Budget is initialized from `min(contextWindow, 100_000)` per attach.
- Current excerpt: `localStorage.getItem(KEY) || "my-customize-conductor"`.
- Test prior art: `activeConductor.test.ts`, `conductorDiscovery.test.ts`, `liveClient.budget.test.ts`.

### GROUND-014 — Usage Footer shared-state convention
- Source: `extensions/usage-footer.ts` → `getCoachLine()`, `getSubagentLine()`, `installUsageFooter()`; `extensions/frontend-coach/index.ts`; `extensions/subagents.ts`
- Existing behavior: Optional extensions publish process-local snapshots through lazily initialized `globalThis` objects; Usage Footer reads them null-safely on render.
- Current excerpt: absent shared state produces an empty footer segment rather than a dependency failure.
- Test prior art: `extensions/__tests__/capability-visibility.test.ts`; new footer rendering/state tests are required.

### GROUND-015 — Cache-first frozen boundary
- Source: `vendor/accordion/extension/cache-tracker.ts`; `accordion.ts` → `harnessFrame()`; `store.svelte.ts` → `setHarnessBreakdown()`, frozen clamp
- Existing behavior: The provider-cache boundary flows into `ConductorView.frozenFromIndex`; the host clamps ordinary folds below it and permits breaking it only for real context-window pressure.
- Current excerpt: cold start reports zero; later request-side prefix matches advance the frozen boundary.
- Test prior art: `cache-tracker.test.ts`, `store.foldgate.test.ts`, `conductor.my-customize-conductor.test.ts`.

### GROUND-016 — Build and verification wiring
- Source: `package.json`, `vitest.config.ts`, `vendor/accordion/app/package.json`, `packages/accordion-broker/package.json`
- Existing behavior: Root `npm run check` performs TypeScript checking; root Vitest config covers vendor app and extension tests; broker tests are package-local. The app has build/check/test scripts.
- Current excerpt: root has no `test` script; use explicit Vitest/package commands.
- Test prior art: `npx vitest run`, `npm test --prefix vendor/accordion/app`, `npm test --prefix packages/accordion-broker`, `npm run accordion:build`.
