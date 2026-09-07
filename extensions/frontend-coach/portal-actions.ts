/**
 * Playwright actions that still work inside a Radix Dialog portal.
 *
 * `page.fill` already updates React Hook Form (synthetic input/change).
 * Native `HTMLInputElement.prototype.value` setters + `dispatchEvent` do not.
 * The failure mode in coach runs is: Radix overlay intercepts pointer events →
 * the agent falls back to eval setters → the form stays invalid.
 *
 * This module keeps the Playwright fill/click/setInputFiles path alive when
 * an overlay is sitting on top of the dialog.
 */

import type { Locator, Page } from "playwright-core";

const PIERCE_ATTR = "data-pi-coach-pierce";

export function isPointerInterceptError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return (
		msg.includes("intercepts pointer events") ||
		msg.includes("not receiving pointer events") ||
		msg.includes("not receive pointer events")
	);
}

export type FilePayload =
	| string
	| string[]
	| { name: string; mimeType: string; buffer: Buffer };

export function filePayloadFromStep(step: {
	value?: string;
	files?: string[];
	fileName?: string;
	fileContent?: string;
	mimeType?: string;
}): FilePayload {
	if (step.fileContent != null) {
		return {
			name: (step.fileName ?? "").trim() || "upload.txt",
			mimeType: (step.mimeType ?? "").trim() || "application/octet-stream",
			buffer: Buffer.from(step.fileContent),
		};
	}
	if (step.files && step.files.length > 0) return step.files;
	const path = step.value?.trim();
	if (path) return path;
	throw new Error("setInputFiles step needs value (path), files, or fileName+fileContent");
}

async function countSafe(locator: Locator): Promise<number> {
	try {
		return await locator.count();
	} catch {
		return 0;
	}
}

/**
 * Prefer the copy inside an open `role=dialog` portal (Radix mounts there),
 * then the last visible match so we don't hit a hidden duplicate in the React tree.
 */
export async function stepLocator(
	page: Page,
	selector: string,
	opts: { allowHidden?: boolean } = {},
): Promise<Locator> {
	const root = page.locator(selector);
	let scoped = root;
	const dialog = page.locator('[role="dialog"]').last();
	try {
		if ((await countSafe(dialog)) > 0 && (await dialog.isVisible())) {
			const inner = dialog.locator(selector);
			if ((await countSafe(inner)) > 0) scoped = inner;
		}
	} catch {
		scoped = root;
	}
	if (!opts.allowHidden) {
		const visible = scoped.filter({ visible: true });
		if ((await countSafe(visible)) > 0) return visible.last();
	}
	return scoped.last();
}

export async function isHitIntercepted(locator: Locator): Promise<boolean> {
	try {
		return await locator.evaluate((el) => {
			if (!(el instanceof Element)) return false;
			const r = el.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) return false;
			const x = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			const top = document.elementFromPoint(x, y);
			if (!top) return false;
			return top !== el && !el.contains(top) && !top.contains(el);
		});
	} catch {
		return false;
	}
}

/** Disable pointer-events on overlay nodes covering the target, then restore. */
export async function pierceOverlays(page: Page, locator: Locator): Promise<() => Promise<void>> {
	await locator.evaluate((el, attr) => {
		if (!(el instanceof Element)) return;
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2;
		const y = r.y + r.height / 2;
		const stack = document.elementsFromPoint(x, y);
		for (const node of stack) {
			if (node === el || el.contains(node)) break;
			if (!(node instanceof HTMLElement)) continue;
			if (node.getAttribute(attr) != null) continue;
			node.setAttribute(attr, node.style.pointerEvents);
			node.style.pointerEvents = "none";
		}
	}, PIERCE_ATTR);

	return async () => {
		try {
			await page.evaluate((attr) => {
				document.querySelectorAll(`[${attr}]`).forEach((node) => {
					if (!(node instanceof HTMLElement)) return;
					node.style.pointerEvents = node.getAttribute(attr) ?? "";
					node.removeAttribute(attr);
				});
			}, PIERCE_ATTR);
		} catch {
			/* page navigated or detached */
		}
	};
}

export async function clickThroughPortal(
	page: Page,
	locator: Locator,
	opts: { timeout: number; force?: boolean; kind?: "click" | "dblclick" | "hover" },
): Promise<void> {
	const kind = opts.kind ?? "click";
	const act = async (force: boolean) => {
		if (kind === "dblclick") await locator.dblclick({ timeout: opts.timeout, force });
		else if (kind === "hover") await locator.hover({ timeout: opts.timeout, force });
		else await locator.click({ timeout: opts.timeout, force });
	};

	const intercepted = opts.force === true || (await isHitIntercepted(locator));
	if (!intercepted) {
		try {
			await act(false);
			return;
		} catch (err) {
			if (!isPointerInterceptError(err)) throw err;
		}
	}

	const restore = await pierceOverlays(page, locator);
	try {
		try {
			await act(true);
		} catch (err) {
			if (kind === "hover") throw err;
			// HTMLElement.click() still fires React onClick; mouse CDP would hit the overlay.
			await locator.evaluate((el) => {
				if (el instanceof HTMLElement) el.click();
			});
		}
	} finally {
		await restore();
	}
}

/**
 * Playwright `locator.fill` — not a native prototype setter. Force-fill when
 * the Radix overlay would fail actionability; the injected fill still emits
 * input/change that React Hook Form sees.
 */
export async function fillThroughPortal(
	locator: Locator,
	value: string,
	opts: { timeout: number; force?: boolean },
): Promise<void> {
	const intercepted = opts.force === true || (await isHitIntercepted(locator));
	if (!intercepted) {
		try {
			await locator.fill(value, { timeout: opts.timeout });
			return;
		} catch (err) {
			if (!isPointerInterceptError(err)) throw err;
		}
	}
	await locator.fill(value, { timeout: opts.timeout, force: true });
}

async function resolveFileInput(page: Page, locator: Locator): Promise<Locator> {
	const isFile = await locator
		.evaluate((el) => el instanceof HTMLInputElement && el.type === "file")
		.catch(() => false);
	if (isFile) return locator;

	const nested = locator.locator('input[type="file"]');
	if ((await countSafe(nested)) > 0) return nested.last();

	const dialog = page.locator('[role="dialog"]').last();
	if ((await countSafe(dialog)) > 0) {
		const inner = dialog.locator('input[type="file"]');
		if ((await countSafe(inner)) > 0) return inner.last();
	}

	const any = page.locator('input[type="file"]');
	if ((await countSafe(any)) > 0) return any.last();

	throw new Error(
		"setInputFiles: no input[type=file] found. Target the hidden file input (or a wrapper that contains one), not a DataTransfer eval.",
	);
}

export async function setInputFilesThroughPortal(
	page: Page,
	locator: Locator,
	payload: FilePayload,
): Promise<void> {
	const fileInput = await resolveFileInput(page, locator);
	await fileInput.setInputFiles(payload);
}
