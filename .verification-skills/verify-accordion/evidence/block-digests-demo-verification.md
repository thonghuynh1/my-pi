# ✅ PASSED — block-digests-final-evidence

- **Recorded**: 2026-08-23T08:36:28.206Z
- **Duration**: 15.81s
- **URL**: http://localhost:1420
- **Change under test**: Slice 4 verification: block-level rich fold digests. Demo session 982 blocks, my-customize-conductor active, transcript view showing folded block digests.
- **Video**: `F:\MyWork\my-pi\.frontend-coach\records\2026-08-23_153612_block-digests-final-evidence.webm` (990.0 KiB, 10 fps)

## Steps
1. ✅ **navigate** → http://localhost:1420  _(@0.03s, 112ms)_
2. ✅ **wait** 2000ms  _(@0.14s, 2007ms)_
3. ✅ **click** `button:has-text('Load sample')`  _(@2.15s, 56ms)_
4. ✅ **wait** 4000ms  _(@2.21s, 4004ms)_
5. ✅ **waitFor** `canvas`  _(@6.21s, 11ms)_
6. ✅ **wait** 1000ms  _(@6.22s, 1012ms)_
7. ✅ **click** `button.seg-pill:has-text('Transcript')`  _(@7.23s, 530ms)_
8. ✅ **wait** 2000ms  _(@7.76s, 2009ms)_
9. ✅ **waitFor** `.tr-text.digest`  _(@9.77s, 14ms)_
10. ✅ **wait** 1000ms  _(@9.79s, 1007ms)_

## Assertions
- ✅ Demo loaded with 982 blocks
  - expression: `document.querySelectorAll('.transcript article.tr-msg').length > 900`
- ✅ 807 blocks are folded with digests
  - expression: `document.querySelectorAll('.tr-text.digest').length > 700`

## Console
```
[+0.12s pageerror] TypeError: Failed to execute 'observe' on 'MutationObserver': parameter 1 is not of type 'Node'.
    at whenBodyReady (<anonymous>:28:12)
    at <anonymous>:72:2
    at <anonymous>:388:3
    at <anonymous>:390:7
[+0.35s debug] [vite] connecting...
[+0.62s debug] [vite] connected.
[+0.93s error] Failed to load resource: the server responded with a status of 404 (Not Found)
[+0.93s error] Failed to load resource: the server responded with a status of 404 (Not Found)
[+2.62s error] WebSocket connection to 'ws://localhost:7777/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
[+6.00s error] WebSocket connection to 'ws://localhost:7777/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
[+10.37s error] WebSocket connection to 'ws://localhost:7777/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
```

