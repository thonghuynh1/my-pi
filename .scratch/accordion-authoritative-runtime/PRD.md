Status: ready-for-agent

## Problem Statement

Accordion currently requires an attached browser to own `AccordionStore`, run the conductor, and return a fold plan before Pi contacts the model. Opening the Global Accordion Dashboard for a large resumed session causes expensive full-history work in the browser, while running `/accordion` without a browser leaves model requests unfolded. Users also cannot reliably see when a budget or conductor change is still calculating, so a provider request can race an unfinished or stale plan.

The affected actors are Pi users running long, tool-heavy sessions, users monitoring many sessions in the Global Accordion Dashboard, and conductor implementations that require equivalent in-process and WebSocket contracts.

## Solution

Move folding authority into a browser-independent runtime owned by each activated Pi session. `/accordion` starts that runtime with `my-customize` by default, bundled conductors calculate in an isolated worker, and external conductors use the same revision/readiness contract over WebSocket. The dashboard becomes an optional observer/controller. Provider requests wait for a plan matching the newest context revision, while warm delta calculations avoid rescanning the full history.

## User Stories

1. As a Pi user, I want `/accordion` to begin folding without opening a browser, so that context management is active in my normal terminal workflow.
2. As a Pi user, I want model requests to wait for the newest ready plan, so that unfinished budget or conductor changes never produce a stale provider payload.
3. As a Pi user, I want Accordion readiness in Usage Footer, so that I know whether the session is starting, calculating, ready, waiting, over budget, or failed.
4. As a dashboard user, I want to control any discovered session without making the browser authoritative, so that closing or reopening the dashboard does not change folding behavior.
5. As a dashboard user, I want manual block actions to respond immediately and show localized pending state, so that a calculation does not freeze unrelated blocks or sessions.
6. As an external-conductor user, I want full parity with bundled conductors, so that moving authority into Pi does not remove existing conductor choices or budgeting and lock semantics.

## Required Behaviors

