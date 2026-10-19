import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CLAUDE_USAGE_REQUEST, readClaudeUsage } from "../lib/provider-usage/claude.ts";
import { CODEX_INITIALIZE, COPILOT_FIELDS, createProcessRunner, createTreeTerminator, providerReaders, resolveLaunch, type ProcessRequest } from "../lib/provider-usage/readers.ts";

function processFixture(options: { timeoutMs?: number; maxOutputBytes?: number } = {}) {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(events, { stdin, stdout, stderr, pid: 123, exitCode: null }) as unknown as ChildProcessWithoutNullStreams;
  const writes: unknown[] = [];
  stdin.on("data", (chunk) => writes.push(JSON.parse(chunk.toString())));
  let cleanups = 0;
  let spawns = 0;
  const run = createProcessRunner({
    launch: (request) => ({ file: request.command, args: [...request.args] }),
    spawn: () => { spawns++; return child; },
    terminate: async () => { cleanups++; }, ...options,
  });
  return { run, writes, stdout, stderr, events, cleanups: () => cleanups, spawns: () => spawns };
}
const signal = () => new AbortController().signal;
const codexRequest: ProcessRequest = { command: "codex", args: ["app-server"], protocol: "codex" };
const jsonRequest: ProcessRequest = { command: "agy", args: ["-p", "/usage", "--output-format", "json"] };

test("registry uses verified CLI commands plus the isolated experimental Cursor transport", async () => {
  const requests: ProcessRequest[] = [];
  const readers = providerReaders(async (request) => {
    requests.push(request);
    if (request.command === "codex") return { rateLimits: { primary: { usedPercent: 69, windowDurationMins: 300 } } };
    if (request.command === "agy") return { status: "SUCCESS", command: { name: "usage", data: { groups: [{ name: "Gemini Models", buckets: [{ window: "5h", remaining_fraction: 1 }] }] } } };
    if (request.command === "claude") return { type: "result", is_error: false, local_command: "usage", num_turns: 0 };
    return { quota_snapshots: { premium_interactions: { credits_used: 54386 } } };
  }, async () => ({ planUsage: { totalPercentUsed: 42 } }), (run, s) => readClaudeUsage(run, s, {
    home: "/home/u", env: {}, readFile: async () => JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 1, utilization: { spend: { enabled: true, used: { amount_minor: 1, exponent: 2 } } } } }),
  }));
  await Promise.all(readers.map((reader) => reader.read(signal())));
  assert.deepEqual(requests, [codexRequest, jsonRequest, { command: "gh", args: ["api", "/copilot_internal/user", "--jq", COPILOT_FIELDS] }, CLAUDE_USAGE_REQUEST]);
  assert.deepEqual(readers.map((r) => r.id), ["codex", "antigravity", "copilot", "cursor", "claude"]);
  assert.equal(readers[2].experimental, true);
});

test("Codex exact initialize handshake, ID matching, newline/chunk framing, then cleanup", async () => {
  const f = processFixture();
  const result = f.run(codexRequest, signal());
  assert.deepEqual(f.writes, [CODEX_INITIALIZE]);
  f.stdout.write('{"id":99,"result":{}}\n{"method":"notice"}\n');
  assert.equal(f.writes.length, 1);
  f.stdout.write('{"id":1,"res');
  f.stdout.write('ult":{"serverInfo":"not retained"}}\n');
  assert.deepEqual(f.writes, [CODEX_INITIALIZE, { method: "initialized" }, { id: 2, method: "account/rateLimits/read" }]);
  f.stdout.write('{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":69}}}}\n');
  assert.deepEqual(await result, { rateLimits: { primary: { usedPercent: 69 } } });
  assert.equal(f.cleanups(), 1);
  f.events.emit("close", 0);
  assert.equal(f.cleanups(), 1);
  assert(!JSON.stringify(f.writes).match(/thread\/start|turn\/start|login|reset|consume/));
});

test("CLI JSON read waits for successful exit and returns no stderr", async () => {
  const f = processFixture();
  const result = f.run(jsonRequest, signal());
  f.stdout.write('{"status":"SUCCESS"}');
  f.stderr.write("private credentials must not be retained");
  f.events.emit("close", 0);
  assert.deepEqual(await result, { status: "SUCCESS" });
  assert.equal(f.cleanups(), 1);
});

