import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";

export const piExtension = { id: "run-tests" };

const RunTestsParams = Type.Object({
	command: Type.Optional(
		Type.String({ description: "Override the auto-detected test command. E.g. 'dotnet test tests/Api.Tests'" }),
	),
	lines: Type.Optional(
		Type.Number({ description: "Number of tail lines to show on failure (default 40)" }),
	),
});

type RunTestsInput = Static<typeof RunTestsParams>;

interface TestLogEntry {
	ts: string;
	project: string;
	command: string;
	result: "pass" | "fail" | "error" | "no-framework";
	durationMs?: number;
	summary?: string;
	exitCode?: number;
	errorMessage?: string;
}

const LOG_DIR = join(homedir(), ".pi", "agent", "logs");
const LOG_FILE = join(LOG_DIR, "run-tests.jsonl");

function writeLog(entry: TestLogEntry): void {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
	} catch {}
}

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

interface DotnetFailure {
	testName: string;
	errorLines: string[];
	stackLine?: string;
}

function isDotnetFailureHeader(line: string): boolean {
	return /^\s*Failed\s+.+\s+\[[^\]]+\]\s*$/.test(line);
}

function extractDotnetFailures(lines: string[]): DotnetFailure[] {
	const failures: DotnetFailure[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]?.match(/^\s*Failed\s+(.+?)\s+\[[^\]]+\]\s*$/);
		if (!match) continue;

		const testName = match[1]!.trim();
		if (/:\s*warning\s+[A-Z]+\d+/i.test(testName)) continue;
		const errorLines: string[] = [];
		let stackLine: string | undefined;
		let inErrorMessage = false;
		let j = i + 1;

		for (; j < lines.length; j++) {
			const line = lines[j] ?? "";
			if (isDotnetFailureHeader(line)) break;
			if (/^\s*Error Message:\s*$/.test(line)) {
				inErrorMessage = true;
				continue;
			}
			if (/^\s*Stack Trace:\s*$/.test(line)) {
				for (let k = j + 1; k < lines.length; k++) {
					const stackCandidate = lines[k] ?? "";
					if (isDotnetFailureHeader(stackCandidate)) break;
					if (stackCandidate.trim().length === 0) continue;
					stackLine = stackCandidate.trim();
					break;
				}
				break;
			}
			if (inErrorMessage) {
				const trimmed = line.trim();
				if (trimmed.length > 0) errorLines.push(trimmed);
			}
		}

		const failure: DotnetFailure = {
			testName,
			errorLines: errorLines.slice(0, 4),
			stackLine,
		};
		const dedupeKey = JSON.stringify(failure);
		if (!seen.has(dedupeKey)) {
			seen.add(dedupeKey);
			failures.push(failure);
		}
		i = j - 1;
	}

	return failures;
}

function formatDotnetFailures(lines: string[], tailLines: number): string | null {
	const failures = extractDotnetFailures(lines);
	if (failures.length === 0) return null;

	const maxFailures = tailLines <= 20 ? 1 : tailLines <= 60 ? 3 : 5;
	const shownFailures = failures.slice(0, maxFailures);
	const blocks = shownFailures.map((failure, index) => {
		const blockLines = [`${index + 1}. ${failure.testName}`];
		for (const errorLine of failure.errorLines) {
			blockLines.push(`   ${errorLine}`);
		}
		if (failure.stackLine) {
			blockLines.push(`   ${failure.stackLine}`);
		}
		return blockLines.join("\n");
	});

	const remaining = failures.length - shownFailures.length;
	const suffix = remaining > 0 ? `\n\n... ${remaining} more failed test(s).` : "";
	return `${failures.length} failed test(s):\n\n${blocks.join("\n\n")}${suffix}`;
}

function formatFailureOutput(command: string, fullOutput: string, tailLines: number): string {
	const outputLines = fullOutput.trim().split("\n");
	const looksLikeDotnet = /\bdotnet\s+test\b/i.test(command) || outputLines.some((line) => /Test run for .*\.dll/i.test(line));
	if (looksLikeDotnet) {
		const formatted = formatDotnetFailures(outputLines, tailLines);
		if (formatted) return formatted;
	}

	return outputLines.slice(-tailLines).join("\n");
}

function detectTestCommand(cwd: string): string | null {
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
				return "npm test";
			}
		} catch {}
	}

	const slnFiles = ["*.sln"].some(() => {
		try {
			const entries = require("fs").readdirSync(cwd);
			return entries.some((e: string) => e.endsWith(".sln"));
		} catch {
			return false;
		}
	});
	if (slnFiles) return "dotnet test";

	if (existsSync(join(cwd, "go.mod"))) return "go test ./...";

	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini"))) {
		return "pytest";
	}

	return null;
}

