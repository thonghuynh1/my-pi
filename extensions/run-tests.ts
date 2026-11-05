import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { readFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, openSync, readSync, fstatSync, closeSync } from "fs";
import type { Dirent } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import {
	createManagedExtension,
	loadCapabilityVisibilitySettings,
	type CapabilityVisibilitySettings,
} from "./lib/capability-visibility.ts";
import { BACKGROUND_START_CHANNEL, type BackgroundJobHandle, type BackgroundStartRequest } from "./lib/background-start.ts";

export const piExtension = { id: "run-tests" };

const RunTestsParams = Type.Object({
	command: Type.Optional(
		Type.String({ description: "Override the auto-detected test command. E.g. 'dotnet test tests/Api.Tests'" }),
	),
	lines: Type.Optional(
		Type.Number({ description: "Number of tail lines to show on failure (default 40)" }),
	),
	cwd: Type.Optional(
		Type.String({ description: "Working directory to run tests from. Defaults to process.cwd(). Pass this when the test project root (jest.config.js, package.json) lives in a subdirectory." }),
	),
});

type RunTestsInput = Static<typeof RunTestsParams>;

interface TestLogEntry {
	ts: string;
	project: string;
	command: string;
	result: "pass" | "fail" | "error" | "timeout" | "background" | "no-framework";
	durationMs?: number;
	summary?: string;
	exitCode?: number;
	errorMessage?: string;
}

const LOG_DIR = join(homedir(), ".pi", "agent", "logs");
const LOG_FILE = join(LOG_DIR, "run-tests.jsonl");
const DEFAULT_TEST_TIMEOUT_MS = 15 * 60 * 1000;
const BACKGROUND_WAIT_MS = Number(process.env.PI_RUN_TESTS_WAIT_MS) || DEFAULT_TEST_TIMEOUT_MS;
const BACKGROUND_POLL_MS = 500;
const LOG_READ_MAX_BYTES = 4 * 1024 * 1024;

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

		// Build failure path — no test-failure blocks found.
		// Surface only error lines; discard warning noise.
		const errorLines = outputLines.filter((line) => /:\s*error\s+[A-Z]+\d+/i.test(line));
		if (errorLines.length > 0) {
			const maxErrors = 10;
			const shown = errorLines.slice(0, maxErrors);
			const extra = errorLines.length - shown.length;
			const suffix = extra > 0 ? `\n... ${extra} more error(s) suppressed.` : "";
			return `Build failed (${errorLines.length} error(s)):\n\n${shown.join("\n")}${suffix}`;
		}

		// No recognizable build errors — filter warnings and tail.
		const withoutWarnings = outputLines.filter((line) => !/:\s*warning\s+[A-Z]+\d+/i.test(line));
		return withoutWarnings.slice(-tailLines).join("\n");
	}

	return outputLines.slice(-tailLines).join("\n");
}

type TestProjectCandidate = {
	cwd: string;
	command: string;
};

const NESTED_PROJECT_MAX_DEPTH = 3;
const MAX_NESTED_PROJECTS = 10;
const SKIPPED_PROJECT_DIRECTORIES = new Set([
	".git",
	".next",
	".cache",
	"__pycache__",
	"bin",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"obj",
]);

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

	let hasSolutionFile = false;
	try {
		hasSolutionFile = readdirSync(cwd).some((entry) => entry.endsWith(".sln"));
	} catch {
		// An unreadable directory cannot contain a discoverable solution file.
	}
	if (hasSolutionFile) return "dotnet test";

	if (existsSync(join(cwd, "go.mod"))) return "go test ./...";

	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini"))) {
		return "pytest";
	}

	return null;
}

function packageManagerTestCommand(cwd: string, detectedCommand: string): string {
	if (detectedCommand !== "npm test") return detectedCommand;
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn test";
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm test";
	if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun test";
	return detectedCommand;
}