- `RB-001`: `/accordion` and `/accordion on` idempotently activate folding for the current Pi session; `/accordion off` and the session-targeted dashboard toggle disable it. Dashboard disconnect and reconnect do not change activation.
- `RB-002`: When inactive, Accordion is raw provider pass-through. When active, an absent dashboard does not disable folding or permit browser-dependent fallback.
- `RB-003`: The authoritative runtime exposes `inactive`, `starting`, `calculating`, `waiting`, `ready`, `ready-frozen-over-budget`, and `error` states with conductor ID, newest revision, ready revision, and actionable error details when applicable.
- `RB-004`: A provider request may proceed only when `readyRevision === contextRevision`; otherwise it waits for that revision. Calculation failure or timeout prevents provider contact and offers retry/cancel rather than sending stale or raw context.
- `RB-005`: Bundled warm, bundled cold/structural, and external calculations have respective deadlines of 1 second, 5 seconds, and 10 seconds. An external conductor may advertise a longer deadline up to a 120-second hard cap.
- `RB-006`: Each active session owns at most one bundled-conductor worker. Intermediate revisions are coalesced; stale results never become authoritative; the worker terminates on session shutdown.
- `RB-007`: A 500k-token, 5,000-block cold session reaches ready within 2 seconds. A warm `my-customize` delta of at most 20 committed blocks or 20k tokens reaches its matching ready revision at p95 no greater than 100 ms without full-history serialization or full conductor recomputation.
- `RB-008`: `~/.accordion/defaults.json` contains small Pi-owned defaults. Each existing `~/.accordion/sessions/<sessionId>.json` contains the active session's complete effective settings and runtime state and is removed on shutdown. Writes remain atomic and heartbeat-compatible.
- `RB-009`: Global-default changes affect future sessions only. Dashboard controls target one explicit session and never recalculate another active session. No legacy browser `localStorage` conductor selection or external URL migration is required.
- `RB-010`: `my-customize-conductor` is the initial default. Bundled and external WebSocket conductors obey the same revision, readiness, deadline, lock, consent, protected-tail, frozen-prefix, calibration, output-reserve, and harness-overhead contracts.
- `RB-011`: Dashboard mutations send a session-targeted command ID, expected revision, target, and desired action. The runtime validates, orders, acknowledges, and broadcasts authoritative outcomes to every observer.
- `RB-012`: A manual block action updates only its target optimistically, shows localized pending state, disables repeated actions for that target, and rolls back with an inline error if rejected or failed. Other blocks and sessions remain interactive.
- `RB-013`: Stale commands against independent targets are semantically rebased. Conflicting stale commands against the same target are rejected and refreshed; no silent last-writer-wins behavior is allowed.
- `RB-014`: Provider-cache protection remains cache-first. If the frozen prefix makes the selected budget unreachable, calculation completes as `ready-frozen-over-budget` and reports frozen tokens/irreducible overage; selected-budget pressure alone never breaks the frozen prefix.
- `RB-015`: Usage Footer continuously renders normal Accordion state through an optional typed `globalThis` snapshot. Notifications occur only when a submitted turn waits, calculation fails, or calculation times out. Accordion remains functional when Usage Footer is disabled or absent.
- `RB-016`: Existing provider-validity rules remain: user and tool-call blocks are never folded, tool pairs remain valid, only durable block IDs shape provider payloads, `recall` remains read-only and unblockable, and `unfold` remains subject to ADR 0011.
- `RB-017`: The Accordion Browser Broker remains a transparent multi-session transport. Authority, command arbitration, and multi-observer state live in the session extension, not the singleton broker.
- `RB-018`: Native compaction suppression follows active authoritative folding rather than browser attachment.
- `RB-019`: Diagnostics record calculation kind, revision, queue/coalescing outcome, duration, deadline, stale-result discard, provider wait, applied plan sizes, frozen overage, and errors without adding disk I/O to the provider critical path.
- `RB-020`: Breaking browser/session and external-conductor protocol changes increment their protocol versions, reject incompatible peers clearly, and update protocol documentation and mirrored registry constants where applicable.

## Accepted Decision Register

