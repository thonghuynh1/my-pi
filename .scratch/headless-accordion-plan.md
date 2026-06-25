# Headless Accordion Plan for Ralph Loop

Accordion currently needs a **controller** to work fully. The browser GUI is normally that controller.

For `ralph-loop`, the browser GUI is not ideal because implementer agents run headlessly. The goal is to replace the GUI with a **headless controller process**.

## Current Accordion Flow

```text
Pi session
  -> Accordion extension
  -> browser GUI
  -> fold plan
  -> Accordion extension applies plan
  -> model receives folded context
```

If the GUI is not open, Accordion mostly does nothing and passes context through unchanged.

## Desired Ralph Loop Flow

```text
ralph-loop implementer Pi session
  -> Accordion extension
  -> headless Accordion controller
  -> fold plan
  -> Accordion extension applies plan
  -> model receives folded context
```

Key idea:

> The browser is not essential. A websocket client that replies with fold plans is essential.

## What to Build

Build a small script/process in `my-pi`, for example:

```text
scripts/accordion-headless.ts
```

It should:

1. watch/read Accordion session files:
   ```text
   ~/.accordion/sessions/*.json
   ```
2. connect to the active session websocket
3. listen for `sync` messages from Accordion
4. return `plan` messages quickly
5. eventually choose what to fold automatically

## MVP Behavior

First version should be very simple:

```text
receive sync -> send empty plan
```

This proves the headless connection works.

Second version:

```text
receive sync
  -> keep recent context open
  -> keep user messages open
  -> fold old assistant/tool-result blocks
  -> send fold plan
```

## Important Constraint

Accordion’s extension only waits about **250ms** for a plan.

So the headless controller must be fast.

Good for MVP:

```text
cheap deterministic rules
cached summaries
oldest-first folding
```

Avoid for MVP:

```text
calling an LLM during the sync request
slow summarization
complex async analysis
```

## Ralph Loop Integration Idea

Before starting the implementer, `ralph-loop` should start:

```bash
npm run accordion:headless
```

or set an environment variable such as:

```bash
PI_ACCORDION_HEADLESS=1
```

Then the implementer session can run while the headless controller stays connected.

## Phased Implementation

### Phase 1 — Connector

- connect to Accordion websocket
- receive `sync`
- send empty `plan`
- log activity

### Phase 2 — Simple Folding

- fold old eligible blocks
- never fold recent tail
- never fold user messages
- avoid folding tool calls

### Phase 3 — Ralph Loop Integration

- auto-start controller before implementer
- stop controller after run
- write logs under `.ralph-loop/`

### Phase 4 — Smarter Folding

- relevance scoring
- summaries
- conductor-like logic
- cached LLM summaries

## Core Takeaway

To make Accordion useful for headless implementers:

> Build a non-visual client that connects to Accordion and sends fold plans, replacing the browser GUI for automation.
