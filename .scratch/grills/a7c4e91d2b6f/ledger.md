# Grill ledger — Accordion headless folding readiness

Status: consumed

Consumed by: `.scratch/accordion-authoritative-runtime/PRD.md`

## Goal

Make `/accordion` begin folding with the default `my-customize` conductor without requiring the Broker Dashboard to be open, and make calculation readiness visible so a model turn cannot unknowingly use an unfinished fold plan.

## Decisions

### D-001 — Headless folding intent
- **Status:** accepted
- **Decision:** `/accordion` should activate folding and calculate a plan with the default `my-customize` conductor even when no browser dashboard is open.
- **Rationale:** Folding is part of the Pi workflow; opening the dashboard should be optional observability/control rather than a prerequisite for context management.
- **Evidence:** User requirement. Current architecture computes conductor plans in the browser after WebSocket sync, so this requires changing an existing system boundary.

### D-002 — Calculation readiness
- **Status:** accepted
- **Decision:** Expose an explicit loading/calculating state, including after budget changes, and prevent an accidental model turn from racing an unfinished fold calculation.
- **Rationale:** Users currently cannot tell that recalculation is in progress and may submit a turn whose context does not reflect the requested budget.
- **Evidence:** User-described budget-slider race.

### D-003 — Authoritative Accordion Folding Runtime
- **Status:** accepted
- **Decision:** Extract a browser-independent shared folding engine and host one authoritative instance in each Pi session extension; the dashboard observes and controls that instance rather than independently recalculating fold state.
- **Rationale:** Folding must work without the dashboard, remain aligned when the dashboard opens later, and gate model requests against the same plan the UI displays.
- **Evidence:** User confirmed the shared-engine option. This reopens Accordion ADR 0001’s “GUI drives, thin extension” boundary and is an ADR candidate.

### D-004 — Wait for newest ready plan
- **Status:** accepted
- **Decision:** A model turn submitted while Accordion is calculating waits for the newest calculation generation; it sends automatically when ready, while failure or a bounded timeout prevents provider contact and produces an actionable error.
- **Rationale:** This preserves the user’s submitted action without allowing stale conductor settings or an unfinished plan to shape the provider request.
- **Evidence:** User selected option 1.

### D-005 — Global defaults and per-session runtime state
- **Status:** accepted
- **Decision:** Persist small global defaults under `~/.accordion/`, snapshot them when `/accordion` starts, and store complete effective settings plus calculation state in one existing registry file per active session. Dashboard controls target one session; saving defaults affects future sessions only and does not mutate active sessions.
- **Rationale:** This supports many concurrent Pi sessions without browser-local configuration, cross-session recalculation, or ambiguous settings diffs. Complete per-session snapshots remain independently understandable after defaults change.
- **Evidence:** User approved the per-session file model. Existing `~/.accordion/sessions/<sessionId>.json` registry provides the natural persistence seam.

### D-006 — Full conductor parity
- **Status:** accepted
- **Decision:** The Authoritative Accordion Folding Runtime must support bundled in-process conductors and external WebSocket conductors in the initial delivery, while defaulting to `my-customize`.
- **Rationale:** Headless authority must not remove existing conductor choices or reintroduce split browser/runtime ownership when an external conductor is selected.
- **Evidence:** User selected full parity (option 3). Existing ADR 0011 consent and lock rules remain constraints.

### D-007 — Footer state plus exceptional notifications
- **Status:** accepted
- **Decision:** Show normal Accordion state continuously through the Usage Footer extension, mirror it in the dashboard, and emit notifications only when a submitted turn waits, calculation fails, or calculation times out.
- **Rationale:** This keeps headless users informed without notification spam and provides independent visibility in each Pi session.
- **Evidence:** User selected option 3 and identified Usage Footer as the implementation surface.

### D-008 — Optional shared status contract
- **Status:** accepted
- **Decision:** Accordion publishes a small typed per-process status snapshot through the repository’s existing optional `globalThis` integration convention; Usage Footer reads it when present, while Accordion remains functional when Usage Footer is absent or disabled.
- **Rationale:** Frontend Coach and Subagents already expose footer state this way, so this is a low-risk reversible convention rather than a new coupled dependency.
- **Evidence:** `extensions/usage-footer.ts`, `extensions/frontend-coach/index.ts`, and `extensions/subagents.ts`.

### D-009 — Heavy-session performance target
- **Status:** accepted
- **Decision:** Prove that a 500k-token, 5,000-block session reaches `ready` within 2 seconds, while a dashboard containing 20 registered sessions remains independently responsive; simultaneous recalculation of all 20 sessions is not required.
- **Rationale:** This represents genuinely large resumed sessions without optimizing for an unlikely 20-way calculation burst.
- **Evidence:** User selected workload option 2.

### D-010 — Lazy per-session worker isolation
- **Status:** accepted
- **Decision:** Bundled conductors calculate in one worker thread created lazily when `/accordion` activates, idle between calculations, and terminated at session end. External WebSocket conductors remain process-isolated but obey the same generation/readiness contract.
- **Rationale:** Pi must remain responsive enough to repaint status, accept cancellation, and enforce request gating during heavy calculations. Versioned results prevent stale worker output from becoming authoritative.
- **Evidence:** User approved the explained worker model subject to careful calculation-trigger performance.