- `DEC-001`: **Decision**: `/accordion` folds headlessly with `my-customize`. **Rationale**: Browser launch must be optional. **Rejected alternatives**: Browser-required calculation. **Downstream impact**: Session startup needs a folding runtime.
- `DEC-002`: **Decision**: Expose explicit calculation readiness and prevent request races. **Rationale**: Users currently cannot distinguish ready from still calculating. **Downstream impact**: State machine and request gate are normative.
- `DEC-003`: **Decision**: Each Pi session extension hosts the Authoritative Accordion Folding Runtime. **Rationale**: It colocates folding lifecycle with provider gating. **Rejected alternatives**: Browser authority and singleton-broker authority. **Downstream impact**: Implements ADR 0002 and replaces vendor ADR 0001's boundary.
- `DEC-004`: **Decision**: A submitted request waits for the newest plan and fails closed on bounded failure. **Rationale**: Preserve user action without stale context. **Rejected alternatives**: Last-ready fallback and immediate rejection. **Downstream impact**: Provider contact is forbidden until revision match.
- `DEC-005`: **Decision**: Use global defaults plus complete per-active-session runtime files. **Rationale**: Supports many sessions without ambiguous diffs. **Rejected alternatives**: One combined file and browser-only settings. **Downstream impact**: Extend atomic session registry writes.
- `DEC-006`: **Decision**: Deliver full bundled and external-conductor parity. **Rationale**: Authority migration must not remove conductor choices. **Rejected alternatives**: `my-customize`-only and bundled-only scope. **Downstream impact**: External wire gaps are in scope.
- `DEC-007`: **Decision**: Show normal state in Usage Footer and exceptional notifications. **Rationale**: Headless visibility without notification spam. **Downstream impact**: Footer gains an Accordion segment.
- `DEC-008`: **Decision**: Publish status through the repository's optional typed `globalThis` convention. **Rationale**: Matches Frontend Coach/Subagents without hard extension coupling. **Downstream impact**: Null-safe producer/consumer contract.
- `DEC-009`: **Decision**: Cold proof uses 500k tokens/5,000 blocks and a responsive 20-session dashboard. **Rationale**: Represents heavy real use. **Rejected alternatives**: Small typical and 20-way simultaneous calculation requirements. **Downstream impact**: Add deterministic fixtures and benchmark.
- `DEC-010`: **Decision**: Bundled conductors run in a lazy per-session worker. **Rationale**: Heavy work must not freeze Pi or status rendering. **Rejected alternatives**: Main event loop and cooperative conductor rewrites. **Downstream impact**: Worker adapter and lifecycle are required.
- `DEC-011`: **Decision**: Use revisioned, eager, coalesced incremental warm calculations. **Rationale**: Tool-heavy turns need current plans without repeated full scans. **Downstream impact**: Persistent worker index/state and delta protocol.
- `DEC-012`: **Decision**: Keep cache-first semantics and expose frozen overage. **Rationale**: Strict budget would contradict cache-aware folding decisions and increase cache cost. **Rejected alternatives**: Default cache breaking. **Downstream impact**: Readiness and budget satisfaction are separate.
- `DEC-013`: **Decision**: Use phase-specific bounded deadlines. **Rationale**: Local and external calculations have different legitimate latency. **Rejected alternatives**: One deadline or indefinite wait. **Downstream impact**: Deadline metadata, timers, retry/cancel.
- `DEC-014`: **Decision**: Warm `my-customize` p95 is at most 100 ms for the defined delta. **Rationale**: Repeated sub-second delays accumulate across tool loops. **Downstream impact**: No full serialization/recompute on warm path.
- `DEC-015`: **Decision**: Activation is explicit and session-scoped. **Rationale**: Dashboard lifecycle is observability only. **Rejected alternatives**: Disable on dashboard close and session-lifetime-without-off. **Downstream impact**: Add idempotent on/off command semantics.
- `DEC-016`: **Decision**: Dashboard controls use revisioned command/acknowledgement. **Rationale**: Browser replicas cannot independently mutate provider state. **Downstream impact**: New protocol messages and multi-client broadcasting.
- `DEC-017`: **Decision**: Manual block actions are optimistic with localized pending/rollback UI. **Rationale**: Immediate feedback without global blocking. **Rejected alternatives**: Global overlay and unchanged-until-ready tile. **Downstream impact**: Per-target pending state.
- `DEC-018`: **Decision**: Semantically rebase independent stale commands and reject target conflicts. **Rationale**: Defensive multi-dashboard safety without needless failure. **Rejected alternatives**: Reject-all and last-writer-wins. **Downstream impact**: Target-aware conflict detection.
- `DEC-019`: **Decision**: Make a clean configuration cutover with no `localStorage` migration. **Rationale**: Latest-version users reload and restart `/accordion`; legacy local state does not justify migration complexity. **Rejected alternatives**: Automatic or prompted import. **Downstream impact**: Pi-owned defaults start from `my-customize`.

## Implementation Plan

### Area: Authoritative session runtime and provider gate

