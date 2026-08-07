import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import runTestsExtension from "../run-tests.ts";
import type { ManagedExtensionPiApi } from "../lib/capability-visibility.ts";

interface FakePi extends ManagedExtensionPiApi {
	tools: Map<string, unknown>;
	execCalls: Array<{ shell: string; args: string[]; cwd: string; timeout?: number }>;
	exec(shell: string, args: string[], options: { cwd: string; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
	emit(event: string): void;
}

function createFakePi(execResult: { code: number; stdout: string; stderr: string }): FakePi {
	const tools = new Map<string, unknown>();
	let activeTools: string[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	const execCalls: Array<{ shell: string; args: string[]; cwd: string; timeout?: number }> = [];

	return {
		tools,
		execCalls,
		registerTool(tool: unknown) {
			const definition = tool as { name: string };
			tools.set(definition.name, tool);
			if (!activeTools.includes(definition.name)) activeTools = [...activeTools, definition.name];
		},
		registerCommand() {},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		on(event: string, handler: (...args: unknown[]) => void) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		emit(event: string) {
			for (const handler of handlers.get(event) ?? []) handler();
		},
		async exec(shell: string, args: string[], options: { cwd: string; timeout?: number }) {
			execCalls.push({ shell, args, cwd: options.cwd, timeout: options.timeout });
			return execResult;
		},
	};
}

function getRunTestsTool(pi: FakePi) {
	const tool = pi.tools.get("run_tests") as {
		execute: (
			toolCallId: string,
			params: { command?: string; lines?: number; cwd?: string },
			signal: AbortSignal | undefined,
			onUpdate: (update: unknown) => void,
		) => Promise<{ content: Array<{ type: string; text: string }> }>;
	};
	assert.ok(tool, "run_tests tool should be registered");
	return tool;
}

function countOccurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

const repeatedDotnetFailureOutput = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "run-tests-dotnet-repeat.txt"),
	"utf8",
);

test("run_tests forwards explicit cwd to pi.exec", async () => {
	const pi = createFakePi({ code: 0, stdout: "1 test passed", stderr: "" });
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	await tool.execute("call-cwd", { command: "npm test", cwd: "C:/GitRepos/Tickets/Web" }, undefined, () => {});

	assert.equal(pi.execCalls[0]?.cwd, "C:/GitRepos/Tickets/Web");
});

test("run_tests applies a 15 minute execution timeout", async () => {
	const pi = createFakePi({ code: 0, stdout: "1 test passed", stderr: "" });
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	await tool.execute("call-timeout", { command: "npm test" }, undefined, () => {});

	assert.equal(pi.execCalls[0]?.timeout, 15 * 60 * 1000);
});

test("run_tests lists nested test projects when the current directory has no test framework", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "run-tests-nested-"));
	const web = path.join(root, "Web");
	const admin = path.join(root, "Web.Admin");
	const dependency = path.join(root, "node_modules", "ignored");
	mkdirSync(web);
	mkdirSync(admin);
	mkdirSync(dependency, { recursive: true });
	writeFileSync(path.join(web, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
	writeFileSync(path.join(web, "yarn.lock"), "");
	writeFileSync(path.join(admin, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
	writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

	try {
		const pi = createFakePi({ code: 0, stdout: "", stderr: "" });
		runTestsExtension(pi as any);
		const tool = getRunTestsTool(pi);
		const result = await tool.execute("call-nested", { cwd: root }, undefined, () => {});
		const text = result.content[0]?.text ?? "";

		assert.match(text, /No test framework found at:/);
		assert.match(text, /Web/);
		assert.match(text, /yarn test/);
		assert.equal(text.includes(`cwd: ${JSON.stringify(web)}`), true);
		assert.equal(text.includes("Web.Admin"), false);
		assert.equal(text.includes("ignored"), false);
		assert.equal(pi.execCalls.length, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("run_tests adds nested project guidance when yarn runs from the wrong directory", async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "run-tests-yarn-"));
	const web = path.join(root, "Web");
	mkdirSync(web);
	writeFileSync(path.join(web, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
	writeFileSync(path.join(web, "yarn.lock"), "");

	try {
		const pi = createFakePi({
			code: 1,
			stdout: `error Couldn't find a package.json file in "${root}"`,
			stderr: "",
		});
		runTestsExtension(pi as any);
		const tool = getRunTestsTool(pi);
		const result = await tool.execute("call-wrong-cwd", { command: "yarn test", cwd: root }, undefined, () => {});
		const text = result.content[0]?.text ?? "";

		assert.match(text, /Tests failed/);
		assert.match(text, /Web/);
		assert.match(text, /run_tests\(\{ command: "yarn test", cwd:/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("run_tests condenses repeated dotnet failures into unique failure summaries", async () => {
	const pi = createFakePi({ code: 1, stdout: repeatedDotnetFailureOutput, stderr: "" });
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	const result = await tool.execute("call-1", { command: "dotnet test C:/GitRepos/Tickets/Tests/Tests.csproj", lines: 200 }, undefined, () => {});
	const text = result.content[0]?.text ?? "";

	assert.match(text, /3 failed test\(s\):/);
	assert.match(text, /1\. MyBusiness\.Tickets\.Tests\.Domain\.Requests\.Endpoint\.DeleteActivityDocumentTests\.When_handler_deletes_an_activity_document\.Attachment_documents_for_the_activity_are_deleted_from_the_index/);
	assert.match(text, /2\. MyBusiness\.Tickets\.Tests\.Domain\.Requests\.Endpoint\.DeleteMessageDocumentTests\.When_handler_deletes_a_message_document\.Attachment_documents_for_the_message_are_deleted_from_the_index/);
	assert.match(text, /3\. MyBusiness\.Tickets\.Tests\.Domain\.Requests\.Endpoint\.DeleteActivityDocumentTests\.When_handler_deletes_an_activity_document\.Attachment_links_for_the_activity_are_removed/);
	assert.equal(countOccurrences(text, "warning MYB004"), 0);
	assert.equal(countOccurrences(text, "Test run for C:"), 0);
	assert.equal(countOccurrences(text, "System.Runtime.CompilerServices.TaskAwaiter"), 0);
	assert.match(text, /Shouldly\.ShouldAssertException : _deletedKeys/);
	assert.match(text, /DeleteActivityDocumentTests\\When_handler_deletes_an_activity_document\.cs:line 88/);
});

test("run_tests extracts build errors and suppresses warnings on dotnet build failure", async () => {
	const buildFailureOutput = [
		"C:/Repo/Foo.csproj : warning NU1902: Package 'MessagePack' 2.5.192 has a known moderate severity vulnerability",
		"C:/Repo/Foo.csproj : warning NU1903: Package 'MessagePack' 2.5.192 has a known high severity vulnerability",
		"C:/Repo/Foo.cs(3,86): warning CS8625: Cannot convert null literal to non-nullable reference type. [Foo.csproj]",
		"C:/Repo/Foo.cs(18,36): error CS0246: The type or namespace name 'MissingType' could not be found [Foo.csproj]",
		"C:/Repo/Bar.cs(20,9): error CS0246: The type or namespace name 'AnotherMissingType' could not be found [Foo.csproj]",
	].join("\n");

	const pi = createFakePi({ code: 1, stdout: buildFailureOutput, stderr: "" });
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	const result = await tool.execute("call-3", { command: "dotnet test C:/Repo/Tests.csproj", lines: 40 }, undefined, () => {});
	const text = result.content[0]?.text ?? "";

	assert.match(text, /Build failed \(2 error\(s\)\)/);
	assert.match(text, /CS0246.*MissingType/);
	assert.match(text, /CS0246.*AnotherMissingType/);
	assert.equal(text.includes("NU1902"), false, "NU1902 warning should be suppressed");
	assert.equal(text.includes("NU1903"), false, "NU1903 warning should be suppressed");
	assert.equal(text.includes("CS8625"), false, "CS8625 warning should be suppressed");
});

test("run_tests keeps tail output for non-dotnet failures", async () => {
	const pi = createFakePi({
		code: 1,
		stdout: ["first line", "second line", "third line", "fourth line"].join("\n"),
		stderr: "",
	});
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	const result = await tool.execute("call-2", { command: "npm test", lines: 2 }, undefined, () => {});
	const text = result.content[0]?.text ?? "";

	assert.match(text, /third line\nfourth line/);
	assert.equal(text.includes("first line"), false);
});

test("run_tests detects Windows 'system cannot find the path' as binary-not-found", async () => {
	const pi = createFakePi({
		code: 1,
		stdout: "The system cannot find the path specified.",
		stderr: "",
	});
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	const result = await tool.execute("call-4", { command: "npm test" }, undefined, () => {});
	const text = result.content[0]?.text ?? "";

	assert.match(text, /Test runner binary not found/);
	assert.match(text, /Dependencies not installed/);
	assert.match(text, /npx/);
});

test("run_tests detects Windows 'not recognized' as binary-not-found", async () => {
	const pi = createFakePi({
		code: 1,
		stdout: "'vitest' is not recognized as an internal or external command,\noperable program or batch file.",
		stderr: "",
	});
	runTestsExtension(pi as any);
	const tool = getRunTestsTool(pi);

	const result = await tool.execute("call-5", { command: "npm test" }, undefined, () => {});
	const text = result.content[0]?.text ?? "";

	assert.match(text, /Test runner binary not found: `vitest`/);
	assert.match(text, /Dependencies not installed/);
});