## Network
| time | method | status | url |
|---:|---|---:|---|
| +0.02s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/7D8B79A2-8974-4D7B-A76A-F4F29624C06Bi_KT8lLODiNKgly1M_hGbEaiaiTBW2EdX1nJ3roJB-Z… |
| +0.02s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/app/node_modules/@sveltejs/kit/src/runtime/client/entry.… |
| +0.02s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/app/.svelte-kit/generated/client/app.js |
| +0.02s | POST | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/74887CE3-B032-41B5-BDD9-CC62A850DCEB/to/ws… |
| +0.03s | GET | 200 | http://localhost:1420/.svelte-kit/generated/client/matchers.js |
| +0.03s | GET | 200 | http://localhost:1420/.svelte-kit/generated/root.js |
| +0.03s | GET | 200 | http://localhost:1420/@vite/client |
| +0.03s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/client.js?v=6626c9d3 |
| +0.07s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_legacy.js?v=6626c9d3 |
| +0.07s | GET | 200 | http://localhost:1420/.svelte-kit/generated/root.svelte |
| +0.07s | GET | 200 | http://localhost:1420/node_modules/vite/dist/client/env.mjs |
| +0.05s | GET | 200 | http://localhost:1420/ |
| +0.12s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/E3E8934C-235A-4B0E-825A-35A08381A191/abn/main.css?attr=aHR0cDovL2xvY2FsaG9zdDox… |
| +0.12s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/FD126C42-EBFA-4E12-B309-BB3FDD723AC1/main.js?attr=kf6sx1EUDZyn6CVnDqCJuRu_tnSKx… |
| +0.13s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/7D8B79A2-8974-4D7B-A76A-F4F29624C06BnOsylu_zsIfkU0ZzINzRXrSFrTDo0FHkdkBVISRyVcs… |
| +0.14s | GET | 304 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/app/node_modules/@sveltejs/kit/src/runtime/client/entry.… |
| +0.14s | GET | 304 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/app/.svelte-kit/generated/client/app.js |
| +0.15s | POST | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/to/ws… |
| +0.17s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/client.js?v=6626c9d3 |
| +0.18s | GET | 304 | http://localhost:1420/@vite/client |
| +0.18s | GET | 304 | http://localhost:1420/.svelte-kit/generated/client/matchers.js |
| +0.18s | GET | 304 | http://localhost:1420/.svelte-kit/generated/root.js |
| +0.23s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_legacy.js?v=6626c9d3 |
| +0.18s | GET | 200 | http://localhost:1420/node_modules/esm-env/index.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/exports/internal/index.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/url.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/fetcher.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/session-storage.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/parse.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/paths/index.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/devalue/index.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/constants.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/exports.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/array.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/error.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/functions.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/shared.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/utils.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_store.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/state.svelte.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/pathname.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/telemetry/noop.js?v=6626c9d3 |
| +0.19s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/ndjson.js?v=6626c9d3 |
| +0.23s | GET | 304 | http://localhost:1420/node_modules/vite/dist/client/env.mjs |
| +0.23s | GET | 304 | http://localhost:1420/.svelte-kit/generated/root.svelte |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-QDDRZFWN.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-OHYQYV5R.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-UGBVNEQM.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-6WDDLUYB.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-246JMGAL.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-BZOVLLF5.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/esm-env/false.js?v=6626c9d3 |
| +0.24s | GET | 200 | http://localhost:1420/node_modules/esm-env/true.js?v=6626c9d3 |
| +0.26s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-U7P2NEEE.js?v=6626c9d3 |
| +0.26s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/exports/internal/remote-functions.js?v=6626c9d3 |
| +0.26s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/hash.js?v=6626c9d3 |
| +0.26s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/utils.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/paths/client.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/devalue/src/uneval.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/devalue/src/parse.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/env/index.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/devalue/src/utils.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/client/stream.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_internal_client.js?v=6626c9d3 |
| +0.27s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/utils/routing.js?v=6626c9d3 |
| +0.26s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-GMCRS3DT.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/devalue/src/stringify.js?v=6626c9d3 |
| +0.28s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_internal_disclose-version.js?v=6626c9d3 |
| +0.33s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/paths/internal/client.js?v=6626c9d3 |
| +0.34s | GET | 200 | http://localhost:1420/node_modules/devalue/src/constants.js?v=6626c9d3 |
| +0.34s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/env/internal.js?v=6626c9d3 |
| +0.34s | GET | 200 | http://localhost:1420/node_modules/devalue/src/base64.js?v=6626c9d3 |
| +0.36s | GET | 200 | http://localhost:1420/.svelte-kit/generated/client/nodes/1.js |
| +0.36s | GET | 200 | http://localhost:1420/.svelte-kit/generated/client/nodes/0.js |
| +0.36s | GET | 200 | http://localhost:1420/.svelte-kit/generated/client/nodes/2.js?t=1787474118335 |
| +0.37s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/components/svelte-5/error.svelte?v=6626c9d3 |
| +0.37s | GET | 200 | http://localhost:1420/src/routes/+layout.ts |
| +0.37s | GET | 200 | http://localhost:1420/src/routes/+layout.svelte |
| +0.39s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/state/index.js?v=6626c9d3 |
| +0.38s | GET | 200 | http://localhost:1420/src/routes/+page.svelte?t=1787474118335 |
| +0.39s | GET | 200 | http://localhost:1420/node_modules/@fontsource-variable/ibm-plex-sans/index.css |
| +0.40s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/state/server.js?v=6626c9d3 |
| +0.39s | GET | 200 | http://localhost:1420/node_modules/@fontsource/ibm-plex-mono/400.css |
| +0.39s | GET | 200 | http://localhost:1420/node_modules/@fontsource/ibm-plex-mono/500.css |
| +0.40s | GET | 200 | http://localhost:1420/node_modules/@sveltejs/kit/src/runtime/app/state/client.js?v=6626c9d3 |
| +0.39s | GET | 200 | http://localhost:1420/src/app.css |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/session.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/settings.svelte.ts |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/liveClient.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/discovery.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/claudeDiscovery.svelte.ts |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/conductor.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/conductorDiscovery.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/conductorClient.svelte.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/activeConductor.ts?t=1787474118335 |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/folding.svelte.ts |
| +0.41s | GET | 200 | http://localhost:1420/src/lib/live/foldAlarm.svelte.ts |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/live/protocol.ts |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/live/brokerIntegration.svelte.ts?t=1787474118335 |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/live/SessionsSidebar.svelte?t=1787474118335 |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConductorActivity.svelte?t=1787474118335 |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/Logo.svelte |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/Icon.svelte |
| +0.52s | GET | 200 | http://localhost:1420/src/lib/engine/parse.ts |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/map/MapHeader.svelte?t=1787474118335 |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/map/Inspector.svelte |
| +0.42s | GET | 200 | http://localhost:1420/src/routes/+page.svelte?svelte&type=style&lang.css |
| +0.42s | GET | 200 | http://localhost:1420/src/lib/ui/map/ContextMap.svelte?t=1787474118335 |
| +0.52s | GET | 200 | http://localhost:1420/src/lib/engine/store.svelte.ts?t=1787474118335 |
| +0.55s | GET | 200 | http://localhost:1420/src/lib/live/mapping.ts |
| +0.55s | GET | 200 | http://localhost:1420/src/lib/live/plan.ts |
| +0.55s | GET | 200 | http://localhost:1420/src/lib/live/registry.ts |
| +0.55s | GET | 200 | http://localhost:1420/src/lib/live/ghostState.svelte.ts |
| +0.55s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/contract/index.ts |
| +0.55s | GET | 200 | http://localhost:1420/src/lib/live/claude.ts |
| +0.55s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/index.ts?t=1787474118335 |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/engine/digest.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/engine/tokens.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/live/brokerMode.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/live/brokerSessions.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/AnimatedNumber.svelte |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/SegControl.svelte |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/live/sessionSlots.svelte.ts?t=1787474118335 |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/utils.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConductorActivity.svelte?svelte&type=style&lang.css |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/conductorDiagnostics.ts |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/Icon.svelte?svelte&type=style&lang.css |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/live/SessionsSidebar.svelte?svelte&type=style&lang.css |
| +0.56s | GET | 200 | http://localhost:1420/src/lib/ui/SettingsPanel.svelte?t=1787474118335 |
| +0.68s | POST | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/to/ab… |
| +0.58s | GET | 200 | http://localhost:1420/src/lib/ui/EditableNumber.svelte |
| +0.58s | GET | 200 | http://localhost:1420/src/lib/ui/map/MapHeader.svelte?svelte&type=style&lang.css |
| +0.63s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_transition.js?v=6626c9d3 |
| +0.63s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_easing.js?v=6626c9d3 |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/ui/map/drain.ts |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/engine/display.ts |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/ui/map/Inspector.svelte?svelte&type=style&lang.css |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/ui/map/ContextMap.svelte?svelte&type=style&lang.css |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/ui/map/tileDraw.ts |
| +0.58s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConductorMenu.svelte?t=1787474118335 |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/engine/extractors.ts |
| +0.63s | GET | 200 | http://localhost:1420/src/lib/ui/map/TileCanvas.svelte |
| +0.63s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/constants.ts |
| +0.75s | GET | 200 | http://localhost:1420/src/lib/engine/bm25.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/contract/conductor.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/contract/protocol.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/builtin/builtin.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/cold-epoch/cold-epoch.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/cold-score/cold-score.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/sliding-window/sliding-window.ts |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/garbage-collector/garbage-collector.ts |
| +0.76s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/compaction-naive/compaction-naive.ts |
| +0.76s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/code-skeleton/code-skeleton.ts |
| +0.76s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/strict-monotonic/strict-monotonic.ts |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/ui/SegControl.svelte?svelte&type=style&lang.css |
| +0.76s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/bear2-hybrid/bear2-hybrid.ts |
| +0.76s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/svelte_motion.js?v=6626c9d3 |
| +0.76s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/keel.ts |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/ui/EditableNumber.svelte?svelte&type=style&lang.css |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/ui/SettingsPanel.svelte?svelte&type=style&lang.css |
| +0.76s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-YERFD2CZ.js?v=6626c9d3 |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConsentDialog.svelte |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConductorMenu.svelte?svelte&type=style&lang.css |
| +0.75s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/my-customize-conductor… |
| +0.76s | GET | 200 | http://localhost:1420/src/lib/live/conductorMerge.ts |
| +0.83s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/cold-score/score.ts |
| +0.83s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/cold-score/lexical.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/code-skeleton/classify.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/garbage-collector/edges.ts |
| +0.84s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-EWJWKXOT.js?v=6626c9d3 |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/code-skeleton/skeletonize.ts |
| +0.84s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-7RQDXF5S.js?v=6626c9d3 |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/roots.ts |
| +0.84s | GET | 200 | http://localhost:1420/node_modules/.vite/deps/chunk-2SHFRDWS.js?v=6626c9d3 |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/relevance.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/ledger.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/budget.ts |
| +0.84s | GET | 200 | http://localhost:1420/src/lib/ui/map/ConsentDialog.svelte?svelte&type=style&lang.css |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/keel/ladder.ts |
| +0.84s | GET | 200 | http://localhost:1420/src/lib/engine/block-digest.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/chunked-compaction.ts |
| +0.84s | GET | 200 | http://localhost:1420/@fs/F:/MyWork/my-pi/extensions/accordion/conductors/my-customize-conductor/mcp-summary.ts |
| +0.92s | GET | 304 | http://localhost:1420/brand-symbol.png |
| +0.92s | GET | 304 | http://localhost:1420/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2 |
| +0.92s | GET | 404 | http://localhost:1420/__accordion/broker-meta |
| +0.92s | GET | 404 | http://localhost:1420/__accordion/meta |
| +2.16s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +2.20s | GET | 200 | http://localhost:1420/sample-session.jsonl |
| +2.52s | GET | 304 | http://localhost:1420/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2 |
| +2.69s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +3.18s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +3.70s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +4.20s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +4.72s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +5.22s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +5.74s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +6.24s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +6.75s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +7.26s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +7.76s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +8.28s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +8.78s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +9.31s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +9.80s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
| +10.31s | GET | 200 | http://me.kis.v2.scr.kaspersky-labs.com/4A0D5A6E-FA28-41C3-99F2-CBFF4A87E8C3/85DA9FE3-70C1-472C-811F-858953B07A91/from?… |