- **Coverage**: `DEC-001`, `DEC-002`, `DEC-003`, `DEC-004`, `DEC-013`, `DEC-015`; `US-001`, `US-002`; `RB-001`–`RB-005`, `RB-018`, `RB-019`.
- **Contract**: The session extension owns activation, runtime revisions, readiness, plan application, deadlines, waiting requests, diagnostics, and cleanup. No provider call proceeds without a matching ready revision while active.
- **Code anchors**: `vendor/accordion/extension/accordion.ts` → `session_start`, `pi.on("context")`, `requestPlan()`, `/accordion`, `session_before_compact`, `session_shutdown`, `writeContextDiagnostic()`; `mapping.ts` → `linearize()`, `applyPlan()`.
- **Existing behavior**: The extension sends context to one GUI client and passes through on no attachment/timeout.
- **Required edits**: Introduce the runtime owner/state machine; replace GUI plan requests with local runtime requests; add `/accordion on|off`; gate provider calls; base compaction suppression on activation; retain provider-safe application and buffered diagnostics.
- **Normative snippet**:
```ts
type FoldingRuntimeStatus =
  | "inactive" | "starting" | "calculating" | "waiting"
  | "ready" | "ready-frozen-over-budget" | "error";

interface FoldingRuntimeSnapshot {
  sessionId: string;
  conductorId: string;
  status: FoldingRuntimeStatus;
  contextRevision: number;
  readyRevision: number | null;
  calculationKind?: "warm" | "cold" | "structural" | "external";
  frozenTokens?: number;
  irreducibleOverage?: number;
  error?: { code: string; message: string; retryable: boolean };
}
```
- **Test seam**: Add extension lifecycle/context tests using deterministic fake runtime results; run `npx vitest run vendor/accordion/extension vendor/accordion/app/src/lib/live/mapping.test.ts`. Success: on/off, exact-revision wait, timeout-without-provider-contact, compaction, diagnostics, and provider-validity assertions pass.
- **Wiring**: Install runtime during extension registration; reset on session start; stop worker/conductor and remove registry state on shutdown.
- **Grounding evidence**: `GROUND-001`, `GROUND-002`, `GROUND-003`, `GROUND-015`.

### Area: Worker engine and Warm Folding Calculation

- **Coverage**: `DEC-009`, `DEC-010`, `DEC-011`, `DEC-014`; `US-002`; `RB-006`, `RB-007`, `RB-019`.
- **Contract**: A lazy worker owns bundled conductor instances, indexes, and prior plans. Main-thread messages carry immutable full snapshots only for cold/structural work and deltas for warm work. One calculation runs at a time; only the newest requested revision may commit.
- **Code anchors**: `store.svelte.ts` → `runConductor()`, `clearConductorState()`, `buildView()`; conductor contract `ConductorView`, `Command`; `MyCustomizeConductor.conduct()`; `RemoteRunner` revision pattern.
- **Existing behavior**: Browser `AccordionStore` and `my-customize` perform multiple full scans and full `JSON.stringify` operations on every refold.
- **Required edits**: Extract a runes-free runtime engine; add worker host/adapter and host-capability bridge; maintain delta indexes/protected/frozen boundaries; add fast validation for protected-tail appends; remove full-view key serialization from warm `my-customize`; coalesce obsolete work.
- **Normative snippet**:
```ts
type WorkerRequest =
  | { kind: "initialize"; revision: number; view: ConductorView; conductorId: string }
  | { kind: "delta"; revision: number; baseRevision: number; blocks: ViewBlock[]; boundaries: BoundaryDelta }
  | { kind: "reconfigure"; revision: number; settings: EffectiveFoldingSettings };

type WorkerResult =
  | { kind: "plan"; revision: number; commands: Command[]; metrics: CalculationMetrics }
  | { kind: "error"; revision: number; error: RuntimeError };
```
- **Test seam**: Extend `conductor.my-customize-conductor.test.ts` and add worker protocol/lifecycle tests plus a deterministic benchmark fixture. Success: 500k/5,000 cold ≤2 s and warm delta p95 ≤100 ms, with stale/coalesced revisions never applied.
- **Wiring**: Worker module must be resolvable in source and built extension layouts; terminate and drain promises on shutdown/off.
- **Grounding evidence**: `GROUND-004`, `GROUND-005`, `GROUND-006`, `GROUND-007`.

### Area: Pi-owned defaults and per-session registry state