function findNestedTestProjects(root: string): TestProjectCandidate[] {
	const candidates: TestProjectCandidate[] = [];
	const queue: Array<{ cwd: string; depth: number }> = [{ cwd: root, depth: 0 }];

	while (queue.length > 0 && candidates.length < MAX_NESTED_PROJECTS) {
		const current = queue.shift();
		if (!current) continue;
		let entries: Dirent[];
		try {
			entries = readdirSync(current.cwd, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (
				!entry.isDirectory() ||
				entry.isSymbolicLink() ||
				SKIPPED_PROJECT_DIRECTORIES.has(entry.name)
			) {
				continue;
			}

			const childCwd = join(current.cwd, entry.name);
			const detectedCommand = detectTestCommand(childCwd);
			if (detectedCommand) {
				candidates.push({
					cwd: childCwd,
					command: packageManagerTestCommand(childCwd, detectedCommand),
				});
				if (candidates.length >= MAX_NESTED_PROJECTS) break;
				continue;
			}

			if (current.depth + 1 < NESTED_PROJECT_MAX_DEPTH) {
				queue.push({ cwd: childCwd, depth: current.depth + 1 });
			}
		}
	}

	return candidates;
}

function formatNestedProjectGuidance(root: string, candidates: TestProjectCandidate[]): string {
	if (candidates.length === 0) {
		return `No nested test projects found within ${NESTED_PROJECT_MAX_DEPTH} directory levels.\nPass a command explicitly with the searched cwd: run_tests({ command: "your test command", cwd: ${JSON.stringify(root)} })`;
	}

	const lines = [`Found ${candidates.length} nested test project${candidates.length === 1 ? "" : "s"}:`];
	for (const candidate of candidates) {
		lines.push(
			`  - ${candidate.cwd}: ${candidate.command}`,
			`    run_tests({ command: ${JSON.stringify(candidate.command)}, cwd: ${JSON.stringify(candidate.cwd)} })`,
		);
	}
	return lines.join("\n");
}

function isMissingPackageJsonError(output: string, command: string): boolean {
	if (!/^(?:yarn|npm|pnpm|bun)(?:\s|$)/i.test(command.trim())) return false;
	return /couldn't find (?:a )?package\.json|no package\.json|package\.json.*(?:not found|missing)|enoent.*package\.json/i.test(output);
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
			"When the test project root (containing jest.config.js, package.json, or vitest.config.ts) is a subdirectory, pass cwd. Example: run_tests({ command: 'npx jest', cwd: 'C:/GitRepos/MyProject/Web' })",
			"If no framework is found, use the nested project candidates and exact cwd retry commands in the result instead of guessing a repository root.",
		],
		parameters: RunTestsParams,
		async execute(
			toolCallId: string,
			params: RunTestsInput,
			signal: AbortSignal | undefined,
			onUpdate: any,
			ctx?: ExtensionContext,
		) {
			const cwd = params.cwd ?? process.cwd();
			const tailLines = params.lines ?? 40;

			const command = params.command ?? detectTestCommand(cwd);
			const project = basename(cwd);
			if (!command) {
				const nestedProjects = findNestedTestProjects(cwd);
				writeLog({ ts: new Date().toISOString(), project, command: "(none)", result: "no-framework" });
				return {
					content: [
						{
							type: "text" as const,
							text: `⚠️ No test framework found at: ${cwd}\n${formatNestedProjectGuidance(cwd, nestedProjects)}`,
						},
					],
					details: undefined,
				};
			}

			const background = ctx ? startInBackground(pi, { command, cwd, requestId: toolCallId, ctx }) : undefined;
			if (background) {
				return await waitForBackgroundRun({ handle: background, command, project, cwd, tailLines, signal, onUpdate });
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
				const result = await pi.exec(shell, shellArgs, { cwd, signal, timeout: DEFAULT_TEST_TIMEOUT_MS });
				clearInterval(updateInterval);

				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
				const fullOutput = stripAnsi([result.stdout, result.stderr].filter(Boolean).join("\n"));

				if (result.killed) {
					const reason = signal?.aborted ? "was aborted" : `timed out after ${DEFAULT_TEST_TIMEOUT_MS / 1000}s`;
					writeLog({ ts: new Date().toISOString(), project, command, result: "timeout", durationMs: Date.now() - startTime, exitCode: result.code, errorMessage: reason });
					return {
						content: [
							{
								type: "text" as const,
								text: `⏱️ Test run ${reason} (${elapsed}s). Result unknown: this is not a pass.\nOnly the shell was stopped; the test process may still be running and writing results. Wait for it or stop it before running the same suite again.\nFor suites longer than ${DEFAULT_TEST_TIMEOUT_MS / 60000} minutes, run the command with bg_run:\n\`\`\`\n${command}\n\`\`\`\nLast output:\n${fullOutput.trim().split("\n").slice(-tailLines).join("\n")}`,
							},
						],
						details: undefined,
						isError: true,
					};
				}

				return formatOutcome({ command, project, cwd, fullOutput, code: result.code, startTime, tailLines });
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

function startInBackground(
	pi: ExtensionAPI,
	request: Pick<BackgroundStartRequest, "command" | "cwd" | "requestId" | "ctx">,
): BackgroundJobHandle | undefined {
	const message: BackgroundStartRequest = { ...request };
	pi.events?.emit(BACKGROUND_START_CHANNEL, message);
	return message.handle;
}

function readLogTail(path: string): string {
	if (!existsSync(path)) return "";
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const bytes = Buffer.alloc(Math.min(size, LOG_READ_MAX_BYTES));
		const read = readSync(fd, bytes, 0, bytes.length, size - bytes.length);
		return bytes.subarray(0, read).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

interface BackgroundWaitInput {
	handle: BackgroundJobHandle;
	command: string;
	project: string;
	cwd: string;
	tailLines: number;
	signal: AbortSignal | undefined;
	onUpdate: ((update: unknown) => void) | undefined;
}

async function waitForBackgroundRun({ handle, command, project, cwd, tailLines, signal, onUpdate }: BackgroundWaitInput) {
	const startTime = Date.now();
	let lastUpdate = startTime;
	let state = handle.poll();
	while (state.status === "running") {
		if (signal?.aborted) {
			handle.kill();
			writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, errorMessage: `aborted; ${handle.id} killed` });
			return {
				content: [{ type: "text" as const, text: `⚠️ Test run aborted; background job ${handle.id} was stopped. No result: this is not a pass.` }],
				details: { jobId: handle.id, logFilePath: handle.logFilePath },
				isError: true,
			};
		}
		if (Date.now() - startTime >= BACKGROUND_WAIT_MS) {
			handle.notifyWhenFinished();
			const seconds = Math.round((Date.now() - startTime) / 1000);
			writeLog({ ts: new Date().toISOString(), project, command, result: "background", durationMs: Date.now() - startTime, summary: handle.id });
			return {
				content: [{
					type: "text" as const,
					text: `⏳ Tests are still running as background job ${handle.id} after ${seconds}s. No result yet: this is not a pass.\nYou will be notified when it finishes. End your turn and do not start the same suite again.\nLog: ${handle.logFilePath}`,
				}],
				details: { jobId: handle.id, logFilePath: handle.logFilePath },
			};
		}
		await new Promise((resolve) => setTimeout(resolve, BACKGROUND_POLL_MS));
		if (Date.now() - lastUpdate >= 10_000) {
			lastUpdate = Date.now();
			onUpdate?.({ content: [{ type: "text" as const, text: `⏳ Running tests as ${handle.id}... (${Math.round((lastUpdate - startTime) / 1000)}s)` }] });
		}
		state = handle.poll();
	}

	const ended = state;
	const fullOutput = stripAnsi(readLogTail(handle.logFilePath));
	if (ended.status === "completed" || ended.status === "failed") {
		return formatOutcome({ command, project, cwd, fullOutput, code: ended.exitCode ?? 1, startTime, tailLines });
	}
	writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, errorMessage: `${handle.id} ${ended.status}` });
	return {
		content: [{
			type: "text" as const,
			text: [
				`⚠️ Test job ${handle.id} ended as ${ended.status}. Result unknown: this is not a pass.`,
				...("error" in ended && ended.error ? [ended.error] : []),
				`Log: ${handle.logFilePath}`,
				"Last output:",
				fullOutput.trim().split("\n").slice(-tailLines).join("\n"),
			].join("\n"),
		}],
		details: { jobId: handle.id, logFilePath: handle.logFilePath },
		isError: true,
	};
}