test("timeout, cancellation and output limits always terminate the owned process exactly once", async () => {
  const timeout = processFixture({ timeoutMs: 2 });
  await assert.rejects(timeout.run(codexRequest, signal()), /timed out/);
  assert.equal(timeout.cleanups(), 1);
  const abort = processFixture();
  const controller = new AbortController();
  const result = abort.run(codexRequest, controller.signal);
  controller.abort();
  await assert.rejects(result, /canceled/);
  abort.stdout.write('{"id":1,"result":{}}\n');
  assert.equal(abort.writes.length, 1);
  assert.equal(abort.cleanups(), 1);
  const already = processFixture();
  await assert.rejects(already.run(codexRequest, controller.signal), /canceled/);
  assert.equal(already.spawns(), 0);
  for (const channel of ["stdout", "stderr"] as const) {
    const output = processFixture({ maxOutputBytes: 32 });
    const pending = output.run(jsonRequest, signal());
    output[channel].write("secret".repeat(100));
    await assert.rejects(pending, /output exceeded safety limit/);
    assert.equal(output.cleanups(), 1);
  }
});

test("missing executables, protocol errors, invalid JSON and nonzero exits have safe errors", async () => {
  const cases: ((f: ReturnType<typeof processFixture>) => void)[] = [
    (f) => f.events.emit("error", Object.assign(new Error("private path and account"), { code: "ENOENT" })),
    (f) => f.stdout.write('{"id":1,"error":{"message":"raw secret"}}\n'),
    (f) => f.stdout.write('raw private malformed output\n'),
    (f) => f.events.emit("close", 1),
  ];
  for (const fail of cases) {
    const f = processFixture();
    const result = f.run(codexRequest, signal());
    fail(f);
    await assert.rejects(result, (error: Error) => {
      assert(!/private|secret/.test(error.message));
      return true;
    });
    assert.equal(f.cleanups(), 1);
  }
});

test("Windows resolves actual .exe or .cmd safely without generic shell execution", () => {
  const executable = resolveLaunch(codexRequest, "win32", { PATH: "C:\\bin" }, (p) => String(p) === "C:\\bin\\codex.exe");
  assert.deepEqual(executable, { file: "C:\\bin\\codex.exe", args: ["app-server"] });
  const shim = resolveLaunch(codexRequest, "win32", { PATH: "C:\\Program Files\\npm", ComSpec: "C:\\Windows\\System32\\cmd.exe" }, (p) => String(p).endsWith("codex.cmd"));
  assert.deepEqual(shim, { file: "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", '""C:\\Program Files\\npm\\codex.cmd" "app-server""'], windowsVerbatimArguments: true });
  assert.throws(() => resolveLaunch(codexRequest, "win32", { PATH: "C:\\unsafe&path" }, (p) => String(p).endsWith("codex.cmd")), /safely|^$/);
  assert.throws(() => resolveLaunch(codexRequest, "win32", { PATH: "" }, () => false), /not installed/);
  assert.deepEqual(resolveLaunch(jsonRequest, "linux"), { file: "agy", args: ["-p", "/usage", "--output-format", "json"] });
});


test("tree cleanup targets only owned POSIX group and Windows PID tree with bounded taskkill fallback", async () => {
  function childFixture(pid: number | undefined) {
    const stdin = new PassThrough();
    const signals: (string | number | undefined)[] = [];
    const child = { pid, stdin, kill: (signal?: string | number) => { signals.push(signal); return true; } } as unknown as ChildProcessWithoutNullStreams;
    return { child, stdin, signals };
  }
  const posix = childFixture(123);
  const groups: number[] = [];
  await createTreeTerminator({ platform: "linux", killGroup: (pid) => { groups.push(pid); } })(posix.child);
  assert.deepEqual(groups, [123]); assert.equal(posix.stdin.destroyed, true); assert.deepEqual(posix.signals, []);
  await createTreeTerminator({ platform: "linux", killGroup: () => { throw new Error("already exited"); } })(posix.child);
  assert.deepEqual(posix.signals, ["SIGKILL"]);
  const missing = childFixture(undefined);
  await createTreeTerminator({ platform: "linux", killGroup: () => assert.fail("missing PID must not kill any group") })(missing.child);
  for (const timeout of [false, true]) {
    const windows = childFixture(456);
    const events = new EventEmitter();
    let killerKilled = false;
    const killer = Object.assign(events, { kill: () => { killerKilled = true; } });
    const targets: number[] = [];
    let deadline!: () => void;
    let canceled = false;
    const clean = createTreeTerminator({
      platform: "win32",
      taskkill: (pid) => { targets.push(pid); return killer as any; },
      after: (callback, ms) => { assert.equal(ms, 1000); deadline = callback; return 1; },
      cancelAfter: (handle) => { assert.equal(handle, 1); canceled = true; },
    })(windows.child);
    assert.deepEqual(targets, [456]);
    if (timeout) deadline(); else events.emit("exit", 0);
    await clean;
    assert.equal(killerKilled, timeout); assert.equal(canceled, true);
    assert.equal(windows.stdin.destroyed, true); assert.equal(windows.signals.length, 1);
    events.emit("exit", 0);
    assert.equal(windows.signals.length, 1);
  }
});