### D-011 — Revisioned incremental warm calculation
- **Status:** accepted
- **Decision:** Calculate against immutable provider-context revisions, coalesce and skip obsolete intermediate revisions, and keep worker state warm so ordinary appended blocks use delta validation/update rather than a full conductor pass. Full calculations are reserved for cold or structural invalidation.
- **Rationale:** Each provider continuation needs a plan matching its latest context, but full 500k-token recalculation during every tool loop would make agent turns materially slower. Eager work overlaps tool/user time, and the provider waits only when the newest revision is not ready.
- **Evidence:** User confirmed the latest-revision flow and required an incremental warm path.

### D-012 — Cache-first budget readiness
- **Status:** accepted
- **Decision:** Preserve the existing cache-first policy and expose a distinct `ready · frozen over budget` state when the frozen provider-cached prefix makes the selected budget unreachable. Cache-breaking strict-budget behavior remains a later explicit opt-in feature.
- **Rationale:** A completed plan can be valid without satisfying the selected budget; silently breaking cache would contradict the cache-aware folding PRD and its tests.
- **Evidence:** User approved the policy from `accordion-budget-policy-handoff.md`.

### D-013 — Phase-specific bounded deadlines
- **Status:** accepted
- **Decision:** Use a 1-second bundled warm deadline, a 5-second bundled cold/structural deadline, and a 10-second external-conductor default that may be advertised up to a 120-second hard cap. Timeout prevents provider contact and exposes retry/cancel actions.
- **Rationale:** Local incremental work should be fast, cold work needs margin above its 2-second acceptance target, and external conductors may legitimately perform slower embedding or summary work without being allowed to block indefinitely.
- **Evidence:** User selected phase-specific deadline option 1; existing external conductors use 2–10 second embedding warm limits and up to 120-second host-summary limits.

### D-014 — Warm-path latency target
- **Status:** accepted
- **Decision:** For an already-ready 500k-token, 5,000-block session using `my-customize`, appending up to 20 committed blocks or 20k tokens must produce a matching ready revision at p95 ≤ 100 ms, including worker communication and excluding model/tool time. The path must not serialize or recompute the full history.
- **Rationale:** Tool-heavy turns may make many provider continuations, so even sub-second repeated delays materially accumulate.
- **Evidence:** User selected the 100 ms p95 target.

### D-015 — Explicit session activation lifecycle
- **Status:** accepted
- **Decision:** `/accordion` and `/accordion on` idempotently activate folding for the Pi session; folding remains active when dashboards close and is disabled only by `/accordion off`, the session-targeted dashboard toggle, or session shutdown. Disabled mode is raw provider pass-through.
- **Rationale:** Dashboard connection is optional observability/control and must not own folding lifecycle.
- **Evidence:** User selected explicit session control.

### D-016 — Revisioned dashboard command protocol
- **Status:** accepted
- **Decision:** Dashboard controls send session-targeted intents with an expected revision; the runtime validates and orders them, creates a new revision, and broadcasts acknowledged authoritative state to every connected dashboard. Provider requests wait for that revision when calculation is required.
- **Rationale:** Multiple dashboards and headless operation must share one fold state rather than mutate independent browser stores.
- **Evidence:** User approved the command-and-acknowledgement flow with a request for localized pending UI.

### D-017 — Optimistic localized pending UI
- **Status:** accepted
- **Decision:** Manual block actions update that block optimistically with a localized `calculating` indicator, temporarily disable repeated actions for the block, and roll back with an inline error if the authoritative runtime rejects or fails the revision. Other blocks and sessions remain interactive.
- **Rationale:** This gives immediate feedback without falsely treating unacknowledged state as authoritative or blocking the dashboard globally.
- **Evidence:** User selected localized optimistic option 2.

### D-018 — Semantic rebase for rare multi-dashboard conflicts
- **Status:** accepted
- **Decision:** Optimize for one Global Accordion Dashboard, but defensively rebase stale commands that target independent blocks/settings and reject conflicting stale commands to the same target. Rejected optimistic actions roll back after authoritative refresh.
- **Rationale:** The dashboard already aggregates sessions, so multiple dashboards are not the primary workflow; semantic rebase avoids both needless unrelated failures and silent last-writer-wins corruption.
- **Evidence:** User selected option 3 as defensive behavior.

### D-019 — Clean configuration cutover
- **Status:** accepted
- **Decision:** Do not migrate legacy browser-local conductor selection or configured external conductor URLs. The new implementation starts from Pi-owned defaults after users update, reload, and run `/accordion` again; `my-customize` is the initial default.
- **Rationale:** Only the latest implementation participates in the new runtime contract, and migration complexity is not justified for prior local browser state.
- **Evidence:** User explicitly declined backward-compatibility migration.

## ADRs

- `docs/adr/0002-authoritative-accordion-folding-runtime.md` — accepted; replaces Accordion’s “GUI drives, thin extension” boundary with the per-session Authoritative Accordion Folding Runtime while preserving existing consent/lock constraints.