interface OutcomeInput {
	command: string;
	project: string;
	cwd: string;
	fullOutput: string;
	code: number;
	startTime: number;
	tailLines: number;
}

function formatOutcome({ command, project, cwd, fullOutput, code, startTime, tailLines }: OutcomeInput) {
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	if (code === 0) {
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
		writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, exitCode: code, errorMessage: "no output produced" });
		return {
			content: [
				{
					type: "text" as const,
					text: `⚠️ Test command failed (exit ${code}) but produced no output. Likely a compilation or infrastructure error.\nFall back to bash for full diagnostics:\n\`\`\`\n${command}\n\`\`\``,
				},
			],
			details: undefined,
		};
	}

	const binaryNotFound = detectBinaryNotFound(fullOutput, command);
	if (binaryNotFound) {
		writeLog({ ts: new Date().toISOString(), project, command, result: "error", durationMs: Date.now() - startTime, exitCode: code, errorMessage: binaryNotFound.binary });
		return {
			content: [
				{
					type: "text" as const,
					text: binaryNotFound.message,
				},
			],
			details: undefined,
		};
	}

	const failureOutput = formatFailureOutput(command, fullOutput, tailLines);
	const nestedProjects = isMissingPackageJsonError(fullOutput, command)
		? findNestedTestProjects(cwd)
		: [];
	const nestedGuidance = nestedProjects.length > 0
		? `\n\n${formatNestedProjectGuidance(cwd, nestedProjects)}`
		: "";
	writeLog({ ts: new Date().toISOString(), project, command, result: "fail", durationMs: Date.now() - startTime, exitCode: code, summary: outputLines.slice(-3).join(" | ") });
	return {
		content: [
			{
				type: "text" as const,
				text: `❌ Tests failed (exit ${code}, ${elapsed}s):\n\n${failureOutput}${nestedGuidance}`,
			},
		],
		details: undefined,
	};
}

