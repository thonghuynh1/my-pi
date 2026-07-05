# Accordion cache-miss investigation handoff

Date: 2026-07-06
Repo: `F:/MyWork/my-pi`

## Short summary

We investigated whether Accordion folding invalidates provider prompt cache. After adding source-of-truth diagnostics in Accordion's `context` hook, the answer appears to be **yes, sometimes**:

```txt
Accordion context hook applies a fold plan (`changed: true`)
→ provider-bound payload changes
→ the next assistant turn often has `cacheRead = 0` or tiny (`6656`)
→ fresh input cost spikes
```

This seems especially reproducible on Accordion first load/reload/reattach when `frozenFromIndex` is `0` or very low.

When the GUI has **no folded blocks**, Accordion returns an empty plan (`changed: false`) and cache remains healthy. This suggests the issue is tied to provider-bound folding, not recall itself.

## Files changed during investigation

### `scripts/session-cost-report.mjs`

Added a standalone Pi session cost/cache report generator:

```sh
npm run session-cost-report -- "C:\Users\Admin\.pi\agent\sessions\...\session.jsonl"
```

Output default:

```txt
.diagnostics/session-cost/<session-name>.cost-report.json
```

It now reports:

- whole/scoped token/cost totals
- high-cost turns
- cache-miss turns
- visible `{#... FOLDED}` marker heuristic
- Accordion context diagnostic correlation

Important report fields:

```json
{
  "summary": {
    "cacheMissCount": 0,
    "accordionContextCacheMissCount": 0
  },
  "accordion": {
    "contextDiagnostics": {
      "loadedCount": 0,
      "matchedCount": 0,
      "contextCacheMissCount": 0,
      "contextCacheMissLines": [],
      "contextCacheMissCost": 0
    }
  }
}
```

New reason:

```txt
accordion_context_cache_miss
```

Meaning: a cache miss happened after Accordion's context hook logged `accordion_context_apply_plan` with `changed: true`.

### `vendor/accordion/extension/accordion.ts`

Added best-effort content-free diagnostics at the provider-bound context hook.

Diagnostics written to:

```txt
~/.accordion/diagnostics/<accordion-session-id>.context.jsonl
```

Events:

- `accordion_context_apply_plan`
- `accordion_context_empty_plan`
- `accordion_context_plan_timeout`

Example:

```json
{
  "event": "accordion_context_apply_plan",
  "timestamp": "2026-07-05T19:08:11.131Z",
  "sessionId": "s-15200-1783278397684",
  "reqId": 3,
  "changed": true,
  "foldOpsRequested": 96,
  "groupOpsRequested": 0,
  "foldMarkersInAppliedPayload": 39,
  "foldMarkersInOriginalPayload": 121,
  "originalTokensApprox": 247154,
  "appliedTokensApprox": 148383,
  "frozenFromIndex": 0
}
```

No message content is logged; only counts/metadata.

Validation after edits:

```sh
npm run check
```

passed.

## Main evidence

Session investigated:

```txt
C:\Users\Admin\.pi\agent\sessions\--F--MyWork-my-pi--\2026-07-04T20-01-27-856Z_019f2eb8-c130-7525-8714-f3a8aafb6d62.jsonl
```

Reports generated under:

```txt
.diagnostics/session-cost/
```

Latest report from investigation:

```txt
.diagnostics/session-cost/after-recall-refold-check-report.json
.diagnostics/session-cost/after-no-touch-check-report.json
.diagnostics/session-cost/after-latest-accordion-reload-report.json
```

Key repeated source-of-truth pattern:

```txt
Accordion diagnostic:
  event: accordion_context_apply_plan
  changed: true
  foldOpsRequested: nonzero
  frozenFromIndex: 0 or low

Next assistant usage:
  cacheRead: 0 or 6656
  high input tokens
  reason: accordion_context_cache_miss
```

Confirmed Accordion-linked cache-miss lines observed over the session:

```txt
156, 162, 168, 170, 175, 180, 186, 196, 198
```

At one point report totals showed:

```txt
accordionContextCacheMissCount: 9
accordionContextCacheMissCost: ~$2.9332
```

Examples:

### Line 198, after Accordion reload

Accordion event:

```json
{
  "event": "accordion_context_apply_plan",
  "timestamp": "2026-07-05T19:08:11.131Z",
  "changed": true,
  "foldOpsRequested": 96,
  "foldMarkersInAppliedPayload": 39,
  "originalTokensApprox": 247154,
  "appliedTokensApprox": 148383,
  "frozenFromIndex": 0
}
```

Next assistant turn:

```txt
line 198
cost:     $0.550930
input:    102,746
cacheRead: 0
reason:   accordion_context_cache_miss
```

### No-touch turn after initial miss

User asked to try again without touching Accordion. Accordion logged empty plan:

```json
{
  "event": "accordion_context_empty_plan",
  "changed": false,
  "frozenFromIndex": 291
}
```

Next assistant turn had healthy cache:

```txt
line 204
input:     9,078
cacheRead: 209,408
cost:      $0.183814
```

