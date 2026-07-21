<script lang="ts">
	import type { AccordionStore } from "../../engine/store.svelte";
	import type { BlockKind } from "../../engine/types";
	import AnimatedNumber from "$lib/ui/AnimatedNumber.svelte";
	import EditableNumber from "$lib/ui/EditableNumber.svelte";
	import Icon from "$lib/ui/Icon.svelte";
	import ConductorMenu from "./ConductorMenu.svelte";
	import { folding, setFolding } from "$lib/live/folding.svelte";
	import { live } from "$lib/live/liveClient.svelte";
	import { conductorStatus } from "$lib/live/conductorClient.svelte";
	import type { JSONValue } from "$conductors/contract";

	let { store, readOnly = false }: { store: AccordionStore; readOnly?: boolean } = $props();

	const LADDER: { kind: BlockKind; label: string }[] = [
		{ kind: "tool_result", label: "tool results" },
		{ kind: "thinking", label: "thinking" },
		{ kind: "text", label: "replies" },
		{ kind: "tool_call", label: "tool calls" },
		{ kind: "user", label: "your messages" },
	];

	const liveByKind = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const k of LADDER) m[k.kind] = 0;
		for (const b of store.blocks) if (b.kind in m) m[b.kind] += store.effTokens(b);
		return m;
	});

	// Everything the operator SEES is in real provider tokens (estimate × calibration `k`), since
	// that is what fills the window and costs money. The budget is likewise real, and the conductor
	// converts it back to estimate units internally (see `availableCap`).
	const kCal = $derived(store.calibration);
	const liveReal = $derived(store.liveTokens * kCal);
	const fullReal = $derived(store.fullTokens * kCal);
	const savedReal = $derived(store.savedTokens * kCal);
	const denom = $derived(Math.max(fullReal, store.budget, 1));
	const conductorStatusText = $derived(store.conductorStatus.text || conductorStatus.text);
	const conductorStatusDetails = $derived(store.conductorStatus.text ? store.conductorStatus.details : conductorStatus.details);
	// fmt/k formatters must round their input because AnimatedNumber passes a float mid-tween
	const fmt = (n: number) => Math.round(n).toLocaleString();
	type Hint = { text: string; rect: DOMRect };
	let hint = $state<Hint | null>(null);
	const budgetHint = "The budget is a soft target. Accordion kept older cached context intact instead of shrinking it, because changing that prefix would cause a costly provider cache miss.";
	const accountingHint = "Pi reports provider usage. Wire is the serialized request. Harness covers system instructions, tools, and message structure. Live content can still fold. Framing cannot.";
	function showHint(event: MouseEvent | FocusEvent, text: string): void {
		hint = { text, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() };
	}

	const k = (n: number) => {
		const r = Math.round(n);
		if (r >= 1_000_000) {
			const m = r / 1_000_000;
			return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
		}
		return r >= 1000 ? `${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k` : `${r}`;
	};
	const fmtOverBy = (n: number) => k(Math.round(n));
	function formatStatusDetails(value: JSONValue | undefined): string {
		if (value == null) return "";
		const lines: string[] = [];
		const pushList = (title: string, items: JSONValue | undefined) => {
			if (!Array.isArray(items) || items.length === 0) return;
			lines.push(title);
			for (const item of items.slice(0, 8)) {
				if (item && typeof item === "object" && !Array.isArray(item)) {
					const obj = item as Record<string, JSONValue>;
					const turn = typeof obj.turn === "number" ? `t${obj.turn}: ` : "";
					const cat = typeof obj.cat === "string" ? `[${obj.cat}] ` : "";
					const label = typeof obj.label === "string" ? obj.label : typeof obj.value === "string" ? obj.value : JSON.stringify(item);
					lines.push(`  ${turn}${cat}${label}`);
				} else {
					lines.push(`  ${String(item)}`);
				}
			}
		};
		if (typeof value === "object" && !Array.isArray(value)) {
			const obj = value as Record<string, JSONValue>;
			pushList("facts", obj.factLedger);
			pushList("folded TOC", obj.relevanceTOC);
			const summary = obj.summary;
			if (summary && typeof summary === "object" && !Array.isArray(summary)) {
				lines.push(`summaries ${JSON.stringify(summary)}`);
			}
			if (lines.length) return lines.join("\n");
		}
		return JSON.stringify(value, null, 2);
	}

	// ── Protected tail: an on-bar handle (left = 0, drag right to protect more) ──
	const PROT_MAX = 60_000;
	const PROT_STEP = 2_000;
	// Budget slider bounds + fill fraction (native range tracks don't paint a colored
	// fill once a custom thumb is defined, so we drive it via background-size).
	const BUDGET_MIN = 12_000;
	const budgetMax = $derived(Math.max(store.contextWindow ?? 200_000, store.budget, 200_000));
	const budgetPct = $derived(((store.budget - BUDGET_MIN) / (budgetMax - BUDGET_MIN)) * 100);
	let barEl = $state<HTMLDivElement>();
	// Everything on the bar is scaled to `denom` so the protected handle/tint share
	// the composition bar's token axis. Clamp the readout to the bar so a tiny session
	// (protect target > whole context) never paints past the right edge.
	// protectTokens is in ESTIMATE units; the bar's denom is real, so scale by k to place it.
	const protPct = $derived(Math.min(100, ((store.protectTokens * kCal) / denom) * 100));
	// While dragging, the handle follows the cursor continuously (smooth) and the
	// expensive fold commit is throttled to one per frame. `dragTokens` is non-null
	// only mid-drag; otherwise the handle tracks the committed target.
	let dragTokens = $state<number | null>(null);
	const handlePct = $derived(
		dragTokens != null ? Math.min(100, ((dragTokens * kCal) / denom) * 100) : protPct,
	);
	// The TARGET protected size the user is dialing in. The underline + its label echo
	// this (smooth, matches the grip), NOT the actual protected tail — `protectedTokens`
	// snaps to whole-block boundaries, so it differs slightly and jitters as you drag.
	const targetTokens = $derived(dragTokens ?? store.protectTokens);
	// Headroom: the slack between what's used and the budget ceiling. Only present when
	// the budget exceeds the full (unfolded) size — i.e. denom === budget.
	const headroomPct = $derived(Math.max(0, ((denom - fullReal) / denom) * 100));
	// What "Revert to auto" will clear: every block carrying a manual/agent override.
	const editCount = $derived(store.blocks.filter((b) => b.override !== null).length);

	// ── Real context-window bar (live only): the CALIBRATED view of the actual provider
	// request. `liveTokens`/`harnessOverhead` are our estimate units; × calibration `k`
	// projects them onto real provider tokens, which is what actually fills the window. ──
	const realMessages = $derived(liveReal);
	const realHarness = $derived(store.harnessOverhead * kCal);
	const realReserve = $derived(store.outputReserve);
	const realTotal = $derived(realMessages + realHarness + realReserve);
	const showWindow = $derived(store.contextWindow != null && store.harnessBreakdown != null);
	const realOver = $derived(store.contextWindow != null && realTotal > store.contextWindow);
	// Width as a % of the real window, clamped so an over-budget request can't paint past the edge.
	const winPct = (n: number) => {
		const w = store.contextWindow ?? 0;
		return w > 0 ? Math.max(0, Math.min(100, (n / w) * 100)) : 0;
	};

	// ── Involvement locks (ADR 0011) — the honest mirror of the engine's gating. A locked
	// control LOOKS locked in every mode (preview/demo/read-only included), driven purely off
	// `store.isLocked(...)`. The engine already no-ops the underlying action; this is the UI
	// reflecting that, not the enforcement. The budget dial is NEVER gated (sacred tier).
	const tailLocked = $derived(store.isLocked("tail-size"));
	const steerLocked = $derived(store.isLocked("human-steering"));
	const lockedBy = $derived(store.lockingConductorLabel);
	const lockTip = $derived(`Locked by ${lockedBy ?? "the active conductor"} — detach to take back control`);

	function protectFromClientX(clientX: number): number {
		if (!barEl) return store.protectTokens;
		const r = barEl.getBoundingClientRect();
		const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
		// denom is real tokens; PROT_MAX / protectTokens are estimate units → convert back (÷ k).
		return Math.max(0, Math.min(PROT_MAX, (frac * denom) / (kCal || 1)));
	}
	// Snap to the step and commit the real fold. Only ever called on release (or via
	// keyboard) — NEVER mid-drag, so blocks are re-folded once when you let go, not
	// continuously while you move the handle.
	function commitTarget(tokens: number) {
		const snapped = Math.round(tokens / PROT_STEP) * PROT_STEP;
		if (snapped !== store.protectTokens) store.setProtect(snapped);
	}
	function onProtPointerDown(e: PointerEvent) {
		if (tailLocked) return; // tail-size locked by the conductor — the handle is inert
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragTokens = protectFromClientX(e.clientX); // visual only — no refold yet
	}
	function onProtPointerMove(e: PointerEvent) {
		if (dragTokens == null) return; // only while held
		dragTokens = protectFromClientX(e.clientX); // visual only — no refold yet
	}
	function onProtPointerUp() {
		if (dragTokens == null) return;
		commitTarget(dragTokens); // single refold, on release
		dragTokens = null;
	}
	function onProtKeydown(e: KeyboardEvent) {
		if (tailLocked) return; // tail-size locked — keyboard nudges are inert too
		let v = store.protectTokens;
		if (e.key === "ArrowLeft" || e.key === "ArrowDown") v -= PROT_STEP;
		else if (e.key === "ArrowRight" || e.key === "ArrowUp") v += PROT_STEP;
		else if (e.key === "Home") v = 0;
		else if (e.key === "End") v = PROT_MAX;
		else return;
		e.preventDefault();
		store.setProtect(Math.max(0, Math.min(PROT_MAX, v)));
	}