- **Coverage**: `DEC-005`, `DEC-019`; `US-001`, `US-004`; `RB-008`, `RB-009`, `RB-020`.
- **Contract**: Defaults and session snapshots are versioned JSON. Defaults are read at activation and changed only by explicit save-as-default. Session files contain complete effective values, not diffs.
- **Code anchors**: `registry.ts` → `SessionEntry`, constants; extension `writeEntry()`/`deleteEntry()`; broker `atomicWrite()` prior art; browser `conductor.svelte.ts`, `conductorDiscovery.svelte.ts`, `liveBudgetForContextWindow()`.
- **Existing behavior**: Session files contain discovery metadata; conductor selection and configured URLs are browser-local.
- **Required edits**: Define versioned defaults/effective settings/runtime snapshot fields; preserve atomic heartbeat writes; remove runtime authority from conductor-related `localStorage`; leave display preferences and browser-only secrets local; implement clean cutover without import.
- **Normative snippet**:
```ts
interface AccordionDefaults {
  schemaVersion: 1;
  conductorId: "my-customize-conductor" | string;
  budgetPolicy: { kind: "context-aware"; cap: number };
  externalConductors: Array<{ id: string; label: string; url: string }>;
}

interface EffectiveFoldingSettings {
  enabled: boolean;
  conductorId: string;
  budget: number;
  protectTokens: number;
}
```
- **Test seam**: Registry round-trip, atomic write, malformed/version fallback, multi-session isolation, shutdown deletion, and no-localStorage-import tests; run app/extension Vitest and broker registry tests.
- **Wiring**: Keep vendor and broker registry constants/version mirrors synchronized; honor `ACCORDION_HOME` for tests.
- **Grounding evidence**: `GROUND-012`, `GROUND-013`.

### Area: External conductor parity and lifecycle

- **Coverage**: `DEC-006`, `DEC-013`; `US-006`; `RB-005`, `RB-010`, `RB-016`, `RB-020`.
- **Contract**: Session runtime, not browser store, owns external handshake, consent, locks, revision updates, capabilities, reconnect/error state, and deadline enforcement. External views include all budgeting fields available in-process and hello supports `tailTokens`.
- **Code anchors**: `conductorClient.svelte.ts` → `RemoteRunner`, `attachConductor()`, `serveCapability()`; conductor `protocol.ts`; `conductorDiscovery.svelte.ts`; `registry.ts` → `ConductorEntry`; ADR 0011.
- **Existing behavior**: Browser owns external connections; wire revisions reject stale replies but omit calibration/harness/output-reserve and remote tail size.
- **Required edits**: Move/adapt `RemoteRunner` into the session runtime; add omitted parity fields; retain protocol mismatch rejection, sacred controls, consent, lock filtering, recall availability, and host capabilities; surface connection/calculation errors through runtime state.
- **Normative snippet**: `ContextUpdateMessage` must carry `harnessOverhead?`, `outputReserve?`, and `calibration?`; `ConductorHelloMessage` must carry validated `tailTokens?`; command replies must echo the authoritative revision.
- **Test seam**: Reuse FakeWebSocket tests for handshake, stale reply, disconnect, deadline advertisement/cap, locks/consent, complete capability, calibration fields, tailTokens, and breakFrozen clamp. Run conductor smoke tests where configured.
- **Wiring**: Bump conductor protocol; update `docs/conductor-protocol.md`, correcting documented capability names and recoverable replace behavior.
- **Grounding evidence**: `GROUND-005`, `GROUND-007`, `GROUND-008`, `GROUND-015`.

### Area: Dashboard replica, controls, and optimistic UI

