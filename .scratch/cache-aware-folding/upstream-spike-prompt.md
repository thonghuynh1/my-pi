You are running a narrow local spike in F:/MyWork/my-pi.

Goal:
Prove whether a small additive public pi hook change is enough for Accordion to consume provider usage data safely.

Scope:
1. Patch the INSTALLED local package in node_modules/@earendil-works/pi-coding-agent, not an upstream repo.
2. Extend after_provider_response to carry usage?: unknown.
3. Update the local emitted event in dist/core/sdk.js to include usage from the provider response if present.
4. Update the local type in dist/core/extensions/types.d.ts.
5. Update the local docs/example only if trivial.
6. Adapt vendor/accordion/extension/cache-tracker.ts to read event.usage instead of event.response.
7. Update vendor/accordion/extension/cache-tracker.test.ts fake events to emit usage directly.
8. If small and obvious, wire the remaining Accordion consumer path needed for frozenFromIndex transport. If that becomes broad, stop and report the exact remaining gap instead of wandering.
9. Run focused verification.

Verification target:
- package type exposes usage?: unknown
- package emit path includes usage
- cache-tracker tests pass
- if you wire more, run the smallest relevant Accordion tests too

Important:
- Keep the diff minimal.
- Do not rewrite unrelated files.
- At the end, print:
  1. files changed
  2. commands run
  3. whether this proves Anthropic shape support
  4. whether this proves OpenAI or Codex shape support
  5. what is still unproven without a live provider session
