---
status: accepted
---

# Make each Pi session authoritative for Accordion folding

Accordion will extract a browser-independent folding engine and host one authoritative runtime in each activated Pi session extension. This replaces the earlier “GUI drives, thin extension” boundary because folding must start without a dashboard, model requests must wait for the newest ready plan, and every dashboard must observe and control the same revisioned session state.

## Considered Options

Keeping folding in the browser preserves the thin extension but makes an open dashboard a runtime dependency. Hosting state in the singleton broker centralizes multiple sessions but makes model-request correctness depend on another process. A per-session runtime keeps folding lifecycle and provider-request gating together while allowing bundled worker-isolated and external WebSocket conductors to share one contract.

## Consequences

The dashboard becomes an optional observer/controller and sends revisioned commands rather than independently calculating authoritative plans. Bundled conductors run in a lazy per-session worker; external conductors retain process isolation. This reopens the boundary recorded by vendor Accordion ADR 0001 while preserving ADR 0011 consent and lock rules.