</script>

<div class="hdr">
	<div class="top">
		<!-- ── Left: the hero live number / budget. Single focal stat — no echoing
		     CONTEXT eyebrow or live·folded readout (those just restated this). ── -->
		<div class="nums">
			<div class="hero-line">
				<span class="hero-stat mono tnum" class:over={store.overBudget}>
					<AnimatedNumber value={liveReal} format={fmt} />
				</span>
				<span class="budget-denom mono tnum">/ <AnimatedNumber value={store.budget} format={fmt} /></span>
				{#if store.overBudget}
					<span class="over-flag mono tnum">
						over by <AnimatedNumber value={liveReal - store.budget} format={fmtOverBy} />
						<button class="hint-icon" aria-label="Why this is over budget" onmouseenter={(event) => showHint(event, budgetHint)} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, budgetHint)} onblur={() => (hint = null)}>i</button>
					</span>
				{/if}
			</div>
			<!-- Slice 0c diagnostic: harness overhead broken into named buckets so the
			     operator can see where the wire actually goes. `pi` is what the provider
			     reports via getContextUsage (may include cache-accounting phantoms);
			     `wire` is the chars/4 size of the actual serialized request body. A gap
			     between them = cache accounting (cheap). `sys`/`tools`/`other` split the
			     wire harness into provider-payload buckets. -->
			{#if store.harnessBreakdown}
				{@const hb = store.harnessBreakdown}
				{@const total = hb.totalTokens}
				{#if total !== null}
					{@const wire = hb.actualWireTokens ?? null}
					{@const sysWire = hb.systemPayloadTokens ?? hb.systemPromptTokens ?? null}
					{@const toolsWire = hb.toolsTokens ?? null}
					{@const msgsWire = hb.messagesTokens ?? null}
					{@const framing = msgsWire !== null ? Math.max(0, msgsWire - store.liveTokens) : null}
					{@const wireHarness = wire !== null ? wire - store.liveTokens : null}
					<div class="harness-line mono tnum">
						<button class="hint-icon" aria-label="About these token measurements" onmouseenter={(event) => showHint(event, accountingHint)} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, accountingHint)} onblur={() => (hint = null)}>i</button>
						<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Pi's provider-reported context usage. It can include cached input, so it may differ from the serialized request size.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Pi's provider-reported context usage. It can include cached input, so it may differ from the serialized request size.")} onblur={() => (hint = null)}>pi {fmt(total)}</span>
						{#if wire !== null}<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Estimated size of the actual request body sent to the model provider.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Estimated size of the actual request body sent to the model provider.")} onblur={() => (hint = null)}>· wire {fmt(wire)}</span>{/if}
						{#if wireHarness !== null}<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Everything in the request besides the currently foldable conversation, such as system instructions, tools, and message framing.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Everything in the request besides the currently foldable conversation, such as system instructions, tools, and message framing.")} onblur={() => (hint = null)}>· harness {fmt(wireHarness)}</span>{:else}<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Everything in the request besides the currently foldable conversation, estimated from Pi's reported usage.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Everything in the request besides the currently foldable conversation, estimated from Pi's reported usage.")} onblur={() => (hint = null)}>· harness {fmt(total - store.liveTokens)}</span>{/if}
						{#if sysWire !== null && toolsWire !== null && msgsWire !== null && framing !== null}
							(<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "System instructions sent with every request.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "System instructions sent with every request.")} onblur={() => (hint = null)}>sys {fmt(sysWire)}</span> · <span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Tool schemas sent with every request.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Tool schemas sent with every request.")} onblur={() => (hint = null)}>tools {fmt(toolsWire)}</span> · <span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "All conversation messages in the serialized request.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "All conversation messages in the serialized request.")} onblur={() => (hint = null)}>messages {fmt(msgsWire)}</span>: <span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Conversation content Accordion can still fold or keep live.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Conversation content Accordion can still fold or keep live.")} onblur={() => (hint = null)}>{fmt(store.liveTokens)} live</span> + <span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "Per-message protocol structure and other irreducible message overhead. It cannot be folded away.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "Per-message protocol structure and other irreducible message overhead. It cannot be folded away.")} onblur={() => (hint = null)}>{fmt(framing)} framing</span>)
						{:else if hb.systemPromptTokens !== null}
							(<span class="hint-target" tabindex="0" onmouseenter={(event) => showHint(event, "System instructions sent with every request.")} onmouseleave={() => (hint = null)} onfocus={(event) => showHint(event, "System instructions sent with every request.")} onblur={() => (hint = null)}>sys {fmt(hb.systemPromptTokens)}</span>)
						{/if}
					</div>
				{/if}
			{/if}
		</div>

		<!-- ── Right: controls cluster ── -->
		<div class="ctl">
			<!-- Active conductor (ADR 0007): which strategy is managing this context. The store
			     drives the lock-aware affordances (ADR 0011: consent gate + kill switch). -->
			<ConductorMenu {store} />

			{#if readOnly}
				<span
					class="ro-badge mono"
					role="status"
					aria-label="Read-only session"
					title="Viewing a recording — folds are local and do not affect any agent."
				>
					<Icon name="eye" size={11} />
					READ-ONLY
				</span>
			{/if}

			{#if live.status === "connected"}
				<button
					class="fold-arm"
					class:on={folding.enabled}
					aria-pressed={folding.enabled}
					aria-label="Apply folds to the live agent"
					title={folding.enabled
						? "Accordion is applying folds to the live agent's context. Takes effect on the agent's next turn."
						: "Folds are previewed in the view only. The agent's context is unchanged."}
					onclick={() => setFolding(!folding.enabled)}
				>
					<span class="fold-arm-dot" aria-hidden="true"></span>
					<span class="fold-arm-eyebrow mono">FOLDING</span>
					<span class="fold-arm-state">{folding.enabled ? "steering" : "preview"}</span>
				</button>
			{/if}

			<!-- Protect readout: eyebrow + editable mono value (the dial lives on the bar). -->
			<div
				class="ctl-field protect-read"
				class:ctl-locked={tailLocked}
				aria-disabled={tailLocked}
				title={tailLocked
					? lockTip + " (the conductor now owns the tail)"
					: `Actual protected tail: ${fmt(store.protectedTokens * kCal)} tokens; target: ${fmt(store.protectTokens * kCal)} tokens — click the value or drag the handle to change it`}
			>
				<span class="ctl-eyebrow mono">
					<Icon name="lock" size={10} />
					PROTECT
				</span>
				<span class="ctl-value mono tnum">
					{#if tailLocked}
						<!-- tail-size locked: a static readout, not an editable dial. -->
						<span class="kl-val">{k(store.protectTokens * kCal)}</span>
					{:else}
						<EditableNumber
							value={store.protectTokens * kCal}
							format={k}
							label="Protected tail target in thousands of tokens (real)"
							oncommit={(n) => store.setProtect(Math.max(0, Math.min(PROT_MAX, n / (kCal || 1))))}
						/>
					{/if}
					{#if Math.abs(store.protectedTokens - store.protectTokens) > 500}
						<span class="kl-target tnum">({k(store.protectedTokens * kCal)})</span>
					{/if}
				</span>
			</div>

			<!-- Budget: eyebrow + editable mono value + fill slider. -->
			<div class="ctl-field knob">
				<span class="ctl-eyebrow mono">
					<Icon name="target" size={10} />
					BUDGET
				</span>
				<span class="ctl-value mono tnum">
					<EditableNumber
						value={store.budget}
						format={k}
						label="Context budget in thousands of tokens"
						oncommit={(n) => store.setBudget(Math.max(BUDGET_MIN, Math.min(budgetMax, n)))}
					/>
				</span>
				<input
					type="range"
					min={BUDGET_MIN}
					max={budgetMax}
					step="2000"
					value={store.budget}
					oninput={(e) => store.setBudget(+e.currentTarget.value)}
					aria-label="Context budget"
					style:background-size="{budgetPct}% 100%"
				/>
			</div>

			<button
				class="btn-secondary reset-btn"
				onclick={() => store.resetAll()}
				disabled={editCount === 0 || steerLocked}
				aria-disabled={steerLocked}
				title={steerLocked
					? lockTip
					: editCount === 0
						? "No manual edits — the view is already automatic"
						: `Clear ${editCount} manual edit${editCount === 1 ? "" : "s"} and return to the automatic fold view`}
			>
				<Icon name="rotate-ccw" size={13} />
				Revert to auto
				{#if editCount > 0}<span class="reset-cnt mono tnum">{editCount}</span>{/if}
			</button>
		</div>
	</div>

	<!-- ── Conductor telemetry (display-only): one-line status from the active conductor. -->
	{#if conductorStatusText}
		<div class="cond-telemetry-wrap">
			<div class="cond-telemetry" role="status" title={conductorStatusText}>
				<Icon name="activity" size={11} />
				<span class="cond-telemetry-text mono">{conductorStatusText}</span>
			</div>
			{#if conductorStatusDetails}
				<details class="cond-detail">
					<summary class="cond-detail-trigger mono">details</summary>
					<pre class="cond-detail-body mono">{formatStatusDetails(conductorStatusDetails)}</pre>
				</details>
			{/if}
		</div>
	{/if}

	<!-- ── Composition bar + on-bar protected control ── -->
	<div class="bar-area">
		<div class="bar" bind:this={barEl} role="img" aria-label="Context composition">
			{#each LADDER as seg (seg.kind)}
				{@const v = liveByKind[seg.kind] * kCal}
				{#if v > 0}
					<span class="seg k-{seg.kind}" style:width="{(v / denom) * 100}%" title="{seg.label}: {fmt(v)} live"></span>
				{/if}
			{/each}
			{#if savedReal > 0}
				<span class="seg saved-seg" style:width="{(savedReal / denom) * 100}%" title="folded away: {fmt(savedReal)}"></span>
			{/if}
			{#if headroomPct > 0.5}
				<span class="headroom" style:left="{100 - headroomPct}%" style:width="{headroomPct}%" title="headroom: {fmt(store.budget - fullReal)} under budget"></span>
			{/if}
			<!-- protected extent, clipped to the bar -->
			<span class="prot-tint" style:width="{handlePct}%" aria-hidden="true"></span>
		</div>

		<!-- budget ceiling marker — sibling of .bar so its cap escapes overflow:hidden -->
		<span class="bar-marker" style:left="{(store.budget / denom) * 100}%" title="budget: {fmt(store.budget)}">
			<span class="bar-marker-cap" aria-hidden="true"></span>
		</span>

		<!-- draggable protected handle (floats above the clipped bar). Inert under the
		     tail-size lock — the conductor owns the tail (ADR 0011 §7). -->
		<div
			class="prot-grip"
			class:dragging={dragTokens != null}
			class:locked={tailLocked}
			style:left="{handlePct}%"
			role="slider"
			tabindex={tailLocked ? -1 : 0}
			aria-label="Protected tail in tokens"
			aria-disabled={tailLocked}
			aria-valuemin="0"
			aria-valuemax={PROT_MAX}
			aria-valuenow={store.protectTokens}
			aria-valuetext="{fmt(store.protectTokens)} tokens protected"
			title={tailLocked ? lockTip : undefined}
			onpointerdown={onProtPointerDown}
			onpointermove={onProtPointerMove}
			onpointerup={onProtPointerUp}
			onpointercancel={onProtPointerUp}
			onkeydown={onProtKeydown}
		></div>

		<!-- the slight underline echoing the protected extent -->
		<div class="prot-underline-track" aria-hidden="true">
			<span class="prot-underline" style:width="{handlePct}%"></span>
			<span class="prot-underline-lab" style:left="{handlePct}%">{k(targetTokens * kCal)} protected</span>
		</div>
	</div>

	<!-- ── Real context-window bar (live): messages · harness · reply · free, against the
	     model's true window, using the live calibration `k` so this reflects the ACTUAL
	     provider request — not just the folded conversation the composition bar shows. ── -->
	{#if showWindow}
		{@const window = store.contextWindow ?? 0}
		<div class="window-area">
			<div class="window-caption mono tnum" class:over={realOver}>
				<span class="win-label">real window</span>
				{fmt(realTotal)} / {fmt(window)}
				<span class="win-k">×{kCal.toFixed(2)}</span>
				<span class="win-split">messages {fmt(realMessages)} · harness {fmt(realHarness)} · reply {fmt(realReserve)}</span>
				{#if realOver}<span class="win-over">over window by {fmt(realTotal - window)}</span>{/if}
			</div>
			<div
				class="window-bar"
				class:over={realOver}
				role="img"
				aria-label="Real context window usage: {fmt(realTotal)} of {fmt(window)} tokens"
			>
				<span class="wseg w-msg" style:width="{winPct(realMessages)}%" title="messages (calibrated): {fmt(realMessages)}"></span>
				<span class="wseg w-harness" style:width="{winPct(realHarness)}%" title="harness — system + tools + framing (calibrated): {fmt(realHarness)}"></span>
				<span class="wseg w-reserve" style:width="{winPct(realReserve)}%" title="reserved for the reply: {fmt(realReserve)}"></span>
			</div>
		</div>
	{/if}
</div>

{#if hint}
	<div class="header-tip" style:left="{hint.rect.left + hint.rect.width / 2}px" style:top="{hint.rect.bottom + 8}px">{hint.text}</div>
{/if}

<style>
	/* ── Container ── */
	.hdr {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		padding: var(--sp-3) var(--sp-4) var(--sp-3);
		border-bottom: 1px solid var(--line-soft);
		background: var(--panel);
		box-shadow: var(--shadow-1);
		flex: 0 0 auto;
	}

	/* ── Top row: nums left, ctl right ── */
	.top {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-4);
	}

	/* ── Nums cluster — the brand data device ── */
	.nums {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		min-width: 0;
	}

	/* Hero line: live number + denominator + optional over-flag */
	.hero-line {
		display: flex;
		align-items: baseline;
		gap: var(--sp-2);
	}

	/* Hero stat — the primary focal point */
	.hero-stat {
		font-size: var(--fs-2xl);
		font-weight: 600;
		color: var(--text);
		line-height: 1;
		letter-spacing: -0.01em;
		transition: color var(--dur-fast) var(--ease-out);
	}
	.hero-stat.over {
		color: var(--danger);
	}

	.budget-denom {
		font-size: var(--fs-sm);
		color: var(--faint);
		align-self: baseline;
	}

	/* Slice 0 harness diagnostic: dim line under the hero number. */
	.harness-line {
		font-size: var(--fs-xs);
		color: var(--faint);
		margin-top: 2px;
		letter-spacing: 0.01em;
	}

	/* Over-budget flag — danger, no pill chrome */
	.hint-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		margin-left: 3px;
		padding: 0;
		background: transparent;
		color: inherit;
		border: 1px solid currentColor;
		border-radius: 50%;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		font-style: normal;
		line-height: 1;
		vertical-align: 1px;
		cursor: help;
	}

	.hint-target {
		border-radius: 3px;
		cursor: help;
		outline: none;
	}

	.hint-target:hover,
	.hint-target:focus-visible {
		color: var(--text);
		text-decoration: underline dotted;
		text-underline-offset: 2px;
	}

	.header-tip {
		position: fixed;
		z-index: 20;
		max-width: 300px;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
		font-size: var(--fs-xs);
		line-height: 1.45;
		transform: translateX(-50%);
		pointer-events: none;
	}

	.over-flag {
		font-size: var(--fs-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--danger);
	}

	/* ── Controls cluster ── */
	.ctl {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		flex: 0 0 auto;
	}

	/* Eyebrow shared by every control field — mono, uppercase, wide tracking, faint. */
	.ctl-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-2xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--faint);
		line-height: 1;
		user-select: none;
	}
	/* The mono value beneath an eyebrow. */
	.ctl-value {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		font-size: var(--fs-sm);
		color: var(--text);
		line-height: 1;
	}
	.ctl-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		cursor: default;
	}

	/* Read-only badge — mono eyebrow chip */
	.ro-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-2xs);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
		background: var(--panel-2);
		border: 1px solid var(--line);
		padding: 4px 9px 4px 7px;
		border-radius: var(--radius-sm);
		white-space: nowrap;
		user-select: none;
	}

	/* ── Folding-arm toggle — quiet ghost; armed → --ok green (state color) ── */
	.fold-arm {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		padding: 6px 12px 6px 10px;
		border-radius: var(--radius-sm);
		line-height: 1;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}
	.fold-arm:hover {
		border-color: var(--line-strong);
		background: var(--accent-soft);
		color: var(--text);
	}
	.fold-arm-eyebrow {
		font-size: var(--fs-2xs);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--faint);
	}
	.fold-arm-state {
		font-size: var(--fs-xs);
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.fold-arm-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--faint);
		flex: 0 0 auto;
		transition:
			background var(--dur-fast) var(--ease-out),
			box-shadow var(--dur-fast) var(--ease-out);
	}
	.fold-arm.on {
		background: color-mix(in srgb, var(--ok) 12%, transparent);
		border-color: color-mix(in srgb, var(--ok) 55%, var(--line));
		color: var(--ok);
	}
	.fold-arm.on:hover {
		background: color-mix(in srgb, var(--ok) 20%, var(--panel));
		border-color: var(--ok);
	}
	.fold-arm.on .fold-arm-eyebrow {
		color: color-mix(in srgb, var(--ok) 70%, var(--muted));
	}
	.fold-arm.on .fold-arm-dot {
		background: var(--ok);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 28%, transparent);
	}

	/* Protect / Budget value helpers */
	.kl-val {
		color: var(--text);
		font-weight: 600;
	}
	.kl-target {
		color: var(--faint);
		font-weight: 400;
	}

	/* ── Slider knob ── */
	.knob input[type="range"] {
		width: 120px;
		height: 4px;
		accent-color: var(--accent);
		margin: 0;
		cursor: pointer;
		/* Custom track via appearance manipulation where supported */
		appearance: none;
		-webkit-appearance: none;
		/* native range tracks won't paint a colored fill once a custom thumb is set,
		   so the accent "progress" is a no-repeat background sized via --budgetPct */
		background-color: var(--panel-2);
		background-image: linear-gradient(var(--accent), var(--accent));
		background-repeat: no-repeat;
		background-size: 0% 100%;
		border-radius: var(--radius-pill);
		outline: none;
	}
	.knob input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
		transition: box-shadow var(--dur-fast) var(--ease-out);
	}
	.knob input[type="range"]:hover::-webkit-slider-thumb {
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.knob input[type="range"]:focus-visible {
		box-shadow: var(--focus-ring);
		border-radius: var(--radius-pill);
	}

	/* ── Secondary (outline) button — brand button system ── */
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid var(--line-strong);
		color: var(--text);
		padding: 7px 12px 7px 10px;
		border-radius: var(--radius-sm);
		font-size: var(--fs-xs);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}
	.btn-secondary:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.btn-secondary:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.btn-secondary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.reset-cnt {
		font-size: 10px;
		line-height: 1;
		font-weight: 600;
		color: var(--ink);
		background: var(--paper);
		border-radius: var(--radius-pill);
		padding: 2px 6px;
	}

	/* Protect readout (the dial lives on the bar) */
	.protect-read {
		cursor: default;
	}

	/* A control gated by an involvement lock (ADR 0011): greyed, reduced affordance. The
	   honest mirror of the engine's server-side gating — looks locked in every mode. */
	.ctl-locked {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Conductor telemetry line: one muted, mono status from the active conductor ──
	   Right-aligned so it sits under the conductor switcher in the controls cluster. */
	.cond-telemetry-wrap {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		min-width: 0;
	}
	.cond-telemetry {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 5px;
		margin-top: -2px;
		min-width: 0;
		color: var(--faint);
	}
	.cond-telemetry-text {
		font-size: var(--fs-2xs);
		letter-spacing: 0.01em;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.cond-detail {
		max-width: min(760px, 100%);
		color: var(--muted);
		font-size: var(--fs-2xs);
	}
	.cond-detail-trigger {
		cursor: pointer;
		color: var(--faint);
		list-style: none;
		text-align: right;
	}
	.cond-detail-trigger::-webkit-details-marker {
		display: none;
	}
	.cond-detail-body {
		margin: 2px 0 0;
		padding: var(--sp-2);
		max-height: 180px;
		overflow: auto;
		white-space: pre-wrap;
		border: 1px solid var(--line-soft);
		background: var(--panel-2);
		color: var(--muted);
	}

	/* ── Composition bar area: bar + on-bar protected control + underline ── */
	.bar-area {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	/* Budget headroom: slack between usage and the ceiling */
	.headroom {
		position: absolute;
		top: 0;
		bottom: 0;
		pointer-events: none;
		background: repeating-linear-gradient(
			90deg,
			transparent,
			transparent 5px,
			rgba(255, 255, 255, 0.03) 5px,
			rgba(255, 255, 255, 0.03) 6px
		);
		border-left: 1px dashed var(--line-strong);
	}

	/* Protected extent tint — clipped to the bar's rounded shape */
	.prot-tint {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		pointer-events: none;
		background: var(--accent-soft);
		border-right: 2px solid var(--accent);
		border-radius: var(--radius-pill) 0 0 var(--radius-pill);
	}

	/* Draggable handle — lives in .bar-area so it can extend past the clipped bar */
	.prot-grip {
		position: absolute;
		top: -4px;
		height: 34px;
		width: 14px;
		margin-left: -7px;
		cursor: ew-resize;
		z-index: 5;
		touch-action: none;
		display: flex;
		align-items: center;
		justify-content: center;
		/* the focus-visible ring (global box-shadow) follows this radius — without it the
		   ring would be a sharp rectangle around the transparent hit area. */
		border-radius: var(--radius-sm);
	}
	.prot-grip::before {
		content: "";
		width: 4px;
		height: 100%;
		border-radius: 4px;
		background: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
		transition: box-shadow var(--dur-fast) var(--ease-out);
	}
	.prot-grip:hover::before,
	.prot-grip:focus-visible::before,
	.prot-grip.dragging::before {
		box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 32%, transparent);
	}
	.prot-grip:focus-visible {
		outline: none;
	}

	/* tail-size locked: the handle is inert and dimmed (the conductor owns the tail). */
	.prot-grip.locked {
		cursor: not-allowed;
		opacity: 0.4;
	}
	.prot-grip.locked::before {
		background: var(--faint);
		box-shadow: none;
	}
	.prot-grip.locked:hover::before {
		box-shadow: none;
	}

	/* The slight underline echoing the protected extent */
	.prot-underline-track {
		position: relative;
		height: 13px;
	}
	.prot-underline {
		position: absolute;
		left: 0;
		top: 0;
		height: 3px;
		border-radius: 3px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 40%, transparent), var(--accent));
	}
	.prot-underline-lab {
		position: absolute;
		top: 5px;
		transform: translateX(-50%);
		font-family: var(--mono);
		font-size: var(--fs-2xs);
		color: var(--accent);
		white-space: nowrap;
		pointer-events: none;
	}

	/* ── Composition bar ── */
	.bar {
		position: relative;
		display: flex;
		height: 26px;
		width: 100%;
		background: var(--panel-2);
		border: 1px solid var(--line-soft);
		/* inset frame shadow gives the "recessed track" feeling */
		box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.seg {
		height: 100%;
		/* 1px gap between segments via outline trick — avoids reflow */
		outline: 1px solid var(--panel);
		outline-offset: -1px;
		transition: width 180ms var(--ease-out);
		flex: 0 0 auto;
	}
	/* Segment rounding — only first and last visible get radius (paint trick via box-shadow) */
	.seg:first-child  { border-radius: var(--radius-pill) 0 0 var(--radius-pill); }
	.seg:last-of-type { border-radius: 0 var(--radius-pill) var(--radius-pill) 0; }

	.seg.k-user       { background: var(--k-user); }
	.seg.k-text       { background: var(--k-text); }
	.seg.k-thinking   { background: var(--k-thinking); }
	.seg.k-tool_call  { background: var(--k-tool_call); }
	.seg.k-tool_result{ background: var(--k-tool_result); }
	.seg.saved-seg {
		background-color: var(--panel-3);
		background-image: repeating-linear-gradient(
			45deg,
			transparent,
			transparent 4px,
			rgba(255, 255, 255, 0.045) 4px,
			rgba(255, 255, 255, 0.045) 8px
		);
	}

	/* Budget marker line + tiny cap. Sibling of .bar (not a child) so the cap at
	   top:-3px escapes .bar's overflow:hidden; height matches the bar's 28px box. */
	.bar-marker {
		position: absolute;
		top: 0;
		height: 28px;
		width: 2px;
		background: var(--text);
		box-shadow: 0 0 0 1px var(--panel-2);
		pointer-events: none;
		transform: translateX(-50%);
		z-index: 4;
	}
	.bar-marker-cap {
		position: absolute;
		top: -3px;
		left: 50%;
		transform: translateX(-50%);
		width: 6px;
		height: 6px;
		background: var(--text);
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--panel-2);
	}

	/* ── Real context-window bar: calibrated messages · harness · reply · free ── */
	.window-area {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: var(--sp-2);
	}
	.window-caption {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 6px;
		font-size: var(--fs-2xs);
		color: var(--muted);
		letter-spacing: 0.01em;
	}
	.window-caption.over {
		color: var(--danger);
	}
	.win-label {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--faint);
	}
	.win-k {
		color: var(--faint);
	}
	.win-split {
		color: var(--faint);
	}
	.win-over {
		font-weight: 600;
		color: var(--danger);
	}
	.window-bar {
		position: relative;
		display: flex;
		height: 10px;
		width: 100%;
		background: var(--panel-2);
		border: 1px solid var(--line-soft);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.window-bar.over {
		border-color: color-mix(in srgb, var(--danger) 55%, var(--line));
	}
	.wseg {
		height: 100%;
		outline: 1px solid var(--panel);
		outline-offset: -1px;
		transition: width 180ms var(--ease-out);
		flex: 0 0 auto;
	}
	.wseg:first-child {
		border-radius: var(--radius-pill) 0 0 var(--radius-pill);
	}
	/* messages = the foldable conversation; harness = system + tools + framing;
	   reply = the reserved output space. Free space is the bar's own track. */
	.wseg.w-msg {
		background: var(--accent);
	}
	.wseg.w-harness {
		background: var(--k-tool_call);
	}
	.wseg.w-reserve {
		background-color: var(--panel-3);
		background-image: repeating-linear-gradient(
			45deg,
			transparent,
			transparent 3px,
			rgba(255, 255, 255, 0.06) 3px,
			rgba(255, 255, 255, 0.06) 6px
		);
	}
</style>
