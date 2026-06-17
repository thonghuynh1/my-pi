/**
 * File-backed task extraction for pair_program.
 *
 * Provides pure text parsing plus a thin filesystem boundary to:
 * - Detect file:// URLs and absolute/relative file paths in task text.
 * - Read the referenced file at run start.
 * - Extract the accepted-criteria packet from markdown issue/spec files.
 *
 * Decision IDs: DEC-006, DEC-007, DEC-008, DEC-009.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// IssueTaskPacket — normative extracted packet shape (DEC-006)
// ---------------------------------------------------------------------------

export interface IssueTaskPacket {
	/** Resolved absolute path of the source file. */
	sourcePath: string;
	/** Raw text of the ## Acceptance criteria (or ## Acceptance checklist) section. */
	acceptanceCriteria: string;
	/** Bullet items from any ## Constraints / ## Explicit constraints section. */
	explicitConstraints: string[];
	/** Bullet items from any ## Build notes / ## Wiring notes section. */
	buildOrWiringNotes: string[];
	/** Raw text of the ## Blocked by section, if present. */
	blockedBy?: string;
}

// ---------------------------------------------------------------------------
// detectFileReference — file URL and path detection
// ---------------------------------------------------------------------------

/**
 * file:///path (POSIX) → capture /path
 * file:///C:/path (Windows URL) → capture /C:/path (leading slash stripped later)
 * file://C:/path (two-slash Windows) → capture C:/path
 */
const FILE_URL_RE = /file:\/\/([^\s"'`\)]+\.md)/i;

/** Windows drive-letter path: C:\... or C:/... */
const WINDOWS_PATH_RE = /[A-Za-z]:[/\\][^\s"'`\)]+\.md/;

/** Unix absolute path */
const UNIX_PATH_RE = /\/[^\s"'`\)]+\.md/;

/** Relative path starting with ./ or .\ */
const RELATIVE_PATH_RE = /\.[/\\][^\s"'`\)]+\.md/;

/**
 * Detect the first explicit file URL or file path in task text.
 *
 * Preference order: file:// URL > Windows absolute > Unix absolute > relative.
 * Returns the resolved local path string, or null when no reference is found.
 */
export function detectFileReference(task: string): string | null {
	// 1. file:// URL
	const urlMatch = FILE_URL_RE.exec(task);
	if (urlMatch) {
		let p = urlMatch[1];
		// Remove leading slash before Windows drive letter: /C:/path → C:/path
		if (/^\/[A-Za-z]:/.test(p)) {
			p = p.slice(1);
		}
		return p;
	}

	// 2. Windows absolute path
	const winMatch = WINDOWS_PATH_RE.exec(task);
	if (winMatch) return winMatch[0];

	// 3. Unix absolute path
	const unixMatch = UNIX_PATH_RE.exec(task);
	if (unixMatch) return unixMatch[0];

	// 4. Relative path
	const relMatch = RELATIVE_PATH_RE.exec(task);
	if (relMatch) return relMatch[0];

	return null;
}

// ---------------------------------------------------------------------------
// extractIssueTaskPacket — pure markdown parser
// ---------------------------------------------------------------------------

/** Normalize a heading for case/punctuation-insensitive matching. */
function normalizeHeading(raw: string): string {
	return raw.trim().toLowerCase().replace(/[.!?:]+$/, "");
}

/**
 * Extract the raw body text of the first matching heading at any level (##, ###, …).
 * Returns null when no matching heading is found or the body is empty.
 */
function extractSection(content: string, headingAliases: string[]): string | null {
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = /^(#+)\s+(.+)/.exec(lines[i]);
		if (!m) continue;
		if (!headingAliases.includes(normalizeHeading(m[2]))) continue;
		const body: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			// Stop at any heading of the same or higher level
			if (/^#+\s/.test(lines[j])) break;
			body.push(lines[j]);
		}
		const text = body.join("\n").trim();
		return text || null;
	}
	return null;
}

/**
 * Extract bullet list items from a section, stripping leading markers and
 * checkbox prefixes (- [ ] … / - [x] …).
 */
function extractListItems(content: string, headingAliases: string[]): string[] {
	const section = extractSection(content, headingAliases);
	if (!section) return [];
	return section
		.split(/\r?\n/)
		.map((line) =>
			line
				.replace(/^[-*+]\s+/, "")
				.replace(/^\[.\]\s+/, "")
				.trim(),
		)
		.filter((line) => line.length > 0);
}

/**
 * Parse a markdown issue/spec file into an IssueTaskPacket.
 * Pure function — no filesystem access.
 */
export function extractIssueTaskPacket(sourcePath: string, content: string): IssueTaskPacket {
	return {
		sourcePath,
		acceptanceCriteria:
			extractSection(content, [
				"acceptance criteria",
				"acceptance checklist",
			]) ?? "",
		explicitConstraints: extractListItems(content, [
			"constraints",
			"explicit constraints",
		]),
		buildOrWiringNotes: extractListItems(content, [
			"build notes",
			"wiring notes",
			"build and wiring notes",
			"build or wiring notes",
			"wiring/build notes",
			"build/wiring notes",
		]),
		blockedBy: extractSection(content, ["blocked by"]) ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// readIssueTaskFile — thin filesystem boundary
// ---------------------------------------------------------------------------

/**
 * Detect the file reference in task text, read the file, and return the
 * extracted packet.  Resolves relative paths against `cwd` when provided.
 * Returns null when no file reference is found or the file cannot be read.
 */
export function readIssueTaskFile(task: string, cwd?: string): IssueTaskPacket | null {
	const ref = detectFileReference(task);
	if (!ref) return null;

	let resolvedPath = ref;
	if (!path.isAbsolute(ref) && cwd) {
		resolvedPath = path.resolve(cwd, ref);
	}

	try {
		const content = fs.readFileSync(resolvedPath, "utf8");
		return extractIssueTaskPacket(resolvedPath, content);
	} catch {
		return null;
	}
}
