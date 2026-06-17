/**
 * Prompt renderer for pair protocol markdown prompt files.
 *
 * Loads prompt templates from the extensions/prompts/ directory (resolved
 * relative to this file, not the user's current repo) and replaces named
 * HTML comment markers with phase-specific content blocks.
 *
 * Marker format: <!-- MARKER_NAME -->
 *
 * Rendering fails fast if a required marker (one that appears in the template)
 * has no corresponding payload entry.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve prompts directory relative to extensions/lib/ (this file's parent's parent)
const thisDir =
	typeof __dirname !== "undefined"
		? __dirname
		: dirname(fileURLToPath(new URL(import.meta.url)));
const PROMPTS_DIR = join(thisDir, "..", "prompts");

/**
 * Pattern that matches HTML comment markers of the form <!-- MARKER_NAME -->.
 * Marker names must be ALL_CAPS_WITH_UNDERSCORES.
 */
const MARKER_PATTERN = /<!--\s*([A-Z_]+)\s*-->/g;

/**
 * Render a prompt template by replacing named markers with payload strings.
 *
 * - Every marker found in the template must have a corresponding key in
 *   `payloads`. If any is absent, an Error is thrown (fail-fast).
 * - Extra keys in `payloads` that do not appear in the template are ignored.
 * - Empty string is a valid payload (the marker is replaced with "").
 *
 * @param template - Raw markdown template string containing markers.
 * @param payloads - Map from marker name to replacement string.
 * @returns Rendered prompt string.
 * @throws {Error} If a required marker has no payload.
 */
export function renderPrompt(template: string, payloads: Record<string, string>): string {
	// Collect all unique marker names from the template
	const markers = new Set<string>();
	for (const match of template.matchAll(MARKER_PATTERN)) {
		markers.add(match[1]);
	}

	// Fail fast: every marker must have a payload
	for (const marker of markers) {
		if (!(marker in payloads)) {
			throw new Error(
				`Prompt marker <!-- ${marker} --> is required but no payload was provided.`,
			);
		}
	}

	// Replace every occurrence of each marker with its payload
	return template.replace(MARKER_PATTERN, (_match, marker: string) => {
		return payloads[marker] ?? "";
	});
}

/**
 * Load a prompt template file from the extensions/prompts/ directory.
 *
 * Path is resolved relative to this file, not the user's current working
 * directory, so templates are always found regardless of where Pi is invoked.
 *
 * @param filename - Filename (e.g. "navigator-review.md") within prompts/.
 * @returns Raw template string.
 * @throws {Error} If the file cannot be read.
 */
export function loadPromptTemplate(filename: string): string {
	return readFileSync(join(PROMPTS_DIR, filename), "utf8");
}
