import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ClaudeUsageError, readClaudeUsageAt } from "../lib/provider-usage/claude.ts";
import { detailText, parseClaude } from "../lib/provider-usage/model.ts";
import { createProcessRunner, UsageReadError, type ProcessRequest } from "../lib/provider-usage/readers.ts";

const request = {
  command: "claude",
  args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"],
  protocol: "claude",
} satisfies ProcessRequest;
const initialize = { type: "control_request", request_id: "usage-init", request: { subtype: "initialize" } };
const getUsage = { type: "control_request", request_id: "usage-read", request: { subtype: "get_usage", skip_behaviors: true } };
const signal = () => new AbortController().signal;
const success = (id: string, response: unknown) => ({
  type: "control_response", response: { subtype: "success", request_id: id, response },
});

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
    launch: (r) => ({ file: r.command, args: [...r.args] }),
    spawn: () => { spawns++; return child; },
    terminate: async () => { cleanups++; },
    ...options,
  });
  const send = (message: unknown) => stdout.write(JSON.stringify(message) + "\n");
  return { run, writes, stdout, stderr, events, send, cleanups: () => cleanups, spawns: () => spawns };
}

const usage = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 23, resets_at: "2026-10-23T15:00:00Z" },
    seven_day: { utilization: 41, resets_at: "2026-10-26T15:00:00Z" },
    spend: {
      enabled: true,
      used: { amount_minor: 1234, currency: "USD", exponent: 2 },
      limit: { amount_minor: 50000, currency: "USD", exponent: 2 },
    },
    extra_usage: null,
  },
};

test("Claude handshake frames fragments, matches IDs, denies permissions and resolves only get_usage", async () => {
  const f = processFixture();
  const pending = f.run(request, signal());
  assert.deepEqual(f.writes, [initialize]);
  f.send(success("other-init", {}));
  f.send(success("usage-read", { premature: true }));
  f.send({ type: "system", subtype: "init", session_id: "not-retained" });
  assert.deepEqual(f.writes, [initialize]);
  const initialized = JSON.stringify(success("usage-init", { commands: ["not-retained"] }));
  f.stdout.write(initialized.slice(0, 31));
  assert.deepEqual(f.writes, [initialize]);
  f.stdout.write(initialized.slice(31) + "\n");
  assert.deepEqual(f.writes, [initialize, getUsage]);
  f.send(success("usage-init", {}));
  f.send(success("other-read", { unrelated: true }));
  assert.deepEqual(f.writes, [initialize, getUsage]);
  f.send({ type: "control_request", request_id: "permission-1", request: {
    subtype: "can_use_tool", tool_name: "Bash", input: { command: "do-not-run" }, tool_use_id: "tool-1",
  } });
  assert.equal(f.writes.length, 3);
  const denial = f.writes[2] as { type: string; response: { subtype: string; request_id: string; response: { behavior: string } } };
  assert.equal(denial.type, "control_response");
  assert.equal(denial.response.subtype, "success");
  assert.equal(denial.response.request_id, "permission-1");
  assert.equal(denial.response.response.behavior, "deny");
  const reply = JSON.stringify(success("usage-read", usage));
  f.stdout.write(reply.slice(0, 57));
  assert.equal(f.cleanups(), 0);
  f.stdout.write(reply.slice(57) + "\n");
  assert.deepEqual(await pending, usage);
  assert.equal(f.cleanups(), 1);
  f.send(success("usage-read", { duplicate: true }));
  f.events.emit("close", 0);
  assert.equal(f.cleanups(), 1);
  assert.equal(f.writes.length, 3);
  assert(!f.writes.some((write) => ["user", "assistant"].includes((write as { type: string }).type)));
});

