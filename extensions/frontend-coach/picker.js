/* frontend-coach picker — injected into your app page.
 * Connects to ws://localhost:7777, lets you Alt+P → click an element →
 * type an instruction → sends it to pi.
 */
(() => {
	if (window.__piCoach) {
		console.log("[frontend-coach] already loaded");
		return;
	}
	window.__piCoach = true;

	const PORT = 7777;
	const WS_URL = `ws://localhost:${PORT}`;

	// ---------- WebSocket ----------
	let ws;
	let backoff = 500;
	function connect() {
		ws = new WebSocket(WS_URL);
		ws.onopen = () => {
			backoff = 500;
			banner("frontend-coach connected · Alt+P to pick", "#0a0");
		};
		ws.onclose = () => {
			banner("frontend-coach disconnected — retrying…", "#a00");
			setTimeout(connect, (backoff = Math.min(backoff * 2, 5000)));
		};
		ws.onerror = () => { try { ws.close(); } catch {} };
		ws.onmessage = (ev) => {
			let m; try { m = JSON.parse(ev.data); } catch { return; }
			if (m.kind === "highlight") return flash(m.selector, m.color || "lime");
			if (m.kind === "inspect")   return reply(m.reqId, inspect(m.selector));
			if (m.kind === "eval")      return reply(m.reqId, safeEval(m.expression));
		};
	}
	function reply(reqId, result) {
		try { ws.send(JSON.stringify({ reqId, result })); } catch {}
	}
	connect();

	// ---------- UI: banner + selection box ----------
	const banner_ = document.createElement("div");
	Object.assign(banner_.style, {
		position: "fixed", bottom: "8px", right: "8px",
		padding: "4px 8px", font: "12px/1.4 system-ui, sans-serif",
		color: "#fff", background: "#333", borderRadius: "4px",
		zIndex: 2147483647, pointerEvents: "none", opacity: "0.85",
	});
	document.body.appendChild(banner_);
	function banner(text, bg) {
		banner_.textContent = text;
		if (bg) banner_.style.background = bg;
	}

	const box = document.createElement("div");
	Object.assign(box.style, {
		position: "fixed", pointerEvents: "none", display: "none",
		outline: "2px solid #f0f", outlineOffset: "0px",
		background: "rgba(255,0,255,0.08)",
		zIndex: 2147483646, transition: "all 60ms",
	});
	document.body.appendChild(box);

	// ---------- Pick mode ----------
	let armed = false;
	let hovered = null;

	addEventListener("keydown", (e) => {
		// Alt+P toggles picker
		if (e.altKey && (e.key === "p" || e.key === "P")) {
			armed = !armed;
			box.style.display = armed ? "block" : "none";
			banner(armed ? "PICKING — click an element (Esc to cancel)" : "frontend-coach idle · Alt+P to pick",
				armed ? "#a60" : "#333");
		}
		if (e.key === "Escape" && armed) {
			armed = false; box.style.display = "none";
			banner("frontend-coach idle · Alt+P to pick", "#333");
		}
	});

	addEventListener("mousemove", (e) => {
		if (!armed) return;
		const el = document.elementFromPoint(e.clientX, e.clientY);
		if (!el || el === box || el === banner_) return;
		hovered = el;
		const r = el.getBoundingClientRect();
		Object.assign(box.style, {
			display: "block",
			top: r.top + "px", left: r.left + "px",
			width: r.width + "px", height: r.height + "px",
		});
	}, true);

	addEventListener("click", (e) => {
		if (!armed || !hovered) return;
		e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
		const el = hovered;
		armed = false; box.style.display = "none";
		banner("frontend-coach idle · Alt+P to pick", "#333");

		const instruction = window.prompt(
			"What should the agent do with this element?\n\n" + cssPath(el),
			""
		);
		if (!instruction) return;

		const payload = {
			kind: "user_click",
			url: location.href,
			selector: cssPath(el),
			outerHTML: (el.outerHTML || "").slice(0, 2000),
			sourceFile: el.dataset && (el.dataset.source || el.dataset.locator) || null,
			rect: rectOf(el),
			styles: pickStyles(el),
			componentChain: fiberBreadcrumb(el),
			scriptHosts: scriptHosts(),
			instruction,
		};
		try { ws.send(JSON.stringify(payload)); banner("sent to pi ✓", "#0a0"); }
		catch (err) { banner("send failed: " + err.message, "#a00"); }
	}, true);

	// ---------- Tool implementations ----------
	function inspect(selector) {
		const el = document.querySelector(selector);
		if (!el) return { error: `no element matches ${selector}` };
		return {
			selector,
			outerHTML: (el.outerHTML || "").slice(0, 4000),
			rect: rectOf(el),
			styles: pickStyles(el),
			textContent: (el.textContent || "").trim().slice(0, 500),
		};
	}
	function flash(selector, color) {
		document.querySelectorAll(selector).forEach((el) => {
			const prev = el.style.outline;
			el.style.outline = `3px solid ${color}`;
			setTimeout(() => { el.style.outline = prev; }, 1500);
		});
	}
	function safeEval(expr) {
		try {
			// eslint-disable-next-line no-new-func
			const v = Function(`"use strict";return (${expr});`)();
			return JSON.parse(JSON.stringify(v ?? null));
		} catch (err) {
			return { error: String(err) };
		}
	}

	// ---------- helpers ----------
	function rectOf(el) {
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}
	function pickStyles(el) {
		const cs = getComputedStyle(el);
		const keys = [
			"display","position","width","height","margin","padding",
			"color","background-color","font-size","font-weight","font-family",
			"text-align","border","border-radius","flex","grid","gap","opacity","z-index",
		];
		const out = {};
		for (const k of keys) out[k] = cs.getPropertyValue(k);
		return out;
	}

	// React fiber introspection (pure property reads, CSP-safe — no eval).
	// Returns ordered chain of named React components from clicked node up to root,
	// each with its prop keys (values omitted: too big + may contain PII).
	function reactFiberFrom(el) {
		const key = Object.keys(el).find(
			(k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
		);
		return key ? el[key] : null;
	}
	function fiberTypeName(t) {
		if (!t) return null;
		if (typeof t === "function") return t.displayName || t.name || null;
		if (typeof t === "string") return null; // host element (div/span/...)
		if (typeof t === "object") {
			// forwardRef, memo, lazy, context.Provider/Consumer wrappers
			return (
				t.displayName ||
				(t.type && (t.type.displayName || t.type.name)) ||
				(t.render && (t.render.displayName || t.render.name)) ||
				null
			);
		}
		return null;
	}
	function fiberBreadcrumb(el) {
		const fiber = reactFiberFrom(el);
		if (!fiber) return null;
		const chain = [];
		const seen = new Set();
		let cur = fiber;
		let hops = 0;
		while (cur && hops < 80 && chain.length < 12) {
			const name = fiberTypeName(cur.type);
			if (name && /^[A-Z]/.test(name) && !seen.has(name)) {
				seen.add(name);
				const propKeys =
					cur.memoizedProps && typeof cur.memoizedProps === "object"
						? Object.keys(cur.memoizedProps)
								.filter((k) => k !== "children")
								.slice(0, 8)
						: [];
				const entry = { name, propKeys };
				if (cur._debugSource) {
					entry.source = {
						fileName: cur._debugSource.fileName,
						line: cur._debugSource.lineNumber,
					};
				}
				chain.push(entry);
			}
			cur = cur.return;
			hops++;
		}
		return chain; // [clicked-most-specific, ..., root-most-generic]
	}

	// Distinct origins of loaded <script src> tags — helps map a clicked
	// element back to the micro-frontend repo that served its bundle.
	function scriptHosts() {
		const set = new Set();
		for (const s of document.querySelectorAll("script[src]")) {
			try {
				const u = new URL(s.src, location.href);
				if (u.host) set.add(u.protocol + "//" + u.host);
			} catch {}
		}
		return Array.from(set);
	}
	function cssPath(el) {
		if (!(el instanceof Element)) return "";
		const parts = [];
		while (el && el.nodeType === 1 && parts.length < 6) {
			let part = el.nodeName.toLowerCase();
			if (el.id) { part += "#" + el.id; parts.unshift(part); break; }
			const cls = (el.className && typeof el.className === "string")
				? el.className.trim().split(/\s+/).slice(0, 2).join(".")
				: "";
			if (cls) part += "." + cls;
			const parent = el.parentNode;
			if (parent) {
				const sibs = Array.from(parent.children).filter((c) => c.nodeName === el.nodeName);
				if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(el) + 1})`;
			}
			parts.unshift(part);
			el = el.parentElement;
		}
		return parts.join(" > ");
	}
})();