interface BinaryNotFoundResult {
	binary: string;
	message: string;
}

function detectBinaryNotFound(output: string, command: string): BinaryNotFoundResult | null {
	const lines = output.trim().split("\n").map((l) => l.trim()).filter(Boolean);

	// Windows: "'vitest' is not recognized as an internal or external command"
	const notRecognized = output.match(/'([^']+)' is not recognized as an internal or external command/);
	if (notRecognized) {
		return buildBinaryNotFoundMessage(notRecognized[1]!, command);
	}

	// Windows: "The system cannot find the path specified."
	// This is a short, generic error. Only match when the entire output is just this error
	// (possibly with npm ERR! lines) to avoid false positives on real test failures.
	const substantiveLines = lines.filter((l) => !l.startsWith("npm ERR!") && !l.startsWith("npm warn") && !/^\s*$/.test(l));
	const isOnlyPathError = substantiveLines.length <= 2 && substantiveLines.some((l) => /the system cannot find the (path|file) specified/i.test(l));
	if (isOnlyPathError) {
		const binary = extractBinaryFromCommand(command);
		return buildBinaryNotFoundMessage(binary, command);
	}

	// Unix: "command not found" or "No such file or directory"
	const cmdNotFound = output.match(/(?:bash|sh|zsh):\s*(?:line \d+:\s*)?([^:]+):\s*(?:command not found|No such file or directory)/);
	if (cmdNotFound) {
		return buildBinaryNotFoundMessage(cmdNotFound[1]!.trim(), command);
	}

	// npm error when lifecycle script binary is missing
	const npmMissing = output.match(/npm ERR!.*?Missing script:/);
	if (npmMissing) {
		return {
			binary: "(missing script)",
			message: [
				`⚠️ Test runner not found. npm reports a missing script.`,
				`Command attempted: \`${command}\``,
				``,
				`Likely causes:`,
				`  1. package.json "scripts.test" references a binary not in node_modules/.bin`,
				`  2. Dependencies not installed (run \`npm install\`)`,
				``,
				`Next steps: check package.json scripts.test, verify the test runner is a devDependency, then retry with run_tests({ command: "npx vitest run" }) or the correct runner.`,
			].join("\n"),
		};
	}

	return null;
}

function extractBinaryFromCommand(command: string): string {
	// For "npm test", the actual binary is in package.json scripts.test
	// For direct commands like "vitest run", extract the first word
	if (command === "npm test" || command === "npm run test") {
		return "(test script binary)";
	}
	const parts = command.split(/\s+/);
	return parts[0] ?? command;
}

function buildBinaryNotFoundMessage(binary: string, command: string): BinaryNotFoundResult {
	const isNpmScript = command === "npm test" || command.startsWith("npm run");
	const lines = [
		`⚠️ Test runner binary not found: \`${binary}\``,
		`Command attempted: \`${command}\``,
		``,
		`The test framework binary is not installed or not in PATH.`,
		``,
		`Likely causes:`,
		`  1. Dependencies not installed (run \`npm install\` or \`npm ci\`)`,
	];
	if (isNpmScript) {
		lines.push(`  2. package.json "scripts.test" references a binary not listed in devDependencies`);
		lines.push(`  3. Monorepo with hoisted deps — binary lives in a nested node_modules/.bin`);
	} else {
		lines.push(`  2. Binary not in devDependencies or not in node_modules/.bin`);
	}
	lines.push(``);
	lines.push(`Next steps:`);
	lines.push(`  - Check package.json to find what test runner is configured`);
	lines.push(`  - Verify the runner is in devDependencies and installed`);
	lines.push(`  - Try: run_tests({ command: "npx <runner> run" }) to bypass PATH issues`);

	return { binary, message: lines.join("\n") };
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