test("profile reader uses live control usage, not yesterday's cache, and projects only four fields", async () => {
  const requests: ProcessRequest[] = [];
  const controller = new AbortController();
  const raw = await readClaudeUsageAt(async (r, s) => {
    requests.push(r);
    assert.equal(s, controller.signal);
    return {
      ...usage, fetchedAtMs: Date.parse("2026-10-22T10:00:00Z"), accountUuid: "secret-account", accessToken: "secret-token",
      rate_limits: { ...usage.rate_limits, seven_day_opus: { utilization: 99 }, emailAddress: "secret@example.com" },
    };
  }, controller.signal, "/cfg-personal");
  assert.deepEqual(requests, [{ ...request, env: { CLAUDE_CONFIG_DIR: "/cfg-personal", ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: undefined, DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", DISABLE_AUTOUPDATER: "1" } }]);
  assert.deepEqual(raw, { utilization: usage.rate_limits });
  assert(!JSON.stringify(raw).match(/secret|fetchedAt|seven_day_opus/));
  const parsed = parseClaude(raw);
  assert(parsed.kind === "spend");
  assert.equal(parsed.fetchedAt, undefined);
  assert.equal(parsed.windows[0].usedPercent, 23);
  assert(!detailText([{ id: "claude-personal", name: "Claude Personal", status: "available", value: parsed }]).includes("cache fetched"));
});

test("personal usage enables account requests without enabling telemetry or changing the parent environment", async () => {
  const before = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  try {
    const raw = await readClaudeUsageAt(async (r) => {
      assert.deepEqual(r.env, {
        CLAUDE_CONFIG_DIR: "/cfg-personal",
        ANTHROPIC_API_KEY: undefined,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: undefined,
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        DISABLE_AUTOUPDATER: "1",
      });
      assert.equal(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
      return usage;
    }, signal(), "/cfg-personal");
    assert.equal(parseClaude(raw).kind, "spend");
    assert.equal(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = before;
  }
});

test("Claude usage child omits the traffic blocker while preserving privacy opt-outs", async () => {
  const before = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  try {
    const run = createProcessRunner({ launch: () => ({ file: process.execPath, args: ["-e", `
      console.log(JSON.stringify({
        trafficAbsent: !('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' in process.env),
        apiKeyAbsent: !('ANTHROPIC_API_KEY' in process.env),
        telemetry: process.env.DISABLE_TELEMETRY,
        reporting: process.env.DISABLE_ERROR_REPORTING,
        updater: process.env.DISABLE_AUTOUPDATER,
        configDir: process.env.CLAUDE_CONFIG_DIR
      }));
    `] }) });
    await readClaudeUsageAt(async (r, s) => {
      const childEnv = await run({ ...r, protocol: undefined }, s);
      assert.deepEqual(childEnv, {
        trafficAbsent: true, apiKeyAbsent: true, telemetry: "1", reporting: "1", updater: "1", configDir: "/cfg-personal",
      });
      return usage;
    }, signal(), "/cfg-personal");
    assert.equal(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = before;
  }
});

test("unavailable or null Claude rate limits reject safely without falling back to disk", async () => {
  for (const response of [
    { rate_limits_available: false, rate_limits: usage.rate_limits, error: "secret-token" },
    { rate_limits_available: true, rate_limits: null, error: "secret-token" },
    { rate_limits_available: false, rate_limits: null },
  ]) {
    await assert.rejects(readClaudeUsageAt(async () => response, signal(), "/private-profile"), (error: Error) => {
      assert(error instanceof ClaudeUsageError);
      assert.match(error.message, /usage unavailable/i);
      assert.match(error.message, /check.*CLI login/i);
      assert(!/secret|private-profile/.test(error.message));
      return true;
    });
  }
});

test("Claude protocol errors, malformed output and EOF without matching usage reject safely", async () => {
  for (const failure of ["initialize", "usage", "malformed", "eof"] as const) {
    const f = processFixture();
    const pending = f.run(request, signal());
    f.stderr.write("secret stderr /private-profile");
    if (failure !== "initialize") f.send(success("usage-init", {}));
    if (failure === "initialize" || failure === "usage") {
      f.send({ type: "control_response", response: {
        subtype: "error", request_id: failure === "initialize" ? "usage-init" : "usage-read",
        error: "secret-token /private-profile",
      } });
    } else if (failure === "malformed") {
      f.stdout.write("secret malformed JSON\n");
    } else {
      f.send({ type: "result", is_error: false, local_command: "usage", num_turns: 0 });
      f.stdout.end();
      f.events.emit("close", 0);
    }
    await assert.rejects(pending, (error: Error) => {
      assert(error instanceof UsageReadError);
      assert(!/secret|private-profile/.test(error.message));
      return true;
    });
    assert.equal(f.cleanups(), 1);
    f.events.emit("close", 1);
    assert.equal(f.cleanups(), 1);
  }
});

test("Claude timeout, cancellation and output limits clean up once and never send later usage requests", async () => {
  const timeout = processFixture({ timeoutMs: 2 });
  await assert.rejects(timeout.run(request, signal()), /timed out/i);
  assert.equal(timeout.cleanups(), 1);
  timeout.send(success("usage-init", {}));
  assert.deepEqual(timeout.writes, [initialize]);

  const aborted = processFixture();
  const controller = new AbortController();
  const pending = aborted.run(request, controller.signal);
  controller.abort();
  await assert.rejects(pending, /canceled/i);
  aborted.send(success("usage-init", {}));
  aborted.events.emit("close", 0);
  assert.deepEqual(aborted.writes, [initialize]);
  assert.equal(aborted.cleanups(), 1);
  const already = processFixture();
  await assert.rejects(already.run(request, controller.signal), /canceled/i);
  assert.equal(already.spawns(), 0);
  assert.equal(already.cleanups(), 0);

  for (const channel of ["stdout", "stderr"] as const) {
    const f = processFixture({ maxOutputBytes: 32 });
    const result = f.run(request, signal());
    f[channel].write("secret".repeat(100));
    await assert.rejects(result, /output exceeded safety limit/i);
    f.send(success("usage-init", {}));
    f.events.emit("close", 0);
    assert.deepEqual(f.writes, [initialize]);
    assert.equal(f.cleanups(), 1);
  }
});