- **Coverage**: `DEC-016`, `DEC-017`, `DEC-018`; `US-004`, `US-005`; `RB-003`, `RB-011`–`RB-013`, `RB-020`.
- **Contract**: Browser stores are read replicas. Commands include session, command ID, expected revision, typed target, and desired state. Acknowledgements report applied/rebased/rejected and authoritative revision/snapshot.
- **Code anchors**: `protocol.ts`; `liveClient.svelte.ts` → `computePlan()` and message handler; `sessionSlots.svelte.ts` → `connectSlot()`; `store.svelte.ts` block/group mutators; map block components.
- **Existing behavior**: Each browser slot owns a conductor/store and calculates `PlanMessage`; a second client supersedes the first.
- **Required edits**: Replace plan calculation with runtime subscriptions and commands; support multiple observers; implement target-scoped pending indicators/rollback; broadcast snapshots/acks; implement semantic rebase and same-target rejection; make folding toggle session-targeted.
- **Normative snippet**:
```ts
type DashboardTarget =
  | { kind: "block"; id: string }
  | { kind: "group"; id: string }
  | { kind: "setting"; key: "enabled" | "budget" | "protectTokens" | "conductorId" };

interface DashboardCommand {
  commandId: string;
  sessionId: string;
  expectedRevision: number;
  target: DashboardTarget;
  action: JSONValue;
}

interface DashboardAck {
  commandId: string;
  outcome: "applied" | "rebased" | "rejected";
  revision: number;
  error?: RuntimeError;
}
```
- **Test seam**: Extend `sessionSlots.test.ts` and UI/store tests for observer-only behavior, pending block display, rollback, unrelated rebase, same-target rejection, two browser clients, and session isolation. Success: no browser-side conductor execution occurs.
- **Wiring**: Bump Pi browser protocol; update direct and broker client paths together.
- **Grounding evidence**: `GROUND-009`, `GROUND-010`.

### Area: Cache-first budget state and provider safety

- **Coverage**: `DEC-012`; `US-002`, `US-003`; `RB-014`, `RB-016`, `RB-019`.
- **Contract**: Frozen prefix protection is independent of calculation readiness. Selected-budget overage reports frozen tokens and irreducible overage without `breakFrozen`; only actual provider-window pressure may authorize existing breakFrozen behavior.
- **Code anchors**: `cache-tracker.ts`; extension `harnessFrame()`; store `setHarnessBreakdown()`/frozen clamp; conductor `availableCap()`/`contextWindowCap()`; `my-customize` breakFrozen path.
- **Existing behavior**: Frozen boundary is wired and host-clamped, but UI does not clearly distinguish unreachable budget from calculation in progress.
- **Required edits**: Compute/report frozen cost and overage; map it to runtime/footer/dashboard state; ensure warm validation preserves frozen decisions and tests selected-budget versus hard-window pressure.
- **Test seam**: Extend cache tracker, foldgate, and my-customize tests; add deterministic 70k-style scenario from the supplied budget-policy handoff. Success: selected budget can yield ready-frozen-over-budget without cache break.
- **Wiring**: Include budget state in registry snapshot, diagnostics, and observer protocol.
- **Grounding evidence**: `GROUND-006`, `GROUND-008`, `GROUND-015`.

### Area: Usage Footer and notifications

- **Coverage**: `DEC-007`, `DEC-008`; `US-003`; `RB-003`, `RB-015`.
- **Contract**: Accordion publishes one optional typed process-local snapshot. Footer reads it null-safely and renders compact status. Runtime owns exceptional notifications.
- **Code anchors**: `extensions/usage-footer.ts` → `getCoachLine()`, `getSubagentLine()`, `installUsageFooter()`; Frontend Coach/Subagents shared globals; extension UI notification/status APIs.
- **Existing behavior**: Footer composes token, model, coach, and subagent lines from live state; Accordion has only a static status label.
- **Required edits**: Add `globalThis.__accordion` producer/type and footer renderer; invalidate/reinstall footer on runtime changes as needed; notify only waiting/failure/timeout.
- **Test seam**: Add formatting, absent-state, lifecycle, waiting, frozen-overage, and error tests. Success: disabling Usage Footer does not alter runtime behavior.
- **Wiring**: Keep Usage Footer a Managed Extension; no new capability visibility dependency is required.
- **Grounding evidence**: `GROUND-002`, `GROUND-014`.