export default function runTestsExtension(pi: ExtensionAPI) {
	let piSettings: CapabilityVisibilitySettings = {};
	const visibilityResult = loadCapabilityVisibilitySettings();
	for (const warning of visibilityResult.warnings) {
		console.warn(`[run-tests] capability-visibility: ${warning.message}`);
	}
	piSettings = visibilityResult.settings;
	const managed = createManagedExtension(pi, { id: piExtension.id, visibility: piSettings });

	managed.registerTool({
		name: "run_tests",
		defaultVisibility: "agent-visible",
		label: "Run Tests",
		description:
			"Run project tests and return compact pass/fail output. Use this INSTEAD of bash for all test execution. Auto-detects vitest, jest, dotnet, go, pytest.",
		promptSnippet: "Run tests with compact output (auto-detects framework). Use instead of bash for test commands.",
		promptGuidelines: [
			"When running tests, use run_tests instead of bash. run_tests returns compact output that saves context tokens.",
			"Do NOT use bash to run test commands (npm test, vitest, jest, dotnet test, go test, pytest). Use run_tests instead.",
			"If run_tests returns a fallback message suggesting bash, THEN use bash with the exact command it provides.",
		],
		parameters: RunTestsParams,
		async execute(
			_toolCallId: string,
			params: RunTestsInput,
			signal: AbortSignal | undefined,
			onUpdate: any,
		) {
			const cwd = process.cwd();
			const tailLines = params.lines ?? 40;

			const command = params.command ?? detectTestCommand(cwd);
			const project = basename(cwd);
			if (!command) {
				writeLog({ ts: new Date().toISOString(), project, command: "(none)", result: "no-framework" });
				return {
					content: [
						{
							type: "text" as const,
							text: "⚠️ Cannot detect test framework. No package.json scripts.test, .sln, go.mod, or pytest config found.\nPass a command explicitly: run_tests({ command: \"your test command\" })",
						},
					],
					details: undefined,
				};
			}

			const isWindows = process.platform === "win32";
			const shell = isWindows ? "cmd" : "sh";
			const shellArgs = isWindows ? ["/c", command] : ["-c", command];

			const startTime = Date.now();
			let lastUpdate = startTime;
			const updateInterval = setInterval(() => {
				const elapsed = Math.round((Date.now() - startTime) / 1000);
				onUpdate?.({
					content: [{ type: "text" as const, text: `⏳ Running tests... (${elapsed}s)` }],
				});
				lastUpdate = Date.now();
			}, 10_000);

			try {
				const result = await pi.exec(shell, shellArgs, { cwd, signal });
				clearInterval(updateInterval);

				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
				const fullOutput = stripAnsi([result.stdout, result.stderr].filter(Boolean).join("\n"));

				if (result.code === 0) {
					const lines = fullOutput.trim().split("\n");
					const summary = extractPassSummary(lines) ?? `All tests passed`;
					writeLog({ ts: new Date().toISOString(), project, command, result: "pass", durationMs: Date.now() - startTime, summary });
					return {
						content: [{ type: "text" as const, text: `✅ ${summary} (${elapsed}s)` }],
						details: undefined,
					};
				}

				const outputLines = fullOutput.trim().split("\n");
				if (outputLines.length === 0 || (outputLines.length === 1 && outputLines[0] === "")) {
					writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, exitCode: result.code, errorMessage: "no output produced" });
					return {
						content: [
							{
								type: "text" as const,
								text: `⚠️ Test command failed (exit ${result.code}) but produced no output. Likely a compilation or infrastructure error.\nFall back to bash for full diagnostics:\n\`\`\`\n${command}\n\`\`\``,
							},
						],
						details: undefined,
					};
				}

				const failureOutput = formatFailureOutput(command, fullOutput, tailLines);
				writeLog({ ts: new Date().toISOString(), project, command, result: "fail", durationMs: Date.now() - startTime, exitCode: result.code, summary: outputLines.slice(-3).join(" | ") });
				return {
					content: [
						{
							type: "text" as const,
							text: `❌ Tests failed (exit ${result.code}, ${elapsed}s):\n\n${failureOutput}`,
						},
					],
					details: undefined,
				};
			} catch (err: any) {
				clearInterval(updateInterval);
				const message = err?.message ?? String(err);
				writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, errorMessage: message });
				return {
					content: [
						{
							type: "text" as const,
							text: `⚠️ Test execution error: ${message}\nFall back to bash:\n\`\`\`\n${command}\n\`\`\``,
						},
					],
					details: undefined,
					isError: true,
				};
			}
		},
	});
}

function extractPassSummary(lines: string[]): string | null {
	for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
		const line = lines[i];
		if (/tests?\s+passed/i.test(line) || /\d+\s+pass/i.test(line)) {
			return line.trim();
		}
		if (/Tests:\s+\d+\s+passed/i.test(line)) {
			return line.trim();
		}
		if (/Test Run Successful/i.test(line)) {
			return line.trim();
		}
	}
	return null;
}