This supports the hypothesis that the cache miss is caused by provider-bound payload changes, not merely Accordion being open.

## Recall observations

We tested recall multiple times.

### Successful recall

`recall("2crfgu")` returned a folded block successfully once. The turn that called recall had a cache miss, but the next turn after the recall result had healthy cache.

Interpretation:

```txt
Recall result itself lands in the recent tail and does not appear to break cache.
The cache miss happened on the model turn where Accordion had just applied a fold plan before the recall call.
```

### Stale/no-op recall

Later, the same code returned:

```txt
No folded block for: #2crfgu (already full, or not in this session's context).
```

At that point GUI showed no folded blocks, Accordion emitted `empty_plan`, and cache remained healthy.

## Current hypothesis

### Likely bug/design problem

Accordion can apply a fold plan that rewrites old provider-bound context before the provider cache boundary is safe/stable.

This happens particularly on first load/reload/reattach:

```txt
first Accordion load/reload
→ frozenFromIndex = 0
→ GUI/engine has folded state or creates one
→ context hook applies fold plan
→ old prefix changes
→ provider prompt cache misses
```

### Important nuance

This may not be a violation of current code's frozen-boundary logic when `frozenFromIndex = 0`: the system is saying there is no known frozen prefix. But from a cost perspective, folding at that moment is expensive because it changes the prefix and prevents cache read.

### Related GUI observation

User observed: recall makes a folded block appear unfolded in GUI, then it may become folded again next turn.

This was not conclusively reproduced because the available recall code became stale/no-op. But if true, automatic refolding after recall may also rewrite provider-bound context and cause cache churn. Needs a fresh folded code from GUI to test.

## Suggested fixes to investigate

1. **Do not apply fold plans on first attach/reload when `frozenFromIndex === 0`.**
   - Let cache warm/stabilize first.
   - Maybe require one or two provider turns with stable cache before folding.

2. **Never fold blocks before `frozenFromIndex`.**
   - This already seems intended in engine/store, but verify for first-load/reconnect paths and stale GUI state.

3. **Preserve previous provider-bound fold shape if already folded.**
   - If the folded payload is already what provider cache has seen, keep it byte-stable.
   - Avoid recomputing/changing summaries/marker distribution unnecessarily.

4. **Treat `frozenFromIndex = 0` as “cache unknown; avoid optional folding unless needed for context-window fit.”**
   - Especially when context fits without folding.

5. **Investigate auto-refold after recall.**
   - If recall changes GUI state, don't immediately refold the restored block in the next provider-bound payload unless outside cached prefix or context pressure requires it.

6. **Improve diagnostics further.**
   - Log whether each fold op targets block order `< frozenFromIndex`, `>= frozenFromIndex`, or unknown.
   - Log min/max order of foldOps.
   - Log whether the applied payload differs from the previous applied payload and where the first difference is.
   - Log cache response data if Pi/provider exposes actual cacheRead after response and correlate by request id.

## Commands useful for future investigation

Generate report for latest current session:

```sh
npm run session-cost-report -- "C:\Users\Admin\.pi\agent\sessions\--F--MyWork-my-pi--\2026-07-04T20-01-27-856Z_019f2eb8-c130-7525-8714-f3a8aafb6d62.jsonl"
```

Inspect Accordion context logs:

```sh
python - <<'PY'
import glob, os, pathlib, json
for p in sorted(glob.glob(os.path.expanduser(r'~/.accordion/diagnostics/*.context.jsonl')), key=os.path.getmtime)[-5:]:
    print('\n', os.path.basename(p), 'lines', len(pathlib.Path(p).read_text().splitlines()))
    for line in pathlib.Path(p).read_text().splitlines()[-5:]:
        o=json.loads(line)
        print({k:o.get(k) for k in ['event','timestamp','sessionId','reqId','changed','foldOpsRequested','foldMarkersInAppliedPayload','originalTokensApprox','appliedTokensApprox','frozenFromIndex']})
PY
```

Run typecheck:

```sh
npm run check
```

## Recommended next concrete investigation

Use a fresh session with Accordion open and do three controlled turns:

1. No Accordion folding / GUI no folded blocks.
2. Trigger Accordion fold on first load/reload.
3. Do a no-touch follow-up turn.

Expected if hypothesis is right:

```txt
Turn after first fold/reload: cacheRead 0/tiny, accordion_context_apply_plan changed=true
No-touch follow-up: cacheRead high, accordion_context_empty_plan changed=false
```

Then test recall/refold with a currently valid fold code from GUI:

1. Copy an actual visible `{#code FOLDED}` from the current context.
2. Call `recall([code])`.
3. Observe GUI unfold/refold.
4. Check context diagnostics and next-turn cacheRead.

## Current conclusion

There is enough evidence to treat this as a real Accordion cache-cost bug/design issue:

```txt
Accordion provider-bound folding can invalidate provider prompt cache, especially on first load/reload or when frozenFromIndex is 0/low.
```

The fix should make provider-bound folding cache-aware and stable, not just context-window-aware.