### Area: Broker and 20-session responsiveness

- **Coverage**: `DEC-005`, `DEC-009`, `DEC-018`; `US-004`; `RB-009`, `RB-013`, `RB-017`.
- **Contract**: Broker remains a transparent proxy. A session extension accepts multiple observer connections and arbitrates commands; dashboard slot work is bounded and does not calculate fold plans for background sessions.
- **Code anchors**: broker `createBrokerServer()`/`proxySession()`; broker registry; `brokerIntegration.svelte.ts`; `sessionSlots.svelte.ts` slot registry.
- **Existing behavior**: Broker already proxies independently, but browser slots each calculate and the extension effectively accepts one current GUI.
- **Required edits**: Preserve proxy framing; make extension multi-observer; reduce background slot work to state replication; verify 20-session discovery/poll/render remains responsive.
- **Test seam**: Broker WS tests plus a 20-session dashboard fixture and two-client command-conflict integration test. Success: one session recalculation does not mutate/block another.
- **Wiring**: Broker protocol mirrors must be updated only for shared version/type changes; do not move folding authority into broker.
- **Grounding evidence**: `GROUND-010`, `GROUND-011`, `GROUND-012`.

## Global Build & Wiring Notes

- Browser/session wire changes require a `PROTOCOL_VERSION` bump and coordinated direct-mode, broker-mode, extension, and broker mirror updates.
- External conductor contract changes require a `CONDUCTOR_PROTOCOL_VERSION` bump and protocol documentation updates.
- Preserve the dependency-free/runeless conductor contract; the worker engine must not import Svelte `$state`/`$derived` code.
- Preserve static browser build resolution for published and development layouts.
- Root Vitest includes vendor app and extension tests but broker tests remain package-local. Add an explicit root test script only if needed by implementation automation; do not assume `npm test` exists at root.

## Testing Decisions

- Test observable revision gating with a provider-call spy: timeout/error must show zero provider contacts.
- Test worker lifecycle and stale result rejection with controllable worker fixtures, not sleeps.
- Add deterministic cold and warm performance fixtures. Report median/p95 and fail against the accepted 2-second/100-ms thresholds; isolate them from network and external conductors.
- Reuse FakeWebSocket prior art for external conductor and multi-dashboard protocol tests.
- Reuse `ACCORDION_HOME` temporary directories for defaults/session registry isolation.
- Preserve mapping/property tests for provider-validity, durable IDs, groups, recall, and unfold.
- Verification commands and recognizable success results:
  - `npm run check` → TypeScript exits 0.
  - `npx vitest run` → vendor app and extension suites pass, including cold/warm benchmarks.
  - `npm test --prefix packages/accordion-broker` → broker suites pass.
  - `npm run check --prefix vendor/accordion/app` → Svelte check exits 0.
  - `npm run accordion:build` → static Accordion app build succeeds.

## Out of Scope

- Cache-breaking strict-budget mode or changing cache-first defaults.
- Persisting fold/conductor calculation state after a Pi session shuts down.
- Migrating legacy conductor selection or external URLs from browser `localStorage`.
- Persisting browser display preferences or browser-only API keys in Pi defaults.
- Guaranteeing the 100-ms warm target for external conductors.
- Requiring 20 sessions to recalculate concurrently; the requirement is 20-session dashboard responsiveness and session isolation.
- Moving folding authority or semantic command handling into the Accordion Browser Broker.

## Unresolved Gaps

None.

## Further Notes

- Governing ADR: `docs/adr/0002-authoritative-accordion-folding-runtime.md`
- Related cache/budget evidence: `C:/Users/Admin/AppData/Local/Temp/accordion-budget-policy-handoff.md`
