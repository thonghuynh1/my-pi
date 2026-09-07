/**
 * Unit tests for Radix/RHF portal helpers (no browser).
 *
 * Run: npx tsx --test extensions/frontend-coach/portal-actions.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { filePayloadFromStep, isPointerInterceptError } from "./portal-actions.ts";

test("isPointerInterceptError matches Playwright overlay messages", () => {
	assert.equal(
		isPointerInterceptError(new Error(`<div id="overlay">…</div> intercepts pointer events`)),
		true,
	);
	assert.equal(
		isPointerInterceptError(new Error("element is not receiving pointer events")),
		true,
	);
	assert.equal(
		isPointerInterceptError(new Error("<div> subtree intercepts pointer events")),
		true,
	);
	assert.equal(isPointerInterceptError(new Error("Timeout 10000ms exceeded.")), false);
	assert.equal(isPointerInterceptError("not an error about pointers"), false);
});

test("filePayloadFromStep prefers inline content over paths", () => {
	const inline = filePayloadFromStep({
		fileName: "note.txt",
		fileContent: "hello coach",
		mimeType: "text/plain",
		value: "/tmp/ignored.pdf",
	});
	assert.deepEqual(inline, {
		name: "note.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hello coach"),
	});
});

test("filePayloadFromStep accepts path, files[], and defaults", () => {
	assert.equal(filePayloadFromStep({ value: "/tmp/doc.pdf" }), "/tmp/doc.pdf");
	assert.deepEqual(filePayloadFromStep({ files: ["/a", "/b"] }), ["/a", "/b"]);
	const fallback = filePayloadFromStep({ fileContent: "x" });
	assert.deepEqual(fallback, {
		name: "upload.txt",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("x"),
	});
});

test("filePayloadFromStep requires a file source", () => {
	assert.throws(
		() => filePayloadFromStep({}),
		/setInputFiles step needs value/,
	);
});
